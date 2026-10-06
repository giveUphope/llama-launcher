import { describe, it, expect } from 'vitest';
import { recommendForTarget, recommendOffloadAdvice } from '../src/target-recommend.js';
import { PARAMS } from '@llama-launcher/shared';
import type { DeviceMemInfo, GgufModelInfo } from '@llama-launcher/shared';

/** 参数表里真实存在的 key 集合：建议只准引用这些（§5.6 第 3 项的硬约束） */
const PARAM_KEYS = new Set(PARAMS.map((p) => p.key));

/** 混合架构模型（Qwen3.6-35B 形态：262K 训练上限、MTP 头、MoE、KV 极小） */
const HYBRID: GgufModelInfo = {
  path: '', version: 3, tensor_count: 0, metadata_kv_count: 0, metadata: {},
  architecture: 'qwen35moe', name: 'Qwen3.6-35B-A3B', quantization: 'IQ1_M', file_type: 31,
  quantization_version: 2, type: 'model', finetune: null, basename: null,
  size_label: '35B-A3B', context_length: 262144, embedding_length: 2048,
  feed_forward_length: null, block_count: 41, attention_head_count: 16,
  attention_head_count_kv: 2, attention_key_length: 256, attention_value_length: 256,
  attention_layer_norm_rms_epsilon: null, expert_count: 256, expert_used_count: 8,
  nextn_predict_layers: 1, full_attention_interval: 4, ssm_conv_kernel: null,
  ssm_state_size: null, ssm_group_count: null, rope_freq_base: null,
  tokenizer_model: null, tokenizer_pre: null, chat_template: null,
  bos_token_id: null, eos_token_id: null, padding_token_id: null,
  sampling_temp: null, sampling_top_k: null, sampling_top_p: null, sampling_min_p: null,
  sampling_repeat_penalty: null, sampling_presence_penalty: null,
  imatrix_dataset: null, imatrix_entries_count: null, imatrix_chunks_count: null,
  organization: null, license: null, license_name: null, dataset: null,
  description: null, url: null, add_bos_token: null, add_eos_token: null,
  expert_feed_forward_length: null, sampling_penalty_last_n: null,
  sampling_typical_p: null, sampling_mirostat: null, sampling_mirostat_eta: null,
  sampling_mirostat_tau: null,
};

/** 稠密模型（64 层、GQA 8 KV 头、f16 KV 262144 B/token，无 MTP） */
const DENSE: GgufModelInfo = {
  ...HYBRID,
  architecture: 'qwen3', block_count: 64, attention_head_count: 32,
  attention_head_count_kv: 8, attention_key_length: 128, attention_value_length: 128,
  expert_count: null, expert_used_count: null, nextn_predict_layers: null,
  full_attention_interval: null, context_length: 32768,
};

const FILE_HYBRID = 10840 * 1024 * 1024; // 10.8 GiB
const FILE_DENSE = 19968 * 1024 * 1024; // 19.5 GiB
const FREE_MIB = 23749; // 7900 XTX 空闲
const SYS_FREE_MIB = 21000; // 系统可用内存

function keys(recs: ReturnType<typeof recommendForTarget>): string[] {
  return recs.map((r) => r.key);
}

