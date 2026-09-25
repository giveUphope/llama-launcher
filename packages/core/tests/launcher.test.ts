import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the module — the FakeLlamaServerProcess class must be defined
// inside the factory since vi.mock() is hoisted.
// FakeLlamaServerProcess 模拟真实进程行为：
// - kill() 同步触发 exit 事件（真实 process 是异步，但 mock 同步便于测试）
// - start() 始终成功（buildCommand 已校验路径存在性）
vi.mock('../src/process.js', () => {
  const FakeLlamaServerProcess = class {
    pid: number | null = null;
    _running = false;
    private _listeners: Record<string, Function[]> = {};

    start(_opts: any) {
      this._running = true;
      this.pid = 9999;
      return this;
    }

    isRunning(): boolean {
      return this._running;
    }

    kill(): boolean {
      if (!this._running) return false;
      this._running = false;
      // 模拟真实进程退出：触发 exit 事件，使 Launcher 能感知并切换状态
      if (this._listeners.exit) {
        this._listeners.exit.forEach((fn: Function) => fn(0));
      }
      return true;
    }

    on(event: string, fn: Function): this {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return this;
    }

    once(event: string, fn: Function): this {
      const wrapper = (...args: any[]) => {
        this.off(event, wrapper);
        fn(...args);
      };
      return this.on(event, wrapper);
    }

    off(event: string, fn: Function): this {
      const list = this._listeners[event];
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
      return this;
    }

    _triggerOutput(data: string) {
      const entry = { kind: 'stdout' as const, data, ts: Date.now() };
      if (this._listeners.output) {
        this._listeners.output.forEach((fn: Function) => fn(entry));
      }
    }

    _triggerExit(code: number | null) {
      if (this._listeners.exit) {
        this._listeners.exit.forEach((fn: Function) => fn(code));
      }
    }
  };

  return {
    LlamaServerProcess: FakeLlamaServerProcess,
  };
});

import { Launcher } from '../src/launcher.js';
import type { PropsFetcher } from '../src/server-props.js';

/** 单测桩：绝不发真网络请求——本机 8080 上可能正跑着用户的 llama-server，
 *  而 Launcher 就绪后默认会去 GET /props 做回读对账。 */
const noProps: PropsFetcher = async () => ({ ok: false, json: null });

import type { AppSettings, ServerInfo, ServerStatusEvent } from '@llama-launcher/shared';

const baseSettings: AppSettings = {
  server_exe: process.execPath,
  models_dir: './models',
  selected_model: '',
  last_preset: '',
  window_geometry: '1280x800',
  theme_mode: 'dark',
  sidebar_collapsed: false,
  language: 'zh',
  last_tab: '',
};

