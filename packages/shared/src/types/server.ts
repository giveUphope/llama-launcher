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
 * 一次「运行测试」执行两个场景：单并发（1 个请求）与多并发（concurrency 个并行请求）。
 */
export interface BenchRequest {
  prompt: string;
  maxTokens: number;
  /** 服务器 API key（参数表中的 api_key），设置后请求带 Bearer 鉴权 */
  apiKey?: string;
  /** 多并发场景的并发请求数（≥2）；缺省由主进程决定（4） */
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
 * 一次「运行测试」的完整结果：单并发场景 + 多并发场景。
 */
export interface BenchRunResult {
  single: BenchResult;
  concurrent: BenchResult;
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
