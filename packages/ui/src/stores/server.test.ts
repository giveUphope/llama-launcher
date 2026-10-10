import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import type { ServerStatus, ServerStatusEvent, ServerStopInfo, PropsCheck, OutputEntry } from '@llama-launcher/shared';
import { formatLogTime } from './appLog';
import { LLAMA_SERVER_NAME_RE, PORT_BUSY_RE, PROPS_POLL_MAX_MS, PROPS_POLL_MAX_STEPS, propsPollDelayMs, useServerStore } from './server';

// i18n 桩的 lang 用真实 ref（模块导入期由 factory 填充），控制台行时间串的「切语言整表重算」才有响应式可测
const i18nStub = vi.hoisted(() => ({ lang: null as { value: string } | null }));

// —— window.api 桩：捕获 onOutputBatch/onStatus 回调，getStatus 返回可控的主进程状态 ——
type StatusCb = (e: ServerStatusEvent) => void;
type OutputCb = (entries: any[]) => void;
let statusCb: StatusCb = () => {};
let outputCb: OutputCb = () => {};
let mainStatus: any = { status: 'stopped', pid: null, host: '127.0.0.1', port: 8080, url: '', values: {} };
// checkPort 桩返回值（外部实例探测用），null 模拟 mock 环境无响应
let checkPortResult: { inUse: boolean; pid?: number; name?: string } | null = { inUse: false };
/** 每次 getStatus 的调用记录（refresh 标志决定主进程要不要敲端口做 /props 回读） */
let statusCalls: Array<{ refresh: boolean }> = [];

/** 带 refresh 的拉取次数 = 「敲了一次端口」的次数，自动刷新的所有判据都数这个 */
function refreshCalls(): number {
  return statusCalls.filter((c) => c.refresh).length;
}

/**
 * 造一条回读结论。checkedAt 固定：结论指纹**不该**把时间戳算进去
 * （每次回读都带新时间戳，算进去就等于每次「变了」，退避永不生效）。
 */
function propsOf(mismatchFlags: string[], error: string | null = null): PropsCheck {
  return {
    checked: ['temperature'],
    mismatched: mismatchFlags.map((flag) => ({ flag, param: flag, sent: '40', actual: '20' })),
    skipped: 0,
    buildInfo: 'b11178-f9af9be21',
    checkedAt: 1_700_000_000_000,
    error: error as PropsCheck['error'],
    baselineDrift: null,
  } as unknown as PropsCheck;
}

/** 状态事件：与主进程同形状（状态 + 停止事实），停止事实默认空 */
function ev(status: ServerStatus, stop: ServerStopInfo | null = null): ServerStatusEvent {
  return { status, stop };
}

/** 造一条停止事实，只写与断言相关的字段 */
function stopOf(part: Partial<ServerStopInfo> & { reason: ServerStopInfo['reason'] }): ServerStopInfo {
  return { code: null, signal: null, hadBeenReady: false, at: Date.now(), ...part };
}

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  server: {
    onOutputBatch: (cb: OutputCb) => { outputCb = cb; },
    onStatus: (cb: StatusCb) => { statusCb = cb; },
    getStatus: (refresh?: boolean) => {
      statusCalls.push({ refresh: refresh === true });
      return Promise.resolve(mainStatus);
    },
    start: () => Promise.resolve({ ok: true }),
    stop: () => Promise.resolve({ ok: true }),
    restart: () => Promise.resolve({ ok: true }),
    previewCommand: () => Promise.resolve({ ok: true, data: [] }),
  },
  system: {
    checkPort: () => Promise.resolve(checkPortResult),
  },
};

vi.mock('@/stores/i18n', async () => {
  const { ref } = await import('vue');
  const lang = ref('zh-CN');
  i18nStub.lang = lang;
  return {
    // lang 用 getter 而非求值快照：store 里 watch(() => i18n.lang) 要能在 ref 变化时触发
    useI18nStore: () => ({
      t: (k: string) => k,
      get lang() {
        return lang.value;
      },
    }),
  };
});

/** 模拟主进程推送的一行服务输出（preload 载荷恒为批次数组） */
function out(data: string) {
  outputCb([{ kind: 'stderr', data, ts: Date.now() }]);
}

