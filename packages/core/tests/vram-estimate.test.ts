import { describe, it, expect } from 'vitest';
import { kvLayersOf, kvBytesPerTokenOf, estimateVram, KV_DTYPE_BYTES, COMPUTE_RESERVE_MIB } from '../src/vram-estimate.js';
import type { GgufModelInfo } from '@llama-launcher/shared';

const MIB = 1024 * 1024;

/** 构造最小 GgufModelInfo（仅填估算相关字段，其余置空）。 */
function makeInfo(overrides: Partial<GgufModelInfo> = {}): GgufModelInfo {
  return {
    path: '',
    version: 3,
    tensor_count: 0,
    metadata_kv_count: 0,
    metadata: {},
    architecture: 'llama',
    name: '',
    quantization: '',
    file_type: null,
    quantization_version: null,
    type: 'model',
    finetune: null,
    basename: null,
    size_label: null,
    context_length: 32768,
    embedding_length: null,
    feed_forward_length: null,
    block_count: 64,
    attention_head_count: 32,
    attention_head_count_kv: 8,
    attention_key_length: 128,
    attention_value_length: 128,
    attention_layer_norm_rms_epsilon: null,
    expert_count: null,
    expert_used_count: null,
    nextn_predict_layers: null,
    full_attention_interval: null,
    ssm_conv_kernel: null,
    ssm_state_size: null,
    ssm_group_count: null,
    rope_freq_base: null,
    tokenizer_model: null,
    tokenizer_pre: null,
    chat_template: null,
    bos_token_id: null,
    eos_token_id: null,
    padding_token_id: null,
    sampling_temp: null,
    sampling_top_k: null,
    sampling_top_p: null,
    sampling_min_p: null,
    sampling_repeat_penalty: null,
    sampling_presence_penalty: null,
    imatrix_dataset: null,
    imatrix_entries_count: null,
    imatrix_chunks_count: null,
    organization: null,
    license: null,
    license_name: null,
    dataset: null,
    description: null,
    url: null,
    add_bos_token: null,
    add_eos_token: null,
    expert_feed_forward_length: null,
    sampling_penalty_last_n: null,
    sampling_typical_p: null,
    sampling_mirostat: null,
    sampling_mirostat_eta: null,
    sampling_mirostat_tau: null,
    ...overrides,
  };
}

describe('kvLayersOf', () => {
  it('dense model: all blocks carry KV', () => {
    expect(kvLayersOf(makeInfo({ block_count: 64 }))).toBe(64);
  });

  it('hybrid model: every full_attention_interval-th layer carries KV (ceil)', () => {
    // Qwen3.6-35B：41 层 / 间隔 4 → 11 个全注意力层
    expect(kvLayersOf(makeInfo({ block_count: 41, full_attention_interval: 4 }))).toBe(11);
  });

  it('returns null when block_count is missing', () => {
    expect(kvLayersOf(makeInfo({ block_count: null }))).toBeNull();
  });
});

describe('kvBytesPerTokenOf', () => {
  it('computes 2 × layers × kv_heads × key_length × dtype_bytes', () => {
    // 2 × 64 × 8 × 128 × 2 = 262144 B/token（dense, f16）
    expect(kvBytesPerTokenOf(makeInfo(), KV_DTYPE_BYTES.f16)).toBe(262144);
  });

  it('falls back to head_count when head_count_kv is missing (non-GQA)', () => {
    const info = makeInfo({ attention_head_count_kv: null, block_count: 8, attention_head_count: 8 });
    expect(kvBytesPerTokenOf(info, KV_DTYPE_BYTES.f16)).toBe(2 * 8 * 8 * 128 * 2);
  });

  it('falls back to 128 key_length when missing', () => {
    const info = makeInfo({ attention_key_length: null, block_count: 4, attention_head_count_kv: 4 });
    expect(kvBytesPerTokenOf(info, KV_DTYPE_BYTES.f16)).toBe(2 * 4 * 4 * 128 * 2);
  });

  it('returns null when heads are unavailable', () => {
    const info = makeInfo({ attention_head_count: null, attention_head_count_kv: null });
    expect(kvBytesPerTokenOf(info, KV_DTYPE_BYTES.f16)).toBeNull();
  });
});

