import { open, stat, type FileHandle } from 'node:fs/promises';
import {
  GgufValueType,
  type GgufValue,
  type GgufMetadataMap,
  type GgufModelInfo,
  type GgufSuggestedParam,
  type GgufReadResult,
} from '@llama-launcher/shared';

/**
 * GGUF 魔数（"GGUF" 的 little-endian uint32 表示）。
 */
const GGUF_MAGIC = 0x46554747;
/**
 * 支持的 GGUF 版本范围。
 */
const GGUF_SUPPORTED_VERSIONS = new Set([1, 2, 3]);
/**
 * 读取时的块大小。
 * BufferReader 按此大小从文件按需加载，内存占用恒定。
 */
const READ_CHUNK_SIZE = 64 * 1024; // 64 KB
/**
 * 各固定大小值类型的字节长度（用于跳过数组）。
 */
const FIXED_TYPE_SIZE: Partial<Record<GgufValueType, number>> = {
  [GgufValueType.UINT8]: 1,
  [GgufValueType.INT8]: 1,
  [GgufValueType.UINT16]: 2,
  [GgufValueType.INT16]: 2,
  [GgufValueType.UINT32]: 4,
  [GgufValueType.INT32]: 4,
  [GgufValueType.FLOAT32]: 4,
  [GgufValueType.BOOL]: 1,
  [GgufValueType.UINT64]: 8,
  [GgufValueType.INT64]: 8,
  [GgufValueType.FLOAT64]: 8,
};

/**
 * 已知的量化类型映射（general.file_type → 描述字符串）。
 * 值与 llama.cpp ggml_type 枚举对应（ggml.h）：0=F32 1=F16 2=Q4_0 3=Q4_1
 * 6=Q5_0 7=Q5_1 8=Q8_0（修正历史版本把 Q5_0/Q5_1/Q8_0 三档错位的问题）。
 */
const FILE_TYPE_MAP: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 6: 'Q5_0', 7: 'Q5_1', 8: 'Q8_0',
  10: 'Q2_K', 11: 'Q3_K', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K', 15: 'Q8_K',
  16: 'IQ2_XXS', 17: 'IQ2_XS', 18: 'IQ3_XXS', 19: 'IQ1_S', 20: 'IQ4_NL',
  21: 'IQ3_S', 22: 'IQ2_S', 23: 'IQ4_XS', 24: 'I8', 25: 'I16', 26: 'I32',
  27: 'I64', 28: 'F64', 29: 'IQ1_M', 30: 'BF16', 31: 'Q4_0_4_4', 32: 'Q4_0_4_8',
  33: 'Q4_0_8_8', 34: 'TQ1_0', 35: 'TQ2_0',
};

/**
 * 已知的聊天模板名称关键词匹配（用于从 tokenizer.chat_template 推断 chat_template 参数）。
 * llama-server 的 --chat-template 支持的值与模板内容前缀做模糊匹配。
 */
const CHAT_TEMPLATE_MATCHERS: { key: string; keywords: string[] }[] = [
  { key: 'chatml', keywords: ['<|im_start|>'] },
  { key: 'llama3', keywords: ['<|begin_of_text|>', '<|start_header_id|>'] },
  { key: 'llama2', keywords: ['[INST]', '[/INST]'] },
  { key: 'mistral-v1', keywords: ['[INST]'] },
  { key: 'phi3', keywords: ['<|user|>', '<|assistant|>', '<|end|>'] },
  { key: 'phi4', keywords: ['<|im_start|>', '<|im_end|>', '<|tool|>'] },
  { key: 'gemma', keywords: ['<start_of_turn>', '<end_of_turn>'] },
  { key: 'deepseek', keywords: ['<｜begin▁of▁sentence｜>'] },
  { key: 'deepseek2', keywords: ['<｜begin▁of▁sentence｜>', 'next_token'] },
  { key: 'deepseek3', keywords: ['<｜begin▁of▁sentence｜>', 'chat'] },
  { key: 'chatglm3', keywords: ['<|system|>', '<|user|>', '<|assistant|>'] },
  { key: 'chatglm4', keywords: ['[gMASK]', '<|system|>'] },
  { key: 'vicuna', keywords: ['USER:', 'ASSISTANT:'] },
  { key: 'zephyr', keywords: ['<|system|>', '</s>'] },
  { key: 'command-r', keywords: ['<|START_OF_TURN_TOKEN|>'] },
  { key: 'falcon3', keywords: ['<|system|>', 'falcon'] },
  { key: 'granite', keywords: ['granite'] },
  { key: 'gpt-oss', keywords: ['<|im_start|>', 'gpt-oss'] },
  { key: 'grok-2', keywords: ['grok'] },
  { key: 'hunyuan-moe', keywords: ['hunyuan'] },
  { key: 'kimi-k2', keywords: ['kimi'] },
];