beforeEach(() => {
  setActivePinia(createPinia());
  statusCb = () => {};
  outputCb = () => {};
  statusCalls = [];
  mainStatus = { status: 'stopped', pid: null, host: '127.0.0.1', port: 8080, url: '', values: {} };
  checkPortResult = { inUse: false };
});

describe('PORT_BUSY_RE（端口占用原始输出识别）', () => {
  it('命中断口占用关键文本（跨 llama.cpp 版本）', () => {
    const busyLines = [
      'bind() failed: Address already in use (OS Error: 10048)',
      'http: bind: address already in use',
      'error bind: address already in use',
      'EADDRINUSE: address already in use',
      "socket error: Cannot assign requested address",
      'bind() failed with errno 98 Address already in use',
      '[llama server] failed to bind port 8080: address already in use',
    ];
    for (const line of busyLines) {
      expect(PORT_BUSY_RE.test(line), `应命中: ${line}`).toBe(true);
    }
  });

  it('不误伤正常启动/其他错误输出', () => {
    const normalLines = [
      'llama_server: listening on http://127.0.0.1:8080',
      'server is listening on port 8080',
      'HTTP server listening',
      'failed to allocate GPU buffer',
      'error while loading model: mmap failed',
    ];
    for (const line of normalLines) {
      expect(PORT_BUSY_RE.test(line), `不应命中: ${line}`).toBe(false);
    }
  });
});

describe('effectiveStatus 由主进程下发的停止事实决定，不看日志文字', () => {
  // 用户实测日志原文（llama.cpp b11053，上下文 95744）：服务拒绝一个越界请求后仍继续正常服务。
  // 旧实现按「最近 80 行有没有 error 字样」判定，会把这行变成界面上的「异常退出」。
  const SEND_ERROR_OVER_CAPACITY =
    '0.46.902.034 E srv    send_error: task id = 0, error: request (481560 tokens) exceeds the available context size (95744 tokens), try increasing it\n';

  it('运行中收到 send_error 越界请求行 → 仍是 running（回归：曾误判 crashed）', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('starting'));
    out('0.13.283.820 I srv  llama_server: listening on http://127.0.0.1:8080\n');
    statusCb(ev('running'));
    expect(server.effectiveStatus).toBe('running');

    out(SEND_ERROR_OVER_CAPACITY);
    expect(server.effectiveStatus).toBe('running');
    // 该行确实进了控制台并标成 error 色——只是不再参与状态判定
    expect(server.outputs.at(-1)?.tone).toBe('error');
  });

  it('曾就绪后异常退出（exited + hadBeenReady + 非 0 退出码）→ crashed', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('starting'));
    statusCb(ev('running'));
    statusCb(ev('stopped', stopOf({ reason: 'exited', code: 1, hadBeenReady: true })));
    expect(server.effectiveStatus).toBe('crashed');
  });

  it('被信号杀死（无退出码）→ crashed', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    statusCb(ev('stopped', stopOf({ reason: 'exited', signal: 'SIGSEGV', hadBeenReady: true })));
    expect(server.effectiveStatus).toBe('crashed');
  });

  it('启动阶段就退出（未就绪，如端口占用）→ failed', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('starting'));
    out('bind() failed: Address already in use (OS Error: 10048)\n');
    statusCb(ev('stopped', stopOf({ reason: 'exited', code: 1, hadBeenReady: false })));
    expect(server.effectiveStatus).toBe('failed');
  });

  it('进程压根没起来（spawn_failed）→ failed', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('starting'));
    statusCb(ev('stopped', stopOf({ reason: 'spawn_failed' })));
    expect(server.effectiveStatus).toBe('failed');
  });

  it('用户主动停止 → stopped（Windows 下 taskkill /F 退出码非 0，也不能显示成失败/崩溃）', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    statusCb(ev('stopped', stopOf({ reason: 'stopped_by_user', code: 1, hadBeenReady: true })));
    expect(server.effectiveStatus).toBe('stopped');
  });

  it('曾就绪后干净退出（code 0 无信号）→ stopped（服务自行结束，不算崩）', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    statusCb(ev('stopped', stopOf({ reason: 'exited', code: 0, hadBeenReady: true })));
    expect(server.effectiveStatus).toBe('stopped');
  });

  it('上一轮的失败事实不污染新一轮：start 时主进程清空 stop', () => {
    const server = useServerStore();
    server.subscribe();
    // 上一轮：越界崩溃，留下 error 字样日志
    statusCb(ev('running'));
    out('llama_context: error: KV cache allocation failed, server aborting\n');
    statusCb(ev('stopped', stopOf({ reason: 'exited', code: 139, hadBeenReady: true })));
    expect(server.effectiveStatus).toBe('crashed');
    // 问题解决后重启：core 在 start() 里把停止事实清成 null
    statusCb(ev('starting'));
    expect(server.effectiveStatus).toBe('starting');
    statusCb(ev('running'));
    out('0.08.204.956 I srv  llama_server: listening on http://127.0.0.1:8080\n');
    expect(server.effectiveStatus).toBe('running');
    // 上一轮那行 error 字样日志仍在缓冲里（控制台不该丢历史），但状态不受它影响
    expect(server.outputs.some((o) => o.tone === 'error')).toBe(true);
  });

  it('refreshStatus 与事件同源：从主进程拉到的 stop 决定增强态', async () => {
    const server = useServerStore();
    mainStatus = {
      status: 'stopped', pid: null, host: '127.0.0.1', port: 8080, url: '', values: {},
      stop: stopOf({ reason: 'exited', code: 1, hadBeenReady: true }),
    };
    await server.refreshStatus();
    expect(server.effectiveStatus).toBe('crashed');
  });
});