describe('Launcher', () => {
  let launcher: Launcher;

  beforeEach(() => {
    launcher = new Launcher({ propsFetcher: noProps });
  });

  afterEach(() => {
    if (launcher.getStatus().status !== 'stopped') {
      launcher.stop();
    }
    vi.restoreAllMocks();
  });

  it('initial status is stopped', () => {
    const info = launcher.getStatus();
    expect(info.status).toBe('stopped');
    expect(info.pid).toBeNull();
    expect(info.url).toBe('http://127.0.0.1:8080/');
  });

  it('initial host/port defaults are 127.0.0.1 and 8080', () => {
    const info = launcher.getStatus();
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBe(8080);
  });

  it('starts a process with correct command and emits command event', async () => {
    const commandPromise = new Promise<any[]>((resolve) => {
      launcher.once('command', resolve);
    });

    launcher.start({
      values: {
        ctx_size: 4096, port: 8081, host: '127.0.0.1',
        cont_batching: true, flash_attn: 'on',
        spec_type: '', alias: '', mmproj: '',
        spec_draft_model: '', spec_draft_n_max: 3, spec_draft_n_min: 0,
        model: 'model.gguf',
      },
      settings: baseSettings,
    });

    const capturedCmd = await commandPromise;
    expect(capturedCmd[0]).toBe(process.execPath);
    expect(capturedCmd).toContain('-m');
    expect(capturedCmd).toContain('model.gguf');
    expect(capturedCmd).toContain('-c');
    expect(capturedCmd).toContain('4096');
    expect(capturedCmd).toContain('--port');
    expect(capturedCmd).toContain('8081');
    expect(capturedCmd).toContain('-cb');
    expect(capturedCmd).toContain('-fa');
    // host=127.0.0.1 为默认值，按"值非默认即发射"语义不生成 --host
  });

  it('emits command with only exe path when no model', async () => {
    const commandPromise = new Promise<any[]>((resolve) => {
      launcher.once('command', resolve);
    });

    launcher.start({ values: {}, settings: baseSettings });
    const cmd = await commandPromise;
    expect(cmd).toEqual([process.execPath]);
  });

  it('emits status events and transitions', async () => {
    const statuses: string[] = [];
    launcher.on('status', (e: { status: string }) => statuses.push(e.status));

    launcher.start({ values: {}, settings: baseSettings });
    expect(statuses).toContain('starting');

    const info = launcher.getStatus();
    expect(info.status).toBe('starting');

    launcher.stop();
    // kill 触发 exit → setStatus('stopped')
    expect(statuses).toContain('stopped');
  });

  describe('停止事实（ServerStopInfo）随状态事件下发，供渲染层区分 stopped/failed/crashed', () => {
    /** 走到 running：喂一行 listening 输出（真实 llama-server 的就绪信号） */
    function reachRunning(l: Launcher) {
      l.start({ values: {}, settings: baseSettings });
      const proc = l['proc'] as any;
      proc._triggerOutput('llama_server: listening on http://127.0.0.1:8080');
      expect(l.getStatus().status).toBe('running');
      return proc;
    }

    it('running 后自行退出（非 0 退出码）→ exited + hadBeenReady', () => {
      const proc = reachRunning(launcher);
      const events: any[] = [];
      launcher.on('status', (e: any) => events.push(e));

      proc._triggerExit(139);

      const last = events.at(-1);
      expect(last.status).toBe('stopped');
      expect(last.stop).toMatchObject({ reason: 'exited', code: 139, hadBeenReady: true });
      expect(launcher.getStatus().stop).toMatchObject({ reason: 'exited', code: 139 });
    });

    it('启动阶段就退出（从未就绪）→ exited + hadBeenReady=false', () => {
      launcher.start({ values: {}, settings: baseSettings });
      const proc = launcher['proc'] as any;
      proc._triggerExit(1);
      expect(launcher.getStatus().stop).toMatchObject({ reason: 'exited', code: 1, hadBeenReady: false });
    });

    it('用户主动 stop → stopped_by_user（即便 Windows taskkill 给出非 0 退出码）', () => {
      const proc = reachRunning(launcher);
      // 真实链路里 taskkill /F 的退出码不是 0，这里直接喂 exit 事件模拟
      launcher.stop();
      proc._triggerExit(1);
      expect(launcher.getStatus().stop).toMatchObject({ reason: 'stopped_by_user', hadBeenReady: true });
    });

    it('命令构建/spawn 失败（进程压根没起来）→ spawn_failed', () => {
      const settings: AppSettings = { ...baseSettings, server_exe: '/nonexistent/path/llama-server.exe' };
      // 该路径会 emit('error')：EventEmitter 上没有 error 监听时 emit 会抛出，故先挂一个
      launcher.once('error', () => {});
      launcher.start({ values: {}, settings });
      expect(launcher.getStatus().status).toBe('stopped');
      expect(launcher.getStatus().stop).toMatchObject({ reason: 'spawn_failed', code: null, hadBeenReady: false });
    });

    it('干净自退（code 0）也如实上报，交给渲染层判成 stopped 而非 crashed', () => {
      const proc = reachRunning(launcher);
      proc._triggerExit(0);
      expect(launcher.getStatus().stop).toMatchObject({ reason: 'exited', code: 0, signal: null, hadBeenReady: true });
    });

    it('process.ts 用 -1 归一「被信号杀死」，上报时还原为 null（别让上层把 -1 当真实退出码）', () => {
      const proc = reachRunning(launcher);
      proc._triggerExit(-1);
      expect(launcher.getStatus().stop).toMatchObject({ reason: 'exited', code: null });
    });

    it('新一轮 start() 清空上一轮的停止事实（旧崩溃不得显示成当前状态）', () => {
      const proc = reachRunning(launcher);
      proc._triggerExit(139);
      expect(launcher.getStatus().stop).not.toBeNull();

      launcher.start({ values: {}, settings: baseSettings });
      expect(launcher.getStatus().stop).toBeNull();
      launcher.stop();
    });
  });

  it('emits output events forwarded from subprocess', async () => {
    const outputs: any[] = [];
    launcher.on('output', (entry: any) => outputs.push(entry));

    launcher.start({ values: {}, settings: baseSettings });
    const proc = launcher['proc'] as any;
    proc._triggerOutput('test output line');
    expect(outputs.length).toBe(1);
    expect(outputs[0].kind).toBe('stdout');
    expect(outputs[0].data).toBe('test output line');
    launcher.stop();
  });

  it('reports correct host and port in status', async () => {
    const commandPromise = new Promise<any[]>((resolve) => {
      launcher.once('command', resolve);
    });

    launcher.start({ values: { host: '0.0.0.0', port: 9090 }, settings: baseSettings });
    await commandPromise;
    const info = launcher.getStatus();
    expect(info.host).toBe('0.0.0.0');
    expect(info.port).toBe(9090);
    expect(info.url).toBe('http://0.0.0.0:9090/');
    launcher.stop();
  });

  it('emits error when executable does not exist', async () => {
    const settings: AppSettings = { ...baseSettings, server_exe: '/nonexistent/path/llama-server.exe' };
    const errorPromise = new Promise<Error>((resolve) => {
      launcher.once('error', resolve);
    });
    launcher.start({ values: {}, settings });
    const error = await errorPromise;
    expect(error.message).toContain('executable does not exist');
    expect(launcher.getStatus().status).toBe('stopped');
  });

  it('prevents starting when already running', async () => {
    launcher.start({ values: {}, settings: baseSettings });
    const proc = launcher['proc'] as any;
    expect(proc.isRunning()).toBe(true);

    const errorPromise = new Promise<Error>((resolve) => {
      launcher.once('error', resolve);
    });
    launcher.start({ values: {}, settings: baseSettings });
    const error = await errorPromise;
    expect(error.message).toBe('Server is already running');
    launcher.stop();
  });
});