describe('recommendForTarget', () => {
  it('max-context (hybrid): KV q8_0，全卸载即可达训练上限 262K', () => {
    // 23749−1024−10840 = 11885 MiB ÷ 0.0114 MiB/token ≈ 104 万 → 训练上限封顶，无需部分卸载
    const recs = recommendForTarget('max-context', HYBRID, FILE_HYBRID, FREE_MIB, SYS_FREE_MIB);
    expect(recs.find((r) => r.key === 'cache_type_k')?.value).toBe('q8_0');
    expect(recs.find((r) => r.key === 'ctx_size')?.value).toBe(262144);
    expect(keys(recs)).not.toContain('gpu_layers');
    expect(keys(recs)).not.toContain('spec_type');
  });

  it('balanced (hybrid): q8_0 全卸载 262K + MTP 建议', () => {
    const recs = recommendForTarget('balanced', HYBRID, FILE_HYBRID, FREE_MIB, SYS_FREE_MIB);
    expect(recs.find((r) => r.key === 'ctx_size')?.value).toBe(262144);
    expect(recs.find((r) => r.key === 'spec_type')?.value).toBe('draft-mtp');
  });

  it('latency (hybrid): f16 全卸载仍可达 262K + MTP', () => {
    // 混合架构 KV 极小：f16 下预算依然充裕
    const recs = recommendForTarget('latency', HYBRID, FILE_HYBRID, FREE_MIB, SYS_FREE_MIB);
    expect(recs.find((r) => r.key === 'cache_type_k')?.value).toBe('f16');
    expect(recs.find((r) => r.key === 'ctx_size')?.value).toBe(262144);
    expect(recs.find((r) => r.key === 'spec_type')?.value).toBe('draft-mtp');
  });

  it('memory (hybrid): q4_0 KV，全卸载 262K', () => {
    const recs = recommendForTarget('memory', HYBRID, FILE_HYBRID, FREE_MIB, SYS_FREE_MIB);
    expect(recs.find((r) => r.key === 'cache_type_k')?.value).toBe('q4_0');
    expect(recs.find((r) => r.key === 'ctx_size')?.value).toBe(262144);
  });

  it('dense model: ctx differs by dtype and scales with budget (no arbitrary caps)', () => {
    // 全卸载预算 = 23749−1024−19968 = 2757 MiB
    // q8_0: 2757/0.1328 ≈ 20756 → 20480；f16: 2757/0.25 ≈ 11028 → 10240；q4_0: → 训练上限 32768
    const balanced = recommendForTarget('balanced', DENSE, FILE_DENSE, FREE_MIB, SYS_FREE_MIB);
    expect(balanced.find((r) => r.key === 'ctx_size')?.value).toBe(20480);
    const latency = recommendForTarget('latency', DENSE, FILE_DENSE, FREE_MIB, SYS_FREE_MIB);
    expect(latency.find((r) => r.key === 'ctx_size')?.value).toBe(10240);
    const memory = recommendForTarget('memory', DENSE, FILE_DENSE, FREE_MIB, SYS_FREE_MIB);
    expect(memory.find((r) => r.key === 'ctx_size')?.value).toBe(32768);
  });

  it('max-context (dense): joint VRAM+RAM budget reaches trained max with partial offload', () => {
    // 全卸载仅 20480 < 训练上限 32768 → 联合预算（+20488 MiB RAM）推到训练上限，
    // 需部分卸载：最大 GPU 比例 f = 22725/24320 ≈ 0.934 → ngl = 59/64
    const recs = recommendForTarget('max-context', DENSE, FILE_DENSE, FREE_MIB, SYS_FREE_MIB);
    expect(recs.find((r) => r.key === 'ctx_size')?.value).toBe(32768);
    const ngl = recs.find((r) => r.key === 'gpu_layers');
    expect(ngl?.value).toBe(59);
  });

  it('weights exceed free memory entirely: balanced falls back to joint budget (no OOM)', () => {
    // 16 GiB 权重 > 8 GiB 空闲 → 全卸载不可行，联合预算（VRAM 7168 + RAM 20488 MiB）
    // 在 q8_0 KV（0.1328 MiB/token）下推到训练上限 32768，需部分卸载：
    // f = 7168/(16384+0.1328×32768) ≈ 0.346 → ngl = 22/64
    const recs = recommendForTarget('balanced', DENSE, 16 * 1024 * 1024 * 1024, 8192, SYS_FREE_MIB);
    const ctx = recs.find((r) => r.key === 'ctx_size');
    expect(ctx).toBeDefined();
    expect(Number(ctx!.value)).toBe(32768);
    const ngl = recs.find((r) => r.key === 'gpu_layers');
    expect(ngl).toBeDefined();
    expect(Number(ngl!.value)).toBe(22);
  });

  it('no devices: no recommendations at all', () => {
    expect(recommendForTarget('balanced', HYBRID, FILE_HYBRID, null, SYS_FREE_MIB)).toEqual([]);
    expect(recommendForTarget('balanced', HYBRID, FILE_HYBRID, 0, SYS_FREE_MIB)).toEqual([]);
  });
});

