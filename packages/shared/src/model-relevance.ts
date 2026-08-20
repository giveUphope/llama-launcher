// 模型文件分类与相关性评分工具（被 core 与 ui 共用）
// - 将模型仓库文件名归入 gguf / safetensors / bin / other 类别
// - 计算文件名/模型名与关键词的相关性，用于搜索排序与下载推荐
// - 从文件名解析量化标签（Q4_K_M / FP8 / BF16 / INT4 等），用于徽标展示

/** 模型文件类别 */
export type FileCategory = 'gguf' | 'safetensors' | 'bin' | 'other';

/** 量化系列：用于颜色分组与排序 */
export type QuantizationFamily =
  | 'k-quants'
  | 'i-quants'
  | 'legacy'
  | 'fp8'
  | 'bf16'
  | 'fp16'
  | 'fp32'
  | 'int';

/** 量化信息 */
export interface QuantizationInfo {
  /** 显示标签（统一大写，如 Q4_K_M、FP8、BF16、INT4） */
  label: string;
  /** 量化位宽（如 4 表示 4-bit、16 表示 BF16）；无法识别时为 null */
  bits: number | null;
  /** 量化系列：用于颜色分组与排序 */
  family: QuantizationFamily;
}

/** 根据文件名后缀判定模型文件类别 */
export function categorizeFile(fileName: string): FileCategory {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gguf')) return 'gguf';
  if (lower.endsWith('.safetensors')) return 'safetensors';
  if (lower.endsWith('.bin')) return 'bin';
  return 'other';
}

/**
 * 量化标签匹配规则（按优先级降序排列，先匹配先返回）。
 * 设计原则：
 * - 带下划线后缀（_K_M、_XS、_0 等）的模式特异性高，放前面；
 * - Q/I 系列使用 `\b` 边界防止误匹配（如 iq3_small 不应被识别为 IQ3_S）；
 * - FP/INT 系列使用 `(?![a-z0-9])` 边界：允许后续为 `_` 或 `-`（如 fp8_mixed、bf16-instruct），
 *   但拒绝后续为字母/数字（如 f16c、int8only 这类不完整吞并）。
 */
const QUANT_PATTERNS: ReadonlyArray<{ regex: RegExp; family: QuantizationFamily }> = [
  // I-quants: IQ1_S, IQ2_XXS, IQ3_XS, IQ3_M, IQ4_NL, IQ4_XS 等
  { regex: /iq[1-4]_(?:xxs|xs|s|m|l|nl)\b/i, family: 'i-quants' },
  // K-quants XL 变体（较新，如 Q4_K_XL / Q6_K_XL / Q8_K_XL）
  { regex: /q[2-8]_k_xl\b/i, family: 'k-quants' },
  // K-quants 带尺寸后缀: Q3_K_S, Q4_K_M, Q5_K_L 等
  { regex: /q[2-6]_k_[sml]\b/i, family: 'k-quants' },
  // K-quants 不带尺寸: Q2_K, Q6_K, Q8_K
  { regex: /q[2-8]_k\b/i, family: 'k-quants' },
  // Legacy: Q4_0, Q4_1, Q5_0, Q5_1, Q8_0
  { regex: /q[4-8]_[01]\b/i, family: 'legacy' },
  // FP8（含 e4m3/e5m2/fn 变体）
  { regex: /fp8(?:_e[45]m[23])?(?:fn)?(?![a-z0-9])/i, family: 'fp8' },
  // BF16
  { regex: /bf16(?![a-z0-9])/i, family: 'bf16' },
  // FP16 / F16
  { regex: /(?:fp16|f16)(?![a-z0-9])/i, family: 'fp16' },
  // FP32 / F32
  { regex: /(?:fp32|f32)(?![a-z0-9])/i, family: 'fp32' },
  // INT2/4/8
  { regex: /int[2-8](?![a-z0-9])/i, family: 'int' },
];

