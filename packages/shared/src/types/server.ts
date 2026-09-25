export type ServerStatus = 'stopped' | 'starting' | 'running';

/**
 * 子进程最近一次「退出 / 停止」的事实，由核心状态机（`Launcher`）记录，随状态事件一起跨桥下发。
 *
 * 为什么要有这个类型：服务页的「启动失败」与「异常退出」两态此前是由渲染层猜的——
 * 看最近 80 行日志里有没有 `error|failed|unable` 字样。而 llama-server 在正常运行期间
 * 就会为拒绝单个越界请求打这样一行：
 * `E srv  send_error: task id = N, error: request (481560 tokens) exceeds the available context size (95744 tokens)`
 * 进程活得好好的，界面却翻红成「异常退出」，再滚过 80 行日志又自己变回「运行中」（2026-09-25 修）。
 * 判「进程是否还在、怎么没的」只有核心状态机知道，故改由它下发事实，渲染层不再从日志文本推断。
 */
export interface ServerStopInfo {
  /**
   * 结束方式：
   * - `exited`：子进程自己退出（没等到它退出，或崩了）
   * - `spawn_failed`：命令构建或 spawn 阶段就抛错，进程压根没起来
   * - `stopped_by_user`：本应用主动 stop/restart/forceStop 导致的退出
   */
  reason: 'exited' | 'spawn_failed' | 'stopped_by_user';
  /** 退出码；被信号杀死时为 null（`process.ts` 用 -1 归一，此处还原为 null，别让上层把 -1 当成真退出码） */
  code: number | null;
  /** 终止信号名（如 `SIGKILL`）；正常退出为 null */
  signal: string | null;
  /** 结束前是否进入过 `running` —— 区分「运行中崩了」与「启动阶段就失败」 */
  hadBeenReady: boolean;
  /** 发生时刻（epoch ms） */
  at: number;
}

/**
 * `IPC.SERVER_STATUS` 事件的载荷：状态与停止事实一起给。
 * 分两条发会让渲染层先收到 `stopped`、再收到停止事实，中间那一瞬只能猜；一条发就没这个竞态。
 */
export interface ServerStatusEvent {
  status: ServerStatus;
  /** 最近一次结束的事实；`start()` 时清空，故 running/starting 期间为 null */
  stop: ServerStopInfo | null;
}

export interface ServerInfo {
  status: ServerStatus;
  pid: number | null;
  host: string;
  port: number;
  url: string;
  /** 最近一次启动/重启使用的参数快照（仅参数值，无逐参数启用位），用于判断服务是否与当前参数一致 */
  values?: Record<string, string | number | boolean>;
  /** 与 `IPC.SERVER_STATUS` 事件同源，保证 `refreshStatus()` 不会拿到比事件旧的停止事实 */
  stop?: ServerStopInfo | null;
  /**
   * 启动时检出的人设 `LLAMA_ARG_*` 环境变量名（llama.cpp 的引擎侧参数通道）。
   * 发射规则是「值等于引擎缺省就不写进命令行」，其前提是没有别的东西改写过缺省值；
   * 这些变量正具备该能力（b11178 起 help 里 57/60 个应用参数带 env 通道），
   * 因此界面必须能说明「这里显示的值不一定是引擎实际用的」。
   */
  envOverrides?: string[];
}

export type OutputKind =
  | 'stdout'
  | 'stderr'
  | 'end'
  | 'info'
  | 'success'
  | 'warn'
  | 'error';

export interface OutputEntry {
  kind: OutputKind;
  data: string;
  ts: number;
}

// 应用日志：应用自身生命周期/操作记录（服务启停、下载等），区别于服务控制台（后端 llama 输出）
export type AppLogKind = 'info' | 'success' | 'warn' | 'error';

export interface AppLogEntry {
  kind: AppLogKind;
  data: string;
  ts: number;
}

export interface ModelInfo {
  name: string;
  path: string;
  size: number; // bytes
  size_str: string;
  modified: string; // ISO datetime
  /** 模型目录下的伴随文件标签（mmproj / dflash / draft），由扫描器检测填充 */
  tags?: string[];
}

/**
 * llama-bench 离线体检结果（对未启动服务的模型文件直接测速，随引擎分发的 llama-bench.exe）。
 * 单次体检固定跑 pp512 / tg128 两个测试（全卸载 -ngl 99），汇总为 prefill / decode tok/s。
 */
export interface LlamaBenchSummary {
  modelPath: string;
  /** prefill 速度（pp512, tok/s）；未测出为 null */
  ppTokS: number | null;
  /** decode 速度（tg128, tok/s）；未测出为 null */
  tgTokS: number | null;
  /** 实际卸载层数（-ngl 99 时的引擎取值） */
  ngl: number | null;
  /** 后端（如 Vulkan） */
  backend: string | null;
  /** 模型描述（llama-bench model_type，如 "qwen35moe 35B.A3B IQ1_M - 1.75 bpw"） */
  modelType: string | null;
  /** 完成时间 ISO */
  testedAt: string;
}

/** llama-bench 作业状态（单模型单作业；结果按模型路径缓存于主进程会话期） */
export interface LlamaBenchJobState {
  modelPath: string;
  state: 'running' | 'done' | 'error';
  error?: string;
  summary?: LlamaBenchSummary;
}
