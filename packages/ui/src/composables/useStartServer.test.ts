/**
 * 统一启动/重启前置校验（useStartServer）的协调逻辑。
 * 组合式本身不实现任何store行为——它把「同步校验 → 端口冲突处置 → 异步校验 → 启动」
 * 串成一条链，这里桩掉四个 store、router、弹窗与 system IPC，专守**编排判据**：
 *  - 各缺失项的错误消息与「跳转 /models 引导」的触发条件（needExe/needModelsDir/needModel 才跳，
 *    端口非法不跳）；
 *  - 重启跳过端口占用检查（当前进程正占着端口，检查必然误报）；
 *  - 端口冲突弹窗的动作集合随占用者身份变化（llama-server 才有「接管监控」，有 PID 才有「结束进程」）；
 *  - 「结束占用进程」后端口释放可能滞后：轮询重探而不是一锤子判定。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- 桩：四个 store + router + confirm + i18n ----
const routerPush = vi.fn();

/** 弹窗的选择结果（动作 key），每条用例改写 */
let confirmChoice = '';
/** 最近一次弹窗收到的动作表（断言「按占用者身份给选项」用） */
let lastConfirmActions: Array<{ key: string; labelKey: string }> = [];

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@/composables/useConfirm', () => ({
  confirm: async (opts: { actions?: Array<{ key: string; labelKey: string }> }) => {
    lastConfirmActions = opts.actions ?? [];
    return confirmChoice;
  },
}));

vi.mock('@/stores/i18n', () => ({
  useI18nStore: () => ({ t: (k: string, args?: (string | number)[]) => `${k}|${args?.length ?? 0}` }),
}));

// store 桩：只提供组合式真正读写的成员（shared 的 LLAMA_SERVER_NAME_RE 用真值，
// 「占用者是否 llama-server」的判别属于组合式的行为）
vi.mock('@/stores/server', () => ({
  LLAMA_SERVER_NAME_RE: /llama[-_]?ser/i,
  useServerStore: () => serverMock,
}));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => settingsMock }));
vi.mock('@/stores/params', () => ({ useParamsStore: () => paramsMock }));
vi.mock('@/stores/appLog', () => ({ useAppLogStore: () => appLogMock }));

import { useStartServer } from './useStartServer';

const serverMock = {
  pushOutput: vi.fn(),
  start: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
  adoptExternal: vi.fn(),
};
const appLogMock = { push: vi.fn() };
const settingsMock = {
  settings: {
    server_exe: 'D:/llama/llama-server.exe',
    models_dir: 'D:/models',
  } as Record<string, string> | null,
};
const paramsMock = {
  values: { model: 'D:/models/m.gguf', port: 8080, host: '127.0.0.1' } as Record<string, unknown>,
  snapshot: () => ({ ...paramsMock.values }),
  set: (k: string, v: unknown) => { paramsMock.values[k] = v; },
};

// ---- window.api.system 桩（组合式直接调用的四个 IPC）----
let fileExistsResult = true;
let checkPortResult: { inUse: boolean; pid?: number; name?: string } | null = null;
let checkPortCalls: Array<{ port: number; host?: string }> = [];
let killResult: { ok: boolean; error?: string } = { ok: true };
let freePortResult: number | null = 8081;
/** 个别用例替换整个探测行为（如「杀后释放」的多次返回序列）；beforeEach 复位。
 *  允许返回 Promise：个别用例用异步桩模拟「杀进程后再探测」的两段结果 */
let checkPortImpl: (
  port: number,
  host?: string,
) => { inUse: boolean; pid?: number; name?: string } | null | Promise<{ inUse: boolean; pid?: number; name?: string }> = (
  port: number,
  host?: string,
) => {
  checkPortCalls.push({ port, host });
  return checkPortResult;
};

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  system: {
    fileExists: vi.fn(async () => fileExistsResult),
    checkPort: vi.fn(async (port: number, host?: string) => checkPortImpl(port, host)),
    killProcess: vi.fn(async () => killResult),
    findFreePort: vi.fn(async () => freePortResult),
  },
};

