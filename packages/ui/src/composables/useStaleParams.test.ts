/**
 * 「运行中 ≠ 当前参数」差异数信号源（useStaleParams）的状态门控。
 * 守的判据（2026-10-09 收敛为全站唯一信号源——设置页引擎提示 / 参数页提示槽 /
 * 顶栏重启钮注意力态三处同源，此处钉死口径防第二套实现回潮）：
 *  - 未运行（stopped/stopping）恒 0，且不触碰 countDiffers（未运行就不比）；
 *  - running/starting 才把 runningValues 交给 params.countDiffers 比对，返回其值；
 *  - runningValues 为 null（服务在跑但无快照，如接管的外部实例）→ countDiffers
 *    自身返回 0（params store 已测，这里只钉「调用发生且结果为 0」）；
 *  - 状态在 stopped→starting→running→stopping 间切换时计数即时跟随（响应性，
 *    顶栏按钮的注意力态靠它即时点亮/熄灭）。
 * 桩掉两个 store（组合式契约就是「读 server 状态 + 委托 params 比较」，不实现任何
 * store 行为）；countDiffers 的比较口径（忽略自动检测字段等）归 params.test.ts。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

// ---- store 桩：只提供组合式真正读的成员 ----
const serverState = reactive<{
  status: string;
  runningValues: Record<string, string | number | boolean> | null;
}>({ status: 'stopped', runningValues: null });

/** countDiffers 的返回值（每条用例改写）；记录最近一次收到的 other 快照 */
let diffResult = 0;
const countDiffersMock = vi.fn((_other: Record<string, string | number | boolean> | null | undefined) => diffResult);

vi.mock('@/stores/server', () => ({
  useServerStore: () => serverState,
}));
vi.mock('@/stores/params', () => ({
  useParamsStore: () => ({ countDiffers: countDiffersMock }),
}));

import { useStaleParams } from './useStaleParams';

beforeEach(() => {
  serverState.status = 'stopped';
  serverState.runningValues = null;
  diffResult = 0;
  countDiffersMock.mockClear();
});

describe('useStaleParams', () => {
  it('未运行（stopped）恒 0，且不触发比对', () => {
    serverState.runningValues = { ctx_size: '4096' };
    diffResult = 5;
    const stale = useStaleParams();
    expect(stale.value).toBe(0);
    expect(countDiffersMock).not.toHaveBeenCalled();
  });

  it('stopping 同样恒 0：停止中的服务不再持有「运行中参数」', () => {
    serverState.status = 'stopping';
    serverState.runningValues = { ctx_size: '4096' };
    diffResult = 3;
    const stale = useStaleParams();
    expect(stale.value).toBe(0);
    expect(countDiffersMock).not.toHaveBeenCalled();
  });

  it('running 时把 runningValues 交给 countDiffers 并透传结果', () => {
    serverState.status = 'running';
    const snapshot = { ctx_size: '4096', temp: '0.8' };
    serverState.runningValues = snapshot;
    diffResult = 2;
    const stale = useStaleParams();
    expect(stale.value).toBe(2);
    expect(countDiffersMock).toHaveBeenCalledWith(snapshot);
  });

  it('starting 也计入口径（对齐 GeneralPanel 原实现：启动中即可能已有运行快照）', () => {
    serverState.status = 'starting';
    serverState.runningValues = { ctx_size: '8192' };
    diffResult = 1;
    const stale = useStaleParams();
    expect(stale.value).toBe(1);
    expect(countDiffersMock).toHaveBeenCalledWith({ ctx_size: '8192' });
  });

  it('服务在跑但无快照（null）：比对仍发生，结果为 0', () => {
    serverState.status = 'running';
    serverState.runningValues = null;
    const stale = useStaleParams();
    expect(stale.value).toBe(0);
    expect(countDiffersMock).toHaveBeenCalledWith(null);
  });

  it('状态切换即时跟随：stopped→running 点亮、running→stopping 熄灭（顶栏注意力态依赖此响应性）', () => {
    const stale = useStaleParams();
    expect(stale.value).toBe(0);

    serverState.status = 'running';
    serverState.runningValues = { ctx_size: '4096' };
    diffResult = 4;
    expect(stale.value).toBe(4);

    serverState.status = 'stopping';
    expect(stale.value).toBe(0);
  });

  it('快照内容变化即时跟随：同一运行态下 runningValues 更新，计数重算', () => {
    serverState.status = 'running';
    serverState.runningValues = { ctx_size: '4096' };
    diffResult = 1;
    const stale = useStaleParams();
    expect(stale.value).toBe(1);

    serverState.runningValues = { ctx_size: '4096', temp: '0.8', top_k: '20' };
    diffResult = 3;
    expect(stale.value).toBe(3);
  });
});