describe('estimateVram', () => {
  // 场景：19.5 GiB 权重、23.2 GiB 空闲、64 层全注意力、q8_0（136 KB/token）
  // KV/token = 2 × 64 × 8 × 128 × 1.0625 = 139264 B
  const q8 = KV_DTYPE_BYTES.q8_0;
  const scenario = {
    info: makeInfo({ context_length: 32768 }),
    fileSizeBytes: 19968 * MIB,
    freeBytes: 23749 * MIB,
    dtypeBytes: q8,
  };

  it('computes weights, kv layers and per-token bytes', () => {
    const est = estimateVram(scenario);
    expect(est.weightsMiB).toBeCloseTo(19968, 0);
    expect(est.kvLayers).toBe(64);
    expect(est.kvBytesPerToken).toBe(139264);
  });

  it('clamps max context to trained max when memory is ample', () => {
    const est = estimateVram(scenario);
    // 预算 = 23749 − 19968 − 1024 = 2757 MiB → ~20880 token，低于训练上限 32768
    expect(est.maxContext).toBe(20480);
    expect(est.fullOffloadFits).toBe(true);
  });

  it('clamps max context to memory budget when trained max is higher', () => {
    const est = estimateVram({ ...scenario, info: makeInfo({ context_length: 262144 }) });
    expect(est.maxContext).toBe(20480);
  });

  it('rounds max context down to 1024 granularity', () => {
    const est = estimateVram(scenario);
    expect(est.maxContext! % 1024).toBe(0);
  });

  it('reports no-fit when weights exceed free memory (context = 0)', () => {
    const est = estimateVram({ ...scenario, freeBytes: 18000 * MIB });
    expect(est.maxContext).toBe(0);
    expect(est.fullOffloadFits).toBe(false);
  });

  it('returns nulls when inputs are missing (graceful degradation)', () => {
    const est = estimateVram({ ...scenario, fileSizeBytes: null, freeBytes: null });
    expect(est.weightsMiB).toBeNull();
    expect(est.maxContext).toBeNull();
    expect(est.fullOffloadFits).toBeNull();
  });

  it('hybrid model needs far less KV memory per token', () => {
    const hybrid = makeInfo({ block_count: 41, full_attention_interval: 4, attention_head_count_kv: 2, attention_key_length: 256, context_length: 262144 });
    const est = estimateVram({ info: hybrid, fileSizeBytes: 19000 * MIB, freeBytes: 23749 * MIB, dtypeBytes: q8 });
    // 2 × 11 × 2 × 256 × 1.0625 = 11968 B/token → 256K 混合架构轻松可达（同规模稠密模型为 10 倍以上）
    expect(est.kvBytesPerToken).toBe(11968);
    expect(est.maxContext).toBe(262144);
  });
});

import { estimateOccupancy } from '../src/vram-estimate.js';

describe('estimateOccupancy', () => {
  // 64 层稠密模型：权重 19.5 GiB，f16 KV 262144 B/token，训练上限 32768
  const base = {
    info: makeInfo(),
    fileSizeBytes: 19968 * MIB,
    deviceFreeMiB: 23749,
    deviceTotalMiB: 24560,
    systemTotalMiB: 32768,
    systemFreeMiB: 21000,
    ngl: 'all',
    ctxSize: 32768,
    kvDtype: 'f16',
  };

  it('full offload: vram = weights + kv + reserve, over free → fits false', () => {
    const o = estimateOccupancy(base);
    expect(o.offloadLayers).toBe(64);
    expect(o.contextTokens).toBe(32768);
    expect(o.vram.weightsMiB).toBeCloseTo(19968, 0);
    expect(o.vram.kvMiB).toBe(8192); // 262144 B × 32768 / MiB
    expect(o.vram.totalMiB).toBe(19968 + 8192 + 1024);
    expect(o.vram.fits).toBe(false); // 29184 > 23749
    expect(o.ram.weightsMiB).toBe(0);
    expect(o.ram.totalMiB).toBe(512);
    expect(o.ram.fits).toBe(true);
  });

  it('partial offload splits weights and KV between VRAM and RAM', () => {
    const o = estimateOccupancy({ ...base, ngl: '32' });
    expect(o.offloadLayers).toBe(32);
    expect(o.vram.weightsMiB).toBeCloseTo(9984, 0);
    expect(o.vram.kvMiB).toBe(4096);
    expect(o.vram.fits).toBe(true); // 9984 + 4096 + 1024 = 15104 ≤ 23749
    expect(o.ram.weightsMiB).toBeCloseTo(9984, 0);
    expect(o.ram.kvMiB).toBe(4096);
    expect(o.ram.totalMiB).toBe(9984 + 4096 + 512);
  });

  it('auto mode: engine-fit assumption — all layers when weights fit', () => {
    const o = estimateOccupancy({ ...base, ngl: 'auto', kvDtype: 'q8_0' });
    expect(o.offloadLayers).toBe(64);
  });

  it('ctx 0 resolves to trained max for contextTokens', () => {
    const o = estimateOccupancy({ ...base, ctxSize: 0 });
    expect(o.contextTokens).toBe(32768);
  });

  it('missing device info degrades to nulls', () => {
    const o = estimateOccupancy({ ...base, deviceFreeMiB: null, deviceTotalMiB: null, ngl: 'auto' });
    expect(o.offloadLayers).toBeNull();
    expect(o.vram.totalMiB).toBeNull();
    expect(o.vram.fits).toBeNull();
  });

  it('hybrid model carries far less KV on GPU', () => {
    const hybrid = estimateOccupancy({
      ...base,
      info: makeInfo({ block_count: 41, full_attention_interval: 4, attention_head_count_kv: 2, attention_key_length: 256 }),
      fileSizeBytes: 10840 * MIB,
      ngl: 'all',
      kvDtype: 'q8_0',
    });
    // 2 × 11 × 2 × 256 × 1.0625 = 11968 B/token × 32768 ≈ 374 MiB（同规模稠密为 8192 MiB）
    expect(hybrid.vram.kvMiB).toBeCloseTo(374, 0);
    expect(hybrid.vram.fits).toBe(true);
  });
});