describe('toneOf 级别分类（JSON level 字段优先于关键词正则）', () => {
  it('llama-server JSON 行按 level 字段归档：INFO → info、ERROR → error、DEBUG → plain', () => {
    const server = useServerStore();
    server.subscribe();
    // INFO JSON 且 msg 含 loaded（若走关键词正则会被判 success）——优先级判据
    outputCb([{ kind: 'stdout', data: '{"timestamp":1756100000,"level":"INFO","msg":"loaded"}\n', ts: Date.now() }]);
    outputCb([{ kind: 'stdout', data: '{"level":"ERROR","msg":"oops"}\n', ts: Date.now() }]);
    outputCb([{ kind: 'stdout', data: '{"level":"DEBUG","msg":"hello"}\n', ts: Date.now() }]);
    expect(server.outputs.at(-3)?.tone).toBe('info');
    expect(server.outputs.at(-2)?.tone).toBe('error');
    expect(server.outputs.at(-1)?.tone).toBe('plain');
  });

  it('无 level 字段的行仍走关键词正则（success 词表 / error 词表不变）', () => {
    const server = useServerStore();
    server.subscribe();
    outputCb([{ kind: 'stdout', data: 'llama_model_loader: loaded meta data with 39 key-value pairs\n', ts: Date.now() }]);
    outputCb([{ kind: 'stderr', data: 'srv send_error: error: request exceeds the available context size\n', ts: Date.now() }]);
    outputCb([{ kind: 'stdout', data: 'ggml_cuda_init: found 1 CUDA device\n', ts: Date.now() }]);
    expect(server.outputs.at(-3)?.tone).toBe('success');
    expect(server.outputs.at(-2)?.tone).toBe('error');
    expect(server.outputs.at(-1)?.tone).toBe('plain');
  });
});

describe('控制台行时间串（入队时格式化随行携带，OutputLine.time）', () => {
  it('行时间与 formatLogTime 同源；切换语言整表重算，同一控制台不混两种格式', async () => {
    expect(i18nStub.lang).not.toBeNull();
    i18nStub.lang!.value = 'zh-CN';
    const server = useServerStore();
    server.subscribe();
    const ts = 1_700_000_000_000;
    outputCb([{ kind: 'stdout', data: 'hello\n', ts }]);
    expect(server.outputs[0].time).toBe(formatLogTime(ts, 'zh-CN'));
    const zhTime = server.outputs[0].time;
    i18nStub.lang!.value = 'en-US';
    await nextTick();
    expect(server.outputs[0].time).toBe(formatLogTime(ts, 'en-US'));
    expect(server.outputs[0].time).not.toBe(zhTime);
  });
});

