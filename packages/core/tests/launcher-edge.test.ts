import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 与 launcher.test.ts 同形的进程夹具，另加 _triggerSpawned：spawned 事件是主进程建立
// 「窗口 ↔ 进程」关联映射的入口（窗口关闭时精准清理子进程全靠它），值得单独钉住。
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
      if (this._listeners.exit) {
        [...this._listeners.exit].forEach((fn: Function) => fn(0));
      }
      return true;
    }

    killSync(): boolean {
      return this.kill();
    }

    forceKill(): void {
      this.kill();
    }

    on(event: string, fn: Function): this {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return this;
    }

    off(event: string, fn: Function): this {
      const list = this._listeners[event];
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
      return this;
    }

    once(event: string, fn: Function): this {
      const wrapper = (...args: any[]) => {
        this.off(event, wrapper);
        fn(...args);
      };
      return this.on(event, wrapper);
    }

    _triggerOutput(data: string) {
      const entry = { kind: 'stdout' as const, data, ts: Date.now() };
      if (this._listeners.output) {
        [...this._listeners.output].forEach((fn: Function) => fn(entry));
      }
    }

    _triggerSpawned(info: { pid: number | null; exePath?: string }) {
      this.pid = info.pid;
      if (this._listeners.spawned) {
        [...this._listeners.spawned].forEach((fn: Function) => fn(info));
      }
    }
  };

  return { LlamaServerProcess: FakeLlamaServerProcess };
});

import { Launcher } from '../src/launcher.js';
import { ENGINE_BASELINE_BUILD } from '@llama-launcher/shared';
import type { PropsFetcher } from '../src/server-props.js';
import type { AppSettings, ServerStatusEvent } from '@llama-launcher/shared';

/** 单测桩：默认不发真网络请求（本机 8080 可能正跑着用户的 llama-server）。 */
const noProps: PropsFetcher = async () => ({ ok: false, json: null });

const baseSettings: AppSettings = {
  server_exe: process.execPath,
  models_dir: './models',
  selected_model: '',
  window_geometry: '1280x800',
  theme_mode: 'dark',
  sidebar_collapsed: false,
  language: 'zh',
  last_tab: '',
};

const LISTENING = 'llama_server: listening on http://127.0.0.1:8080';

/** 比基线旧一号的构建号：baselineDrift 断言全部从常量推导，不落第二个基线字面量
 * （re-pin 时改一处常量，这里跟着变，不会假红）。 */
const OLDER_BUILD = `b${Number(ENGINE_BASELINE_BUILD.match(/b(\d+)/)![1]) - 1}`;