/**
 * 流式缓冲区读取器：从文件描述符按需读取，支持游标偏移与跳过。
 * 按需以 64KB 块加载文件内容，内存占用恒定。
 * 通过 skipBytes() 可跳过大段数据（如 tokenizer 数组）而不加载到内存。
 */
class BufferReader {
  private fh: FileHandle;
  private fileEnd: number;
  private buf: Buffer;
  private bufStart: number; // buf 在文件中的起始偏移
  private bufLen: number;   // buf 中有效数据长度
  private pos: number;      // 当前读取游标（相对于文件起始）

  constructor(fh: FileHandle, fileSize: number) {
    this.fh = fh;
    this.fileEnd = fileSize;
    this.buf = Buffer.allocUnsafe(READ_CHUNK_SIZE);
    this.bufStart = -1;
    this.bufLen = 0;
    this.pos = 0;
  }

  /**
   * 确保游标位置的数据已加载到缓冲区，必要时从文件读取新块。
   * 异步：底层 fs 走线程池，不阻塞主进程事件循环（大模型头部读取去阻塞的关键）。
   */
  private async ensureBuffer(): Promise<void> {
    if (this.bufStart >= 0 && this.pos >= this.bufStart && this.pos < this.bufStart + this.bufLen) {
      return; // 当前块已覆盖
    }
    this.bufStart = this.pos;
    if (this.bufStart >= this.fileEnd) {
      throw new Error(`Unexpected end of GGUF file at offset ${this.pos}`);
    }
    const toRead = Math.min(READ_CHUNK_SIZE, this.fileEnd - this.bufStart);
    // FileHandle.read（fs/promises 命名导出 read 在当前运行时不可用，走句柄方法）
    const { bytesRead } = await this.fh.read(this.buf, 0, toRead, this.bufStart);
    this.bufLen = bytesRead;
    if (bytesRead === 0) {
      throw new Error(`Unexpected end of GGUF file at offset ${this.pos}`);
    }
  }

  /** 读取单个字节 */
  async readU8(): Promise<number> {
    await this.ensureBuffer();
    const val = this.buf[this.pos - this.bufStart];
    this.pos += 1;
    return val;
  }

  /** 读取有符号 int8 */
  async readI8(): Promise<number> {
    const val = await this.readU8();
    return val > 127 ? val - 256 : val;
  }

  /** 读取 little-endian uint16 */
  async readU16(): Promise<number> {
    return (await this.readBytes(2)).readUInt16LE(0);
  }

  /** 读取 little-endian int16 */
  async readI16(): Promise<number> {
    return (await this.readBytes(2)).readInt16LE(0);
  }

  /** 读取 little-endian uint32 */
  async readU32(): Promise<number> {
    return (await this.readBytes(4)).readUInt32LE(0);
  }

  /** 读取 little-endian int32 */
  async readI32(): Promise<number> {
    return (await this.readBytes(4)).readInt32LE(0);
  }

  /** 读取 little-endian float32 */
  async readF32(): Promise<number> {
    return (await this.readBytes(4)).readFloatLE(0);
  }

  /** 读取 little-endian uint64（返回 Number，元数据值不会超过 JS 安全整数范围） */
  async readU64(): Promise<number> {
    const buf = await this.readBytes(8);
    const lo = buf.readUInt32LE(0);
    const hi = buf.readUInt32LE(4);
    return hi * 0x100000000 + lo;
  }

  /** 读取 little-endian int64 */
  async readI64(): Promise<number> {
    const buf = await this.readBytes(8);
    const lo = buf.readUInt32LE(0);
    const hi = buf.readInt32LE(4);
    return hi * 0x100000000 + lo;
  }

  /** 读取 little-endian float64 */
  async readF64(): Promise<number> {
    return (await this.readBytes(8)).readDoubleLE(0);
  }

  /**
   * 读取 GGUF 字符串（uint64 长度 + UTF-8 字节）。
   * 大字符串（如 chat_template）会被截断到 MAX_STRING_LEN 以节省内存。
   */
  async readString(): Promise<string> {
    const len = await this.readU64();
    if (len > 10 * 1024 * 1024) {
      throw new Error(`GGUF string too large: ${len} bytes`);
    }
    const buf = await this.readBytes(len);
    return buf.toString('utf-8');
  }

