export type ServerStatus = 'stopped' | 'starting' | 'running';

export interface ServerInfo {
  status: ServerStatus;
  pid: number | null;
  host: string;
  port: number;
  url: string;
  /** 最近一次启动/重启使用的参数快照（含 _enabled），用于判断服务是否与当前参数一致 */
  values?: Record<string, string | number | boolean>;
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
