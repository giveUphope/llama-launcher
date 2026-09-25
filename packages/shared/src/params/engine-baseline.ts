import type { ParamDef } from '../types/index.js';

/**
 * 引擎缺省基线：`llama-server` **没收到该 flag 时**的行为。
 *
 * 为什么单独一张表（而不是复用 `ParamDef.default`）：
 * `default` 一值两用了两件事——① 界面初始值、② 「值 == 默认就不发射」的判定基准。
 * 但 ① 的本意常常是**启动器的基线推荐**（如 KV 量化 q8_0、`--load-mode none`、`--fit off`，
 * 见 definitions.ts 文件头 2026-08-15 实测记录），而 ② 要求它等于**引擎的真实缺省**。
 * 两者一混，推荐值刚好等于 `default` 的参数就永远不会写进命令行——引擎按自己的缺省跑，
 * 界面却显示着推荐值，用户以为那是后端/模型的默认行为（2026-09-25 修）。
 *
 * 发射规则因此改为：**值 ∈ `sentinel` ⇒ 不发射；值 == `engineDefault` ⇒ 不发射；否则发射。**
 * 一致性由 `scripts/verify-params-sync.cjs` 对拍 help 基线守住。
 *
 * 值来源：逐条读 `docs/params/llama-server-help-out.txt`（当前固定 b11178）；
 * 换引擎版本后须按 `docs/zh/params-system.md` §5.5 重新对拍。
 */
export interface EngineBaseline {
  /** 引擎未收到该 flag 时的缺省行为（help 里 `(default: X)`；help 未标注时按语义写并注明） */
  engineDefault: string | number | boolean;
  /**
   * 显式哨兵：这些 UI 值表示「不指定，交给引擎」，即使 ≠ `engineDefault` 也**不发射**。
   * 空字符串已被 `buildCommand` 统一视为不指定，这里只收非空的哨兵写法（如 `'none'`、`0`）。
   */
  sentinel?: Array<string | number | boolean>;
  /**
   * `default` 与 `engineDefault` 不同（= 启动器有意给出的基线推荐）时必填：为什么。
   * 这条由门禁强制，防止有人把「填错的默认值」当成「推荐值」混过去。
   */
  note?: string;
}