/** 从大写标签中提取位宽（Q4_K_M→4、FP8→8、BF16→16、INT4→4） */
function extractBits(label: string): number | null {
  const m = label.match(/[A-Z]+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 从文件名解析量化标签。
 * 支持 GGUF（Q4_K_M、IQ3_XS、Q8_0、F16）、Safetensors（FP8、BF16）、Bin（INT4）等格式。
 * 文件名中含多个潜在匹配时，按 QUANT_PATTERNS 优先级返回首个命中。
 * 无匹配返回 null。
 */
export function parseQuantization(fileName: string): QuantizationInfo | null {
  if (!fileName) return null;
  for (const { regex, family } of QUANT_PATTERNS) {
    const m = fileName.match(regex);
    if (m) {
      const label = m[0].toUpperCase();
      return { label, bits: extractBits(label), family };
    }
  }
  return null;
}

/** 将字符串切分为小写 token（按常见分隔符拆分） */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[\s_\-./\\]+/)
    .filter(Boolean);
}

/**
 * 计算 name 与 query 的相关性得分（0~1）。
 * query 可为模型名关键词，或文件全名（如 qwen_3_4b_fp8_mixed.safetensors）。
 * 命中权重：完整 token 命中=1，前缀命中=0.8，子串命中=0.5。
 */
export function scoreRelevance(name: string, query: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const nTokens = tokenize(name);
  if (nTokens.length === 0) return 0;
  let score = 0;
  for (const q of qTokens) {
    if (nTokens.includes(q)) score += 1;
    else if (nTokens.some((t) => t.startsWith(q))) score += 0.8;
    else if (nTokens.some((t) => t.includes(q))) score += 0.5;
  }
  return score / qTokens.length;
}

/**
 * 量化偏好得分:Q4_K_M / Q5_K_M 是 llama.cpp 社区公认的甜点,优先推荐。
 * 返回 0~1,无量化信息返回 0.5(中性)。
 */
function quantPreference(q: QuantizationInfo | null | undefined): number {
  if (!q) return 0.5;
  const { family, label, bits } = q;
  // Q4_K_M / Q5_K_M:甜点
  if (family === 'k-quants' && bits !== null && (bits === 4 || bits === 5)) return 1.0;
  // Q6_K / Q8_0:高质量但偏大
  if (family === 'k-quants' && bits === 6) return 0.9;
  if (family === 'legacy' && bits === 8) return 0.85;
  // Q3:可接受
  if (family === 'k-quants' && bits === 3) return 0.7;
  if (family === 'k-quants' && bits === 2) return 0.5;
  // I-quants:整体略低于 K-quants(社区使用率较低)
  if (family === 'i-quants') return 0.75;
  // Legacy Q4_0/Q5_0:老格式
  if (family === 'legacy') return 0.65;
  // FP8:体积大但精度高,适合有显存的情况
  if (family === 'fp8') return 0.6;
  // BF16/FP16:全精度,体积巨大
  if (family === 'bf16' || family === 'fp16') return 0.4;
  if (family === 'fp32') return 0.2;
  if (family === 'int') return 0.55;
  return 0.5;
}

/** 类别偏好:llama.cpp 优先 GGUF */
function categoryPreference(c: FileCategory | null | undefined): number {
  switch (c) {
    case 'gguf': return 1.0;
    case 'safetensors': return 0.8;
    case 'bin': return 0.6;
    case 'other': return 0.3;
    default: return 0.5;
  }
}

/** 从关键词中提取量化提示(如 "q4"、"fp8"、"bf16") */
function extractQuantHint(keyword: string): string | null {
  const lower = keyword.toLowerCase();
  // 匹配 q[2-6]、iq[1-4]、fp8、bf16、fp16、int[2-8] 等
  const m = lower.match(/(?:iq?[2-6](?:_k_[sml])?|q[2-8]_[01]|fp8|bf16|fp16|fp32|int[2-8])/);
  return m ? m[0] : null;
}

