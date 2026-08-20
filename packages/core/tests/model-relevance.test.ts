import { describe, it, expect } from 'vitest';
import {
  categorizeFile,
  scoreRelevance,
  recommendFileName,
  sortFilesByRelevance,
  parseQuantization,
} from '@llama-launcher/shared';

describe('categorizeFile', () => {
  it('按扩展名分类', () => {
    expect(categorizeFile('a.gguf')).toBe('gguf');
    expect(categorizeFile('b.safetensors')).toBe('safetensors');
    expect(categorizeFile('c.bin')).toBe('bin');
    expect(categorizeFile('d.txt')).toBe('other');
    expect(categorizeFile('E.GGUF')).toBe('gguf');
  });
});

describe('scoreRelevance', () => {
  it('精确文件名匹配得分最高(=1)', () => {
    const files = ['qwen3-4b-fp8.safetensors', 'qwen3-4b-fp16.safetensors', 'readme.md'];
    const s = files.map((f) => scoreRelevance(f, 'qwen3-4b-fp8.safetensors'));
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[0]).toBe(1);
  });

  it('与模型名部分相关时也有得分', () => {
    const s = scoreRelevance('qwen3-4b-fp8.safetensors', 'Qwen3-4B');
    expect(s).toBeGreaterThan(0);
  });
});

describe('recommendFileName', () => {
  const files = [
    { name: 'qwen3-4b-fp8.safetensors' },
    { name: 'qwen3-4b-fp16.safetensors' },
    { name: 'config.json' },
  ];

  it('优先精确匹配尾部文件名', () => {
    expect(recommendFileName(files, 'qwen3-4b-fp8.safetensors')).toBe(
      'qwen3-4b-fp8.safetensors',
    );
  });

  it('无精确匹配时返回相关性最高的文件', () => {
    const rec = recommendFileName(files, 'Qwen3-4B');
    expect(rec).toContain('qwen3-4b');
  });

  it('空关键词返回 null', () => {
    expect(recommendFileName(files, '')).toBeNull();
  });
});

describe('sortFilesByRelevance', () => {
  // 构造可推荐文件(含 category / quantization 以启用多因子评分)
  const mk = (name: string, category: 'gguf' | 'safetensors' | 'bin' | 'other', quantLabel: string | null) => ({
    name,
    size: 0,
    category,
    quantization: quantLabel ? parseQuantization(name) : null,
  });

  it('精确匹配文件名排在最前', () => {
    const files = [
      mk('config.json', 'other', null),
      mk('qwen3-4b-fp8.safetensors', 'safetensors', 'FP8'),
      mk('qwen3-4b-fp16.safetensors', 'safetensors', 'FP16'),
    ];
    const sorted = sortFilesByRelevance(files, 'qwen3-4b-fp8.safetensors');
    expect(sorted[0].name).toBe('qwen3-4b-fp8.safetensors');
  });

  it('部分匹配时相关性高的文件排在前面', () => {
    const files = [
      mk('readme.md', 'other', null),
      mk('qwen3-4b-q4_k_m.gguf', 'gguf', 'Q4_K_M'),
      mk('llama2-7b-q4_k_m.gguf', 'gguf', 'Q4_K_M'),
    ];
    // 关键词 qwen3-4b:qwen3-4b 文件相关性高于 llama2-7b
    const sorted = sortFilesByRelevance(files, 'qwen3-4b');
    expect(sorted[0].name).toBe('qwen3-4b-q4_k_m.gguf');
    // 无关文件(readme)应排在最后
    expect(sorted[sorted.length - 1].name).toBe('readme.md');
  });

  it('同分时保持原始顺序(稳定排序)', () => {
    // 两个完全无关的文件,得分相同(均无量化、类别 other)
    const files = [
      { name: 'aaa.txt', size: 0, category: 'other' as const, quantization: null },
      { name: 'bbb.txt', size: 0, category: 'other' as const, quantization: null },
    ];
    const sorted = sortFilesByRelevance(files, 'qwen3');
    expect(sorted[0].name).toBe('aaa.txt');
    expect(sorted[1].name).toBe('bbb.txt');
  });

  it('不修改原数组', () => {
    const files = [
      mk('a.gguf', 'gguf', 'Q4_K_M'),
      mk('b.safetensors', 'safetensors', 'FP8'),
    ];
    const original = files.map((f) => f.name);
    sortFilesByRelevance(files, 'b');
    expect(files.map((f) => f.name)).toEqual(original);
  });

  it('空关键词时按类别+量化偏好排序(GGUF Q4_K_M 优先)', () => {
    const files = [
      mk('model-fp32.safetensors', 'safetensors', 'FP32'),
      mk('model-q4_k_m.gguf', 'gguf', 'Q4_K_M'),
      mk('readme.md', 'other', null),
    ];
    const sorted = sortFilesByRelevance(files, '');
    // GGUF Q4_K_M 得分最高(类别偏好 1.0 + 量化偏好 1.0)
    expect(sorted[0].name).toBe('model-q4_k_m.gguf');
  });
});