/** 键集必须与 PARAMS 双向完全相等（缺一个即 fail），沿用 PARAM_LABELS/PARAM_HELP 的既有做法。 */
export const PARAM_ENGINE_BASELINE: Record<string, EngineBaseline> = {
  // ---------------- 网络 / 上下文 ----------------
  host: { engineDefault: '127.0.0.1' },
  port: { engineDefault: 8080 },
  ctx_size: { engineDefault: 0 }, // help: 0 = loaded from model
  batch_size: { engineDefault: 2048 },
  ubatch_size: { engineDefault: 512 },
  parallel: { engineDefault: -1 }, // help: -1 = auto
  threads: { engineDefault: -1 },
  // ---------------- 计算与加速 ----------------
  flash_attn: { engineDefault: 'auto' }, // help: default: 'auto'
  cont_batching: { engineDefault: true },
  load_mode: {
    engineDefault: 'auto',
    note: '启动器基线推荐 none：mmap 权重页常驻系统内存会吃满 32GB 并冻结系统（2026-08-15 实测）',
  },
  fit: {
    engineDefault: 'on',
    note: '启动器基线推荐 off：显式给定 ctx/ngl 时 fit on 会中止并留下劣化状态（实测 262K 下 25.7 vs 36.6 tok/s）',
  },
  lazy_mode: { engineDefault: 'auto' },
  gpu_layers: { engineDefault: 'auto' },
  n_cpu_moe: { engineDefault: 0 }, // help 未标 default，0 = 不搬任何层
  n_cpu_ffn: { engineDefault: 0 },
  // ---------------- KV 缓存 ----------------
  cache_type_k: {
    engineDefault: 'f16',
    note: '启动器基线推荐 q8_0：f16 在长上下文下使 27B@262K 显存需求达 ~35GB，是 OOM 根因之一',
  },
  cache_type_v: {
    engineDefault: 'f16',
    note: '同 cache_type_k（K/V 必须一起降档，故推荐值一致）',
  },
  kv_offload: { engineDefault: true },
  kv_unified: {
    engineDefault: false,
    note: 'help 的条件默认（"enabled if number of slots is auto"）不可复现，启动器恒定下发 --no-kv-unified 规避整块共享缓冲',
  },
  kv_unified_per_slot: {
    engineDefault: 'unset',
    sentinel: [0],
    note: 'help 默认 unset；UI 用 0 表示「不设上限」，故 0 不发射',
  },
  swa_full: { engineDefault: false },
  // ---------------- 多模态 / 视频 ----------------
  mmproj: { engineDefault: '' }, // help 未标 default；空串 = 不指定
  mmproj_device: {
    engineDefault: '',
    note: 'help 默认 "follows --device"（条件式，不可复现为字面量）；UI 空串 = 不指定该 flag，--device 的行为由引擎决定',
  },
  mmproj_offload: { engineDefault: true },
  video_fps: { engineDefault: 4 }, // help: 4.0
  video_timestamp_interval: { engineDefault: 5000 },
  video_ffmpeg_dir: {
    engineDefault: '',
    note: 'help 默认 "search in PATH"（条件式）；UI 空串 = 不指定，交给引擎在 PATH 里找',
  },
  // ---------------- 对话模板 ----------------
  jinja: { engineDefault: true },
  chat_template: {
    engineDefault: 'model-metadata',
    sentinel: ['none'],
    note: 'help 默认为「取模型自带模板」，UI 的 none 就是该项，故 none 不发射',
  },
  // ---------------- 推测解码 ----------------
  spec_type: {
    engineDefault: 'none',
    note: 'UI 用空串表示「不指定」（已被空串规则统一跳过）',
  },
  spec_draft_model: {
    engineDefault: 'unused',
    note: 'UI 空串 = 不指定',
  },
  spec_draft_ngl: { engineDefault: 'auto' },
  spec_draft_n_max: { engineDefault: 3 },
  spec_draft_n_min: { engineDefault: 0 },
  spec_cache_type_k: { engineDefault: 'f16' },
  spec_cache_type_v: { engineDefault: 'f16' },
  spec_synth_len: { engineDefault: 0 },
  spec_synth_rates: { engineDefault: '' },
  // ---------------- 推理（reasoning） ----------------
  reasoning: {
    engineDefault: 'auto',
    sentinel: [''],
    note: 'help 默认 auto（按模板检测）；UI 空串 = 不指定该 flag',
  },
  reasoning_effort: {
    engineDefault: 'default',
    note: 'UI 空串 = 不指定',
  },
  reasoning_budget: { engineDefault: -1 },
  reasoning_format: {
    engineDefault: 'auto',
    note: 'UI 空串 = 不指定（none 是引擎的一个字面取值，与「不下发该 flag」不同，故不做哨兵）',
  },
  reasoning_budget_message: {
    engineDefault: 'none',
    note: 'UI 空串 = 不指定',
  },
  // ---------------- 采样 ----------------
  temperature: { engineDefault: 0.8 }, // help: 0.80
  top_k: { engineDefault: 40 },
  top_p: { engineDefault: 0.95 },
  min_p: { engineDefault: 0.05 },
  repeat_penalty: { engineDefault: 1 }, // help: 1.00
  presence_penalty: { engineDefault: 0 },
  seed: { engineDefault: -1 }, // -1 = 随机
  // ---------------- 服务端 ----------------
  alias: { engineDefault: '' },
  api_key: {
    engineDefault: 'none',
    note: 'UI 空串 = 不设鉴权',
  },
  ui: { engineDefault: true },
  slots_endpoint: { engineDefault: true },
  metrics: { engineDefault: false },
  props_endpoint: { engineDefault: false },
  timeout: { engineDefault: 3600 },
  cache_prompt: { engineDefault: true },
  cache_reuse: { engineDefault: 0 },
  context_shift: { engineDefault: false },
};

/** 宽松相等：help/表单可能一边是数字 4、另一边是字符串 '4'（含 float 归一）。 */
export function sameParamValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

/** 取某参数的发射判定基准；未登记时回退到 `default`（缺登记由门禁 fail，不在此处报错）。 */
export function engineDefaultOf(p: ParamDef): string | number | boolean {
  return PARAM_ENGINE_BASELINE[p.key]?.engineDefault ?? p.default;
}

/** 该值是否被显式声明为「交给引擎决定，不发射」。 */
export function isSentinelValue(p: ParamDef, v: string | number | boolean): boolean {
  return (PARAM_ENGINE_BASELINE[p.key]?.sentinel ?? []).some((s) => sameParamValue(s, v));
}

/** 空字符串 = 不指定：所有类型统一不发射（与旧行为一致）。 */
export function isUnsetValue(v: string | number | boolean): boolean {
  return v === '';
}

/**
 * llama.cpp 的引擎侧环境变量前缀（help 条目尾的 `(env: LLAMA_ARG_*)`）。
 * b11178 基线实测：60 个应用参数里 57 个带该通道，其中采样族 6 条（temperature / top_p /
 * min_p / repeat_penalty / presence_penalty / frequency_penalty）是 b11053 → b11178 之间新增的。
 */
export const LLAMA_ENV_PREFIX = 'LLAMA_ARG_';

/**
 * 检出环境变量里的引擎参数覆写项（纯函数，入参给 `process.env` 形状便于单测）。
 * 空串按「未设」处理：Windows 上删变量常留下空值，而引擎对空值的行为按参数类型分叉，
 * 与其猜，不如只在真的有值时提示。
 */
export function detectLlamaEnvOverrides(env: Record<string, string | undefined>): string[] {
  return Object.keys(env)
    .filter((k) => k.startsWith(LLAMA_ENV_PREFIX) && env[k] !== undefined && env[k] !== '')
    .sort();
}