  /**
   * 读取指定字节数，返回 Buffer 副本（可能跨缓冲块）。
   */
  async readBytes(n: number): Promise<Buffer> {
    if (n <= 0) return Buffer.alloc(0);
    const result = Buffer.allocUnsafe(n);
    let read = 0;
    while (read < n) {
      await this.ensureBuffer();
      const offsetInBuf = this.pos - this.bufStart;
      const available = this.bufLen - offsetInBuf;
      const need = n - read;
      const copy = Math.min(available, need);
      this.buf.copy(result, read, offsetInBuf, offsetInBuf + copy);
      read += copy;
      this.pos += copy;
    }
    return result;
  }

  /**
   * 跳过指定字节数，不加载到内存。
   * 仅前进游标，下次读取时才按需加载新块。
   */
  skipBytes(n: number): void {
    if (n <= 0) return;
    this.pos += n;
    if (this.pos > this.fileEnd) {
      throw new Error(`Skip past end of file: pos=${this.pos}, fileEnd=${this.fileEnd}`);
    }
  }

  /**
   * 跳过一个字符串（读取长度后跳过内容），不加载字符串内容到内存。
   * 用于跳过字符串数组中的各元素。
   */
  async skipString(): Promise<void> {
    const len = await this.readU64();
    this.skipBytes(len);
  }

  get position(): number {
    return this.pos;
  }
}

/**
 * 读取单个元数据值。
 * 对于 ARRAY 类型，跳过整个数组数据不加载到内存（tokenizer 数组可达数 MB）。
 * 返回 null 占位，因为建议参数推导只使用标量值。
 */
async function readValue(reader: BufferReader, type: GgufValueType): Promise<GgufValue> {
  switch (type) {
    case GgufValueType.UINT8: return reader.readU8();
    case GgufValueType.INT8: return reader.readI8();
    case GgufValueType.UINT16: return reader.readU16();
    case GgufValueType.INT16: return reader.readI16();
    case GgufValueType.UINT32: return reader.readU32();
    case GgufValueType.INT32: return reader.readI32();
    case GgufValueType.FLOAT32: return reader.readF32();
    case GgufValueType.BOOL: return (await reader.readU8()) !== 0;
    case GgufValueType.STRING: return reader.readString();
    case GgufValueType.ARRAY: {
      const arrType = (await reader.readU32()) as GgufValueType;
      const arrLen = await reader.readU64();
      // 跳过数组数据，不加载到内存
      await skipArray(reader, arrType, arrLen);
      return null;
    }
    case GgufValueType.UINT64: return reader.readU64();
    case GgufValueType.INT64: return reader.readI64();
    case GgufValueType.FLOAT64: return reader.readF64();
    default:
      throw new Error(`Unknown GGUF value type: ${type}`);
  }
}

/**
 * 跳过数组数据而不加载到内存。
 * 固定大小类型按 count * elementSize 计算总字节后一次性跳过；
 * 字符串数组需逐个读取长度后跳过字符串内容。
 */
async function skipArray(reader: BufferReader, elementType: GgufValueType, count: number): Promise<void> {
  const elemSize = FIXED_TYPE_SIZE[elementType];
  if (elemSize !== undefined) {
    // 固定大小类型：一次性跳过
    reader.skipBytes(count * elemSize);
  } else if (elementType === GgufValueType.STRING) {
    // 字符串数组：逐个读取长度并跳过内容
    for (let i = 0; i < count; i++) {
      await reader.skipString();
    }
  } else if (elementType === GgufValueType.ARRAY) {
    // 嵌套数组：递归跳过（罕见情况）
    for (let i = 0; i < count; i++) {
      const innerType = (await reader.readU32()) as GgufValueType;
      const innerLen = await reader.readU64();
      await skipArray(reader, innerType, innerLen);
    }
  } else {
    throw new Error(`Cannot skip array of unknown type: ${elementType}`);
  }
}

/**
 * 从元数据映射中获取数值类型值。
 */
function getNumber(meta: GgufMetadataMap, key: string): number | null {
  const v = meta[key];
  if (v === undefined) return null;
  if (typeof v === 'number') return v;
  return null;
}

/**
 * 从元数据映射中获取字符串类型值。
 */
function getString(meta: GgufMetadataMap, key: string): string | null {
  const v = meta[key];
  if (v === undefined) return null;
  if (typeof v === 'string') return v;
  return null;
}

/**
 * 从元数据映射中获取布尔类型值。
 */
function getBool(meta: GgufMetadataMap, key: string): boolean | null {
  const v = meta[key];
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v;
  return null;
}

/**
 * 尝试从聊天模板内容匹配已知的 chat_template 名称。
 */
