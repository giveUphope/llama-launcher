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
  /** 就绪后 /props 回读对账结果；每次 start 清空，未回读回来时为 null */
  private lastPropsCheck: PropsCheck | null = null;
  private readonly propsFetcher: PropsFetcher;

  constructor(deps: LauncherDeps = {}) {
    super();
    this.propsFetcher = deps.propsFetcher ?? defaultPropsFetcher;
  }
  // 本轮运行是否曾到达 running：退出时据此区分「运行中崩了」与「启动阶段就失败」
  private hadBeenReady = false;
  /**
   * 本轮首次检出就绪（listening）的时刻，epoch ms；未就绪或本轮进程已退出为 null。
   * 为什么核心要专门记这个时刻：界面要显示「已运行 N 分 N 秒」，而渲染层只知道
   * 「自己什么时候看见 running」——用户第一次进概览页 / 渲染层重载时看见的 running
   * 比真就绪晚得多，时长于是永远显示「—」或从进页面那一刻起算（2026-10 实测）。
   * 进程何时可用只有状态机知道，事实必须由这里下发。
   */
  private readyAt: number | null = null;
  // 本轮结束是否由本应用主动停（stop/restart/forceStop/应用退出）——必须显式记，
  // 因为 Windows 下 taskkill /F 打出来的退出码并非 0，光看退出码分不清「用户停的」和「自己崩的」
  private stopRequested = false;
  private lastStop: ServerStopInfo | null = null;
  // 已排队的重启只允许有一个：restart() 等旧进程 exit 后再 start，连点两次「重启」
  // 若排队两次就会并发拉起第二个进程（表现为停不掉 + 再启动报端口占用）
  private restartArmed = false;
  // 每轮 start 自增：/props 回读是异步的，旧一轮晚到的结果不得写进新一轮
  private runSeq = 0;

  start(opts: StartOptions): void {
    if (this.proc && this.proc.isRunning()) {
      this.emit('error', new Error('Server is already running'));
      return;
    }
    // 新一轮运行：先清掉上一轮的停止事实与标记，再发 starting——
    // 留着旧崩溃记录会让渲染层把刚拉起的进程显示成「异常退出」。
    this.lastStop = null;
    this.hadBeenReady = false;
    this.readyAt = null;
    this.stopRequested = false;
    this.lastPropsCheck = null;
    this.runSeq++;
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
    // 本轮进程对象的本地引用：exit 回调可能在下一轮已经开始之后才到达
    const proc = this.proc;
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
        // 只认第一次：引擎后续还可能再打一行含 listening 的输出，覆盖成晚一些的时刻
        // 会让界面显示的时长比真实运行时间短
        if (this.readyAt === null) this.readyAt = Date.now();
        this.setStatus('running');
        // 就绪即回读一次，不阻塞状态迁移（服务可用不必等 HTTP 往返）
        this.runPropsCheck();
      }
    });
    this.proc.on('exit', (code: number, signal: NodeJS.Signals | null) => {
      this.emit('exit', code, signal);
      // 迟到的旧进程退出不得改写新一轮：restart 之后 this.proc 已指向新进程，
      // 若在这里无条件清状态，刚拉起的服务会被显示成「已停止」，还会按旧轮的
      // stopRequested / hadBeenReady 判成「异常退出」。
      if (this.proc !== proc) return;
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
      // 回读结论属于「这一轮服务运行期」的事实：进程没了还挂着，服务页就会在
      // 停止状态下显示上一轮的「N 项与运行中不一致」
      this.lastPropsCheck = null;
      // 就绪时刻同理只活在进程活着的那段：停服后还留着，界面就会给一个已经不存在的
      // 进程继续计时（hadBeenReady 不清，它已被上面的 lastStop 快照带走）
      this.readyAt = null;
      this.setStatus('stopped');
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
    // 先出声再动手：没有 stopping 这一态时，界面在进程真正退出之前一直显示「运行中」，
    // 停止/重启按钮全程可点——连点就会并发拉起第二个进程。
    if (this.status !== 'stopping') this.setStatus('stopping');
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
      // 只允许排队一次：连点两次「重启」若挂上两个 once('exit')，旧进程一死就会
      // 并发拉起两个 llama-server，第二个直接撞 already running / 端口占用
      if (this.restartArmed) return;
      this.restartArmed = true;
      this.proc.once('exit', () => {
        this.restartArmed = false;
        this.start(opts);
      });
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
      // 与 status 事件同源：重载后的渲染层第一次拉状态就该有就绪时刻，不必等下一次状态推送
      readyAt: this.readyAt,
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
    this.emit('status', { status: s, stop: this.lastStop, propsCheck: this.lastPropsCheck, readyAt: this.readyAt });
  }

  /**
   * 回读 /props 并对账；结果有序列化差异时才补发一次同状态事件
   * （渲染层按 status 幂等，重复 running 不改状态机）。
   * 取不到 /props 只标 error='unreachable'，不判成不一致——偶发网络失败
   * 不该让界面谎报「参数没生效」，那正是本项目一直在消灭的那类问题。
   *
   * 触发时机是事件而非定时器：就绪时一次；此后仅在「有人真的在看」——页签重新可见或
   * 用户手动点「重新校验」（两者经 `server:status(refresh:true)`），以及窗口重新聚焦
   * （主进程 `launcher-bridge` 挂 `win.on('focus')` 直接调 `recheckProps()`，
   * 不经渲染层：窗口没聚焦时渲染层也收不到那个信号）——时由 `recheckProps()` 触发。
   * 引擎的参数只可能被外部 `POST /props` 改动，
   * 盲目每 60s 敲一次端口既抓不到规律，也无事可报。
   */
  private runPropsCheck(): void {
    const viewHost = displayHost(this.host);
    if (!viewHost) return;
    const values = { ...this.currentValues };
    // 世代号：重启后新一轮也是 running，旧一轮在途的回读若只判 status 就会晚到并覆盖新结论
    const seq = this.runSeq;
    void verifyEngineProps({
      baseUrl: `http://${viewHost}:${this.port}`,
      values,
      fetcher: this.propsFetcher,
    }).then((check) => {
      if (seq !== this.runSeq || this.status !== 'running') return;
      const changed = JSON.stringify(check.mismatched) !== JSON.stringify(this.lastPropsCheck?.mismatched)
        || check.error !== this.lastPropsCheck?.error
        || JSON.stringify(check.baselineDrift) !== JSON.stringify(this.lastPropsCheck?.baselineDrift);
      this.lastPropsCheck = check;
      if (changed) this.setStatus('running');
    });
  }

  /** 供主进程在 `server:status(refresh)`、窗口重新聚焦或手动校验时调用；不阻塞调用方 */
  recheckProps(): void {
    if (this.status === 'running') this.runPropsCheck();
  }
}