describe('外部 llama-server 实例检测（refreshExternal / adoptExternal）', () => {
  it('LLAMA_SERVER_NAME_RE 识别跨平台进程名（含 POSIX 截断名），不误伤普通进程', () => {
    expect(LLAMA_SERVER_NAME_RE.test('llama-server.exe')).toBe(true);
    expect(LLAMA_SERVER_NAME_RE.test('llama-server')).toBe(true);
    expect(LLAMA_SERVER_NAME_RE.test('llama-ser')).toBe(true); // lsof comm 截断
    expect(LLAMA_SERVER_NAME_RE.test('llama_bench.exe')).toBe(false);
    expect(LLAMA_SERVER_NAME_RE.test('nginx')).toBe(false);
    expect(LLAMA_SERVER_NAME_RE.test(undefined as unknown as string)).toBe(false);
  });

  it('stopped 时探测到 llama-server 占用端口 → 记录外部实例并输出检测日志', async () => {
    const server = useServerStore();
    server.subscribe();
    checkPortResult = { inUse: true, pid: 23508, name: 'llama-server.exe' };
    const found = await server.refreshExternal(8080, '127.0.0.1');
    expect(found).toBe(true);
    expect(server.external).toEqual({ pid: 23508, name: 'llama-server.exe', port: 8080, host: '127.0.0.1' });
    // 出现时输出一条检测日志（i18n 键桩返回键名本身）
    expect(server.outputs.at(-1)?.data).toContain('msg_external_detected');
  });

  it('重复探测不重复输出日志；端口空闲后清除并输出下线日志', async () => {
    const server = useServerStore();
    server.subscribe();
    checkPortResult = { inUse: true, pid: 23508, name: 'llama-server.exe' };
    await server.refreshExternal(8080);
    const linesAfterFirst = server.outputs.length;
    await server.refreshExternal(8080);
    expect(server.outputs.length).toBe(linesAfterFirst);
    checkPortResult = { inUse: false };
    const gone = await server.refreshExternal(8080);
    expect(gone).toBe(false);
    expect(server.external).toBeNull();
    expect(server.outputs.at(-1)?.data).toContain('msg_external_gone');
  });

  it('占用者不是 llama-server（其他程序）不标记外部实例', async () => {
    const server = useServerStore();
    server.subscribe();
    checkPortResult = { inUse: true, pid: 999, name: 'nginx.exe' };
    expect(await server.refreshExternal(8080)).toBe(false);
    expect(server.external).toBeNull();
  });

  it('本应用自身 starting/running 时外部标记清空（端口归自家进程）', async () => {
    const server = useServerStore();
    server.subscribe();
    checkPortResult = { inUse: true, pid: 23508, name: 'llama-server.exe' };
    await server.refreshExternal(8080);
    expect(server.external).not.toBeNull();
    statusCb(ev('running'));
    expect(server.external).toBeNull();
    // 自家运行中再探测：直接返回 false 且不记录
    expect(await server.refreshExternal(8080)).toBe(false);
    expect(server.external).toBeNull();
  });

  it('adoptExternal 接管外部实例并输出日志；checkPort 异常时探测静默返回 false', async () => {
    const server = useServerStore();
    server.subscribe();
    server.adoptExternal({ pid: 42, name: 'llama-server', port: 8080, host: '127.0.0.1' });
    expect(server.external).toEqual({ pid: 42, name: 'llama-server', port: 8080, host: '127.0.0.1' });
    expect(server.outputs.at(-1)?.data).toContain('msg_external_adopted');
    server.clearExternal();
    expect(server.external).toBeNull();
    // mock 环境无 checkPort 响应：静默 false，不抛错
    checkPortResult = null;
    expect(await server.refreshExternal(8080)).toBe(false);
  });
});