function matchChatTemplate(template: string): string | null {
  const lower = template.toLowerCase();
  for (const m of CHAT_TEMPLATE_MATCHERS) {
    if (m.keywords.every((kw) => lower.includes(kw.toLowerCase()))) {
      return m.key;
    }
  }
  return null;
}

/**
 * 量化类型为低精度量化的判断（用于建议 KV cache 量化）。
 * 值 < 10 的为 F32/F16，>= 10 的为各种量化格式。
 */
function isQuantized(fileType: number | null): boolean {
  return fileType !== null && fileType >= 2;
}

/**
 * 量化标识符正则：从文件名中提取比 FILE_TYPE_MAP 更具体的量化描述。
 * 匹配模式：
 *   - 可选 UD- 前缀（Unsloth Dynamic 量化）
 *   - Q + 数字 + 可选后缀：Q4_0, Q4_K, Q4_K_M, Q4_K_XL, Q8_0
 *   - IQ + 数字 + 可选后缀：IQ1_S, IQ2_XXS, IQ3_S, IQ4_NL, IQ4_XS
 *   - TQ + 数字 + 后缀：TQ1_0, TQ2_0
 *   - BF + 数字：BF16
 *   - F + 数字：F16, F32
 *   - I + 数字：I8, I16
 * 后缀为下划线分隔的字母数字组合（如 _K, _M, _S, _L, _XL, _XXS, _XS, _NL）。
 */
const QUANT_PATTERN = /(UD-)?(?:(?:Q|IQ|TQ)\d(?:_[A-Z0-9]+)*|BF\d+|F\d+|I\d+)/i;

/**
 * 从模型文件路径中提取量化描述符。
 * FILE_TYPE_MAP 只提供基础类型（如 Q4_K），但文件名可能包含更具体的变体
 * （如 Q4_K_XL、UD-Q4_K_XL、IQ2_XXS）。优先使用文件名中的量化描述。
 *
 * @returns 量化描述字符串（如 "Q4_K_XL"、"UD-Q4_K_XL"），未匹配返回 null
 */
