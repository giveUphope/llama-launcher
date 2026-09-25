import { EventEmitter } from 'node:events';
import { LlamaServerProcess } from './process.js';
import { buildCommand } from './command-builder.js';
import { defaultPropsFetcher, verifyEngineProps, type PropsFetcher } from './server-props.js';
import { DEFAULT_HOST, DEFAULT_PORT, detectLlamaEnvOverrides, displayHost } from '@llama-launcher/shared';
import type { AppSettings, ServerStatus, ServerStopInfo, ServerInfo, OutputEntry, PropsCheck } from '@llama-launcher/shared';

export interface StartOptions {
  values: Record<string, string | number | boolean>;
  settings: AppSettings;
}

/** /props 复检周期：够 catches 运行期 POST /props 的改动，又不至于每分钟敲一次本地端口还制造事件噪声 */
const PROPS_POLL_MS = 60_000;

export interface LauncherDeps {
  /**
   * /props 取数实现。默认走全局 fetch（主进程有网络），
   * 单测**必须**注入桩——否则会真去请求本机 8080 上用户正在跑的 llama-server。
   */
  propsFetcher?: PropsFetcher;
}

export class Launcher extends EventEmitter {
  private proc: LlamaServerProcess | null = null;
  private status: ServerStatus = 'stopped';
  private currentSettings: AppSettings | null = null;
  // 最近一次 start/restart 使用的参数快照（用于判断当前运行服务是否与某组参数一致，
  // 参数未变时可据此避免重复加载）
  private currentValues: Record<string, string | number | boolean> = {};
  private host = DEFAULT_HOST;
  private port = DEFAULT_PORT;
  /** 本次启动时检出的 `LLAMA_ARG_*` 环境变量名（见 ServerInfo.envOverrides） */
  private envOverrides: string[] = [];
  /** /props 复检定时器；进程退出即清，不留悬空轮询 */
  private propsTimer: ReturnType<typeof setInterval> | null = null;
  /** 就绪后 /props 回读对账结果；每次 start 清空，未回读回来时为 null */
  private lastPropsCheck: PropsCheck | null = null;
  private readonly propsFetcher: PropsFetcher;

  constructor(deps: LauncherDeps = {}) {
    super();
    this.propsFetcher = deps.propsFetcher ?? defaultPropsFetcher;
  }
  // 本轮运行是否曾到达 running：退出时据此区分「运行中崩了」与「启动阶段就失败」
  private hadBeenReady = false;
  // 本轮结束是否由本应用主动停（stop/restart/forceStop/应用退出）——必须显式记，
  // 因为 Windows 下 taskkill /F 打出来的退出码并非 0，光看退出码分不清「用户停的」和「自己崩的」
  private stopRequested = false;
  private lastStop: ServerStopInfo | null = null;