describe('Launcher - listening detection', () => {
  let launcher: Launcher;

  beforeEach(() => {
    launcher = new Launcher({ propsFetcher: noProps });
  });

  afterEach(() => {
    if (launcher.getStatus().status !== 'stopped') {
      launcher.stop();
    }
    vi.restoreAllMocks();
  });

  // llama-server 不同版本的 listening 输出格式（见 docs/zh/core-modules.md §4.2 通用 listening 检测）
  it.each([
    'llama server is listening',
    'server is listening',
    'http server listening',
    'llama_server: listening on http://127.0.0.1:8080',
    'listening on http://0.0.0.0:9090',
  ])('transitions to running on listening message: %s', (msg) => {
    launcher.start({ values: {}, settings: baseSettings });
    expect(launcher.getStatus().status).toBe('starting');

    const proc = launcher['proc'] as any;
    proc._triggerOutput(msg);
    expect(launcher.getStatus().status).toBe('running');
    launcher.stop();
  });

  it('does not transition to running on non-listening message', () => {
    launcher.start({ values: {}, settings: baseSettings });
    expect(launcher.getStatus().status).toBe('starting');

    const proc = launcher['proc'] as any;
    proc._triggerOutput('model loaded successfully');
    expect(launcher.getStatus().status).toBe('starting');
    launcher.stop();
  });

  it('emits running status when listening detected', () => {
    const statuses: string[] = [];
    launcher.on('status', (e: { status: string }) => statuses.push(e.status));

    launcher.start({ values: {}, settings: baseSettings });
    const proc = launcher['proc'] as any;
    proc._triggerOutput('llama_server: listening on http://127.0.0.1:8080');

    expect(statuses).toContain('starting');
    expect(statuses).toContain('running');
    launcher.stop();
  });
});