describe('状态事件与运行事实（2026-10-06 停止态补全）', () => {
  it('stopped 事件清掉 PID 与 URL：不给已经不在的进程继续挂账号', async () => {
    const server = useServerStore();
    server.subscribe();
    mainStatus = {
      status: 'running', pid: 23508, host: '127.0.0.1', port: 8080,
      url: 'http://127.0.0.1:8080/', values: {},
    };
    await server.refreshStatus();
    expect(server.pid).toBe(23508);

    statusCb(ev('stopped'));
    expect(server.status).toBe('stopped');
    expect(server.pid).toBeNull();
    expect(server.url).toBe('');
    // host/port 是用户配置的监听地址，不是「这一轮运行」的事实，必须留着
    expect(server.port).toBe(8080);
    expect(server.host).toBe('127.0.0.1');
  });

  it('stopping 期间 canOpenWeb 为 false、effectiveStatus 报 stopping、外部标记不复活', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    expect(server.canOpenWeb).toBe(true);

    statusCb(ev('stopping'));
    expect(server.canOpenWeb).toBe(false);
    expect(server.effectiveStatus).toBe('stopping');
    // 端口此刻仍归自家进程（进程还没退），把外部实例算进来就是错的
    server.adoptExternal({ pid: 42, name: 'llama-server', port: 8080, host: '127.0.0.1' });
    statusCb(ev('stopping'));
    expect(server.external).toBeNull();
  });
});