/** 推荐评分所需的文件信息 */
export interface RecommendableFile {
  name: string;
  size?: number;
  category?: FileCategory;
  quantization?: QuantizationInfo | null;
}

/**
 * 多因子推荐评分(0~1.6 左右):
 * - 基础相关性(0~1,权重 0.5)
 * - 类别偏好(0~1,权重 0.2)
 * - 量化偏好(0~1,权重 0.2)
 * - 关键词量化提示匹配(额外 +0.3,权重 0.1)
 * - 大小惩罚(>30GB 扣 0.1,>60GB 扣 0.2)
 */
function scoreFileForRecommendation(file: RecommendableFile, keyword: string): number {
  // 1. 基础相关性
  const relevance = scoreRelevance(file.name, keyword);

  // 2. 类别偏好
  const cat = categoryPreference(file.category);

  // 3. 量化偏好
  const quant = quantPreference(file.quantization);

  // 4. 关键词量化提示匹配
  let hintBonus = 0;
  const hint = extractQuantHint(keyword);
  if (hint && file.quantization) {
    const fileQuantStr = file.quantization.label.toLowerCase();
    // 模糊匹配:hint "q4" 匹配 "Q4_K_M";hint "fp8" 匹配 "FP8"
    if (fileQuantStr.includes(hint) || hint.includes(fileQuantStr.replace(/_k_[sml]$/, ''))) {
      hintBonus = 0.3;
    }
  }

  // 5. 大小惩罚
  let sizePenalty = 0;
  if (file.size && file.size > 60 * 1024 * 1024 * 1024) sizePenalty = 0.2;
  else if (file.size && file.size > 30 * 1024 * 1024 * 1024) sizePenalty = 0.1;

  return relevance * 0.5 + cat * 0.2 + quant * 0.2 + hintBonus * 0.1 - sizePenalty;
}

/**
 * 从文件列表中推荐最匹配 keyword 的文件名。
 * keyword 通常为解析出的链接尾部文件名(如 qwen_3_4b_fp8_mixed.safetensors)。
 * 优先精确文件名匹配;否则按多因子评分(相关性 + 类别偏好 + 量化偏好 + 大小惩罚)取最高分。
 * files 可仅含 name(向后兼容),也可含 size/category/quantization 以启用多因子评分。
 * 无匹配返回 null。
 */
export function recommendFileName(
  files: (RecommendableFile | { name: string })[],
  keyword: string,
): string | null {
  if (!keyword) return null;
  const lower = keyword.toLowerCase();
  const exact = files.find((f) => f.name.toLowerCase() === lower);
  if (exact) return exact.name;

  let best: string | null = null;
  let bestScore = 0;
  for (const f of files) {
    // 兼容仅含 name 的输入:缺失字段按中性处理
    const file: RecommendableFile = {
      name: f.name,
      size: 'size' in f ? (f as RecommendableFile).size : undefined,
      category: 'category' in f ? (f as RecommendableFile).category : undefined,
      quantization: 'quantization' in f ? (f as RecommendableFile).quantization : undefined,
    };
    const s = scoreFileForRecommendation(file, keyword);
    if (s > bestScore) {
      bestScore = s;
      best = f.name;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * 按与 keyword 的相关性降序排序文件列表(稳定排序,同分保持原顺序)。
 * 用于下载文件列表展示:匹配度高的模型权重文件排在前面,便于用户优先看到目标文件。
 * 评分复用 scoreFileForRecommendation(相关性 + 类别偏好 + 量化偏好 + 关键词量化提示 + 大小惩罚)。
 * 不修改原数组,返回新数组。泛型 T 保留元素原始类型(如 ModelScopeFile)。
 */
export function sortFilesByRelevance<T extends RecommendableFile>(
  files: T[],
  keyword: string,
): T[] {
  return files
    .map((f, idx) => ({ f, idx, score: scoreFileForRecommendation(f, keyword) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((x) => x.f);
}