function extractQuantFromFilename(filePath: string): string | null {
  const filename = filePath.split(/[/\\]/).pop() ?? '';
  const match = filename.match(QUANT_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

/**
 * 判断模型名是否已包含指定标签（如 size_label "27B"、量化 "Q4_K_M"）。
 * 按独立词元匹配（大小写不敏感）：标签需以分隔符/边界出现，避免子串误判
 * （如名称 "Qwen3.6-35B-A3B" 中的 "3B" 不视为已含尺寸标签 "3B"）。
 */
export function nameContainsLabel(name: string, label: string): boolean {
  if (!name || !label) return false;
  const escaped = label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(name.toLowerCase());
}

/** 各量化家族的典型字节/参数（粗估，用于元数据量化与文件尺寸的一致性校验）。 */
const QUANT_BYTES_PER_PARAM: Record<string, number> = {
  Q2_K: 0.3, Q3_K: 0.4, Q4_K: 0.55, Q5_K: 0.68, Q6_K: 0.82, Q8_K: 1.04,
  IQ1_S: 0.2, IQ1_M: 0.22, IQ2_S: 0.27, IQ2_XXS: 0.25, IQ2_XS: 0.3,
  IQ3_XXS: 0.35, IQ3_S: 0.4, IQ4_NL: 0.5, IQ4_XS: 0.47,
  Q4_0: 0.55, Q4_1: 0.6, Q5_0: 0.7, Q5_1: 0.75, Q8_0: 1.05,
  BF16: 2, F16: 2, F32: 4, TQ1_0: 0.33, TQ2_0: 0.4,
  Q4_0_4_4: 0.55, Q4_0_4_8: 0.55, Q4_0_8_8: 0.55,
};

/** 尺寸一致性阈值：元数据量化的理论字节/参数与实际偏差 ≥ 该比例即视为元数据不可信。 */
const QUANT_SIZE_MISMATCH_THRESHOLD = 0.3;
/** 实际字节/参数的合理范围（超出视为无法估算：微型/稀疏测试文件等）。 */
const QUANT_SIZE_PLAUSIBLE_RANGE: [number, number] = [0.1, 4.5];

/** 量化家族分类：修正候选只在同一家族内选取，避免 k-quant 文件被误标为 legacy（如 Q5_0）。 */
function quantClass(label: string): string {
  if (/^Q[2-8]_K/.test(label)) return 'k';
  if (label.startsWith('IQ')) return 'iq';
  if (/^Q[4-8]_[01]$/.test(label)) return 'legacy';
  if (label === 'F16' || label === 'F32' || label === 'BF16') return 'fp';
  return 'other';
}

/**
 * 由模型超参数粗估参数量（不含完整词表嵌入，词表按 64K 粗估）。
 * 缺失关键超参（层数/嵌入维度）时返回 0（无法估算，调用方应跳过校验）。
 */
export function estimateModelParams(
  blockCount: number | null,
  embeddingLength: number | null,
  feedForwardLength: number | null,
  expertCount: number | null,
): number {
  const L = blockCount ?? 0;
  const E = embeddingLength ?? 0;
  if (L <= 0 || E <= 0) return 0;
  const F = feedForwardLength && feedForwardLength > 0 ? feedForwardLength : 8 * E;
  const experts = expertCount && expertCount > 0 ? expertCount : 1;
  const attn = 4 * E * E; // q/k/v/o 投影
  const mlp = 2 * E * F * experts; // up+gate（×专家）+ down
  const norms = 2 * E;
  return L * (attn + mlp + norms) + E * 65536; // + 词表嵌入粗估（64K）
}

/**
 * 尺寸一致性校验：当元数据量化的理论字节/参数与实际文件尺寸严重不符时（≥30%），
 * 返回按尺寸估算的最接近量化家族（同家族内选取，如 Q8_K 文件实际仅 0.7 字节/参数 → Q5_K）；
 * 偏差在阈值内、无法估算或元数据量化不在已知表内时返回 null（保持元数据）。
 */
export function estimateQuantFromSize(
  fileBytes: number,
  params: number,
  metadataQuant: string,
): string | null {
  const expected = QUANT_BYTES_PER_PARAM[metadataQuant];
  if (!expected || params <= 0) return null;
  const actual = fileBytes / params;
  // 实际字节/参数超出合理范围（如微型测试文件）→ 无法可靠估算，保持元数据
  if (actual < QUANT_SIZE_PLAUSIBLE_RANGE[0] || actual > QUANT_SIZE_PLAUSIBLE_RANGE[1]) return null;
  if (Math.abs(actual - expected) / expected < QUANT_SIZE_MISMATCH_THRESHOLD) return null;
  const cls = quantClass(metadataQuant);
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const [label, bpp] of Object.entries(QUANT_BYTES_PER_PARAM)) {
    if (quantClass(label) !== cls) continue;
    const d = Math.abs(actual - bpp);
    if (d < bestDiff) {
      bestDiff = d;
      best = label;
    }
  }
  return best;
}

/**
 * 从结构化模型信息中推导建议参数。
 * 覆盖采样、推测解码、KV cache、模型别名等。
 *
 * 分类原则（展示信息 ≠ 参数建议）：
 * - 仅「模型事实 → 参数值」的确定性映射（MTP 头 → draft-mtp、作者采样推荐 → 采样参数）
 *   与标注来源的启发式规则（量化权重 → KV q8_0 等）进入建议；
 * - 纯参考信息（context_length 训练上限、rope.freq_base 等）不产生建议——
 *   llama-server 的 -c 默认 0 = 从模型加载，逐项建议反而是混淆源。
 */
function buildSuggestions(info: GgufModelInfo): GgufSuggestedParam[] {
  const suggestions: GgufSuggestedParam[] = [];
  const arch = info.architecture;

  // 附件文件守卫：仅主模型（general.type=model 或旧文件缺省）生成建议。
  // mmproj/clip 附件也常携带 general.sampling.*/name，对其生成建议没有意义。
  const isMainModel = (info.type ?? 'model') === 'model' && info.architecture !== 'clip';
  if (!isMainModel) return [];

  // 采样参数 — 模型内置的推荐采样参数
  if (info.sampling_temp !== null && info.sampling_temp > 0) {
    suggestions.push({
      key: 'temperature',
      value: info.sampling_temp,
      source: 'general.sampling.temp',
      description: '模型推荐的采样温度',
    });
  }
  if (info.sampling_top_k !== null && info.sampling_top_k > 0) {
    suggestions.push({
      key: 'top_k',
      value: info.sampling_top_k,
      source: 'general.sampling.top_k',
      description: '模型推荐的 top-k 采样值',
    });
  }
  if (info.sampling_top_p !== null && info.sampling_top_p > 0) {
    suggestions.push({
      key: 'top_p',
      value: info.sampling_top_p,
      source: 'general.sampling.top_p',
      description: '模型推荐的 top-p 采样值',
    });
  }
  if (info.sampling_min_p !== null && info.sampling_min_p > 0) {
    suggestions.push({
      key: 'min_p',
      value: info.sampling_min_p,
      source: 'general.sampling.min_p',
      description: '模型推荐的 min-p 采样值',
    });
  }
  if (info.sampling_repeat_penalty !== null && info.sampling_repeat_penalty > 0) {
    suggestions.push({
      key: 'repeat_penalty',
      value: info.sampling_repeat_penalty,
      source: 'general.sampling.repetition_penalty',
      description: '模型推荐的重复惩罚值',
    });
  }
  if (info.sampling_presence_penalty !== null) {
    suggestions.push({
      key: 'presence_penalty',
      value: info.sampling_presence_penalty,
      source: 'general.sampling.penalty_present',
      description: '模型推荐的存在惩罚值',
    });
  }
  // MTP 推测解码 — 模型含 nextn_predict_layers 时启用 draft-mtp
  if (info.nextn_predict_layers !== null && info.nextn_predict_layers > 0) {
    suggestions.push({
      key: 'spec_type',
      value: 'draft-mtp',
      source: `${arch}.nextn_predict_layers`,
      description: `模型包含 ${info.nextn_predict_layers} 层 MTP 预测头，启用 MTP 推测解码`,
    });
  }

  // 模型别名 — 使用"模型名称-量化版本"格式，便于多量化版本同时部署时区分
  {
    // 量化描述优先级：文件名提取（更具体，如 Q4_K_XL、UD-Q4_K_XL）> FILE_TYPE_MAP（基础类型，如 Q4_K）
    // 文件名中的量化变体（_M/_S/_L/_XL、UD- 前缀）在 GGUF file_type 中无法区分，
    // 但对别名区分多量化版本部署很重要，因此优先从文件名提取。
    const filenameQuant = extractQuantFromFilename(info.path);
    const quantLabel =
      filenameQuant ??
      (info.quantization && isQuantized(info.file_type) ? info.quantization : null);

    // 优先使用 size_label（如 7B、13B）拼接量化类型（如 Q4_K_M）→ "Model-7B-Q4_K_M"
    // 退化路径：name → name+quantization → quantization → basename
    const parts: string[] = [];
    const baseName = info.name || info.basename || '';
    if (baseName) parts.push(baseName);
    // size_label 去重：模型名已含尺寸（如 Qwen3.8-27B 已含 27B）时不重复拼接，
    // 避免别名出现 "27B-27B"；量化同理（名称已含量化标签时不重复）。
    if (info.size_label && !nameContainsLabel(baseName, info.size_label)) {
      parts.push(info.size_label);
    }
    if (quantLabel && !nameContainsLabel(baseName, quantLabel)) {
      parts.push(quantLabel);
    }
    if (parts.length > 0) {
      const aliasValue = parts.join('-');
      suggestions.push({
        key: 'alias',
        value: aliasValue,
        source: 'general.name+file_type+filename',
        description: `使用"模型名称-量化版本"作为服务器别名: ${aliasValue}`,
      });
    }
  }

  // KV cache 量化 — 量化模型建议使用 q8_0 KV cache 节省显存（启发式：来源为权重量化，
  // 非 KV cache 自身的元数据）
  if (isQuantized(info.file_type)) {
    suggestions.push({
      key: 'cache_type_k',
      value: 'q8_0',
      source: 'general.file_type',
      description: `模型已量化为 ${info.quantization}，建议 KV cache K 使用 q8_0 节省显存`,
    });
    suggestions.push({
      key: 'cache_type_v',
      value: 'q8_0',
      source: 'general.file_type',
      description: `模型已量化为 ${info.quantization}，建议 KV cache V 使用 q8_0 节省显存`,
    });
  }

  // Flash Attention — 大上下文模型建议启用（启发式：经验规则，非模型元数据事实）
  if (info.context_length !== null && info.context_length >= 8192) {
    suggestions.push({
      key: 'flash_attn',
      value: 'on',
      source: `${arch}.context_length`,
      description: '上下文长度较大，建议启用 Flash Attention 以减少显存占用',
    });
  }

  return suggestions;
}

/**
 * 内存缓存：按 "filePath:mtimeMs:size" 作为键缓存 GGUF 解析结果。
 * 进程重启后缓存失效（可接受，因为首次读取后即缓存）。
 * 文件 mtime/size 未变化时直接返回缓存，避免重复 IO。
 */
interface CacheEntry {
  key: string;
  result: GgufReadResult;
}
const ggufCache = new Map<string, CacheEntry>();

// 缓存上限，避免大量不同模型文件导致内存膨胀
const GGUF_CACHE_MAX = 32;

function makeCacheKey(filePath: string, mtimeMs: number, size: number): string {
  return `${filePath}:${mtimeMs}:${size}`;
}

/**
 * 清空 GGUF 元数据缓存。
 */
export function clearGgufCache(): void {
  ggufCache.clear();
}

/**
 * 读取 GGUF 文件头部元数据并返回结构化信息与建议参数（带缓存）。
 *
 * 仅读取文件头部元数据区域，不会加载模型权重。
 * 文件 mtime/size 未变化时直接返回缓存结果，避免重复 IO。
 * 对于损坏或非 GGUF 文件会抛出错误。
 *
 * @param filePath GGUF 文件绝对路径
 * @returns 模型信息与建议参数
 * @throws 文件不存在、不是 GGUF 文件、版本不支持、或读取越界时抛出错误
 */
export async function readGgufMetadata(filePath: string): Promise<GgufReadResult> {
  let st;
  try {
    st = await stat(filePath);
  } catch {
    throw new Error(`Cannot access file: ${filePath}`);
  }

  const cacheKey = makeCacheKey(filePath, st.mtimeMs, st.size);
  const cached = ggufCache.get(cacheKey);
  if (cached) return cached.result;

  const result = await readGgufMetadataUncached(filePath, st.size);

  // LRU 简化版：超过上限时删除最早插入的条目
  if (ggufCache.size >= GGUF_CACHE_MAX) {
    const firstKey = ggufCache.keys().next().value;
    if (firstKey) ggufCache.delete(firstKey);
  }
  ggufCache.set(cacheKey, { key: cacheKey, result });

  return result;
}

/**
 * 实际读取 GGUF 元数据（无缓存内部实现）。
 *
 * @param filePath GGUF 文件路径
 * @param fileSize 文件大小（由调用方传入，避免重复 stat）
 * @returns 模型信息与建议参数
 * @throws 文件不存在、不是 GGUF 文件、版本不支持、或读取越界时抛出错误
 */
async function readGgufMetadataUncached(filePath: string, fileSize: number): Promise<GgufReadResult> {
  if (fileSize < 12) {
    throw new Error(`File too small to be a valid GGUF: ${filePath}`);
  }

  const fh = await open(filePath, 'r');
  try {
    const reader = new BufferReader(fh, fileSize);

    // 读取文件头
    const magic = await reader.readU32();
    if (magic !== GGUF_MAGIC) {
      throw new Error(`Not a GGUF file (magic: 0x${magic.toString(16)})`);
    }

    const version = await reader.readU32();
    if (!GGUF_SUPPORTED_VERSIONS.has(version)) {
      throw new Error(`Unsupported GGUF version: ${version}`);
    }

    // version 1 使用 uint32 计数，version 2+ 使用 uint64
    const tensor_count = version === 1 ? await reader.readU32() : await reader.readU64();
    const metadata_kv_count = version === 1 ? await reader.readU32() : await reader.readU64();

    // 读取所有元数据键值对
    const metadata: GgufMetadataMap = {};
    for (let i = 0; i < metadata_kv_count; i++) {
      const key = await reader.readString();
      const valueType = (await reader.readU32()) as GgufValueType;
      const value = await readValue(reader, valueType);
      metadata[key] = value;
    }

    // 提取结构化信息
    const architecture = getString(metadata, 'general.architecture') ?? '';
    const name = getString(metadata, 'general.name') ?? '';
    const fileType = getNumber(metadata, 'general.file_type');
    // 量化展示：文件名优先——文件名含精确变体（Q4_K_M/Q4_K_XL/UD-Q4_K_XL），
    // 比元数据 file_type 的家族名（Q4_K）更贴近实际文件；部分文件元数据与文件名
    // 不一致（如 Q4_K_XL 文件报 file_type=14=Q6_K），用户视角以文件名为准，元数据仅作回退。
    const filenameQuant = extractQuantFromFilename(filePath);
    let quantization =
      filenameQuant ??
      (fileType !== null ? (FILE_TYPE_MAP[fileType] ?? `type_${fileType}`) : '');
    // 元数据可信度尺寸校验：文件名无量化标签时，若元数据量化的理论字节/参数与实际
    // 文件尺寸严重不符（如自定义 kquant 文件报 Q8_K 但实际仅 ~0.7 字节/参数），
    // 用尺寸估算的量化家族覆盖（同家族内选取）；无法估算或偏差在阈值内则保持元数据。
    if (!filenameQuant && fileType !== null) {
      const estParams = estimateModelParams(
        getNumber(metadata, `${architecture}.block_count`),
        getNumber(metadata, `${architecture}.embedding_length`),
        getNumber(metadata, `${architecture}.feed_forward_length`),
        getNumber(metadata, `${architecture}.expert_count`),
      );
      const sizeQuant = estimateQuantFromSize(fileSize, estParams, quantization);
      if (sizeQuant) quantization = sizeQuant;
    }

    // 架构相关字段使用 "<arch>." 前缀
    const p = (suffix: string) => `${architecture}.${suffix}`;

    const info: GgufModelInfo = {
      path: filePath,
      version,
      tensor_count,
      metadata_kv_count,
      metadata,
      architecture,
      name,
      quantization,
      file_type: fileType,
      quantization_version: getNumber(metadata, 'general.quantization_version'),
      type: getString(metadata, 'general.type'),
      finetune: getString(metadata, 'general.finetune'),
      basename: getString(metadata, 'general.basename'),
      size_label: getString(metadata, 'general.size_label'),
      context_length: getNumber(metadata, p('context_length')),
      embedding_length: getNumber(metadata, p('embedding_length')),
      feed_forward_length: getNumber(metadata, p('feed_forward_length')),
      block_count: getNumber(metadata, p('block_count')),
      attention_head_count: getNumber(metadata, p('attention.head_count')),
      attention_head_count_kv: getNumber(metadata, p('attention.head_count_kv')),
      attention_key_length: getNumber(metadata, p('attention.key_length')),
      attention_value_length: getNumber(metadata, p('attention.value_length')),
      attention_layer_norm_rms_epsilon: getNumber(metadata, p('attention.layer_norm_rms_epsilon')),
      expert_count: getNumber(metadata, p('expert_count')),
      expert_used_count: getNumber(metadata, p('expert_used_count')),
      nextn_predict_layers: getNumber(metadata, p('nextn_predict_layers')),
      full_attention_interval: getNumber(metadata, p('full_attention_interval')),
      ssm_conv_kernel: getNumber(metadata, p('ssm.conv_kernel')),
      ssm_state_size: getNumber(metadata, p('ssm.state_size')),
      ssm_group_count: getNumber(metadata, p('ssm.group_count')),
      rope_freq_base: getNumber(metadata, p('rope.freq_base')),
      tokenizer_model: getString(metadata, 'tokenizer.ggml.model'),
      tokenizer_pre: getString(metadata, 'tokenizer.ggml.pre'),
      chat_template: getString(metadata, 'tokenizer.chat_template'),
      bos_token_id: getNumber(metadata, 'tokenizer.ggml.bos_token_id'),
      eos_token_id: getNumber(metadata, 'tokenizer.ggml.eos_token_id'),
      padding_token_id: getNumber(metadata, 'tokenizer.ggml.padding_token_id'),
      sampling_temp: getNumber(metadata, 'general.sampling.temp'),
      sampling_top_k: getNumber(metadata, 'general.sampling.top_k'),
      sampling_top_p: getNumber(metadata, 'general.sampling.top_p'),
      sampling_min_p: getNumber(metadata, 'general.sampling.min_p'),
      sampling_repeat_penalty: getNumber(metadata, 'general.sampling.repetition_penalty'),
      sampling_presence_penalty: getNumber(metadata, 'general.sampling.penalty_present'),
      imatrix_dataset: getString(metadata, 'quantize.imatrix.dataset'),
      imatrix_entries_count: getNumber(metadata, 'quantize.imatrix.entries_count'),
      imatrix_chunks_count: getNumber(metadata, 'quantize.imatrix.chunks_count'),
      organization: getString(metadata, 'general.organization'),
      license: getString(metadata, 'general.license'),
      license_name: getString(metadata, 'general.license_name'),
      dataset: getString(metadata, 'general.dataset'),
      description: getString(metadata, 'general.description'),
      url: getString(metadata, 'general.url'),
      add_bos_token: getBool(metadata, 'tokenizer.ggml.add_bos_token'),
      add_eos_token: getBool(metadata, 'tokenizer.ggml.add_eos_token'),
      expert_feed_forward_length: getNumber(metadata, p('expert_feed_forward_length')),
      sampling_penalty_last_n: getNumber(metadata, 'general.sampling.penalty_last_n'),
      sampling_typical_p: getNumber(metadata, 'general.sampling.typical_p'),
      sampling_mirostat: getNumber(metadata, 'general.sampling.mirostat'),
      sampling_mirostat_eta: getNumber(metadata, 'general.sampling.mirostat_eta'),
      sampling_mirostat_tau: getNumber(metadata, 'general.sampling.mirostat_tau'),
    };

    const suggestions = buildSuggestions(info);

    return { info, suggestions };
  } finally {
    await fh.close();
  }
}