describe('Launcher - /props 回读的在途与世代纪律（launcher.test.ts 未覆盖的分支）', () => {
  let launcher: Launcher;

  beforeEach(() => {
    launcher = new Launcher({ propsFetcher: noProps });
  });

  afterEach(() => {
    if (launcher.getStatus().status !== 'stopped') launcher.stop();
    vi.restoreAllMocks();
  });

  it('取数实现自身抛错：放行下一次回读，不把自动刷新永久关掉', async () => {
    // ok:false 走的是「unreachable」正常路径；这里钉的是 fetcher 直接 throw 的 catch 分支——
    // 在途标记若不清，一次异常之后 recheckProps 永远敲不出第二次请求
    let calls = 0;
    launcher = new Launcher({
      propsFetcher: async () => {
        calls++;
        if (calls === 1) throw new Error('fetcher exploded');
        return { ok: true, json: { build_info: `${ENGINE_BASELINE_BUILD}-x`, ui: true } };
      },
    });
    const events: ServerStatusEvent[] = [];
    launcher.on('status', (e: ServerStatusEvent) => events.push(e));

    launcher.start({ values: { model: 'D:/m.gguf' }, settings: baseSettings });
    (launcher['proc'] as any)._triggerOutput(LISTENING);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1); // 第一次已发起并已抛出

    launcher.recheckProps();
    await vi.waitFor(() => expect(calls).toBe(2));
    await vi.waitFor(() => expect(launcher.getStatus().propsCheck).not.toBeNull());
    expect(launcher.getStatus().propsCheck?.error).toBeNull();
    l_stop(launcher);
  });

  it('回读结果晚到但进程已停（同世代）：丢弃不补发，propsCheck 保持 null', async () => {
    // 与「按世代去重」不同的一条分支：seq 相同（没重启过），只是结果回来时进程已经没了。
    // 若照样 setStatus('running')，已停止的服务会被拉回「运行中」。
    let release: (() => void) | undefined;
    launcher = new Launcher({
      propsFetcher: async () => {
        await new Promise<void>((r) => { release = r; });
        return { ok: true, json: { build_info: `${ENGINE_BASELINE_BUILD}-x`, ui: true } };
      },
    });
    const events: ServerStatusEvent[] = [];
    launcher.on('status', (e: ServerStatusEvent) => events.push(e));

    launcher.start({ values: { model: 'D:/m.gguf' }, settings: baseSettings });
    (launcher['proc'] as any)._triggerOutput(LISTENING);
    await new Promise((r) => setTimeout(r, 0));
    expect(launcher.getStatus().status).toBe('running');

    launcher.stop(); // kill 同步触发 exit → stopped
    expect(launcher.getStatus().status).toBe('stopped');

    release!();
    await new Promise((r) => setTimeout(r, 20));
    expect(events.map((e) => e.status)).toEqual(['starting', 'running', 'stopping', 'stopped']);
    expect(launcher.getStatus().propsCheck).toBeNull();
  });

  it('引擎构建比基线旧：baselineDrift 随回读结果一起下发', async () => {
    launcher = new Launcher({
      propsFetcher: async () => ({ ok: true, json: { build_info: `${OLDER_BUILD}-deadbeef` } }),
    });
    launcher.start({ values: { model: 'D:/m.gguf' }, settings: baseSettings });
    (launcher['proc'] as any)._triggerOutput(LISTENING);
    await vi.waitFor(() => expect(launcher.getStatus().propsCheck).not.toBeNull());

    const check = launcher.getStatus().propsCheck!;
    // 断言从常量推导，不写死基线构建号（re-pin 不得在此留下第二处字面量）
    expect(check.baselineDrift).toEqual({ engineBuild: OLDER_BUILD, baselineBuild: ENGINE_BASELINE_BUILD });
    expect(check.buildInfo).toBe(`${OLDER_BUILD}-deadbeef`);
    l_stop(launcher);
  });
});

describe('Launcher - host/port 取值回退与状态快照', () => {
  let launcher: Launcher;

  beforeEach(() => {
    launcher = new Launcher({ propsFetcher: noProps });
  });

  afterEach(() => {
    if (launcher.getStatus().status !== 'stopped') launcher.stop();
  });

  it('host 空串回落默认 127.0.0.1；port 非数字回落默认 8080', () => {
    launcher.start({ values: { host: '', port: 'abc' }, settings: baseSettings });
    const info = launcher.getStatus();
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBe(8080);
    expect(info.url).toBe('http://127.0.0.1:8080/');
    launcher.stop();
  });

  it('getStatus().values 是副本：调用方就地改写不得污染内部参数快照', () => {
    launcher.start({ values: { ctx_size: 4096 }, settings: baseSettings });
    const first = launcher.getStatus();
    first.values.ctx_size = 'mutated';
    expect(launcher.getStatus().values.ctx_size).toBe(4096);
    launcher.stop();
  });

  it('未启动时 stop() 是安全空操作（不发任何状态事件）', () => {
    const events: unknown[] = [];
    launcher.on('status', (e: unknown) => events.push(e));
    expect(() => launcher.stop()).not.toThrow();
    expect(events).toEqual([]);
    expect(launcher.getStatus().status).toBe('stopped');
  });
});

describe('Launcher - spawned 事件转发（窗口 ↔ 进程关联的入口）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('子进程 spawned 事件原样向上转发，并附带进程实例与 pid', () => {
    const launcher = new Launcher({ propsFetcher: noProps });
    const spawned: Array<{ pid: number | null; exePath?: string; proc: unknown }> = [];
    launcher.on('spawned', (info: any) => spawned.push(info));

    launcher.start({ values: {}, settings: baseSettings });
    const proc = launcher.getProcess()!;
    (proc as any)._triggerSpawned({ pid: 4242, exePath: 'D:/eng/llama-server.exe' });

    expect(spawned).toHaveLength(1);
    expect(spawned[0].pid).toBe(4242);
    expect(spawned[0].exePath).toBe('D:/eng/llama-server.exe');
    // 进程实例必须就是当前托管的那个：主进程靠它登记窗口映射，拿错句柄清理就会扑空
    expect(spawned[0].proc).toBe(proc);
    launcher.stop();
  });
});

/** 收尾兜底：直接驱动 exit，避免夹具状态泄漏到下一个用例 */
function l_stop(l: Launcher) {
  if (l.getStatus().status !== 'stopped') l.stop();
}