describe('recommendOffloadAdvice（显存装不下时的减负建议，§5.6 第 3 项）', () => {
  /** 两块卡的探测结果（顺序即 `--list-devices` 原序，-ts 的份数按它写） */
  const TWO_DEVICES: DeviceMemInfo[] = [
    { id: 'CUDA0', name: 'NVIDIA GeForce RTX 3060', totalMiB: 12288, freeMiB: 11000 },
    { id: 'Vulkan0', name: 'AMD Radeon RX 7900 XTX', totalMiB: 24560, freeMiB: 23749 },
  ];

  it('显存装得下 ⇒ 一条建议都不出（不制造噪音）', () => {
    // 19968 + 1024 = 20992 ≤ 23749：稠密大模型放得进 24 GB 卡，无需减负
    const recs = recommendOffloadAdvice({
      info: DENSE, fileSizeBytes: FILE_DENSE, deviceFreeMiB: FREE_MIB, systemFreeMiB: SYS_FREE_MIB,
    });
    expect(recs).toEqual([]);
  });

  it('MoE 超出空闲显存 ⇒ 建议 -cmoe + -ngl 降档', () => {
    // 10840 + 1024 > 8192 ⇒ 装不下；需挪内存 3672 MiB ≤ 21000 − 512 ⇒ 内存接得住
    const recs = recommendOffloadAdvice({
      info: HYBRID, fileSizeBytes: FILE_HYBRID, deviceFreeMiB: 8192, systemFreeMiB: SYS_FREE_MIB,
    });
    expect(recs.find((r) => r.key === 'cpu_moe')?.value).toBe(true);
    // 每层 10840/41 ≈ 264 MiB，可用 8192 − 1024 = 7168 MiB ⇒ 27/41 层
    const ngl = recs.find((r) => r.key === 'gpu_layers');
    expect(ngl?.value).toBe(27);
    expect(ngl?.reasonArgs).toEqual([27, 41]);
    expect(recs.every((r) => r.offloadRelief === true)).toBe(true);
  });

  it('稠密模型超出 ⇒ 只降 -ngl，不建议 MoE 开关', () => {
    const recs = recommendOffloadAdvice({
      info: DENSE, fileSizeBytes: FILE_DENSE, deviceFreeMiB: 8192, systemFreeMiB: SYS_FREE_MIB,
    });
    expect(keys(recs)).toEqual(['gpu_layers']);
    expect(recs[0].value).toBe(22); // (8192 − 1024) / (19968/64) = 22.97 → 22
  });

  it('内存也接不住溢出的那部分 ⇒ 不发声（减负开关救不了总容量不够）', () => {
    const recs = recommendOffloadAdvice({
      info: HYBRID, fileSizeBytes: FILE_HYBRID, deviceFreeMiB: 2000, systemFreeMiB: 4000,
    });
    expect(recs).toEqual([]);
  });

  it('可用内存未知 ⇒ 同样不发声（不劝人往没探到的内存里挪）', () => {
    const recs = recommendOffloadAdvice({
      info: HYBRID, fileSizeBytes: FILE_HYBRID, deviceFreeMiB: 8192, systemFreeMiB: null,
    });
    expect(recs).toEqual([]);
  });

  it('多于一块卡 ⇒ 追加 -dev / -ts；单卡不追加', () => {
    const args = {
      info: DENSE, fileSizeBytes: FILE_DENSE, deviceFreeMiB: 11000, systemFreeMiB: SYS_FREE_MIB,
    };
    const single = recommendOffloadAdvice({ ...args, devices: [TWO_DEVICES[0]] });
    expect(keys(single)).not.toContain('device');
    expect(keys(single)).not.toContain('tensor_split');

    const multi = recommendOffloadAdvice({ ...args, devices: TWO_DEVICES });
    // 空闲最多的是第二块（Vulkan0 23749 MiB），-ts 份数按入参顺序写
    expect(multi.find((r) => r.key === 'device')?.value).toBe('Vulkan0');
    expect(multi.find((r) => r.key === 'tensor_split')?.value).toBe('11,23');
  });

  it('不建议参数表里不存在的开关（含未验证取值的 override_tensor）', () => {
    const recs = recommendOffloadAdvice({
      info: HYBRID, fileSizeBytes: FILE_HYBRID, deviceFreeMiB: 8192, systemFreeMiB: SYS_FREE_MIB,
      devices: TWO_DEVICES,
    });
    for (const r of recs) {
      expect(PARAM_KEYS.has(r.key)).toBe(true);
      expect(r.key).not.toBe('override_tensor');
    }
  });

  it('无设备 / 文件不可读 ⇒ 空数组', () => {
    const base = { info: HYBRID, systemFreeMiB: SYS_FREE_MIB };
    expect(recommendOffloadAdvice({ ...base, fileSizeBytes: null, deviceFreeMiB: 8192 })).toEqual([]);
    expect(recommendOffloadAdvice({ ...base, fileSizeBytes: FILE_HYBRID, deviceFreeMiB: null })).toEqual([]);
    expect(recommendOffloadAdvice({ ...base, fileSizeBytes: FILE_HYBRID, deviceFreeMiB: 0 })).toEqual([]);
  });

  it('recommendForTarget 把减负条目并进同一份建议，且不与目标建议撞 key', () => {
    // max-context（稠密）本身就会给一条 -ngl，减负那条应被去重而不是并列两条
    const recs = recommendForTarget('max-context', DENSE, FILE_DENSE, 8192, SYS_FREE_MIB, TWO_DEVICES);
    expect(recs.filter((r) => r.key === 'gpu_layers')).toHaveLength(1);
    expect(recs.find((r) => r.key === 'tensor_split')?.offloadRelief).toBe(true);
    expect(recs.filter((r) => r.offloadRelief).map((r) => r.key)).toEqual(['device', 'tensor_split']);
  });
});
