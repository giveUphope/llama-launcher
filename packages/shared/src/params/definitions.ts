import type { ParamDef, ParamGroup } from '../types/index.js';

export const MODEL_KEY = 'model';
export const APP_NAME = 'llama Launcher';
export const APP_VERSION = '0.0.23';

/**
 * 基线推荐值（实测依据，2026-08-15，docs/archive/experiments/plan-kv-split-cli-test.md）——
 * 以下默认值即命令行发射基线（值 ≠ 默认值才发射，见 core 的 buildCommand）：
 * - cache_type_k/v：KV 量化 q8_0。f16 在长上下文下使 27B@262K 显存需求达 ~35GB，是 OOM 根因之一
 * - load_mode：none。--mmap/--mlock 已废弃；mmap 权重页常驻系统内存会吃满 32GB 冻结系统
 * - fit：off。显式 ctx/ngl 时 fit on 会中止并留下劣化状态（实测 262K 下 25.7 vs 36.6 tok/s）
 * - kv_unified：off。--kv-unified 在槽位数 auto 时默认启用单一大缓存跨序列共享，实测推荐关闭
 *   （下发 --no-kv-unified 规避整块共享缓冲的内存占用；需要时可在参数页手动开启）
 * （历史注：旧版 `_enabled` 启用机制与 BASELINE_ENABLED_KEYS 常量已随双轨参数逻辑移除。）
 */

export const PARAM_GROUPS: ParamGroup[] = [
  { key: 'basic', labelKey: 'param_basic' },
  { key: 'advanced', labelKey: 'param_advanced' },
  { key: 'server', labelKey: 'param_server' },
];

