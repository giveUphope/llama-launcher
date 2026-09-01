export interface ParamI18nEntry {
  zh: string;
  en: string;
}

export const PARAM_LABELS: Record<string, ParamI18nEntry> = {
  // ---------------- basic ----------------
  host: { zh: '监听地址', en: 'Listen Address' },
  port: { zh: '端口', en: 'Port' },
  ctx_size: { zh: '上下文长度', en: 'Context Size' },
  threads: { zh: 'CPU 线程数', en: 'CPU Threads' },
  batch_size: { zh: '批大小', en: 'Batch Size' },
  ubatch_size: { zh: '微批次大小', en: 'Micro Batch' },
  parallel: { zh: '并行槽位', en: 'Parallel Slots' },
  flash_attn: { zh: 'Flash Attention', en: 'Flash Attention' },
  cont_batching: { zh: '连续批处理', en: 'Continuous Batching' },

  // ---------------- advanced ----------------
  cache_type_k: { zh: 'KV 缓存类型 K', en: 'KV Cache Type K' },
  cache_type_v: { zh: 'KV 缓存类型 V', en: 'KV Cache Type V' },
  kv_offload: { zh: 'KV 卸载', en: 'KV Offload' },
  kv_unified: { zh: '统一 KV 缓存', en: 'Unified KV' },
  load_mode: { zh: '模型加载模式', en: 'Load Mode' },
  fit: { zh: '自动适配内存', en: 'Auto Fit Memory' },
  gpu_layers: { zh: 'GPU 层数', en: 'GPU Layers' },
  n_cpu_moe: { zh: 'CPU MoE 层数', en: 'CPU MoE Layers' },
  mmproj: { zh: '多模态投影器', en: 'Multimodal Projector' },
  chat_template: { zh: '聊天模板', en: 'Chat Template' },
  jinja: { zh: 'Jinja 模板引擎', en: 'Jinja Template Engine' },
  spec_type: { zh: '投机采样类型', en: 'Speculative Type' },
  spec_draft_model: { zh: '草稿模型路径', en: 'Draft Model Path' },
  spec_draft_ngl: { zh: '草稿模型 GPU 层数', en: 'Draft GPU Layers' },
  spec_draft_n_max: { zh: '最大草稿 Token 数', en: 'Max Draft Tokens' },
  spec_draft_n_min: { zh: '最小草稿 Token 数', en: 'Min Draft Tokens' },
  spec_cache_type_k: { zh: '草稿 KV 缓存类型 K', en: 'Draft KV Cache Type K' },
  spec_cache_type_v: { zh: '草稿 KV 缓存类型 V', en: 'Draft KV Cache Type V' },

  // ---------------- thinking ----------------
  reasoning: { zh: '思考模式', en: 'Reasoning Mode' },
  reasoning_effort: { zh: '推理力度', en: 'Reasoning Effort' },
  reasoning_budget: { zh: '思考 Token 预算', en: 'Reasoning Token Budget' },
  reasoning_format: { zh: '思考输出格式', en: 'Reasoning Format' },
  reasoning_budget_message: { zh: '预算耗尽提示语', en: 'Budget Exhausted Message' },

  // ---------------- sampling ----------------
  temperature: { zh: '温度', en: 'Temperature' },
  top_k: { zh: 'Top-K', en: 'Top-K' },
  top_p: { zh: 'Top-P', en: 'Top-P' },
  min_p: { zh: 'Min-P', en: 'Min-P' },
  repeat_penalty: { zh: '重复惩罚', en: 'Repeat Penalty' },
  presence_penalty: { zh: '存在惩罚', en: 'Presence Penalty' },
  seed: { zh: '随机种子', en: 'Random Seed' },
  repeat_last_n: { zh: '重复窗口', en: 'Repeat Window' },
  typical_p: { zh: 'Typical-P', en: 'Typical-P' },
  mirostat: { zh: 'Mirostat 模式', en: 'Mirostat Mode' },
  mirostat_lr: { zh: 'Mirostat 学习率', en: 'Mirostat LR' },
  mirostat_ent: { zh: 'Mirostat 目标熵', en: 'Mirostat Entropy' },

  // ---------------- server ----------------
  alias: { zh: '模型别名', en: 'Model Alias' },
  api_key: { zh: 'API Key', en: 'API Key' },
  ui: { zh: '启用 Web UI', en: 'Enable Web UI' },
  slots_endpoint: { zh: 'Slots 端点', en: 'Slots Endpoint' },
  metrics: { zh: 'Metrics 端点', en: 'Metrics Endpoint' },
  props_endpoint: { zh: 'Props 端点', en: 'Props Endpoint' },
  timeout: { zh: '超时(秒)', en: 'Timeout (s)' },
  cache_prompt: { zh: 'Prompt 缓存', en: 'Prompt Cache' },
  cache_reuse: { zh: '缓存重用大小', en: 'Cache Reuse Size' },
  context_shift: { zh: '上下文移位', en: 'Context Shift' },

  // ---------------- model (special) ----------------
  model: { zh: '模型文件', en: 'Model File' },

  // ---------------- b10734 新增 ----------------
  lazy_mode: { zh: '惰性张量读取', en: 'Lazy Tensor Read' },
  n_cpu_ffn: { zh: 'CPU FFN 层数', en: 'CPU FFN Layers' },
  kv_unified_per_slot: { zh: '每槽位统一 KV 上限', en: 'Unified KV Per Slot' },
  mmproj_device: { zh: '投影器设备', en: 'Projector Device' },
  video_fps: { zh: '视频帧率', en: 'Video FPS' },
  video_timestamp_interval: { zh: '视频时间戳间隔', en: 'Video Timestamp Interval' },
  video_ffmpeg_dir: { zh: 'FFmpeg 目录', en: 'FFmpeg Dir' },
  spec_synth_len: { zh: '合成接受长度（基准）', en: 'Synthetic Accept Len' },
  spec_synth_rates: { zh: '合成接受率（基准）', en: 'Synthetic Accept Rates' },
};

