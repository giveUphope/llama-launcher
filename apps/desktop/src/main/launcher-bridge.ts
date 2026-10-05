import { Launcher, basenameSafe } from '@llama-launcher/core';
import { BrowserWindow } from 'electron';
import { IPC } from '@llama-launcher/shared';
import { processRegistry } from './process-registry.js';
import type { WebContents } from 'electron';
import type { AppSettings, PresetValues, OutputEntry, ServerStatusEvent } from '@llama-launcher/shared';

class LauncherBridge {
  private launcher = new Launcher();
  private win: BrowserWindow | null = null;
  private outputBuffer: OutputEntry[] = [];
  private MAX_BUFFER = 5000;
  // 已挂上「文档加载完成 → 缓冲回放」钩子的 webContents：同一窗口重复 setWindow 不重复挂，
  // 否则一次加载会触发多遍整段回放（控制台历史日志翻倍）。
  private hookedWc: WebContents | null = null;
  /** 当前文档是否已收过整段缓冲回放；主框架每次加载完成（含 Ctrl+R）都会重新置空 */
  private replayedWc: WebContents | null = null;
  /** 已挂上「窗口聚焦 → /props 复检」钩子的窗口，去重同上 */
  private focusHookedWin: BrowserWindow | null = null;
  /** 输出批量推送：模型加载等突发日志按 16ms 窗口合并发送，避免逐行 IPC 压垮渲染进程 */
  private outputQueue: OutputEntry[] = [];
  private outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static OUTPUT_FLUSH_INTERVAL_MS = 16;
  /** 历史缓冲重放的分块行数（单条 send 载荷过大也会拖住渲染进程） */
  private static REPLAY_CHUNK = 200;

  constructor() {
    // 事件监听器只注册一次，避免重复 start 时累积监听
    this.launcher.on('output', (entry: OutputEntry) => {
      this.pushOutput(entry);
    });
    this.launcher.on('status', (e: ServerStatusEvent) => {
      if (this.win && !this.win.isDestroyed()) {
        // 状态与停止事实一起下发：渲染层不再从日志文字推断 failed/crashed
        this.win.webContents.send(IPC.SERVER_STATUS, e);
      }
    });
    // Launcher 的同步失败（已运行中、命令构建失败、spawn 失败）原先只 emit 'error'，
    // 无人转发到渲染层——IPC 仍返回 ok，界面零反馈，表现为“点击启动状态无变化”。
    // 落入控制台缓冲，随 output 批量推送可见。
    this.launcher.on('error', (err: Error) => {
      this.pushOutput({ kind: 'error', data: `[Launcher] ${err?.message ?? String(err)}\n`, ts: Date.now() });
    });
  }

  /** 缓冲输出：同时写入重放缓冲与批量推送队列（16ms 合并一次发送）。 */
  private pushOutput(entry: OutputEntry): void {
    this.outputBuffer.push(entry);
    if (this.outputBuffer.length > this.MAX_BUFFER) {
      this.outputBuffer.splice(0, this.outputBuffer.length - this.MAX_BUFFER);
    }
    this.outputQueue.push(entry);
    if (!this.outputFlushTimer) {
      this.outputFlushTimer = setTimeout(() => {
        this.outputFlushTimer = null;
        this.flushOutputQueue();
      }, LauncherBridge.OUTPUT_FLUSH_INTERVAL_MS);
    }
  }

  private flushOutputQueue(): void {
    if (this.outputQueue.length === 0) return;
    const batch = this.outputQueue;
    this.outputQueue = [];
    if (this.win && !this.win.isDestroyed()) {
      // 一个 16ms 窗口一次 send：逐行 send 时每条日志都要走一遍 IPC + 结构化克隆 +
      // 渲染层一次刷新，模型加载阶段数百行会直接把渲染进程压住
      this.win.webContents.send(IPC.SERVER_OUTPUT_BATCH, batch);
    }
  }

