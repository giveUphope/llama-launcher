import { EventEmitter } from 'node:events';
import { LlamaServerProcess } from './process.js';
import { buildCommand } from './command-builder.js';
import type { AppSettings, ServerStatus, ServerInfo, OutputEntry } from '@llama-launcher/shared';

export interface StartOptions {
  values: Record<string, string | number | boolean>;
  settings: AppSettings;
}

export class Launcher extends EventEmitter {
  private proc: LlamaServerProcess | null = null;
  private status: ServerStatus = 'stopped';
  private currentSettings: AppSettings | null = null;
  // 最近一次 start/restart 使用的参数快照（用于判断当前运行服务是否与某组参数一致，
  // 参数未变时可据此避免重复加载）
  private currentValues: Record<string, string | number | boolean> = {};
  private host = '127.0.0.1';
  private port = 8080;

  start(opts: StartOptions): void {
    if (this.proc && this.proc.isRunning()) {
      this.emit('error', new Error('Server is already running'));
      return;
    }
    this.setStatus('starting');
    this.currentSettings = opts.settings;
    this.currentValues = { ...opts.values };
    // Track host/port from start() values so getStatus() can report them.
    const hostVal = opts.values.host;
    const portVal = opts.values.port;
    this.host = hostVal != null && String(hostVal) !== '' ? String(hostVal) : '127.0.0.1';
    this.port = portVal != null && !Number.isNaN(Number(portVal)) ? Number(portVal) : 8080;

    let cmd: string[];
    try {
      cmd = buildCommand({
        exePath: opts.settings.server_exe,
        modelPath: String(opts.values.model ?? ''),
        values: opts.values,
        customArgs: opts.settings.custom_args,
      });
    } catch (e) {
      this.setStatus('stopped');
      this.emit('error', e);
      return;
    }
    this.emit('command', cmd);
    this.proc = new LlamaServerProcess();
    // 进程拉起后向上层转发 spawned 事件（携带进程实例 + pid + exePath），
    // 供主进程建立窗口-进程关联映射，从而能在窗口关闭时精准清理。
    this.proc.on('spawned', (info: { pid: number | null; exePath?: string }) => {
      this.emit('spawned', { proc: this.proc, ...info });
    });
    this.proc.on('output', (entry: OutputEntry) => {
      this.emit('output', entry);
      // Detect "listening" message to flip status to running.
      // llama-server 输出格式因版本而异，采用通用匹配策略：
      //   旧版: "llama server is listening" / "http server listening"
      //   b9878+: "llama_server: listening on http://127.0.0.1:8080"
      //   未来版本: 任何包含 "listening" + "http" 的行均视为启动完成
      const lower = entry.data.toLowerCase();
      if (lower.includes('listening') && (lower.includes('http') || lower.includes('server'))) {
        this.setStatus('running');
      }
    });
    this.proc.on('exit', (code) => {
      this.emit('exit', code);
      this.setStatus('stopped');
      this.proc = null;
    });
    try {
      this.proc.start({ exePath: opts.settings.server_exe, args: cmd.slice(1) });
    } catch (e) {
      this.setStatus('stopped');
      this.emit('error', e);
    }
  }

  stop(): void {
    if (!this.proc) return;
    this.proc.kill();
  }

  /**
   * 同步停止：用于应用退出场景，确保子进程在主进程退出前被强制终止。
   */
  stopSync(): void {
    if (!this.proc) return;
    this.proc.killSync();
  }

  /**
   * 强制停止（不依赖 PID 句柄）：杀进程树 + 按可执行文件名扫杀残留同名进程。
   * 用于应用退出/窗口关闭等需要确保子进程彻底终止的场景。
   */
  forceStop(): void {
    if (!this.proc) return;
    this.proc.forceKill();
  }

  restart(opts: StartOptions): void {
    if (this.proc && this.proc.isRunning()) {
      this.proc.once('exit', () => this.start(opts));
      this.stop();
    } else {
      this.start(opts);
    }
  }

  getStatus(): ServerInfo {
    return {
      status: this.status,
      pid: this.proc?.pid ?? null,
      host: this.host,
      port: this.port,
      url: `http://${this.host}:${this.port}/`,
      // 最近一次启动的参数快照（纯值映射，无 `_enabled`），供渲染进程判断当前服务是否与某组参数一致
      values: { ...this.currentValues },
    };
  }

  /** 返回当前托管的子进程实例（未启动时返回 null）。供主进程同步建立窗口-进程关联。 */
  getProcess(): LlamaServerProcess | null {
    return this.proc;
  }

  /** 返回启动用的可执行文件路径（用于按名扫杀兜底）。 */
  getExePath(): string {
    return this.currentSettings?.server_exe ?? '';
  }

  private setStatus(s: ServerStatus): void {
    this.status = s;
    this.emit('status', s);
  }
}