export const PARAM_HELP: Record<string, ParamI18nEntry> = {
  // ---------------- basic ----------------
  host: { zh: '服务器监听 IP；0.0.0.0 表示对外访问', en: 'Server listen IP; 0.0.0.0 for external' },
  port: { zh: '服务器监听端口', en: 'Server listen port' },
  ctx_size: { zh: '上下文窗口大小，0 = 从模型加载', en: 'Context window size, 0 = from model' },
  threads: { zh: '生成时使用的 CPU 线程数，-1 = 自动', en: 'CPU threads for generation, -1 = auto' },
  batch_size: { zh: '逻辑最大批次大小（prompt 处理）', en: 'Logical max batch size (prompt processing)' },
  ubatch_size: { zh: '物理最大批次大小', en: 'Physical max batch size' },
  parallel: { zh: '服务器槽位数，-1 = 自动', en: 'Server slots, -1 = auto' },
  flash_attn: { zh: 'Flash Attention 加速', en: 'Flash Attention acceleration' },
  cont_batching: { zh: '动态批处理（默认启用）', en: 'Dynamic batching (default on)' },

  // ---------------- advanced ----------------
  cache_type_k: { zh: 'K 缓存数据类型；量化可节省显存', en: 'K cache dtype; quantization saves VRAM' },
  cache_type_v: { zh: 'V 缓存数据类型', en: 'V cache dtype' },
  kv_offload: { zh: '启用 KV 缓存卸载到设备；取消勾选（-nkvo，KV 全放系统内存）在混合架构模型上实测慢 2.7x 且输出乱码，不建议', en: 'Offload KV cache to device; unchecking (-nkvo, KV in system RAM) measured 2.7x slower with garbled output on hybrid models — not recommended' },
  kv_unified: { zh: '使用单一统一 KV 缓冲跨所有序列共享（槽位数 auto 时后端默认开启）；默认关闭（--no-kv-unified），需要时勾选启用', en: 'Use a single unified KV buffer shared across all sequences (enabled by default when slots are auto); off by default (--no-kv-unified), check to enable' },
  load_mode: { zh: '模型加载模式：none = 直读缓冲（上传显存后释放，实测推荐，防权重页常驻吃满系统内存）；mmap = 内存映射（加载快但权重页常驻，32GB 内存机器配合超长上下文实测会冻结系统）；mlock = 锁定 RAM；mmap+mlock = 叠加；dio = DirectIO', en: 'Load mode: none = read into buffers then release (recommended; prevents weight pages filling system RAM); mmap = memory-map (faster load but pages stay resident — measured system freeze on 32GB RAM with long context); mlock = lock in RAM; mmap+mlock = both; dio = DirectIO' },
  fit: { zh: '自动适配显存，调整未显式设置的参数（引擎默认 on）；实测：显式设置 ctx/ngl 时 fit on 会中止并留下劣化状态（262K 下 25.7 vs 36.6 tok/s），故默认 off', en: 'Auto-fit device memory by adjusting unset args (engine default on); measured: with explicit ctx/ngl, fit on aborts and leaves a degraded state (25.7 vs 36.6 tok/s at 262K), hence default off' },
  gpu_layers: { zh: 'GPU 卸载层数；数字、auto 或 all', en: 'GPU offload layers; number, auto, or all' },
  n_cpu_moe: { zh: '前 N 层 MoE 权重保留在 CPU；0 = 禁用', en: 'Keep first N MoE layers in CPU; 0 = disabled' },
  mmproj: { zh: '多模态投影器文件路径', en: 'Multimodal projector file path' },
  chat_template: { zh: '聊天模板（覆盖模型默认）', en: 'Chat template (override model default)' },
  jinja: { zh: '使用 Jinja 模板引擎处理聊天模板', en: 'Use Jinja template engine for chat' },
  spec_type: { zh: '投机采样类型：none-关闭；draft-simple/eagle3/dflash/dspark-外部草稿模型（需配草稿模型路径/GPU 层数/草稿 KV 缓存）；draft-mtp-主模型 MTP 头（无需外部草稿模型）；ngram-* 基于 n-gram（无需外部草稿模型）', en: 'Speculative decoding type: none; draft-simple/eagle3/dflash/dspark = external draft model (needs draft path/GPU layers/draft KV cache); draft-mtp = main model MTP head (no external draft); ngram-* = n-gram based (no external draft)' },
  spec_draft_model: { zh: '外部草稿模型路径（仅 draft-simple/eagle3/dflash/dspark 需要）', en: 'External draft model path (only for draft-simple/eagle3/dflash/dspark)' },
  spec_draft_ngl: { zh: '草稿模型卸载到 GPU 的层数：数字、auto 或 all（DFlash 推荐 all；仅外部草稿模型类型）', en: 'Draft model layers to offload to GPU: number, auto, or all (DFlash recommends all; external draft types only)' },
  spec_draft_n_max: { zh: '每次投机生成的最大草稿 token 数（选择投机采样类型时自动应用该类型的推荐值，可再手动微调）', en: 'Max draft tokens per speculative step (auto-applied per selected speculative type; fine-tune manually)' },
  spec_draft_n_min: { zh: '最小草稿 token 数（0 = 贪婪；始终不超过最大草稿数）', en: 'Min draft tokens (0 = greedy; never exceeds max draft tokens)' },
  spec_cache_type_k: { zh: '草稿模型的 K 缓存数据类型；量化可节省显存（仅外部草稿模型类型）', en: 'K cache dtype for draft model; quantization saves VRAM (external draft types only)' },
  spec_cache_type_v: { zh: '草稿模型的 V 缓存数据类型（仅外部草稿模型类型）', en: 'V cache dtype for draft model (external draft types only)' },

  // ---------------- thinking ----------------
  reasoning: { zh: '控制是否启用思考/推理；auto 按模板自动探测，on 强制开启，off 关闭；空（不发送）使用默认 auto', en: 'Enable thinking/reasoning: auto (detect from template), on, or off; empty (not sent) uses default auto' },
  reasoning_effort: { zh: '给聊天模板的推理力度等级：default 保留模板默认，可选 minimal/low/medium/high/xhigh/max；空（不发送）使用后端默认 default', en: 'Reasoning effort level passed to the chat template: default keeps template default, or minimal/low/medium/high/xhigh/max; empty (not sent) uses backend default' },
  reasoning_budget: { zh: '思考 token 预算：-1 不限，0 立即结束，N>0 限制思考长度', en: 'Reasoning token budget: -1 unlimited, 0 end immediately, N>0 limit' },
  reasoning_format: { zh: '思考内容返回格式：none 原文、deepseek 放入 reasoning_content、deepseek-legacy 保留标签', en: 'How reasoning is returned: none, deepseek, or deepseek-legacy' },
  reasoning_budget_message: { zh: '思考预算耗尽时注入到结束思考标签前的提示语', en: 'Message injected before end-of-thinking tag when budget exhausted' },

  // ---------------- sampling ----------------
  temperature: { zh: '采样温度；越高越随机', en: 'Sampling temperature; higher = more random' },
  top_k: { zh: 'Top-K 采样；0 = 禁用', en: 'Top-K sampling; 0 = disabled' },
  top_p: { zh: '核采样；1.0 = 禁用', en: 'Nucleus sampling; 1.0 = disabled' },
  min_p: { zh: 'Min-P 采样；0.0 = 禁用', en: 'Min-P sampling; 0.0 = disabled' },
  repeat_penalty: { zh: '惩罚重复 token 序列', en: 'Penalize repeated token sequences' },
  presence_penalty: { zh: '存在惩罚 alpha', en: 'Presence penalty alpha' },
  seed: { zh: 'RNG 种子；-1 = 随机', en: 'RNG seed; -1 = random' },
  repeat_last_n: { zh: '重复惩罚考虑的最近 token 数；0 = 全部, -1 = 上下文长度', en: 'Last n tokens for repeat penalty; 0 = all, -1 = ctx' },
  typical_p: { zh: '局部典型采样 p；1.0 = 禁用', en: 'Locally typical sampling p; 1.0 = disabled' },
  mirostat: { zh: 'Mirostat 采样模式；0 = 禁用, 1 = v1.0, 2 = v2.0', en: 'Mirostat mode; 0 = off, 1 = v1.0, 2 = v2.0' },
  mirostat_lr: { zh: 'Mirostat 学习率 eta', en: 'Mirostat learning rate eta' },
  mirostat_ent: { zh: 'Mirostat 目标熵 tau', en: 'Mirostat target entropy tau' },

  // ---------------- server ----------------
  alias: { zh: 'API 返回的模型名', en: 'Model name returned by API' },
  api_key: { zh: 'API 鉴权密钥（多个用逗号分隔）', en: 'API auth key (comma-separated)' },
  ui: { zh: '启用内置 Web UI', en: 'Enable built-in Web UI' },
  slots_endpoint: { zh: '暴露槽位监控端点', en: 'Expose slots monitoring endpoint' },
  metrics: { zh: '启用 Prometheus 指标端点', en: 'Enable Prometheus metrics endpoint' },
  props_endpoint: { zh: '允许通过 POST /props 修改属性', en: 'Allow POST /props to modify properties' },
  timeout: { zh: '服务器读写超时', en: 'Server read/write timeout' },
  cache_prompt: { zh: '启用提示缓存', en: 'Enable prompt caching' },
  cache_reuse: { zh: '尝试从缓存重用的最小块大小', en: 'Min block size to reuse from cache' },
  context_shift: { zh: '无限生成时使用上下文移位', en: 'Use context shift for infinite generation' },

  // ---------------- model (special) ----------------
  model: { zh: 'GGUF 模型文件路径', en: 'GGUF model file path' },

  // ---------------- b10734 新增 ----------------
  lazy_mode: { zh: '按需从磁盘读取部分张量（如逐层嵌入）。auto = 仅对大于 4GiB 的张量惰性读取（需 mmap）；off = 始终常驻；on = 行的按需读取', en: 'On-demand reading of tensors (e.g. per-layer embeddings). auto = lazy only for tensors > 4 GiB (needs mmap); off = always resident; on = on-demand row reads' },
  n_cpu_ffn: { zh: '将前 N 层的稠密 FFN 权重保留在 CPU（稠密模型；MoE 专家权重请用 CPU MoE 层数）', en: 'Keep dense FFN weights of first N layers on CPU (dense models; use CPU MoE Layers for MoE experts)' },
  kv_unified_per_slot: { zh: '并行槽位上下文上限；不与上下文长度同用时共享 KV 池按此设置，0 = 不设置（保持原行为）', en: 'Context limit per parallel slot; when unset with ctx-size, shared KV pool is sized per this. 0 = unset' },
  mmproj_device: { zh: '多模态投影器所用设备；none = 不卸载，默认 auto（可用 llama-server --list-devices 查看设备名）', en: 'Device for multimodal projector; none = don\'t offload, default auto (see llama-server --list-devices)' },
  video_fps: { zh: '目标视频帧率', en: 'Target video frame rate' },
  video_timestamp_interval: { zh: '文本时间戳之间的毫秒间隔', en: 'Interval in ms between text timestamps' },
  video_ffmpeg_dir: { zh: '包含 ffmpeg 与 ffprobe 的目录；留空 = 在 PATH 中搜索', en: 'Dir containing ffmpeg and ffprobe; empty = search in PATH' },
  spec_synth_len: { zh: '目标平均合成接受长度（含目标 token，仅基准测试）', en: 'Target mean synthetic acceptance length incl. target token (benchmarking only)' },
  spec_synth_rates: { zh: '逗号分隔的无条件逐位置合成接受概率（仅基准测试）', en: 'Comma-separated per-position synthetic acceptance probabilities (benchmarking only)' },
};