describe('parseQuantization', () => {
  it('解析 K-quants 带尺寸后缀', () => {
    expect(parseQuantization('qwen3-4b-instruct-Q4_K_M.gguf')).toEqual({
      label: 'Q4_K_M',
      bits: 4,
      family: 'k-quants',
    });
    expect(parseQuantization('model-Q3_K_S.gguf')).toEqual({
      label: 'Q3_K_S',
      bits: 3,
      family: 'k-quants',
    });
    expect(parseQuantization('model-Q5_K_L.gguf')).toEqual({
      label: 'Q5_K_L',
      bits: 5,
      family: 'k-quants',
    });
  });

  it('解析 K-quants XL 变体（较新格式，如 Q4_K_XL）', () => {
    expect(parseQuantization('Qwen3.8-27B-UD-Q4_K_XL.gguf')).toEqual({
      label: 'Q4_K_XL',
      bits: 4,
      family: 'k-quants',
    });
    expect(parseQuantization('model-Q6_K_XL.gguf')).toEqual({
      label: 'Q6_K_XL',
      bits: 6,
      family: 'k-quants',
    });
    // 回归：Q8_K_XL 与裸 Q8_K 也应识别（此前 [2-6] 区间漏掉 Q8）
    expect(parseQuantization('Qwen3.8-27B-UD-Q8_K_XL.gguf')).toEqual({
      label: 'Q8_K_XL',
      bits: 8,
      family: 'k-quants',
    });
    expect(parseQuantization('model-Q8_K.gguf')).toEqual({
      label: 'Q8_K',
      bits: 8,
      family: 'k-quants',
    });
  });

  it('解析 K-quants 不带尺寸后缀', () => {
    expect(parseQuantization('model-Q2_K.gguf')).toEqual({
      label: 'Q2_K',
      bits: 2,
      family: 'k-quants',
    });
    expect(parseQuantization('model-Q6_K.gguf')).toEqual({
      label: 'Q6_K',
      bits: 6,
      family: 'k-quants',
    });
  });

  it('解析 I-quants', () => {
    expect(parseQuantization('model-IQ3_XS.gguf')).toEqual({
      label: 'IQ3_XS',
      bits: 3,
      family: 'i-quants',
    });
    expect(parseQuantization('model-IQ2_XXS.gguf')).toEqual({
      label: 'IQ2_XXS',
      bits: 2,
      family: 'i-quants',
    });
    expect(parseQuantization('model-IQ4_NL.gguf')).toEqual({
      label: 'IQ4_NL',
      bits: 4,
      family: 'i-quants',
    });
  });

  it('解析 Legacy 量化', () => {
    expect(parseQuantization('model-Q4_0.gguf')).toEqual({
      label: 'Q4_0',
      bits: 4,
      family: 'legacy',
    });
    expect(parseQuantization('model-Q8_0.gguf')).toEqual({
      label: 'Q8_0',
      bits: 8,
      family: 'legacy',
    });
    expect(parseQuantization('model-Q5_1.gguf')).toEqual({
      label: 'Q5_1',
      bits: 5,
      family: 'legacy',
    });
  });

  it('解析浮点格式 FP8/BF16/FP16/FP32', () => {
    expect(parseQuantization('qwen_3_4b_fp8_mixed.safetensors')).toEqual({
      label: 'FP8',
      bits: 8,
      family: 'fp8',
    });
    expect(parseQuantization('model-bf16.safetensors')).toEqual({
      label: 'BF16',
      bits: 16,
      family: 'bf16',
    });
    expect(parseQuantization('model-fp16.safetensors')).toEqual({
      label: 'FP16',
      bits: 16,
      family: 'fp16',
    });
    expect(parseQuantization('model-f16.gguf')).toEqual({
      label: 'F16',
      bits: 16,
      family: 'fp16',
    });
    expect(parseQuantization('model-f32.gguf')).toEqual({
      label: 'F32',
      bits: 32,
      family: 'fp32',
    });
  });

  it('解析 FP8 变体（e4m3/e5m2）', () => {
    const r = parseQuantization('model-fp8_e4m3.safetensors');
    expect(r?.family).toBe('fp8');
    expect(r?.bits).toBe(8);
    expect(r?.label).toContain('FP8');
  });

  it('解析整数格式 INT4/INT8', () => {
    expect(parseQuantization('model-int4.bin')).toEqual({
      label: 'INT4',
      bits: 4,
      family: 'int',
    });
    expect(parseQuantization('model-int8.bin')).toEqual({
      label: 'INT8',
      bits: 8,
      family: 'int',
    });
  });

  it('非量化文件返回 null', () => {
    expect(parseQuantization('config.json')).toBeNull();
    expect(parseQuantization('tokenizer.model')).toBeNull();
    expect(parseQuantization('README.md')).toBeNull();
    expect(parseQuantization('')).toBeNull();
  });

  it('不误匹配模型名中的数字（如 Qwen3-4B）', () => {
    // Qwen3 中的 "q3" 不应被识别为 Q3 量化
    expect(parseQuantization('Qwen3-4B-Instruct.safetensors')).toBeNull();
  });

  it('标签统一大写', () => {
    const r = parseQuantization('model-q4_k_m.gguf');
    expect(r?.label).toBe('Q4_K_M');
  });
});
