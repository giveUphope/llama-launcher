/**
 * GGUF 元数据值类型枚举（与 llama.cpp gguf_metadata_value_type 对应）。
 */
export enum GgufValueType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

/**
 * GGUF 元数据值的联合类型。
 * null 表示数组类型被跳过（不加载到内存）。
 */
export type GgufValue = number | bigint | boolean | string | GgufValue[] | null;

/**
 * 原始元数据键值对映射（key → value）。
 */
export type GgufMetadataMap = Record<string, GgufValue>;

/**
 * 从 GGUF 文件中提取的结构化模型信息。
 */
export interface GgufModelInfo {
  /** 文件路径 */
  path: string;
  /** GGUF 版本 */
  version: number;
  /** 张量数量 */
  tensor_count: number;
  /** 元数据键值对数量 */
  metadata_kv_count: number;
  /** 原始元数据映射 */
  metadata: GgufMetadataMap;
  /** 通用架构名称（如 llama / qwen2 / gemma 等），来自 general.architecture */
  architecture: string;
  /** 模型名称，来自 general.name */
  name: string;
  /** 量化类型描述（如 Q4_K_M / F16 等），来自 general.file_type */
  quantization: string;
  /** 原始 file_type 值 */
  file_type: number | null;
  /** 量化版本，来自 general.quantization_version */
  quantization_version: number | null;
  /** 模型类型标签（model / vocab 等），来自 general.type */
  type: string | null;
  /** 微调标识，来自 general.finetune */
  finetune: string | null;
  /** 模型基础名称，来自 general.basename */
  basename: string | null;
  /** 模型大小标签，来自 general.size_label */
  size_label: string | null;
  /** 最大上下文长度，来自 <arch>.context_length */
  context_length: number | null;
  /** 嵌入维度，来自 <arch>.embedding_length */
  embedding_length: number | null;
  /** 前馈网络维度，来自 <arch>.feed_forward_length */
  feed_forward_length: number | null;
  /** 层数（block count），来自 <arch>.block_count */
  block_count: number | null;
  /** 注意力头数，来自 <arch>.attention.head_count */
  attention_head_count: number | null;
  /** KV 注意力头数，来自 <arch>.attention.head_count_kv */
  attention_head_count_kv: number | null;
  /** 注意力 key 长度，来自 <arch>.attention.key_length */
  attention_key_length: number | null;
  /** 注意力 value 长度，来自 <arch>.attention.value_length */
  attention_value_length: number | null;
  /** 注意力 RMS epsilon，来自 <arch>.attention.layer_norm_rms_epsilon */
  attention_layer_norm_rms_epsilon: number | null;
  /** 专家数量（MoE 模型），来自 <arch>.expert_count */
  expert_count: number | null;
  /** 每次激活的专家数（MoE 模型），来自 <arch>.expert_used_count */
  expert_used_count: number | null;
  /** MTP 预测层数（推测解码），来自 <arch>.nextn_predict_layers */
  nextn_predict_layers: number | null;
  /** 全注意力间隔（混合 SSM 模型），来自 <arch>.full_attention_interval */
  full_attention_interval: number | null;
  /** SSM 卷积核大小（混合模型），来自 <arch>.ssm.conv_kernel */
  ssm_conv_kernel: number | null;
  /** SSM 状态大小（混合模型），来自 <arch>.ssm.state_size */
  ssm_state_size: number | null;
  /** SSM 分组数（混合模型），来自 <arch>.ssm.group_count */
  ssm_group_count: number | null;
  /** 分词器模型名称，来自 tokenizer.ggml.model */
  tokenizer_model: string | null;
  /** 分词器预处理标识，来自 tokenizer.ggml.pre */
  tokenizer_pre: string | null;
  /** 聊天模板（Jinja），来自 tokenizer.chat_template */
  chat_template: string | null;
  /** BOS token id，来自 tokenizer.ggml.bos_token_id */
  bos_token_id: number | null;
  /** EOS token id，来自 tokenizer.ggml.eos_token_id */
  eos_token_id: number | null;
  /** Padding token id，来自 tokenizer.ggml.padding_token_id */
  padding_token_id: number | null;
  /** 模型默认采样温度，来自 general.sampling.temp */
  sampling_temp: number | null;
  /** 模型默认 top_k，来自 general.sampling.top_k */
  sampling_top_k: number | null;
  /** 模型默认 top_p，来自 general.sampling.top_p */
  sampling_top_p: number | null;
  /** 模型默认 min_p，来自 general.sampling.min_p */
  sampling_min_p: number | null;
  /** 模型默认重复惩罚，来自 general.sampling.repetition_penalty */
  sampling_repeat_penalty: number | null;
  /** 模型默认存在惩罚，来自 general.sampling.presence_penalty */
  sampling_presence_penalty: number | null;
  /** imatrix 校准数据集路径，来自 quantize.imatrix.dataset */
  imatrix_dataset: string | null;
  /** imatrix 条目数，来自 quantize.imatrix.entries_count */
  imatrix_entries_count: number | null;
  /** imatrix 块数，来自 quantize.imatrix.chunks_count */
  imatrix_chunks_count: number | null;
  /** 模型组织/作者，来自 general.organization */
  organization: string | null;
  /** 模型许可证，来自 general.license */
  license: string | null;
  /** 模型许可证名称，来自 general.license_name */
  license_name: string | null;
  /** 训练数据集，来自 general.dataset */
  dataset: string | null;
  /** 模型描述，来自 general.description */
  description: string | null;
  /** 模型主页 URL，来自 general.url */
  url: string | null;
  /** 是否在输入开头添加 BOS token，来自 tokenizer.ggml.add_bos_token */
  add_bos_token: boolean | null;
  /** 是否在输入末尾添加 EOS token，来自 tokenizer.ggml.add_eos_token */
  add_eos_token: boolean | null;
  /** MoE 专家前馈维度，来自 <arch>.expert_feed_forward_length */
  expert_feed_forward_length: number | null;
  /** 模型默认 repeat-last-n，来自 general.sampling.penalty_last_n */
  sampling_penalty_last_n: number | null;
  /** 模型默认 typical-p，来自 general.sampling.typical_p */
  sampling_typical_p: number | null;
  /** 模型默认 mirostat 模式，来自 general.sampling.mirostat */
  sampling_mirostat: number | null;
  /** 模型默认 mirostat 学习率(eta)，来自 general.sampling.mirostat_eta */
  sampling_mirostat_eta: number | null;
  /** 模型默认 mirostat 目标熵(tau)，来自 general.sampling.mirostat_tau */
  sampling_mirostat_tau: number | null;
}

/**
 * 从 GGUF 元数据推导出的建议参数。
 * 每项包含参数 key、建议值、来源元数据 key 和说明。
 */
export interface GgufSuggestedParam {
  /** 参数 key（对应 PARAMS 中的 key） */
  key: string;
  /** 建议值 */
  value: string | number | boolean;
  /** 来源元数据 key */
  source: string;
  /** 说明 */
  description: string;
}

/**
 * GGUF 元数据读取结果，包含模型信息和建议参数。
 */
export interface GgufReadResult {
  info: GgufModelInfo;
  suggestions: GgufSuggestedParam[];
}