// /props 自动刷新（2026-10-06 用户要求「不再需要点按钮」）。判据全部对着
// `statusCalls` 里带 refresh:true 的条目数——那一条是渲染层唯一能证明「这次真的敲了端口」的观测点。
// 与被删掉的核心侧 60s 盲轮询的差别全在这几条里：没人看就不敲、没在跑就不敲、结论没变就拉长间隔。
describe('/props 自动刷新（可见 + 只在 running + 空闲退避）', () => {
  let release: (() => void) | null = null;

  /** 推进假时钟并顺带冲刷微任务（store 里的 watch 是 pre-flush，不冲一次就看不到它生效） */
  async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  function runningMain(check: PropsCheck | null, over: Record<string, unknown> = {}) {
    mainStatus = {
      status: 'running', pid: 23508, host: '127.0.0.1', port: 8080,
      url: 'http://127.0.0.1:8080/', values: {}, propsCheck: check, ...over,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    release = null;
  });

  afterEach(() => {
    // 上一个测试留下的定时器会打到下一个测试的计数上，必须先退掉可见计数
    release?.();
    release = null;
    vi.useRealTimers();
  });

  it('只有「本页可见」时才敲端口：退掉计数后一个也不发', async () => {
    const server = useServerStore();
    server.subscribe();
    runningMain(propsOf([]));
    await server.refreshStatus();
    statusCb(ev('running'));
    expect(refreshCalls()).toBe(0);

    release = server.enterPropsWatch();
    await advance(0);
    expect(refreshCalls()).toBe(1);
    await advance(propsPollDelayMs(0));
    expect(refreshCalls()).toBe(2);

    // 切到别的页（onDeactivated 走 release）：后台页不许继续敲端口
    release();
    release = null;
    await advance(propsPollDelayMs(PROPS_POLL_MAX_STEPS) * 10);
    expect(refreshCalls()).toBe(2);
  });

  it('结论连续不变 → 间隔逐档按 ×2 拉长并在封顶后保持（期望值由 propsPollDelayMs 派生）', async () => {
    const server = useServerStore();
    server.subscribe();
    runningMain(propsOf([]));
    await server.refreshStatus();
    statusCb(ev('running'));

    release = server.enterPropsWatch();
    await advance(0);
    expect(refreshCalls()).toBe(1);

    // 档位序列：第 i 档的间隔就是 propsPollDelayMs(i)，期望值全部从常量派生，不抄死数字
    const gaps = Array.from({ length: PROPS_POLL_MAX_STEPS + 1 }, (_, i) => propsPollDelayMs(i));
    // 非空转对照（删掉退避就会红在这里）：这套档位确实在拉长，且拉长到那个上限常量就封顶
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[gaps.length - 1]).toBe(PROPS_POLL_MAX_MS);

    let expected = 1;
    for (const gap of gaps) {
      await advance(gap - 1);
      // 还没到点：一次都不许多敲（固定周期轮询在这里必然多敲）
      expect(refreshCalls(), `到点前（间隔 ${gap}ms）不应多敲`).toBe(expected);
      await advance(1);
      expected += 1;
      expect(refreshCalls(), `到点应恰好敲一次`).toBe(expected);
    }
  });

  it('结论一变（引擎被外部 POST /props 改写）→ 立刻回到快档', async () => {
    const server = useServerStore();
    server.subscribe();
    runningMain(propsOf([]));
    await server.refreshStatus();
    statusCb(ev('running'));

    release = server.enterPropsWatch();
    await advance(0);
    expect(refreshCalls()).toBe(1);
    // 连续两轮无事可报，退避已经拉长到 propsPollDelayMs(2)
    await advance(propsPollDelayMs(0));
    await advance(propsPollDelayMs(1));
    expect(refreshCalls()).toBe(3);

    // 引擎侧改动被下一次回读带回：结论变了
    runningMain(propsOf(['top_k']));
    await advance(propsPollDelayMs(2));
    expect(refreshCalls()).toBe(4);
    expect(server.propsCheck?.mismatched.map((m) => m.param)).toEqual(['top_k']);

    // 变了就回快档：下一次间隔回到 propsPollDelayMs(0)，而不是继续停在慢档
    await advance(propsPollDelayMs(0) - 1);
    expect(refreshCalls()).toBe(4);
    await advance(1);
    expect(refreshCalls()).toBe(5);
  });

  it('没在 running 就一个也不敲；服务起来当场补一次并归零退避，停服立刻停表', async () => {
    const server = useServerStore();
    server.subscribe();
    runningMain(propsOf([]));

    release = server.enterPropsWatch();
    await advance(propsPollDelayMs(PROPS_POLL_MAX_STEPS) * 10);
    expect(refreshCalls()).toBe(0);

    // 服务就绪：有人在看着 → 立刻敲一次，并从快档起步
    statusCb(ev('running'));
    await advance(0);
    expect(refreshCalls()).toBe(1);
    await advance(propsPollDelayMs(0));
    expect(refreshCalls()).toBe(2);

    // 停服：无端口可敲，节拍必须当场停（不是等下一次 tick 自己发现）
    statusCb(ev('stopping'));
    statusCb(ev('stopped', stopOf({ reason: 'stopped_by_user', hadBeenReady: true })));
    await advance(propsPollDelayMs(PROPS_POLL_MAX_STEPS) * 10);
    expect(refreshCalls()).toBe(2);
  });

  it('监听地址（port）变了 → 立刻归零重探一次，不傻等下一个退避周期', async () => {
    const server = useServerStore();
    server.subscribe();
    runningMain(propsOf([]));
    await server.refreshStatus();
    statusCb(ev('running'));

    release = server.enterPropsWatch();
    await advance(0);
    await advance(propsPollDelayMs(0));
    await advance(propsPollDelayMs(1));
    expect(refreshCalls()).toBe(3);

    // 重启后主进程报回新的端口（一次不带 refresh 的常规拉取把它写进 store）
    runningMain(propsOf([]), { port: 8099 });
    await server.refreshStatus();
    await advance(0);
    expect(refreshCalls()).toBe(4);
    // 归零：下一次间隔回到快档
    await advance(propsPollDelayMs(0) - 1);
    expect(refreshCalls()).toBe(4);
    await advance(1);
    expect(refreshCalls()).toBe(5);
  });

  it('重复 enter/leave 幂等：keep-alive 下 deactivate 与 unmount 双触发不会把计数减成负数', async () => {
    const server = useServerStore();
    server.subscribe();
    runningMain(propsOf([]));
    statusCb(ev('running'));

    const rel1 = server.enterPropsWatch();
    const rel2 = server.enterPropsWatch();
    await advance(0);
    const afterEnter = refreshCalls();
    rel1();
    rel1(); // 重复放（deactivate + unmount 双触发）
    rel2();
    await advance(propsPollDelayMs(PROPS_POLL_MAX_STEPS) * 10);
    // 两份挂接都退掉后必须彻底静默：计数若被减成负数，下一次 enter 就永远开不了
    expect(refreshCalls()).toBe(afterEnter);

    const rel3 = server.enterPropsWatch();
    await advance(0);
    expect(refreshCalls()).toBeGreaterThan(afterEnter);
    release = rel3;
  });
});

// ---- 以下为 2026-10-08 测试补充：控制台批次入队/裁剪、OOM 警示窗口、端口占用提示节流 ----