describe('Launcher - exit and restart', () => {
  let launcher: Launcher;

  beforeEach(() => {
    launcher = new Launcher({ propsFetcher: noProps });
  });

  afterEach(() => {
    if (launcher.getStatus().status !== 'stopped') {
      launcher.stop();
    }
    vi.restoreAllMocks();
  });

  it('transitions to stopped when process exits', () => {
    launcher.start({ values: {}, settings: baseSettings });
    expect(launcher.getStatus().status).toBe('starting');

    const proc = launcher['proc'] as any;
    proc._triggerExit(0);

    expect(launcher.getStatus().status).toBe('stopped');
    expect(launcher['proc']).toBeNull();
  });

  it('emits exit event with code on process exit', () => {
    const exitCodes: any[] = [];
    launcher.on('exit', (code: any) => exitCodes.push(code));

    launcher.start({ values: {}, settings: baseSettings });
    const proc = launcher['proc'] as any;
    proc._triggerExit(42);

    expect(exitCodes).toEqual([42]);
    expect(launcher.getStatus().status).toBe('stopped');
  });

  it('restart stops current process and starts a new one', async () => {
    const commands: any[][] = [];
    launcher.on('command', (cmd: any[]) => commands.push(cmd));

    launcher.start({ values: { ctx_size: 2048 }, settings: baseSettings });
    expect(commands.length).toBe(1);

    launcher.restart({ values: { ctx_size: 4096 }, settings: baseSettings });
    // kill 触发 exit → exit 回调中 start → 新 command
    expect(commands.length).toBe(2);
    expect(launcher.getStatus().status).toBe('starting');
    expect(commands[1]).toContain('-c');
    expect(commands[1]).toContain('4096');
    launcher.stop();
  });

  it('restart starts directly when not running', async () => {
    const commands: any[][] = [];
    launcher.on('command', (cmd: any[]) => commands.push(cmd));

    // 未运行时 restart 等同于 start
    launcher.restart({ values: { ctx_size: 2048 }, settings: baseSettings });
    expect(commands.length).toBe(1);
    expect(launcher.getStatus().status).toBe('starting');
    launcher.stop();
  });

  it('restart while running emits two status transitions (stopped then starting)', () => {
    const statuses: string[] = [];
    launcher.on('status', (e: { status: string }) => statuses.push(e.status));

    launcher.start({ values: {}, settings: baseSettings });
    launcher.restart({ values: {}, settings: baseSettings });

    // 启动(starting) → restart kill 触发 exit(stopped) → 重新 start(starting)
    const transitions = statuses.filter((s) => s === 'starting' || s === 'stopped');
    expect(transitions).toEqual(['starting', 'stopped', 'starting']);
    launcher.stop();
  });
});

// 下面这组是 b11178 基线审计引出的界面可见性契约：`--host` 新支持逗号分隔多地址、
// 且 57/60 个应用参数带 `LLAMA_ARG_*` 环境变量通道（可改写我们刻意不发射的缺省值）。
describe('Launcher - 多地址 host 与引擎侧环境变量', () => {
  // 每次起一个新实例：Launcher 是状态机，同一实例上「running 时再 start」会被拒（ emit error），
  // 复用会把后一条断言变成对上一次启动的取值。
  const instances: Launcher[] = [];
  afterEach(() => {
    for (const i of instances) if (i.getStatus().status !== 'stopped') i.stop();
    instances.length = 0;
    delete process.env.LLAMA_ARG_TEMPERATURE;
  });

  async function startedWith(values: Record<string, string | number | boolean>): Promise<ServerInfo> {
    const inst = new Launcher({ propsFetcher: noProps });
    instances.push(inst);
    const p = new Promise<void>((r) => inst.once('command', () => r()));
    inst.start({ values: { model: 'm.gguf', ...values }, settings: baseSettings });
    await p;
    return inst.getStatus();
  }

  it('多地址 host 的访问 URL 取回环项，host 字段保留用户原样串', async () => {
    const info = await startedWith({ host: '0.0.0.0,127.0.0.1', port: 8080 });
    expect(info.host).toBe('0.0.0.0,127.0.0.1');
    expect(info.url).toBe('http://127.0.0.1:8080/');
  });

  it('纯 UNIX socket 配置不下发 http URL（避免界面渲染出打不开的链接）', async () => {
    const info = await startedWith({ host: '/tmp/llama.sock', port: 8080 });
    expect(info.url).toBe('');
  });

  it('启动时检出 LLAMA_ARG_* 覆写项并随 getStatus 下发', async () => {
    // 不断言"空数组"：CI/本机若真设了引擎变量，那条断言会变成对环境的假设而非对代码的检验
    const before = await startedWith({});
    expect(before.envOverrides).not.toContain('LLAMA_ARG_TEMPERATURE');
    process.env.LLAMA_ARG_TEMPERATURE = '0.5';
    const after = await startedWith({});
    expect(after.envOverrides).toContain('LLAMA_ARG_TEMPERATURE');
  });
});

