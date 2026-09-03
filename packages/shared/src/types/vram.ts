/**
 * 显存探测与上下文容量估算类型。
 *
 * 数据来源：
 * - 设备列表：`llama-server --list-devices`（随引擎分发，输出含每设备总/空闲 MiB）
 * - 估算模型：GGUF 元数据（KV 层数/头数/维度）+ 权重体积（≈文件大小）+ KV dtype 字节
 */

/** 计算设备显存信息（来自 --list-devices 输出解析） */
export interface DeviceMemInfo {
  /** 设备标识（如 Vulkan0 / CUDA0） */
  id: string;
  /** 设备名称 */
  name: string;
  /** 总显存 MiB */
  totalMiB: number;
  /** 空闲显存 MiB */
  freeMiB: number;
}

/** 性能目标（目标选择器四档，驱动关键杠杆联动建议） */
export type PerfTarget = 'max-context' | 'balanced' | 'latency' | 'memory';

/** 目标联动参数建议（一条 = 一个参数的目标取值；理由随条目给出，与当前会话值的差集由渲染端过滤） */
export interface TargetRecommendation {
  /** 参数 key（对应 PARAMS 中的 key） */
  key: string;
  /** 建议值 */
  value: string | number | boolean;
  /** 推导理由（展示用） */
  reason: string;
}

/** 单侧硬件资源占用估算（显存侧 = 最大空闲设备；内存侧 = 系统 RAM） */
export interface OccupancySide {
  /** 权重占用（显存侧 = 已卸载层；内存侧 = 未卸载层） */
  weightsMiB: number | null;
  /** KV 缓存占用（按会话上下文与 dtype；混合架构仅全注意力层持有 KV，CPU/GPU 按卸载比例分摊） */
  kvMiB: number | null;
  /** 固定预留（显存侧 = 计算缓冲 + 余量；内存侧 = 进程开销）；不可估算为 null */
  reserveMiB: number | null;
  /** 估算总占用 */
  totalMiB: number | null;
  /** 容量上限（显存侧 = 设备总显存；内存侧 = 系统总内存）；未知为 null */
  capacityMiB: number | null;
  /** 可用容量（显存侧 = 设备空闲；内存侧 = 系统可用）；未知为 null */
  availableMiB: number | null;
  /** 总占用是否在可用容量内；未知为 null */
  fits: boolean | null;
}

/** 硬件资源占用估算结果（显存 + 内存双侧，由会话参数驱动：卸载层数/上下文/KV 档位） */
export interface HardwareOccupancy {
  /** 显存侧（最大空闲计算设备） */
  vram: OccupancySide;
  /** 内存侧（系统 RAM） */
  ram: OccupancySide;
  /** 估算所用的上下文 token 数（会话 -c>0 取会话值；否则取训练上限） */
  contextTokens: number | null;
  /** 已卸载到 GPU 的层数（估算值） */
  offloadLayers: number | null;
  /** 总层数 */
  totalLayers: number | null;
  /** 当前 dtype 下、全卸载时的上下文上限（token，按训练上限钳制）；供对比参考 */
  maxContext: number | null;
}

/** 显存/上下文估算结果（尽力而为：任一环节不可估算时对应字段为 null） */
export interface VramEstimateResult {
  /** 探测到的计算设备（按空闲显存降序）；未探测到为空数组 */
  devices: DeviceMemInfo[];
  /** 权重体积估算（≈GGUF 文件大小 MiB）；文件不可读为 null */
  weightsMiB: number | null;
  /** 有 KV 缓存的层数（混合架构按 full_attention_interval 折算）；无法估算为 null */
  kvLayers: number | null;
  /** KV 缓存每 token 字节数（按 dtype）；无法估算为 null */
  kvBytesPerToken: number | null;
  /** 权重全卸载 + 计算余量扣减后，最大空闲设备可支撑的上下文上限（token，按训练上限钳制、1024 粒度）；无法估算为 null */
  maxContext: number | null;
  /** 权重是否可完整放入最大空闲设备（含计算余量）；无法估算为 null */
  fullOffloadFits: boolean | null;
  /** 估算参考的 KV dtype（如 q8_0） */
  dtype: string;
  /** 估算使用的性能目标 */
  target: PerfTarget;
  /** 目标联动参数建议（仅含可推导项；与当前会话值的差集由渲染端过滤） */
  recommendations: TargetRecommendation[];
  /** 硬件资源占用估算（显存 + 内存双侧，由会话参数驱动）；无设备/模型不可读为 null */
  occupancy: HardwareOccupancy | null;
}

/** 渲染端传入的会话占用估算配置（与参数页当前值一致，保证前后端链路同源） */
export interface OccupancyConfig {
  /** gpu_layers 会话值：'auto' / 'all' / 数字字符串 / 空串 */
  ngl: string;
  /** ctx_size 会话值（0 = 从模型加载） */
  ctxSize: number;
  /** cache_type_k 会话值（KV dtype） */
  kvDtype: string;
}

/** 模型文件显存适配判定（模型列表徽章用） */
export type ModelFitVerdict = 'fit' | 'partial' | 'no';

export interface ModelFitResult {
  /** fit = 全卸载可容纳；partial = 需部分卸载；no = 权重远超总显存；无法估算为 null */
  verdict: ModelFitVerdict | null;
  /** 全卸载上下文上限（token，估算）；无法估算为 null */
  maxContext: number | null;
  /** 权重体积 MiB */
  weightsMiB: number | null;
  /** 估算参考的 KV dtype */
  dtype: string;
}
