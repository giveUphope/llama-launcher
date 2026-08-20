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

    start(opts: any) {
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
import type { AppSettings } from '@llama-launcher/shared';

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
    launcher = new Launcher();
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
    expect(capturedCmd).toContain('--host');
    expect(capturedCmd).toContain('127.0.0.1');
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
    launcher.on('status', (s: string) => statuses.push(s));

    launcher.start({ values: {}, settings: baseSettings });
    expect(statuses).toContain('starting');

    const info = launcher.getStatus();
    expect(info.status).toBe('starting');

    launcher.stop();
    // kill 触发 exit → setStatus('stopped')
    expect(statuses).toContain('stopped');
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
    launcher = new Launcher();
  });

  afterEach(() => {
    if (launcher.getStatus().status !== 'stopped') {
      launcher.stop();
    }
    vi.restoreAllMocks();
  });

  // llama-server 不同版本的 listening 输出格式（见 docs/core-modules.md §4.2 通用 listening 检测）
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
    launcher.on('status', (s: string) => statuses.push(s));

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
    launcher = new Launcher();
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
    launcher.on('status', (s: string) => statuses.push(s));

    launcher.start({ values: {}, settings: baseSettings });
    launcher.restart({ values: {}, settings: baseSettings });

    // 启动(starting) → restart kill 触发 exit(stopped) → 重新 start(starting)
    const transitions = statuses.filter((s) => s === 'starting' || s === 'stopped');
    expect(transitions).toEqual(['starting', 'stopped', 'starting']);
    launcher.stop();
  });
});