/** appLog.push 收到的消息序列（[Launcher] 前缀后的正文）——应用级事件走应用日志而非控制台 */
function pushedMessages(): string[] {
  return appLogMock.push.mock.calls.map((c: unknown[]) => String((c[0] as { data: string }).data));
}

beforeEach(() => {
  vi.clearAllMocks();
  routerPush.mockReset();
  confirmChoice = '';
  lastConfirmActions = [];
  settingsMock.settings = { server_exe: 'D:/llama/llama-server.exe', models_dir: 'D:/models' };
  paramsMock.values = { model: 'D:/models/m.gguf', port: 8080, host: '127.0.0.1' };
  fileExistsResult = true;
  checkPortResult = null;
  checkPortCalls = [];
  killResult = { ok: true };
  freePortResult = 8081;
  checkPortImpl = (port: number, host?: string) => {
    checkPortCalls.push({ port, host });
    return checkPortResult;
  };
});

describe('useStartServer - 同步校验（checkSync）', () => {
  it('全部就绪 → ok:true，不做任何跳转与报错', async () => {
    const { start } = useStartServer();
    await start();
    expect(routerPush).not.toHaveBeenCalled();
    expect(pushedMessages()).toEqual([]);
  });

  it('无设置对象 → 报 msg_no_exe，不引导跳转（无从判断该去哪页）', async () => {
    settingsMock.settings = null;
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain('msg_no_exe|0');
    expect(routerPush).not.toHaveBeenCalled();
  });

  it.each([
    ['server_exe', 'msg_no_exe_hint'],
    ['models_dir', 'msg_no_models_dir_hint'],
    ['model', 'msg_no_model'],
  ])('%s 缺失 → 报错并引导到模型管理页', async (key, msg) => {
    if (key === 'model') paramsMock.values.model = '';
    else settingsMock.settings = { server_exe: 'x', models_dir: 'y', [key]: '' } as Record<string, string>;
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain(msg);
    expect(routerPush, `${key} 缺失必须跳 /models 引导配置`).toHaveBeenCalledWith('/models');
  });

  it('端口越界 → 报错但**不**跳转（模型与引擎都已就绪，去模型页无意义）', async () => {
    paramsMock.values.port = 99999;
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain('err_invalid_port|2');
    expect(routerPush).not.toHaveBeenCalled();
  });
});

describe('useStartServer - 异步校验与启动', () => {
  it('exe 不存在 → 报 msg_exe_not_found 并带路径，不启动', async () => {
    fileExistsResult = false;
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain('msg_exe_not_found|0');
    expect(serverMock.start).not.toHaveBeenCalled();
  });

  it('首次启动做端口占用检查，并按 --host 的地址探测', async () => {
    await useStartServer().start();
    // start() 里一次冲突预处理探测 + launch→checkAsync 一次，共两次，都带 host
    expect(checkPortCalls.length).toBe(2);
    expect(checkPortCalls[0]).toEqual({ port: 8080, host: '127.0.0.1' });
    expect(serverMock.start).toHaveBeenCalledTimes(1);
  });

  it('端口空闲 → 正常启动，参数快照原样下发', async () => {
    await useStartServer().start();
    expect(serverMock.start).toHaveBeenCalledWith(expect.objectContaining({ model: 'D:/models/m.gguf' }), settingsMock.settings);
  });

  it('restart 跳过端口占用检查（当前进程正占着端口，检查必然误报）', async () => {
    checkPortResult = { inUse: true, pid: 100, name: 'llama-server.exe' };
    const ok = await useStartServer().restart();
    expect(ok).toBe(true);
    expect(checkPortCalls, '重启路径不得探测端口').toEqual([]);
    expect(serverMock.restart).toHaveBeenCalledTimes(1);
    expect(serverMock.start).not.toHaveBeenCalled();
  });
});