describe('pushOutputBatch - 批次入队与 5000 行上限裁剪', () => {
  /** 造一批主进程推送条目（preload 载荷形状：OutputEntry[]） */
  function batchOf(n: number, prefix = 'line'): OutputEntry[] {
    return Array.from({ length: n }, (_, i) => ({ kind: 'stderr' as const, data: `${prefix}-${i}\n`, ts: 1 }));
  }

  it('一批多条一次入队：数组只刷新一次，行按顺序携带派生字段', () => {
    const server = useServerStore();
    server.subscribe();
    outputCb(batchOf(3));
    expect(server.outputs.map((o) => o.data.trim())).toEqual(['line-0', 'line-1', 'line-2']);
    expect(server.outputs.map((o) => o.id), '行号随入队顺序单调递增').toEqual([1, 2, 3]);
  });

  it('超过 5000 行从头部裁掉，只留最新段；后续行号不复用被裁的 id', () => {
    const server = useServerStore();
    server.subscribe();
    // MAX_LINES=5000 是 store 私有常量：溢出 10 行，头部 10 条应被裁
    outputCb(batchOf(5000 + 10));
    expect(server.outputs).toHaveLength(5000);
    expect(server.outputs[0].data.trim(), '头部溢出量被精确裁掉').toBe('line-10');
    expect(server.outputs.at(-1)?.data.trim()).toBe('line-5009');

    const maxIdAfterTrim = server.outputs.at(-1)!.id;
    outputCb(batchOf(1, 'later'));
    expect(server.outputs.at(-1)!.id, '裁剪后行号继续递增（v-for 的稳定 key 不与旧行撞车）').toBeGreaterThan(
      maxIdAfterTrim,
    );
    expect(server.outputs).toHaveLength(5000);
  });

  it('空批次是空操作：不炸也不消耗行号', () => {
    const server = useServerStore();
    server.subscribe();
    expect(() => {
      outputCb([]);
      server.pushOutputBatch([]);
    }).not.toThrow();
    expect(server.outputs).toHaveLength(0);
    // 主进程 16ms 合并窗口里没有新行时就会发空批，这条路径必须完全静默
    outputCb([]);
    expect(server.outputs).toHaveLength(0);
  });
});

describe('oomDetected - 显存/内存耗尽警示（最近 300 行窗口）', () => {
  /** 真机出现过的 OOM 原文措辞（跨后端：CUDA / Vulkan / 分配器） */
  const OOM_LINES = [
    'llama_new_context_with_model: CUDA error: out of memory',
    'ggml_vulkan: Fatal error: VK_ERROR_OUT_OF_DEVICE_MEMORY',
    'load_model: failed to allocate compute buffer of 1024.00 MiB',
    'terminate called after throwing an instance of std::bad_alloc',
  ];

  it('窗口内出现 OOM 关键词行 → true（多种措辞/后端都命中）', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    for (const line of OOM_LINES) out(line);
    expect(server.oomDetected, '四种措辞各推一行，窗口内必须亮警示').toBe(true);
    expect(server.outputs.filter((o) => o.oom)).toHaveLength(OOM_LINES.length);
  });

  it('普通输出不误报', () => {
    const server = useServerStore();
    server.subscribe();
    out('llama_server: listening on http://127.0.0.1:8080\n');
    out('error while loading model: mmap failed\n');
    expect(server.oomDetected).toBe(false);
  });

  it('OOM 行滚出最近 300 行窗口后警示自动解除', () => {
    const server = useServerStore();
    server.subscribe();
    out('ggml_vulkan: Fatal error: VK_ERROR_OUT_OF_DEVICE_MEMORY\n');
    expect(server.oomDetected).toBe(true);
    // 恰好再推 300 行普通输出：OOM 行恰好落在窗口外一格
    outputCb(
      Array.from({ length: 300 }, (_, i) => ({ kind: 'stdout' as const, data: `noise-${i}\n`, ts: 1 })),
    );
    expect(server.oomDetected, '警示窗口必须随滚动解除，不能整轮常亮').toBe(false);
  });
});

