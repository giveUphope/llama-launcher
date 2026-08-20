import { Launcher, basenameSafe } from '@llama-launcher/core';
import { BrowserWindow } from 'electron';
import { processRegistry } from './process-registry.js';
import type { AppSettings, PresetValues, OutputEntry, ServerStatus } from '@llama-launcher/shared';

class LauncherBridge {
  private launcher = new Launcher();
  private win: BrowserWindow | null = null;
  private outputBuffer: OutputEntry[] = [];
  private MAX_BUFFER = 5000;
  // 已重发过缓冲的窗口：同一窗口重复 setWindow 时跳过重发，
  // 避免同一窗口多次收到整段历史日志（控制台重复输出）。
  private bufferedWin: BrowserWindow | null = null;
  /** 输出批量推送：模型加载等突发日志按 16ms 窗口合并发送，避免逐行 IPC 压垮渲染进程 */
  private outputQueue: OutputEntry[] = [];
  private outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static OUTPUT_FLUSH_INTERVAL_MS = 16;

  constructor() {
    // 事件监听器只注册一次，避免重复 start 时累积监听
    this.launcher.on('output', (entry: OutputEntry) => {
      this.pushOutput(entry);
    });
    this.launcher.on('status', (s: ServerStatus) => {
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send('server:status', s);
      }
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
      for (const e of batch) {
        this.win.webContents.send('server:output', e);
      }
    }
  }

  setWindow(win: BrowserWindow | null) {
    this.win = win;
    if (win && !win.isDestroyed() && win !== this.bufferedWin) {
      // Send any buffered output to the new window
      for (const e of this.outputBuffer) {
        win.webContents.send('server:output', e);
      }
      this.bufferedWin = win;
    } else if (!win) {
      // 窗口关闭后重置，下一次新建窗口仍能恢复历史日志
      this.bufferedWin = null;
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

  isRunning(): boolean {
    return this.launcher.getStatus().status === 'running' || this.launcher.getStatus().status === 'starting';
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