// 回读校验的接线：结果晚于 running 事件到达，靠「补发一次同状态事件」带下去。
// 这条链路是界面唯一「已证实引擎收到了什么」的来源，值得钉死。
describe('Launcher - 就绪后 /props 回读对账', () => {
  const propsFixture = {
    build_info: 'b11178-f9af9be21',
    ui: true,
    endpoint_slots: true,
    endpoint_metrics: false,
    total_slots: 4,
    model_path: 'D:\\m.gguf',
    model_alias: 'm',
    default_generation_settings: { params: { seed: 4294967295, temperature: 0.8, top_k: 20, top_p: 0.95, min_p: 0.05, repeat_penalty: 1, presence_penalty: 0 } },
  };

  it('回读完成后补发同状态事件并带上不一致项', async () => {
    const l = new Launcher({ propsFetcher: async () => ({ ok: true, json: propsFixture }) });
    const events: ServerStatusEvent[] = [];
    l.on('status', (e: ServerStatusEvent) => events.push(e));

    l.start({ values: { model: 'D:/m.gguf', alias: 'm', temperature: 0.8, top_k: 40 }, settings: baseSettings });
    (l['proc'] as any)._triggerOutput('llama_server: listening on http://127.0.0.1:8080');

    // 首个 running 事件不带结果：回读是异步的，不阻塞状态迁移
    expect(events.map((e) => e.status)).toEqual(['starting', 'running']);
    expect(events[1].propsCheck).toBeNull();

    await vi.waitFor(() => expect(events.length).toBe(3));
    const last = events[2];
    expect(last.status).toBe('running'); // 同状态补发，不是新状态
    expect(last.propsCheck?.buildInfo).toBe('b11178-f9af9be21');
    // 我们以为 top_k=40（等于引擎缺省基线所以没发射），引擎实际按 20 跑 → 必须现形
    expect(last.propsCheck?.mismatched.map((m) => m.param)).toEqual(['top_k']);
    expect(last.propsCheck?.checked).toContain('temperature');
    expect(l.getStatus().propsCheck?.mismatched.length).toBe(1);
    l.stop();
  });

  it('取不到 /props 只标 unreachable，不产生任何不一致', async () => {
    const l = new Launcher({ propsFetcher: async () => ({ ok: false, json: null }) });
    const events: ServerStatusEvent[] = [];
    l.on('status', (e: ServerStatusEvent) => events.push(e));
    l.start({ values: { model: 'D:/m.gguf' }, settings: baseSettings });
    (l['proc'] as any)._triggerOutput('llama server is listening');
    await vi.waitFor(() => expect(events.length).toBe(3));
    const check = events[2].propsCheck;
    expect(check?.error).toBe('unreachable');
    expect(check?.mismatched).toEqual([]);
    l.stop();
  });

  it('纯 UNIX socket 配置不发回读请求（没有 TCP URL 可请求）', async () => {
    let calls = 0;
    const l = new Launcher({
      propsFetcher: async () => { calls++; return { ok: true, json: propsFixture }; },
    });
    l.start({ values: { model: 'D:/m.gguf', host: '/tmp/llama.sock' }, settings: baseSettings });
    (l['proc'] as any)._triggerOutput('llama server is listening');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
    expect(l.getStatus().status).toBe('running');
    l.stop();
  });

  it('周期复检：结果没变就不补发事件，变了才补发一次', async () => {
    vi.useFakeTimers();
    try {
      let topK = 20;
      const l = new Launcher({
        propsFetcher: async () => ({ ok: true, json: { ...propsFixture, default_generation_settings: { n_ctx: 262144, params: { top_k: topK } } } }),
      });
      const events: ServerStatusEvent[] = [];
      l.on('status', (e: ServerStatusEvent) => events.push(e));
      l.start({ values: { model: 'D:/m.gguf', top_k: 20 }, settings: baseSettings });
      (l['proc'] as any)._triggerOutput('llama server is listening');
      await vi.advanceTimersByTimeAsync(1);
      expect(events.length).toBe(3); // starting, running, 首次回读补发

      // 引擎值没变：再跑一轮只应多一次 HTTP，不应多一个事件
      await vi.advanceTimersByTimeAsync(61_000);
      expect(events.length).toBe(3);

      // 引擎值被运行期改动（POST /props）：必须现形并补发
      topK = 40;
      await vi.advanceTimersByTimeAsync(61_000);
      expect(events.length).toBe(4);
      expect(events[3].status).toBe('running');
      expect(events[3].propsCheck?.mismatched.map((m) => m.param)).toEqual(['top_k']);
      l.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
