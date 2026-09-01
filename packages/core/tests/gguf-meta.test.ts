import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGgufMetadata, estimateModelParams, estimateQuantFromSize, nameContainsLabel } from '../src/gguf-meta.js';

/**
 * GGUF 值类型枚举（与 gguf.ts 中的定义对应）。
 */
const VT = {
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5,
  FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
} as const;

/**
 * 构建 GGUF 字符串（uint64 长度 + UTF-8 字节）。
 */
function ggufString(s: string): Buffer {
  const strBuf = Buffer.from(s, 'utf-8');
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(strBuf.length));
  return Buffer.concat([lenBuf, strBuf]);
}

/**
 * 构建 GGUF 元数据键值对。
 */
function ggufKV(key: string, valueType: number, valueBuf: Buffer): Buffer {
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32LE(valueType);
  return Buffer.concat([ggufString(key), typeBuf, valueBuf]);
}

/**
 * 构建数值类型的 value buffer。
 */
function u8(v: number): Buffer { const b = Buffer.alloc(1); b.writeUInt8(v); return b; }
function u16(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function u32(v: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }
function i32(v: number): Buffer { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
function f32(v: number): Buffer { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }
function u64(v: number): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
function boolVal(v: boolean): Buffer { return Buffer.from([v ? 1 : 0]); }

/**
 * 构建一个完整的 GGUF v3 文件。
 */
function buildGgufV3(tensorCount: number, kvPairs: Buffer[]): Buffer {
  const magic = Buffer.alloc(4);
  magic.writeUInt32LE(0x46554747); // "GGUF" LE
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3);
  const tc = u64(tensorCount);
  const kvc = u64(kvPairs.length);
  return Buffer.concat([magic, version, tc, kvc, ...kvPairs]);
}

describe('readGgufMetadata', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `llama-gguf-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('reads basic metadata from a minimal GGUF v3 file', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Test Model')),
      ggufKV('general.file_type', VT.UINT32, u32(1)), // F16
      ggufKV('llama.context_length', VT.UINT32, u32(4096)),
      ggufKV('llama.block_count', VT.UINT32, u32(32)),
      ggufKV('llama.embedding_length', VT.UINT32, u32(4096)),
    ];
    const filePath = join(testDir, 'model.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.version).toBe(3);
    expect(result.info.tensor_count).toBe(0);
    expect(result.info.architecture).toBe('llama');
    expect(result.info.name).toBe('Test Model');
    expect(result.info.quantization).toBe('F16');
    expect(result.info.context_length).toBe(4096);
    expect(result.info.block_count).toBe(32);
    expect(result.info.embedding_length).toBe(4096);
  });

  it('extracts attention metadata', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen2')),
      ggufKV('qwen2.context_length', VT.UINT32, u32(32768)),
      ggufKV('qwen2.attention.head_count', VT.UINT32, u32(32)),
      ggufKV('qwen2.attention.head_count_kv', VT.UINT32, u32(8)),
    ];
    const filePath = join(testDir, 'qwen2.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.architecture).toBe('qwen2');
    expect(result.info.context_length).toBe(32768);
    expect(result.info.attention_head_count).toBe(32);
    expect(result.info.attention_head_count_kv).toBe(8);
  });

  it('extracts tokenizer and chat template metadata', async () => {
    const chatTemplate = '<|im_start|>user\n{0}<|im_end|>\n<|im_start|>assistant\n';
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('tokenizer.ggml.model', VT.STRING, ggufString('gpt2')),
      ggufKV('tokenizer.chat_template', VT.STRING, ggufString(chatTemplate)),
      ggufKV('tokenizer.ggml.bos_token_id', VT.UINT32, u32(1)),
      ggufKV('tokenizer.ggml.eos_token_id', VT.UINT32, u32(2)),
    ];
    const filePath = join(testDir, 'chatml.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.tokenizer_model).toBe('gpt2');
    expect(result.info.chat_template).toBe(chatTemplate);
    expect(result.info.bos_token_id).toBe(1);
    expect(result.info.eos_token_id).toBe(2);
  });

  it('generates suggestions for context_length', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('llama.context_length', VT.UINT32, u32(8192)),
    ];
    const filePath = join(testDir, 'suggestions.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).toContain('ctx_size');
    const ctxSuggestion = result.suggestions.find((s) => s.key === 'ctx_size');
    expect(ctxSuggestion?.value).toBe(8192);
  });

  it('does not auto-suggest chat_template or jinja (default=none, user-managed)', async () => {
    const chatTemplate = '{% for message in messages %}##{{ message.role }}\n{{ message.content }}\n{% endfor %}';
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen2')),
      ggufKV('tokenizer.chat_template', VT.STRING, ggufString(chatTemplate)),
    ];
    const filePath = join(testDir, 'chatml-template.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    // 对话模板检测机制已移除：不再自动建议 chat_template / jinja，默认 none，用户手动选择
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).not.toContain('chat_template');
    expect(keys).not.toContain('jinja');
  });

  it('returns minimal suggestions when only architecture is present', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
    ];
    const filePath = join(testDir, 'minimal.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.suggestions).toEqual([]);
  });

  it('suggests sampling parameters from general.sampling.*', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('general.sampling.temp', VT.FLOAT32, f32(0.7)),
      ggufKV('general.sampling.top_k', VT.UINT32, u32(20)),
      ggufKV('general.sampling.top_p', VT.FLOAT32, f32(0.8)),
      ggufKV('general.sampling.min_p', VT.FLOAT32, f32(0.0)),
    ];
    const filePath = join(testDir, 'sampling.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.sampling_temp).toBeCloseTo(0.7);
    expect(result.info.sampling_top_k).toBe(20);
    expect(result.info.sampling_top_p).toBeCloseTo(0.8);
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).toContain('temperature');
    expect(keys).toContain('top_k');
    expect(keys).toContain('top_p');
    // min_p = 0 不触发建议（> 0 条件）
    expect(keys).not.toContain('min_p');
    const tempSuggestion = result.suggestions.find((s) => s.key === 'temperature');
    expect(tempSuggestion?.value).toBeCloseTo(0.7);
  });

  it('suggests spec_type draft-mtp when nextn_predict_layers > 0', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('qwen35.nextn_predict_layers', VT.UINT32, u32(1)),
    ];
    const filePath = join(testDir, 'mtp.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.nextn_predict_layers).toBe(1);
    const specSuggestion = result.suggestions.find((s) => s.key === 'spec_type');
    expect(specSuggestion?.value).toBe('draft-mtp');
  });

  it('extracts extended metadata fields (organization/license/dataset/etc.)', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.organization', VT.STRING, ggufString('Meta')),
      ggufKV('general.license', VT.STRING, ggufString('MIT')),
      ggufKV('general.license_name', VT.STRING, ggufString('MIT License')),
      ggufKV('general.dataset', VT.STRING, ggufString('RedPajama')),
      ggufKV('general.description', VT.STRING, ggufString('A test model')),
      ggufKV('general.url', VT.STRING, ggufString('https://example.com')),
      ggufKV('tokenizer.ggml.add_bos_token', VT.BOOL, boolVal(true)),
      ggufKV('tokenizer.ggml.add_eos_token', VT.BOOL, boolVal(false)),
    ];
    const filePath = join(testDir, 'extended-meta.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.organization).toBe('Meta');
    expect(result.info.license).toBe('MIT');
    expect(result.info.license_name).toBe('MIT License');
    expect(result.info.dataset).toBe('RedPajama');
    expect(result.info.description).toBe('A test model');
    expect(result.info.url).toBe('https://example.com');
    expect(result.info.add_bos_token).toBe(true);
    expect(result.info.add_eos_token).toBe(false);
  });

  it('extracts expert FFN metadata', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('qwen35.expert_feed_forward_length', VT.UINT32, u32(4096)),
    ];
    const filePath = join(testDir, 'expert-ffn.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.expert_feed_forward_length).toBe(4096);
  });

  it('suggests advanced sampling params from general.sampling.*', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('general.sampling.penalty_last_n', VT.UINT32, u32(256)),
      ggufKV('general.sampling.typical_p', VT.FLOAT32, f32(0.9)),
      ggufKV('general.sampling.mirostat', VT.UINT32, u32(2)),
      ggufKV('general.sampling.mirostat_eta', VT.FLOAT32, f32(0.1)),
      ggufKV('general.sampling.mirostat_tau', VT.FLOAT32, f32(5.0)),
    ];
    const filePath = join(testDir, 'advanced-sampling.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.sampling_penalty_last_n).toBe(256);
    expect(result.info.sampling_typical_p).toBeCloseTo(0.9);
    expect(result.info.sampling_mirostat).toBe(2);
    expect(result.info.sampling_mirostat_eta).toBeCloseTo(0.1);
    expect(result.info.sampling_mirostat_tau).toBeCloseTo(5.0);

    const keys = result.suggestions.map((s) => s.key);
    // repeat_last_n / typical_p / mirostat* 已从应用移除：元数据仍解析进 info，但不产生建议
    expect(keys).not.toContain('repeat_last_n');
    expect(keys).not.toContain('typical_p');
    expect(keys).not.toContain('mirostat');
    expect(keys).not.toContain('mirostat_lr');
    expect(keys).not.toContain('mirostat_ent');
  });

  it('does not suggest typical_p when value is 1.0 (disabled)', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('general.sampling.typical_p', VT.FLOAT32, f32(1.0)),
    ];
    const filePath = join(testDir, 'disabled-sampling.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).not.toContain('typical_p');
  });

  it('does not suggest mirostat when value is 0 (disabled)', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('general.sampling.mirostat', VT.UINT32, u32(0)),
    ];
    const filePath = join(testDir, 'no-mirostat.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).not.toContain('mirostat');
  });

  it('suggests alias from general.name (no quantization)', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('My Model')),
    ];
    const filePath = join(testDir, 'alias.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
    // 未量化时只有 name 部分
    expect(aliasSuggestion?.value).toBe('My Model');
  });

  it('suggests alias as name-size_label-quantization for quantized model', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Qwen2.5')),
      ggufKV('general.size_label', VT.STRING, ggufString('7B')),
      ggufKV('general.file_type', VT.UINT32, u32(12)), // Q4_K
    ];
    const filePath = join(testDir, 'alias-quant.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
    // 量化时格式: "模型名称-大小-量化版本"
    expect(aliasSuggestion?.value).toBe('Qwen2.5-7B-Q4_K');
  });

  it('suggests alias as name-quantization without size_label', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Gemma-2')),
      ggufKV('general.file_type', VT.UINT32, u32(8)), // Q8_0（ggml_type 8 = Q8_0，7 = Q5_1）
    ];
    const filePath = join(testDir, 'alias-no-size.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
    // 无 size_label 时格式: "模型名称-量化版本"
    expect(aliasSuggestion?.value).toBe('Gemma-2-Q8_0');
  });

  it('maps file_type to correct quantization (Q5_0/Q5_1/Q8_0 not shifted)', async () => {
    // 回归：llama.cpp ggml_type 6=Q5_0 7=Q5_1 8=Q8_0。
    // 历史版本把这三档错位（6 显示 Q5_1、7 显示 Q8_0、8 显示 Q5_0），此处锁定正确映射。
    const cases: Array<[number, string]> = [
      [6, 'Q5_0'],
      [7, 'Q5_1'],
      [8, 'Q8_0'],
    ];
    for (const [fileType, expected] of cases) {
      const kvPairs = [
        ggufKV('general.architecture', VT.STRING, ggufString('llama')),
        ggufKV('general.file_type', VT.UINT32, u32(fileType)),
      ];
      const filePath = join(testDir, `quant-${fileType}.gguf`);
      writeFileSync(filePath, buildGgufV3(0, kvPairs));
      const result = await readGgufMetadata(filePath);
      expect(result.info.quantization).toBe(expected);
    }
  });

  it('prefers filename quantization over file_type when they disagree (Q4_K_XL file reports 14=Q6_K)', async () => {
    // 回归：Q4_K_XL 等较新变体的文件元数据 file_type 可能与文件名不一致
    // （如该文件报 14=Q6_K）。展示应以文件名为准，元数据仅作回退。
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Qwen3.8-27B')),
      ggufKV('general.file_type', VT.UINT32, u32(14)), // 元数据报 Q6_K
    ];
    const filePath = join(testDir, 'Qwen3.8-27B-UD-Q4_K_XL.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    // 文件名中的精确量化优先于元数据家族名
    expect(result.info.quantization).toBe('UD-Q4_K_XL');
    // 别名建议同样使用文件名量化
    const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
    expect(aliasSuggestion?.value).toBe('Qwen3.8-27B-UD-Q4_K_XL');
  });

  it('suggests alias with special quantization from filename (Q4_K_XL)', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Muse-Glimmer')),
      ggufKV('general.size_label', VT.STRING, ggufString('30B')),
      ggufKV('general.file_type', VT.UINT32, u32(12)), // Q4_K (base type)
    ];
    // 文件名包含 Q4_K_XL 变体，比 file_type 的 Q4_K 更具体
    const filePath = join(testDir, 'Muse-Glimmer-30B-UD-Q4_K_XL.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
    // 应从文件名提取 "UD-Q4_K_XL"（含 UD- 前缀），而非 file_type 的 "Q4_K"
    expect(aliasSuggestion?.value).toBe('Muse-Glimmer-30B-UD-Q4_K_XL');
  });

  it('suggests alias with IQ quantization from filename', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('TestModel')),
      ggufKV('general.size_label', VT.STRING, ggufString('7B')),
      ggufKV('general.file_type', VT.UINT32, u32(16)), // IQ2_XXS (base type)
    ];
    const filePath = join(testDir, 'TestModel-7B-IQ2_XXS.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
    // 文件名中的 IQ2_XXS 与 file_type 一致，使用文件名版本
    expect(aliasSuggestion?.value).toBe('TestModel-7B-IQ2_XXS');
  });

  it('suggests KV cache quantization for quantized models', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.file_type', VT.UINT32, u32(12)), // Q4_K
    ];
    const filePath = join(testDir, 'quantized.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).toContain('cache_type_k');
    expect(keys).toContain('cache_type_v');
    const cacheKSuggestion = result.suggestions.find((s) => s.key === 'cache_type_k');
    expect(cacheKSuggestion?.value).toBe('q8_0');
  });

  it('does not suggest KV cache quantization for unquantized models', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.file_type', VT.UINT32, u32(1)), // F16
      ggufKV('general.name', VT.STRING, ggufString('F16 Model')),
    ];
    const filePath = join(testDir, 'f16.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).not.toContain('cache_type_k');
    expect(keys).not.toContain('cache_type_v');
  });

  it('suggests flash_attn for large context models', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('llama.context_length', VT.UINT32, u32(32768)),
    ];
    const filePath = join(testDir, 'large-ctx.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const faSuggestion = result.suggestions.find((s) => s.key === 'flash_attn');
    expect(faSuggestion?.value).toBe('on');
  });

  it('does not suggest flash_attn for small context models', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('llama.context_length', VT.UINT32, u32(2048)),
    ];
    const filePath = join(testDir, 'small-ctx.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    const faSuggestion = result.suggestions.find((s) => s.key === 'flash_attn');
    expect(faSuggestion).toBeUndefined();
  });

  it('extracts expert count and SSM fields', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('qwen35.expert_count', VT.UINT32, u32(128)),
      ggufKV('qwen35.expert_used_count', VT.UINT32, u32(8)),
      ggufKV('qwen35.ssm.conv_kernel', VT.UINT32, u32(4)),
      ggufKV('qwen35.ssm.state_size', VT.UINT32, u32(128)),
    ];
    const filePath = join(testDir, 'moe-ssm.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.expert_count).toBe(128);
    expect(result.info.expert_used_count).toBe(8);
    expect(result.info.ssm_conv_kernel).toBe(4);
    expect(result.info.ssm_state_size).toBe(128);
  });

  it('extracts imatrix metadata', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('quantize.imatrix.dataset', VT.STRING, ggufString('/path/to/calib.txt')),
      ggufKV('quantize.imatrix.entries_count', VT.UINT32, u32(496)),
      ggufKV('quantize.imatrix.chunks_count', VT.UINT32, u32(150)),
    ];
    const filePath = join(testDir, 'imatrix.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.imatrix_dataset).toBe('/path/to/calib.txt');
    expect(result.info.imatrix_entries_count).toBe(496);
    expect(result.info.imatrix_chunks_count).toBe(150);
  });

  it('extracts feed_forward_length and attention key/value length', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('qwen35')),
      ggufKV('qwen35.feed_forward_length', VT.UINT32, u32(17408)),
      ggufKV('qwen35.attention.key_length', VT.UINT32, u32(256)),
      ggufKV('qwen35.attention.value_length', VT.UINT32, u32(256)),
      ggufKV('qwen35.attention.layer_norm_rms_epsilon', VT.FLOAT32, f32(1e-6)),
    ];
    const filePath = join(testDir, 'attn-detail.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.feed_forward_length).toBe(17408);
    expect(result.info.attention_key_length).toBe(256);
    expect(result.info.attention_value_length).toBe(256);
    expect(result.info.attention_layer_norm_rms_epsilon).toBeCloseTo(1e-6);
  });

  it('handles boolean and int metadata values', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('custom.bool_true', VT.BOOL, boolVal(true)),
      ggufKV('custom.bool_false', VT.BOOL, boolVal(false)),
      ggufKV('custom.int8', VT.INT8, Buffer.from([-5 & 0xff])), // -5 as int8
      ggufKV('custom.uint8', VT.UINT8, u8(200)),
      ggufKV('custom.int32', VT.INT32, i32(-123456)),
    ];
    const filePath = join(testDir, 'types.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.metadata['custom.bool_true']).toBe(true);
    expect(result.info.metadata['custom.bool_false']).toBe(false);
    expect(result.info.metadata['custom.int8']).toBe(-5);
    expect(result.info.metadata['custom.uint8']).toBe(200);
    expect(result.info.metadata['custom.int32']).toBe(-123456);
  });

  it('skips array metadata without loading it into memory', async () => {
    // 构建一个字符串数组: type=STRING, count=2, ["hello", "world"]
    const arrType = u32(VT.STRING);
    const arrLen = u64(2);
    const arrValue = Buffer.concat([ggufString('hello'), ggufString('world')]);
    const arrBuf = Buffer.concat([arrType, arrLen, arrValue]);

    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('tokenizer.ggml.tokens', VT.ARRAY, arrBuf),
      // 后续 KV 仍可正常读取，证明跳过后游标正确
      ggufKV('general.name', VT.STRING, ggufString('After Array')),
    ];
    const filePath = join(testDir, 'array.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    // 数组被跳过，存储为 null
    expect(result.info.metadata['tokenizer.ggml.tokens']).toBeNull();
    // 跳过数组后的 KV 仍可正常读取
    expect(result.info.name).toBe('After Array');
  });

  it('skips large fixed-size arrays efficiently', async () => {
    // 构建一个大的 float32 数组（模拟 tokenizer scores）
    const arrType = u32(VT.FLOAT32);
    const arrLen = u64(100000); // 10万元素 = 400KB
    const arrData = Buffer.allocUnsafe(100000 * 4);
    for (let i = 0; i < 100000; i++) {
      arrData.writeFloatLE(i * 0.1, i * 4);
    }
    const arrBuf = Buffer.concat([arrType, arrLen, arrData]);

    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('tokenizer.ggml.scores', VT.ARRAY, arrBuf),
      ggufKV('general.name', VT.STRING, ggufString('Large Array Model')),
    ];
    const filePath = join(testDir, 'large-array.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.metadata['tokenizer.ggml.scores']).toBeNull();
    expect(result.info.name).toBe('Large Array Model');
  });

  it('throws for non-GGUF file', async () => {
    const filePath = join(testDir, 'not-gguf.gguf');
    writeFileSync(filePath, 'This is not a GGUF file'.repeat(10));

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/Not a GGUF file/);
  });

  it('throws for too-small file', async () => {
    const filePath = join(testDir, 'tiny.gguf');
    writeFileSync(filePath, 'GGUF');

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/too small/);
  });

  it('throws for non-existent file', async () => {
    await expect(readGgufMetadata(join(testDir, 'missing.gguf'))).rejects.toThrow(/Cannot access/);
  });

  it('handles unknown file_type gracefully', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.file_type', VT.UINT32, u32(99)),
    ];
    const filePath = join(testDir, 'unknown-quant.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.quantization).toBe('type_99');
  });

  it('handles model with no architecture', async () => {
    const kvPairs = [
      ggufKV('general.name', VT.STRING, ggufString('No Arch')),
    ];
    const filePath = join(testDir, 'no-arch.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.architecture).toBe('');
    expect(result.info.context_length).toBeNull();
    // 有 general.name 仍会生成 alias 建议
    const keys = result.suggestions.map((s) => s.key);
    expect(keys).toContain('alias');
  });

  it('correctly reads large context_length as uint64', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('llama.context_length', VT.UINT64, u64(131072)),
    ];
    const filePath = join(testDir, 'uint64-ctx.gguf');
    writeFileSync(filePath, buildGgufV3(0, kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.context_length).toBe(131072);
  });

  it('reads GGUF v2 format with uint64 counts', async () => {
    // GGUF v2 与 v3 的主要区别在于版本号，但计数格式相同
    const magic = Buffer.alloc(4);
    magic.writeUInt32LE(0x46554747);
    const version = Buffer.alloc(4);
    version.writeUInt32LE(2);
    const tensorCount = u64(0);
    const kvCount = u64(2);
    const kv1 = ggufKV('general.architecture', VT.STRING, ggufString('gemma'));
    const kv2 = ggufKV('gemma.context_length', VT.UINT32, u32(8192));
    const buf = Buffer.concat([magic, version, tensorCount, kvCount, kv1, kv2]);

    const filePath = join(testDir, 'v2.gguf');
    writeFileSync(filePath, buf);

    const result = await readGgufMetadata(filePath);
    expect(result.info.version).toBe(2);
    expect(result.info.architecture).toBe('gemma');
    expect(result.info.context_length).toBe(8192);
  });
});

describe('estimateQuantFromSize（元数据尺寸一致性校验）', () => {
  it('元数据量化与文件尺寸吻合时不覆盖', () => {
    // 52 层 / 6656 嵌入 / 19968 FFN（Muse-Glimmer 类结构）
    const params = estimateModelParams(52, 6656, 19968, null);
    expect(params).toBeGreaterThan(1e9);
    // 实际 0.55 字节/参数，元数据声称 Q4_K(0.55) → 吻合，不覆盖
    expect(estimateQuantFromSize(Math.round(params * 0.55), params, 'Q4_K')).toBeNull();
    // 实际 1.04 字节/参数，元数据 Q8_K → 吻合
    expect(estimateQuantFromSize(Math.round(params * 1.04), params, 'Q8_K')).toBeNull();
  });

  it('元数据 Q8_K 但文件实际仅 ~0.71 字节/参数时修正为 Q5_K（同家族内）', () => {
    const params = estimateModelParams(52, 6656, 19968, null);
    // 对应 D:\LLMmodels 的 muse-glimmer-30B-kquant-17gb.gguf（16.75GB / ~23.5B 参数）
    const sizeQuant = estimateQuantFromSize(Math.round(params * 0.71), params, 'Q8_K');
    expect(sizeQuant).toBe('Q5_K');
  });

  it('修正候选限定在同一家族内（k-quant 不会被误标为 legacy Q4_0）', () => {
    const params = estimateModelParams(32, 4096, 14336, null);
    // 元数据声称 Q2_K(0.3)，实际 ~0.55 字节/参数（Q4_K 级）：k-quant 家族内最接近 Q4_K，
    // 而非 legacy 的 Q4_0（避免跨家族误判）
    expect(estimateQuantFromSize(Math.round(params * 0.55), params, 'Q2_K')).toBe('Q4_K');
  });

  it('缺失关键超参或未知元数据量化时返回 null（跳过校验）', () => {
    expect(estimateModelParams(null, null, null, null)).toBe(0);
    expect(estimateQuantFromSize(1e9, 0, 'Q8_K')).toBeNull();
    expect(estimateQuantFromSize(1e9, 100, 'type_15')).toBeNull();
    expect(estimateQuantFromSize(1e9, 100, 'unknown')).toBeNull();
  });
});

describe('nameContainsLabel（别名 size_label/量化去重）', () => {
  it('模型名已含尺寸标签时判定为已包含（Qwen3.8-27B 含 27B）', () => {
    expect(nameContainsLabel('Qwen3.8-27B', '27B')).toBe(true);
    expect(nameContainsLabel('Qwen2.5-7B-Instruct', '7B')).toBe(true);
  });

  it('尺寸标签须为独立词元（Qwen3.6-35B-A3B 中的 3B 不算）', () => {
    expect(nameContainsLabel('Qwen3.6-35B-A3B', '3B')).toBe(false);
    expect(nameContainsLabel('Qwen3.6-35B-A3B', '35B')).toBe(true);
  });

  it('量化标签去重与大小写不敏感', () => {
    expect(nameContainsLabel('MyModel-Q4_K_M', 'Q4_K_M')).toBe(true);
    expect(nameContainsLabel('MyModel-q4_k_m', 'Q4_K_M')).toBe(true);
    expect(nameContainsLabel('MyModel', 'Q4_K_M')).toBe(false);
  });

  it('别名建议不重复拼接模型名已含的 size_label', async () => {
    // 回归：Qwen3.8-27B（名称已含 27B）+ size_label 27B → 别名不应出现 "27B-27B"
    const localDir = mkdtempSync(join(tmpdir(), 'gguf-alias-'));
    try {
      const kvPairs = [
        ggufKV('general.architecture', VT.STRING, ggufString('llama')),
        ggufKV('general.name', VT.STRING, ggufString('Qwen3.8-27B')),
        ggufKV('general.size_label', VT.STRING, ggufString('27B')),
        ggufKV('general.file_type', VT.UINT32, u32(14)),
      ];
      const filePath = join(localDir, 'Qwen3.8-27B-UD-Q4_K_XL.gguf');
      writeFileSync(filePath, buildGgufV3(0, kvPairs));

      const result = await readGgufMetadata(filePath);
      const aliasSuggestion = result.suggestions.find((s) => s.key === 'alias');
      expect(aliasSuggestion?.value).toBe('Qwen3.8-27B-UD-Q4_K_XL');
    } finally {
      rmSync(localDir, { recursive: true, force: true });
    }
  });
});