  setWindow(win: BrowserWindow | null) {
    this.win = win;
    if (!win) {
      // 窗口关闭后重置，下一次新建窗口仍能重新挂钩并恢复历史日志
      this.hookedWc = null;
      this.replayedWc = null;
      this.focusHookedWin = null;
      return;
    }
    if (win.isDestroyed()) return;
    const wc = win.webContents;
    if (wc !== this.hookedWc) {
      this.hookedWc = wc;
      // 回放时机选在「渲染层刚重新订阅完」而不是「窗口刚创建」：
      // App.vue 的 onMounted 里才 api.server.onOutputBatch(...)，而 preload 收到没人
      // 订阅的事件是直接丢弃的——在窗口创建那一刻 send，渲染层还没订阅，整段缓冲等于白发生。
      // 更要紧的是 Ctrl+R / dev 重载：那是同一个窗口、同一次 setWindow，旧写法再不会回放，
      // 于是引擎明明还在吐日志，界面却全空，要等下一条新日志才有内容。
      wc.on('did-finish-load', () => {
        this.replayedWc = null; // 新文档的控制台是空的 → 整段缓冲该再来一遍
        this.replayBuffer(win);
      });
    }
    if (this.focusHookedWin !== win) {
      this.focusHookedWin = win;
      // 窗口重新聚焦 = 「有人真的在看」的事件信号（与 ipc/download.ts 的 focus 补发进度同构）。
      // 放在主进程而不是渲染层：窗口没聚焦时渲染层自己也收不到 focus，且这里不需要跨桥。
      // 这是三个即时触发点之一（另两个：渲染层 store 的可见自适应节拍、用户点「重新校验」）；
      // 核心自身不排定时器，每次 recheckProps 只发一次本地 GET，结论没变就不补发状态事件。
      win.on('focus', () => this.launcher.recheckProps());
    }
    // setWindow 晚于页面加载完成时（启动顺序被调整）did-finish-load 不会再补一次，当场回放
    if (!wc.isLoading()) this.replayBuffer(win);
  }

  /** 缓冲历史按批重放（同样走 SERVER_OUTPUT_BATCH），避免整段 5000 行逐条 send。每个文档一次。 */
  private replayBuffer(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const wc = win.webContents;
    if (wc.isDestroyed() || this.replayedWc === wc) return;
    this.replayedWc = wc;
    for (let i = 0; i < this.outputBuffer.length; i += LauncherBridge.REPLAY_CHUNK) {
      wc.send(
        IPC.SERVER_OUTPUT_BATCH,
        this.outputBuffer.slice(i, i + LauncherBridge.REPLAY_CHUNK),
      );
    }
  }

  start(values: PresetValues, settings: AppSettings) {
    this.launcher.start({ values, settings });
    // 同步建立窗口-进程关联：spawn 在 start() 内部同步完成，
    // 返回后立即关联，不依赖 spawned 事件回环，避免任何时序/事件丢失导致关联失败。
    // spawned 事件仍作为兜底（见构造函数），双保险。
    if (this.win && !this.win.isDestroyed()) {
      const proc = this.launcher.getProcess();
      if (proc) {
        const exeName = this.launcher.getExePath() ? basenameSafe(this.launcher.getExePath()) : null;
        processRegistry.associate(this.win, proc, exeName);
      }
    }
  }

  stop() { this.launcher.stop(); }

  restart(values: PresetValues, settings: AppSettings) {
    this.launcher.restart({ values, settings });
  }

  getStatus() {
    return this.launcher.getStatus();
  }

  /** 触发一次 /props 回读（异步，不阻塞调用方；结果变化时经 server:status 推送） */
  recheckProps() {
    this.launcher.recheckProps();
  }

  isRunning(): boolean {
    // stopping 期间端口仍归自家进程：把它当空闲端口去接管，会误判成「外部实例」
    const s = this.launcher.getStatus().status;
    return s === 'running' || s === 'starting' || s === 'stopping';
  }

  dispose(): Promise<void> {
    return new Promise((resolve) => {
      const status = this.launcher.getStatus().status;
      if (status === 'stopped') {
        this.outputBuffer = [];
        resolve();
        return;
      }
      this.launcher.once('exit', () => {
        this.outputBuffer = [];
        resolve();
      });
      try { this.launcher.stop(); } catch {}
      // 兜底：最多等待 5 秒
      setTimeout(() => {
        this.outputBuffer = [];
        resolve();
      }, 5000);
    });
  }

  /**
   * 同步清理：用于应用退出/窗口关闭场景。
   * 使用 forceStop()：杀进程树 + 按可执行文件名扫杀残留同名进程，
   * 不依赖 PID 句柄是否有效，确保关闭窗口后无 llama-server 残留。
   * 设计为幂等：重复调用安全。
   */
  disposeSync(): void {
    try {
      this.launcher.forceStop();
    } catch {
      // 忽略清理过程中的异常，确保退出不被阻塞
    }
    this.outputBuffer = [];
  }
}

export const launcherBridge = new LauncherBridge();