export const PARAMS: ParamDef[] = [
  // ---------------- basic (15) ----------------
  // 子分组 network：网络配置
  { key: 'host', group: 'basic', type: 'text', flag: '--host', default: '127.0.0.1', subcategory: 'network' },
  { key: 'port', group: 'basic', type: 'int_entry', flag: '--port', default: 8080, min: 1, max: 65535, subcategory: 'network' },
  // 子分组 context：上下文与批处理
  { key: 'ctx_size', group: 'basic', type: 'int_slider', flag: '-c', default: 0, min: 0, max: 262144, step: 2048, subcategory: 'context', ggufField: 'context_length' },
  { key: 'batch_size', group: 'basic', type: 'int_slider', flag: '-b', default: 2048, min: 128, max: 16384, step: 256, subcategory: 'context' },
  { key: 'ubatch_size', group: 'basic', type: 'int_slider', flag: '-ub', default: 512, min: 64, max: 8192, step: 128, subcategory: 'context' },
  { key: 'parallel', group: 'basic', type: 'int_slider', flag: '-np', default: -1, min: -1, max: 64, step: 1, subcategory: 'context' },
  // 子分组 compute：计算与加速
  { key: 'threads', group: 'basic', type: 'int_slider', flag: '-t', default: -1, min: -1, max: 256, step: 1, subcategory: 'compute' },
  {
    key: 'flash_attn', group: 'basic', type: 'dropdown', flag: '-fa', default: 'auto',
    options: ['auto', 'on', 'off'], subcategory: 'compute',
  },
  { key: 'cont_batching', group: 'basic', type: 'checkbox', flag: '-cb', default: true, invert_flag: '-nocb', subcategory: 'compute' },
  // 子分组 memory：内存与加载（常用 GPU/内存配置，归入基础参数）
  // --mmap/--mlock 已废弃（后端提示 DEPRECATED），迁移为 --load-mode 下拉
  {
    key: 'load_mode', group: 'basic', type: 'dropdown', flag: '--load-mode',
    // 选项与 llama-server b10429 一致（auto 为 b10429 新增：默认 mmap，设备不支持时回退）；
    // 默认仍为 none（实测推荐：防权重页常驻内存，见文件头基线推荐值注释）
    default: 'none', options: ['auto', 'none', 'mmap', 'mlock', 'mmap+mlock', 'dio'], subcategory: 'memory',
  },
  // 显式 ctx/ngl 时 fit on 会中止并留劣化状态，故默认 off（见文件头基线推荐值注释）
  {
    key: 'fit', group: 'basic', type: 'dropdown', flag: '--fit',
    default: 'off', options: ['on', 'off'], subcategory: 'memory',
  },
  // 惰性张量读取（b10734 引入）：auto=仅 >4GiB 张量惰性读取（需 mmap）/ off=全量常驻 / on=按需读行
  {
    key: 'lazy_mode', group: 'basic', type: 'dropdown', flag: '--lazy-mode',
    default: 'auto', options: ['auto', 'off', 'on'], subcategory: 'memory',
  },
  { key: 'gpu_layers', group: 'basic', type: 'text', flag: '-ngl', default: 'auto', subcategory: 'memory' },
  { key: 'n_cpu_moe', group: 'basic', type: 'int_entry', flag: '-ncmoe', default: 0, min: 0, max: 256, subcategory: 'memory' },
  { key: 'n_cpu_ffn', group: 'basic', type: 'int_entry', flag: '-ncffn', default: 0, min: 0, max: 512, subcategory: 'memory' },

  // ---------------- advanced (28) ----------------
  // 子分组 kv_cache：KV 缓存
  // KV cache 类型：与模型权重量化（quantization）无关，不挂 ggufField——
  // 权重量化 → q8_0 的推荐走 buildSuggestions 启发式建议（带来源说明），行内不显示误导性灰字
  {
    key: 'cache_type_k', group: 'advanced', type: 'dropdown', flag: '-ctk', default: 'q8_0',
    options: ['f16', 'f32', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'], subcategory: 'kv_cache',
  },
  {
    key: 'cache_type_v', group: 'advanced', type: 'dropdown', flag: '-ctv', default: 'q8_0',
    options: ['f16', 'f32', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'], subcategory: 'kv_cache',
  },
  { key: 'kv_offload', group: 'advanced', type: 'checkbox', flag: '-kvo', default: true, invert_flag: '-nkvo', subcategory: 'kv_cache' },
  // 统一 KV 缓存（b10502 引入）：单一大缓存跨序列共享，槽位数 auto 时默认启用；基线默认关闭（见文件头基线推荐值注释）
  {
    key: 'kv_unified', group: 'advanced', type: 'checkbox', flag: '--kv-unified', default: false,
    invert_flag: '--no-kv-unified', subcategory: 'kv_cache',
  },
  // 每槽位统一 KV 上下文上限（b10734 引入）；不与 -c 同用时共享 KV 池按此设置；0 = 不设置（保持原行为）
  {
    key: 'kv_unified_per_slot', group: 'advanced', type: 'int_entry', flag: '--kv-unified-per-slot',
    default: 0, min: 0, max: 4194304, subcategory: 'kv_cache',
  },
  // SWA 全量缓存（llama.cpp PR 13194）：滑动窗口注意力层保留全量 KV 而非仅窗口内——质量换显存。
  // 混合注意力模型（线性注意力 + 周期全注意力，如 qwen3-next 系）缓存策略由元数据自动决定，通常无需开启；
  // 纯 SWA 模型（Gemma/Llama-4 系）长上下文质量下降时的排查手段。模型内置信息卡的「全注意力间隔」即此场景标识。
  {
    key: 'swa_full', group: 'advanced', type: 'checkbox', flag: '--swa-full', default: false,
    subcategory: 'kv_cache',
  },
  // 子分组 multimodal：多模态
  {
    key: 'mmproj', group: 'advanced', type: 'file', flag: '-mm', default: '', subcategory: 'multimodal',
    filetypes: [
      { name: 'GGUF / Projector', extensions: ['*.gguf', '*.bin'] },
      { name: 'All Files', extensions: ['*.*'] },
    ],
  },
  // 投影器设备（b10734 引入）：none = 不卸载，默认 auto；设备名动态（见 llama-server --list-devices）
  { key: 'mmproj_device', group: 'advanced', type: 'text', flag: '-mmdev', default: '', subcategory: 'multimodal' },
  // 投影器 GPU 卸载（默认启用）：取消勾选下发 --no-mmproj-offload，投影器留在 CPU（省显存 / 规避部分后端投影器卸载问题）
  { key: 'mmproj_offload', group: 'advanced', type: 'checkbox', flag: '--mmproj-offload', invert_flag: '--no-mmproj-offload', default: true, subcategory: 'multimodal' },
  // 视频多模态（b10734 引入）
  {
    key: 'video_fps', group: 'advanced', type: 'float_slider', flag: '--video-fps',
    default: 4.0, min: 0.1, max: 120, step: 0.5, subcategory: 'multimodal',
  },
  {
    key: 'video_timestamp_interval', group: 'advanced', type: 'int_entry', flag: '--video-timestamp-interval',
    default: 5000, min: 0, max: 600000, subcategory: 'multimodal',
  },
  { key: 'video_ffmpeg_dir', group: 'advanced', type: 'text', flag: '--video-ffmpeg-dir', default: '', subcategory: 'multimodal' },
  // 子分组 template：对话模板
  // --jinja 必须位于 --chat-template 之前发射（llama.cpp 约定：除非先前已用 --jinja，
  // 否则 --chat-template 只接受内置模板名）；定义顺序即命令行发射顺序（见 core buildCommand）。
  // 对话模板启用开关：与 chat_template 内容（tokenizer.chat_template）是两个维度，
  // 不挂 ggufField——模板存在性提示挂在 chat_template 参数行（其取值才与之相关）
  { key: 'jinja', group: 'advanced', type: 'checkbox', flag: '--jinja', default: true, invert_flag: '--no-jinja', subcategory: 'template' },
  {
    key: 'chat_template', group: 'advanced', type: 'dropdown', flag: '--chat-template', default: 'none', editable: true,
    subcategory: 'template', ggufField: 'chat_template',
    // 内置选项全部为 llama-server b10734 内置模板名（--chat-template help 列表子集）；
    // 默认 'none'（值=默认不发射 → 后端用模型元数据模板）；editable 允许输入任意 jinja 模板文本/名
    // （--jinja 在前置保证下后端接受自定义模板）
    options: [
      'none',
      '', 'chatml', 'llama2', 'llama2-sys', 'llama3',
      'mistral-v1', 'mistral-v3', 'deepseek', 'deepseek2', 'deepseek3',
      'gemma', 'phi3', 'phi4', 'chatglm3', 'chatglm4',
      'vicuna', 'zephyr', 'command-r', 'falcon3', 'granite',
      'gpt-oss', 'grok-2', 'hunyuan-moe', 'kimi-k2',
    ],
  },
  // 子分组 speculative：推测解码
  {
    key: 'spec_type', group: 'advanced', type: 'dropdown', flag: '--spec-type', default: '',
    options: [
      '', 'none', 'draft-simple', 'draft-eagle3', 'draft-mtp', 'draft-dflash', 'draft-dspark',
      'ngram-simple', 'ngram-map-k', 'ngram-map-k4v', 'ngram-mod', 'ngram-cache',
    ], subcategory: 'speculative', ggufField: 'nextn_predict_layers',
  },
  {
    key: 'spec_draft_model', group: 'advanced', type: 'file', flag: '--spec-draft-model', default: '',
    subcategory: 'speculative',
    // 仅外部草稿模型类型需要 -md（draft-mtp 用主模型 MTP 头、ngram-* 基于 n-gram，均不需要）
    dependsOn: { key: 'spec_type', values: ['draft-simple', 'draft-eagle3', 'draft-dflash', 'draft-dspark'] },
    filetypes: [
      { name: 'GGUF Draft Model', extensions: ['*.gguf'] },
      { name: 'All Files', extensions: ['*.*'] },
    ],
  },
  {
    key: 'spec_draft_ngl', group: 'advanced', type: 'text', flag: '-ngld', default: 'auto',
    subcategory: 'speculative',
    dependsOn: { key: 'spec_type', values: ['draft-simple', 'draft-eagle3', 'draft-dflash', 'draft-dspark'] },
  },
  {
    key: 'spec_draft_n_max', group: 'advanced', type: 'int_entry', flag: '--spec-draft-n-max', default: 3, min: 1, max: 64,
    subcategory: 'speculative',
    dependsOn: { key: 'spec_type', notValues: ['', 'none'] },
  },
  {
    key: 'spec_draft_n_min', group: 'advanced', type: 'int_entry', flag: '--spec-draft-n-min', default: 0, min: 0, max: 64,
    subcategory: 'speculative',
    dependsOn: { key: 'spec_type', notValues: ['', 'none'] },
  },
  {
    key: 'spec_cache_type_k', group: 'advanced', type: 'dropdown', flag: '-ctkd', default: 'f16',
    options: ['f16', 'f32', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'], subcategory: 'speculative',
    dependsOn: { key: 'spec_type', values: ['draft-simple', 'draft-eagle3', 'draft-dflash', 'draft-dspark'] },
  },
  {
    key: 'spec_cache_type_v', group: 'advanced', type: 'dropdown', flag: '-ctvd', default: 'f16',
    options: ['f16', 'f32', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'], subcategory: 'speculative',
    dependsOn: { key: 'spec_type', values: ['draft-simple', 'draft-eagle3', 'draft-dflash', 'draft-dspark'] },
  },
  // 投机合成基准（b10734 引入，benchmarking only）
  {
    key: 'spec_synth_len', group: 'advanced', type: 'int_entry', flag: '--spec-synth-len',
    default: 0, min: 0, max: 2048, subcategory: 'speculative',
  },
  { key: 'spec_synth_rates', group: 'advanced', type: 'text', flag: '--spec-synth-rates', default: '', subcategory: 'speculative' },
  // 子分组 thinking：思考/推理控制（Qwen3、DeepSeek-R1 等思考模型）
  {
    key: 'reasoning', group: 'advanced', type: 'dropdown', flag: '--reasoning',
    default: '', options: ['', 'auto', 'on', 'off'], subcategory: 'thinking',
  },
  {
    key: 'reasoning_effort', group: 'advanced', type: 'dropdown', flag: '--reasoning-effort',
    default: '', options: ['', 'default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], subcategory: 'thinking',
    dependsOn: { key: 'reasoning', notValues: ['off'] },
  },
  {
    key: 'reasoning_budget', group: 'advanced', type: 'int_entry', flag: '--reasoning-budget',
    default: -1, min: -1, max: 32768, step: 1, subcategory: 'thinking',
    dependsOn: { key: 'reasoning', notValues: ['off'] },
  },
  {
    key: 'reasoning_format', group: 'advanced', type: 'dropdown', flag: '--reasoning-format',
    default: '', options: ['', 'none', 'deepseek', 'deepseek-legacy'], subcategory: 'thinking',
    dependsOn: { key: 'reasoning', notValues: ['off'] },
  },
  {
    key: 'reasoning_budget_message', group: 'advanced', type: 'text', flag: '--reasoning-budget-message',
    default: '', subcategory: 'thinking',
    dependsOn: { key: 'reasoning', notValues: ['off'] },
  },

  // ---------------- basic: sampling (7) ----------------
  // 子分组 sampling：采样参数（用户常用调整，归入基础参数）
  {
    key: 'temperature', group: 'basic', type: 'float_slider', flag: '--temp',
    default: 0.8, min: 0.0, max: 2.0, step: 0.05, subcategory: 'sampling', ggufField: 'sampling_temp',
  },
  { key: 'top_k', group: 'basic', type: 'int_slider', flag: '--top-k', default: 40, min: 0, max: 200, step: 1, subcategory: 'sampling', ggufField: 'sampling_top_k' },
  {
    key: 'top_p', group: 'basic', type: 'float_slider', flag: '--top-p',
    default: 0.95, min: 0.0, max: 1.0, step: 0.01, subcategory: 'sampling', ggufField: 'sampling_top_p',
  },
  {
    key: 'min_p', group: 'basic', type: 'float_slider', flag: '--min-p',
    default: 0.05, min: 0.0, max: 1.0, step: 0.01, subcategory: 'sampling', ggufField: 'sampling_min_p',
  },
  {
    key: 'repeat_penalty', group: 'basic', type: 'float_slider', flag: '--repeat-penalty',
    default: 1.0, min: 0.5, max: 2.5, step: 0.01, subcategory: 'sampling', ggufField: 'sampling_repeat_penalty',
  },
  {
    key: 'presence_penalty', group: 'basic', type: 'float_slider', flag: '--presence-penalty',
    default: 0.0, min: -2.0, max: 2.0, step: 0.05, subcategory: 'sampling', ggufField: 'sampling_presence_penalty',
  },
  { key: 'seed', group: 'basic', type: 'int_entry', flag: '-s', default: -1, min: -1, max: 2147483647, subcategory: 'sampling' },

  // ---------------- server (10) ----------------
  // 子分组 identity：服务标识
  // 别名：由 buildSuggestions 组合生成（name-size_label-量化，启发式）；general.name 单字段
  // 与建议双源展示易混淆，不挂 ggufField
  { key: 'alias', group: 'server', type: 'text', flag: '-a', default: '', subcategory: 'identity' },
  { key: 'api_key', group: 'server', type: 'text', flag: '--api-key', default: '', subcategory: 'identity' },
  // 子分组 endpoints：端点配置
  { key: 'ui', group: 'server', type: 'checkbox', flag: '--ui', default: true, invert_flag: '--no-ui', subcategory: 'endpoints' },
  { key: 'slots_endpoint', group: 'server', type: 'checkbox', flag: '--slots', default: true, invert_flag: '--no-slots', subcategory: 'endpoints' },
  { key: 'metrics', group: 'server', type: 'checkbox', flag: '--metrics', default: false, subcategory: 'endpoints' },
  { key: 'props_endpoint', group: 'server', type: 'checkbox', flag: '--props', default: false, subcategory: 'endpoints' },
  // 子分组 behavior：运行行为
  { key: 'timeout', group: 'server', type: 'int_entry', flag: '-to', default: 3600, min: 1, max: 86400, subcategory: 'behavior' },
  {
    key: 'cache_prompt', group: 'server', type: 'checkbox', flag: '--cache-prompt',
    default: true, invert_flag: '--no-cache-prompt', subcategory: 'behavior',
  },
  {
    key: 'cache_reuse', group: 'server', type: 'int_slider', flag: '--cache-reuse', default: 0, min: 0, max: 262144, step: 32,
    subcategory: 'behavior',
    dependsOn: { key: 'cache_prompt', values: ['true'] },
  },
  {
    key: 'context_shift', group: 'server', type: 'checkbox', flag: '--context-shift',
    default: false, invert_flag: '--no-context-shift', subcategory: 'behavior',
  },
];
