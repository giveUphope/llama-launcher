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
 * 性能测试请求：对运行中的 llama-server 发生成请求。
 * 一次「运行测试」始终执行单并发（1 个请求）；多并发场景依据服务器实际并行槽位数
 * （-np / parallel 参数）决定：np ≥ 2 时以 np 为并发数（钳制上限 8），np ≤ 1（含默认 -1 自动）
 * 时服务器无多并行槽位可测，仅执行单并发，多并发结果置 null。
 */
export interface BenchRequest {
  prompt: string;
  maxTokens: number;
  /** 服务器 API key（参数表中的 api_key），设置后请求带 Bearer 鉴权 */
  apiKey?: string;
  /** 多并发场景的并发请求数：应为服务器实际 np 值；≤1 时主进程跳过多并发测试 */
  concurrency?: number;
}

/**
 * 性能测试结果（来自 completion 响应 timings + /metrics）。
 * 单并发场景为单次请求的准确值；多并发场景为聚合值（concurrency > 1）。
 */
export interface BenchResult {
  // completion timings（单并发：本次请求；多并发：所有成功请求之和）
  promptN: number;
  promptPerSecond: number;
  predictedN: number;
  predictedPerSecond: number;
  draftN: number;
  draftNAccepted: number;
  // /metrics 补充（进程终身累计的推测解码接受率，对所有推测解码类型适用）
  metricsDraftAccepted: number;
  metricsDraftTotal: number;
  metricsPredictedPerSecond: number;
  // 测试元信息
  elapsedMs: number;
  sampledAt: number;
  /** 场景标识：1 = 单并发；N = 多并发聚合（N 个并发请求的求和指标） */
  concurrency: number;
  /** 多并发场景中失败的请求数（单并发恒为 0） */
  failed?: number;
}

/**
 * 一次「运行测试」的完整结果：单并发场景 +（可选）多并发场景。
 * 多并发结果仅在服务器 np ≥ 2（有并行槽位）时存在；否则为 null。
 */
export interface BenchRunResult {
  single: BenchResult;
  /** np ≥ 2 时为多并发聚合结果；np ≤ 1 时为 null（无并行槽位可测） */
  concurrent: BenchResult | null;
}

/**
 * /metrics 端点解析结果（进程终身累计值）。
 */
export interface BenchMetrics {
  promptPerSecond: number;
  predictedPerSecond: number;
  draftAccepted: number;
  draftTotal: number;
  nDecode: number;
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
