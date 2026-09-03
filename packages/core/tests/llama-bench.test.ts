import { describe, it, expect } from 'vitest';
import { parseLlamaBenchJson, summarizeBenchRows } from '../src/llama-bench.js';

// 真实 llama-bench -o json 输出样本（b10734，Qwen3.6-35B IQ1_M，pp64/n32/r1，节选字段）
const REAL_JSON = JSON.stringify([
  {
    build_commit: 'd5d993a09', build_number: 10734, backends: 'Vulkan',
    model_filename: 'D:/LLMmodels/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-IQ1_M.gguf',
    model_type: 'qwen35moe 35B.A3B IQ1_M - 1.75 bpw', model_size: 11355423232,
    n_gpu_layers: 99, type_k: 'f16', type_v: 'f16',
    n_prompt: 64, n_gen: 0, n_depth: 0,
    avg_ns: 73733800, stddev_ns: 0, avg_ts: 867.987273, stddev_ts: 0.0,
  },
  {
    build_commit: 'd5d993a09', build_number: 10734, backends: 'Vulkan',
    model_filename: 'D:/LLMmodels/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-IQ1_M.gguf',
    model_type: 'qwen35moe 35B.A3B IQ1_M - 1.75 bpw', model_size: 11355423232,
    n_gpu_layers: 99, type_k: 'f16', type_v: 'f16',
    n_prompt: 0, n_gen: 32, n_depth: 0,
    avg_ns: 190863400, stddev_ns: 0, avg_ts: 167.659174, stddev_ts: 0.0,
  },
]);

const MODEL_PATH = 'D:/LLMmodels/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-IQ1_M.gguf';

describe('parseLlamaBenchJson', () => {
  it('parses real llama-bench JSON output', () => {
    const rows = parseLlamaBenchJson(REAL_JSON);
    expect(rows).toHaveLength(2);
    expect(rows[0].n_prompt).toBe(64);
    expect(rows[1].n_gen).toBe(32);
  });

  it('returns empty array for invalid JSON / non-array / malformed rows', () => {
    expect(parseLlamaBenchJson('not json')).toEqual([]);
    expect(parseLlamaBenchJson('{"a":1}')).toEqual([]);
    expect(parseLlamaBenchJson('[{"n_prompt": "x"}]')).toEqual([]);
  });
});

describe('summarizeBenchRows', () => {
  it('maps pp row (n_prompt>0, n_gen=0) and tg row (n_prompt=0, n_gen>0)', () => {
    const summary = summarizeBenchRows(MODEL_PATH, parseLlamaBenchJson(REAL_JSON));
    expect(summary.modelPath).toBe(MODEL_PATH);
    expect(summary.ppTokS).toBeCloseTo(867.987273);
    expect(summary.tgTokS).toBeCloseTo(167.659174);
    expect(summary.ngl).toBe(99);
    expect(summary.backend).toBe('Vulkan');
    expect(summary.modelType).toContain('qwen35moe');
    expect(summary.testedAt).toBeTruthy();
  });

  it('yields null speeds when the corresponding test is missing', () => {
    const ppOnly = parseLlamaBenchJson(JSON.stringify([JSON.parse(REAL_JSON)[0]]));
    const summary = summarizeBenchRows(MODEL_PATH, ppOnly);
    expect(summary.ppTokS).not.toBeNull();
    expect(summary.tgTokS).toBeNull();
  });
});