  start(opts: StartOptions): void {
    if (this.proc && this.proc.isRunning()) {
      this.emit('error', new Error('Server is already running'));
      return;
    }
    // 新一轮运行：先清掉上一轮的停止事实与标记，再发 starting——
    // 留着旧崩溃记录会让渲染层把刚拉起的进程显示成「异常退出」。
    this.lastStop = null;
    this.hadBeenReady = false;
    this.stopRequested = false;
    this.lastPropsCheck = null;
    this.setStatus('starting');
    this.currentSettings = opts.settings;
    this.currentValues = { ...opts.values };
    // Track host/port from start() values so getStatus() can report them.
    const hostVal = opts.values.host;
    const portVal = opts.values.port;
    this.host = hostVal != null && String(hostVal) !== '' ? String(hostVal) : DEFAULT_HOST;
    this.port = portVal != null && !Number.isNaN(Number(portVal)) ? Number(portVal) : DEFAULT_PORT;
    this.envOverrides = detectLlamaEnvOverrides(process.env);

    let cmd: string[];
    try {
      cmd = buildCommand({
        exePath: opts.settings.server_exe,
        modelPath: String(opts.values.model ?? ''),
        values: opts.values,
        customArgs: opts.settings.custom_args,
      });
    } catch (e) {
      this.recordStop('spawn_failed');
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
      // 只有 starting 阶段需要识别"已监听"；服务运行后每行都 toLowerCase（最长 8KB 的新串）
      // + 2~3 次子串扫描纯属浪费，运行期日志量远大于启动期
      if (this.status !== 'starting') return;
      // Detect "listening" message to flip status to running.
      // llama-server 输出格式因版本而异，采用通用匹配策略：
      //   旧版: "llama server is listening" / "http server listening"
      //   b9878+: "llama_server: listening on http://127.0.0.1:8080"
      //   未来版本: 任何包含 "listening" + "http" 的行均视为启动完成
      const lower = entry.data.toLowerCase();
      if (lower.includes('listening') && (lower.includes('http') || lower.includes('server'))) {
        this.hadBeenReady = true;
        this.setStatus('running');
        // 就绪即回读，不阻塞状态迁移（服务可用不必等 HTTP 往返）
        this.startPropsWatch();
      }
    });
    this.proc.on('exit', (code: number, signal: NodeJS.Signals | null) => {
      this.emit('exit', code, signal);
      // 先记事实再改状态：状态事件要自带「它是怎么没的」，否则渲染层只能自己去猜日志
      this.lastStop = {
        reason: this.stopRequested ? 'stopped_by_user' : 'exited',
        // process.ts 把「被信号杀死、无退出码」归一成 -1，这里还原成 null，
        // 别让上层把 -1 当成一个真实退出码去判等
        code: code === -1 ? null : code,
        signal: signal ?? null,
        hadBeenReady: this.hadBeenReady,
        at: Date.now(),
      };
      this.setStatus('stopped');
      // 进程没了就别再每分钟去敲它的端口
      this.stopPropsWatch();
      this.proc = null;
    });
    try {
      this.proc.start({ exePath: opts.settings.server_exe, args: cmd.slice(1) });
    } catch (e) {
      this.recordStop('spawn_failed');
      this.setStatus('stopped');
      this.emit('error', e);
    }
  }

  stop(): void {
    if (!this.proc) return;
    this.stopRequested = true;
    this.proc.kill();
  }

  /**
   * 同步停止：用于应用退出场景，确保子进程在主进程退出前被强制终止。
   */
  stopSync(): void {
    if (!this.proc) return;
    this.stopRequested = true;
    this.proc.killSync();
  }

  /**
   * 强制停止（不依赖 PID 句柄）：杀进程树 + 按可执行文件名扫杀残留同名进程。
   * 用于应用退出/窗口关闭等需要确保子进程彻底终止的场景。
   */
  forceStop(): void {
    if (!this.proc) return;
    this.stopRequested = true;
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
    // host 可为 b11178 起的逗号分隔多地址：访问 URL 取其中的回环/首个 TCP 地址，
    // 纯 UNIX socket（.sock）配置没有 http URL → 给空串，避免 UI 渲染出打不开的链接。
    // `host` 字段本身保留用户原样填写的串（状态卡展示的是"服务绑在哪"，不是"从哪访问"）。
    const viewHost = displayHost(this.host);
    return {
      status: this.status,
      pid: this.proc?.pid ?? null,
      host: this.host,
      port: this.port,
      url: viewHost ? `http://${viewHost}:${this.port}/` : '',
      // 最近一次启动的参数快照（纯值映射，无 `_enabled`），供渲染进程判断当前服务是否与某组参数一致
      values: { ...this.currentValues },
      // 与 status 事件同源，避免 refreshStatus() 拿到比事件旧的停止事实
      stop: this.lastStop,
      // 启动那一刻检出的引擎侧环境变量（改名/清掉后要重启才会刷新，与 host/port 同语义）
      envOverrides: [...this.envOverrides],
      // 与 status 事件同源，页面重新激活时也能拿到最近一次回读结果
      propsCheck: this.lastPropsCheck,
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

  /** 起都没起来（命令构建/spawn 抛错）时的停止事实——没有退出码，也从未就绪。 */
  private recordStop(reason: 'spawn_failed'): void {
    this.lastStop = {
      reason,
      code: null,
      signal: null,
      hadBeenReady: this.hadBeenReady,
      at: Date.now(),
    };
  }

  private setStatus(s: ServerStatus): void {
    this.status = s;
    this.emit('status', { status: s, stop: this.lastStop, propsCheck: this.lastPropsCheck });
  }

  /**
   * 就绪后回读 /props 对账「引擎实际收到的」与「我们以为发出的」。
   * 结果晚于 running 事件到达，故完成后再发一次**同状态**事件把它带下去——
   * 渲染层按 status 幂等处理，多一次 running 不改变任何状态机迁移。
   * 取不到 /props（服务已停、网络异常）只标 error='unreachable'，不判成不一致，
   * 否则一次偶发失败就会在界面上谎报参数没生效——那正是我们一直在消灭的那类问题。
   */
  private runPropsCheck(): void {
    const viewHost = displayHost(this.host);
    if (!viewHost) return;
    const values = { ...this.currentValues };
    void verifyEngineProps({ baseUrl: `http://${viewHost}:${this.port}`, values, fetcher: this.propsFetcher }).then((check) => {
      if (this.status !== 'running') return;
      // 周期复检下结果通常没变：只有真的变了才补发事件，避免每分钟一次无意义跨桥推送
      const changed = JSON.stringify(check) !== JSON.stringify(this.lastPropsCheck);
      this.lastPropsCheck = check;
      if (changed) this.setStatus('running');
    });
  }

  /**
   * 首查 + 每 60s 复检。之所以不能只查一次：`POST /props` 允许运行期改全局生成属性，
   * 只查一次的话界面会一直显示早已陈旧的「已证实」结论。
   */
  private startPropsWatch(): void {
    this.stopPropsWatch();
    this.runPropsCheck();
    this.propsTimer = setInterval(() => this.runPropsCheck(), PROPS_POLL_MS);
  }

  private stopPropsWatch(): void {
    if (this.propsTimer) {
      clearInterval(this.propsTimer);
      this.propsTimer = null;
    }
  }
}