describe('端口占用友好提示（portBusyHint：只在启动/运行期 + 同端口 5s 节流）', () => {
  /** 数一下 svc_port_busy_hint 提示行（不含原始输出行） */
  function hintCount(server: ReturnType<typeof useServerStore>): number {
    return server.outputs.filter((o) => o.data.includes('svc_port_busy_hint')).length;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('running 期命中端口占用原文 → 追加一条友好提示（kind=error）', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    const before = server.outputs.length;
    out('bind() failed: Address already in use (OS Error: 10048)\n');
    expect(server.outputs.length, '原始行之外恰好多一条提示').toBe(before + 2);
    const hint = server.outputs.at(-1)!;
    expect(hint.data).toContain('svc_port_busy_hint');
    // 注：本文件的 i18n 桩 t(key) 丢弃插值参数，端口号经 t(key, [port]) 传入但不出现在桩文案里，
    // 端口进文案的断言放在下方「换端口」用例里也只验节流语义，不验文案内容
    expect(hint.kind).toBe('error');
  });

  it('同一端口 5s 内重复命中只提示一次；跨过 5s 窗口再提示', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    out('http: bind: address already in use\n');
    out('EADDRINUSE\n');
    expect(hintCount(server), '5s 内第二条命中不再刷屏').toBe(1);

    vi.advanceTimersByTime(4999);
    out('bind() failed\n');
    expect(hintCount(server), '还差 1ms 到窗口边界，仍被节流').toBe(1);
    vi.advanceTimersByTime(1);
    out('bind() failed\n');
    expect(hintCount(server), '跨过 5000ms 后允许再次提示（用户可能需要新提醒）').toBe(2);
  });

  it('stopped 态不提示：端口冲突提示只在「我们想启动」的语境下有意义', () => {
    const server = useServerStore();
    server.subscribe();
    expect(server.status).toBe('stopped');
    out('bind() failed: Address already in use\n');
    expect(hintCount(server)).toBe(0);
    expect(server.outputs, '原始行照常入队，只是不加提示').toHaveLength(1);
  });

  it('换端口后节流立即放开（提示按端口区分）', async () => {
    const server = useServerStore();
    server.subscribe();
    statusCb(ev('running'));
    out('bind() failed: Address already in use\n');
    expect(hintCount(server)).toBe(1);

    // 主进程改监听端口（refreshStatus 拉回 host/port；必须等拉取落地后再推冲突行）
    mainStatus = { ...mainStatus, status: 'running', port: 8081 };
    await server.refreshStatus();
    expect(server.port).toBe(8081);
    out('bind() failed: Address already in use\n');
    expect(hintCount(server), '新端口不得沿用旧端口的时间戳，第一次命中就要提示').toBe(2);
    expect(server.outputs.filter((o) => o.data.includes('svc_port_busy_hint')).at(-1)?.kind).toBe('error');
  });
});

describe('previewCommand - 失败码必须活着到渲染层（2026-10-10 首次使用告警）', () => {
  /** 换掉 window.api 的预览桩，返回 store 里那条调用 */
  function stubPreview(res: unknown) {
    (globalThis as any).window.api.server.previewCommand = () => Promise.resolve(res);
    const server = useServerStore();
    return server.previewCommand({} as never, {} as never);
  }

  it('主进程回了码：抛出的异常仍带着码，界面才选得出「去哪儿配」那句', async () => {
    const call = stubPreview({
      ok: false,
      error: 'Server executable path is not configured',
      code: 'exe_not_configured',
    });
    await expect(call).rejects.toThrow('Server executable path is not configured');
    let caught: any;
    try {
      await call;
    } catch (e) {
      caught = e;
    }
    // 这一条就是原事故的判据：曾经这里走 invokeOk，码被拼进 Error 文本后丢失，
    // 界面只能把后端英文原文当文案显示出来
    expect(caught.code).toBe('exe_not_configured');
  });

  it('主进程没给码（未知失败）：异常不带码，界面据此走通用文案', async () => {
    let caught: any;
    try {
      await stubPreview({ ok: false, error: 'IPC down' });
    } catch (e) {
      caught = e;
    }
    expect(caught.code, '码表之外的东西不该被当成码传下去').toBeUndefined();
    expect(caught.message).toBe('IPC down');
  });

  it('桩缺失（mock 环境返回 null）时仍然抛错，不静默返回空命令', async () => {
    let caught: any;
    try {
      await stubPreview(null);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBeUndefined();
  });
});