describe('useStartServer - 端口冲突处置', () => {
  function busyBy(name: string, pid?: number) {
    checkPortResult = { inUse: true, pid, name };
  }

  it('占用者是 llama-server：动作含「接管监控」，选它 → adoptExternal 记录实例且不启动', async () => {
    busyBy('llama-server.exe', 4321);
    confirmChoice = 'adopt';
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(lastConfirmActions.map((a) => a.key)).toContain('adopt');
    expect(serverMock.adoptExternal).toHaveBeenCalledWith({ pid: 4321, name: 'llama-server.exe', port: 8080, host: '127.0.0.1' });
    expect(serverMock.start).not.toHaveBeenCalled();
  });

  it('占用者与 llama-server 无关：动作表没有「接管监控」', async () => {
    busyBy('chrome.exe', 99);
    confirmChoice = '';
    await useStartServer().start();
    expect(lastConfirmActions.map((a) => a.key)).not.toContain('adopt');
  });

  it('占用者无 PID：不提供「结束进程」选项（无从定向杀）', async () => {
    busyBy('未知进程');
    confirmChoice = '';
    await useStartServer().start();
    expect(lastConfirmActions.map((a) => a.key)).not.toContain('kill');
  });

  it('选「结束进程」且杀成功、端口随即释放 → 继续启动', async () => {
    busyBy('other.exe', 7);
    confirmChoice = 'kill';
    // 首查 inUse；杀后再查 → 已释放
    let calls = 0;
    checkPortImpl = async () => {
      calls++;
      return calls === 1 ? { inUse: true, pid: 7, name: 'other.exe' } : { inUse: false };
    };
    const ok = await useStartServer().start();
    expect(ok).toBe(true);
    expect(pushedMessages().join('\n')).toContain('msg_port_owner_killed|1');
    expect(serverMock.start).toHaveBeenCalledTimes(1);
  });

  it('杀成功但端口迟迟不释放 → 轮询重探若干次后报 msg_port_still_busy 放弃', async () => {
    vi.useFakeTimers();
    try {
      busyBy('other.exe', 7);
      confirmChoice = 'kill';
      // 始终 inUse：释放滞后场景
      const okPromise = useStartServer().start();
      // 释放轮询 5 次 × 400ms（首次不等待）：把定时器推到底
      await vi.advanceTimersByTimeAsync(5 * 400 + 50);
      const ok = await okPromise;
      expect(ok).toBe(false);
      expect(pushedMessages().join('\n')).toContain('msg_port_still_busy|1');
      expect(serverMock.start).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('杀失败 → 报 msg_kill_failed，不启动', async () => {
    busyBy('other.exe', 7);
    confirmChoice = 'kill';
    killResult = { ok: false, error: 'access denied' };
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain('msg_kill_failed|1');
    expect(serverMock.start).not.toHaveBeenCalled();
  });

  it('选「换用空闲端口」→ 扫到的端口写回参数并继续启动，后续检查用新端口', async () => {
    busyBy('other.exe', 7);
    confirmChoice = 'change';
    freePortResult = 8090;
    // 换端口后的 launch→checkAsync 探测新端口且空闲
    let calls = 0;
    checkPortImpl = async () => {
      calls++;
      return calls === 1 ? { inUse: true, pid: 7, name: 'other.exe' } : { inUse: false };
    };
    const ok = await useStartServer().start();
    expect(ok).toBe(true);
    expect(paramsMock.values.port, '扫到的空闲端口必须写回参数（后续校验与命令预览同步）').toBe(8090);
    expect(serverMock.start).toHaveBeenCalledTimes(1);
  });

  it('扫不到空闲端口 → 报 msg_free_port_not_found，不启动', async () => {
    busyBy('other.exe', 7);
    confirmChoice = 'change';
    freePortResult = null;
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain('msg_free_port_not_found|2');
    expect(serverMock.start).not.toHaveBeenCalled();
  });

  it('取消冲突处置 → 停止流程，冲突提示保留在控制台', async () => {
    busyBy('other.exe', 7);
    confirmChoice = '';
    const ok = await useStartServer().start();
    expect(ok).toBe(false);
    expect(pushedMessages().join('\n')).toContain('msg_port_in_use|1');
    expect(serverMock.start).not.toHaveBeenCalled();
  });
});
