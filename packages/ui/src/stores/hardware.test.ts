import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { MODEL_KEY } from '@llama-launcher/shared';
import type { TargetRecommendation, VramEstimateResult } from '@llama-launcher/shared';
import { useHardwareStore } from './hardware';
import { useParamsStore } from './params';

vi.useFakeTimers();

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.runOnlyPendingTimers();
});

// ---- window.api 桩：只用到 system.estimateVram（真实链路里它是唯一承载设备与占用的通道） ----
interface EstimateCall {
  path: string;
  dtype: string;
  target: string;
  occ: { ngl?: string; ctxSize?: number; kvDtype?: string };
}
let estimateCalls: EstimateCall[] = [];
let estimateResult: VramEstimateResult | null = null;

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = (globalThis as any).window.api ?? {
  models: {
    detectMmproj: () => Promise.resolve(''),
    detectDraft: () => Promise.resolve(''),
    readGgufMeta: () => Promise.resolve(null),
  },
  system: {
    estimateVram: (path: string, dtype: string, target: string, occ: EstimateCall['occ']) => {
      estimateCalls.push({ path, dtype, target, occ });
      return Promise.resolve(estimateResult);
    },
  },
};

/** 占用估算结果的最小构造：只填与断言相关的字段 */
function occOf(vramWeights: number | null, ramWeights: number | null): VramEstimateResult['occupancy'] {
  const side = (w: number | null) => ({
    weightsMiB: w, kvMiB: 0, reserveMiB: 1024,
    totalMiB: w === null ? null : w + 1024,
    capacityMiB: 24560, availableMiB: 23749,
    fits: w !== null && w + 1024 <= 23749,
  });
  return {
    vram: side(vramWeights),
    ram: { ...side(ramWeights), reserveMiB: 512, capacityMiB: 32768, availableMiB: 21000 },
    contextTokens: 32768,
    offloadLayers: 64,
    totalLayers: 64,
    maxContext: 20480,
  };
}

/** 一份完整估算结果（devices / occupancy / recommendations 可按用例覆写） */
function resultOf(part: Partial<VramEstimateResult> = {}): VramEstimateResult {
  return {
    devices: [{ id: 'Vulkan0', name: 'AMD Radeon RX 7900 XTX', totalMiB: 24560, freeMiB: 23749 }],
    weightsMiB: 19968,
    kvLayers: 64,
    kvBytesPerToken: 139264,
    maxContext: 20480,
    fullOffloadFits: true,
    dtype: 'q8_0',
    target: 'balanced',
    recommendations: [],
    occupancy: occOf(19968, 0),
    probeError: null,
    ...part,
  };
}

function reliefRec(part: Partial<TargetRecommendation> & { key: string }): TargetRecommendation {
  return { value: 1, reasonKey: 'offload_rec_ngl', offloadRelief: true, ...part };
}

/** 让 enter() 里那次异步 refresh 落地 */
async function settle() {
  await vi.runOnlyPendingTimersAsync();
}

/**
 * 模块级桩状态必须逐条用例重置：`estimateResult` 与 `estimateCalls` 是跨用例句柄，
 * 不重置会让下一条用例读到上一条的载荷、也让「一次都不发请求」这类计数断言被前序调用污染。
 * 声明位置在本文件第 25-26 行（回调在测试期执行，那时已完成初始化）。
 */
beforeEach(() => {
  estimateCalls = [];
  estimateResult = null;
});

describe('hardware store · relief（减负建议按标记分流）', () => {
  it('只取带 offloadRelief 标记的条目，目标建议留给参数页', async () => {
    estimateResult = resultOf({
      recommendations: [
        { key: 'flash_attn', value: 'on', reasonKey: 'target_rec_fa' },
        reliefRec({ key: 'cpu_moe', value: true, reasonKey: 'offload_rec_cmoe' }),
      ],
    });
    const params = useParamsStore();
    params.set(MODEL_KEY, 'D:/Models/a.gguf');
    const hw = useHardwareStore();
    const release = hw.enter();
    await settle();
    expect(hw.relief.map((r) => r.key)).toEqual(['cpu_moe']);
    release();
  });

  it('会话里已经是这个值 ⇒ 不再建议（点了也不会改变什么）', async () => {
    estimateResult = resultOf({
      recommendations: [reliefRec({ key: 'cpu_moe', value: true }), reliefRec({ key: 'gpu_layers', value: 27 })],
    });
    const params = useParamsStore();
    params.set(MODEL_KEY, 'D:/Models/a.gguf');
    params.set('cpu_moe', true);
    const hw = useHardwareStore();
    const release = hw.enter();
    await settle();
    expect(hw.relief.map((r) => r.key)).toEqual(['gpu_layers']);
    release();
  });

  it('判据不在此重算：core 没发减负条目就是「放得下」，界面闭嘴', async () => {
    estimateResult = resultOf({ recommendations: [{ key: 'ctx_size', value: 8192, reasonKey: 'target_rec_ctx_full' }] });
    const params = useParamsStore();
    params.set(MODEL_KEY, 'D:/Models/a.gguf');
    const hw = useHardwareStore();
    const release = hw.enter();
    await settle();
    expect(hw.relief).toEqual([]);
    release();
  });
});

describe('hardware store · 取数时机（keep-alive 铁律①：可见才取数）', () => {
  it('没有模型路径 ⇒ 一次都不发请求', async () => {
    estimateResult = resultOf();
    const hw = useHardwareStore();
    const release = hw.enter();
    await settle();
    expect(estimateCalls).toHaveLength(0);
    release();
  });

  it('enter 取一次；release 之后改参数不再取数（后台页不敲主进程）', async () => {
    estimateResult = resultOf();
    estimateCalls = [];
    const params = useParamsStore();
    params.set(MODEL_KEY, 'D:/Models/a.gguf');
    const hw = useHardwareStore();
    const release = hw.enter();
    await settle();
    expect(estimateCalls).toHaveLength(1);
    expect(estimateCalls[0].occ.ngl).toBe(params.values.gpu_layers);
    expect(estimateCalls[0].occ.ctxSize).toBe(Number(params.values.ctx_size));

    params.set('gpu_layers', '27');
    await vi.advanceTimersByTimeAsync(400); // 去抖窗口之后应当重发一次
    expect(estimateCalls).toHaveLength(2);
    expect(estimateCalls[1].occ.ngl).toBe('27');

    release();
    params.set('gpu_layers', '12');
    await vi.advanceTimersByTimeAsync(1000);
    expect(estimateCalls).toHaveLength(2);
  });

  it('两个订阅者共享一次取数；release 幂等，退到 0 人才停止', async () => {
    estimateResult = resultOf();
    estimateCalls = [];
    const params = useParamsStore();
    params.set(MODEL_KEY, 'D:/Models/a.gguf');
    const hw = useHardwareStore();
    const relA = hw.enter();
    const relB = hw.enter();
    await settle();
    expect(estimateCalls).toHaveLength(1);

    relA();
    relA(); // 重复 release 不得把计数减成负数（否则另一张卡的订阅提前失效）
    params.set('ctx_size', 8192);
    await vi.advanceTimersByTimeAsync(400);
    expect(estimateCalls).toHaveLength(2);

    relB();
    params.set('ctx_size', 4096);
    await vi.advanceTimersByTimeAsync(400);
    expect(estimateCalls).toHaveLength(2);
  });
});
