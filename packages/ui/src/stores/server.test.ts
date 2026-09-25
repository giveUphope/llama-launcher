import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ServerStatus, ServerStatusEvent, ServerStopInfo } from '@llama-launcher/shared';
import { LLAMA_SERVER_NAME_RE, PORT_BUSY_RE, useServerStore } from './server';

// —— window.api 桩：捕获 onOutputBatch/onStatus 回调，getStatus 返回可控的主进程状态 ——
type StatusCb = (e: ServerStatusEvent) => void;
type OutputCb = (entries: any[]) => void;
let statusCb: StatusCb = () => {};
let outputCb: OutputCb = () => {};
let mainStatus: any = { status: 'stopped', pid: null, host: '127.0.0.1', port: 8080, url: '', values: {} };
// checkPort 桩返回值（外部实例探测用），null 模拟 mock 环境无响应
let checkPortResult: { inUse: boolean; pid?: number; name?: string } | null = { inUse: false };

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
    getStatus: () => Promise.resolve(mainStatus),
    start: () => Promise.resolve({ ok: true }),
    stop: () => Promise.resolve({ ok: true }),
    restart: () => Promise.resolve({ ok: true }),
    previewCommand: () => Promise.resolve({ ok: true, data: '' }),
  },
  system: {
    checkPort: () => Promise.resolve(checkPortResult),
  },
};

vi.mock('@/stores/i18n', () => ({
  useI18nStore: () => ({ t: (k: string) => k }),
}));

/** 模拟主进程推送的一行服务输出（preload 载荷恒为批次数组） */
function out(data: string) {
  outputCb([{ kind: 'stderr', data, ts: Date.now() }]);
}

beforeEach(() => {
  setActivePinia(createPinia());
  statusCb = () => {};
  outputCb = () => {};
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
