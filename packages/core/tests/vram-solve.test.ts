import { describe, it, expect } from 'vitest';
import {
  solveMaxContext,
  partialOffloadLayers,
  estimateOccupancy,
  resolveSessionCtxTokens,
  KV_DTYPE_BYTES,
} from '../src/vram-estimate.js';
import type { GgufModelInfo } from '@llama-launcher/shared';

const MIB = 1024 * 1024;

/** 构造最小 GgufModelInfo（仅填估算相关字段，其余置空）。 */
function makeInfo(overrides: Partial<GgufModelInfo> = {}): GgufModelInfo {
  return {
    path: '', version: 3, tensor_count: 0, metadata_kv_count: 0, metadata: {},
    architecture: 'llama', name: '', quantization: '', file_type: null,
    quantization_version: null, type: 'model', finetune: null, basename: null,
    size_label: null, context_length: 32768, embedding_length: null,
    feed_forward_length: null, block_count: 64, attention_head_count: 32,
    attention_head_count_kv: 8, attention_key_length: 128, attention_value_length: 128,
    attention_layer_norm_rms_epsilon: null, expert_count: null, expert_used_count: null,
    nextn_predict_layers: null, full_attention_interval: null, ssm_conv_kernel: null,
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
    ...overrides,
  };
}

/**
 * 标准稠密场景（与 vram-estimate.test.ts 同一形态，便于交叉验证）：
 * 64 层、KV 262144 B/token（f16），权重 19.5 GiB，设备空闲 23749 MiB。
 */
const DENSE = makeInfo();
const WEIGHTS = 19968 * MIB;
const FREE_MIB = 23749;

describe('solveMaxContext（无 OOM 最大上下文求解——此前零测试覆盖）', () => {
  it('预算充裕：全卸载直达训练上限', () => {
    // 小模型 + 大显存：全卸载预算远超 32768 token 所需
    const r = solveMaxContext({
      info: DENSE, fileSizeBytes: 4 * MIB, deviceFreeMiB: FREE_MIB,
      systemFreeMiB: 21000, dtypeBytes: KV_DTYPE_BYTES.f16, allowPartialOffload: false,
    });
    expect(r).toEqual({ contextTokens: 32768, offloadLayers: 64, fullOffload: true });
  });

  it('全卸载放不下训练上限且不允许部分卸载：给出全卸载预算内的最大上下文', () => {
    // 预算 = (23749−1024−19968) MiB ÷ 0.25 MiB/token ≈ 11028 → 1024 粒度向下 → 10240
    const r = solveMaxContext({
      info: DENSE, fileSizeBytes: WEIGHTS, deviceFreeMiB: FREE_MIB,
      systemFreeMiB: 21000, dtypeBytes: KV_DTYPE_BYTES.f16, allowPartialOffload: false,
    });
    expect(r?.fullOffload).toBe(true);
    expect(r?.offloadLayers).toBe(64);
    expect(r?.contextTokens).toBe(10240);
  });

  it('允许部分卸载：联合显存+内存预算推到训练上限，卸载层数按最大 GPU 比例取整', () => {
    // fullCtx ≈ 20761 < 32768；joint ≫ 32768 → c=32768，
    // f = 22725/(19968+0.1328×32768) ≈ 0.934 → ngl = 59
    const r = solveMaxContext({
      info: DENSE, fileSizeBytes: WEIGHTS, deviceFreeMiB: FREE_MIB,
      systemFreeMiB: 21000, dtypeBytes: KV_DTYPE_BYTES.q8_0, allowPartialOffload: true,
    });
    expect(r?.contextTokens).toBe(32768);
    expect(r?.fullOffload).toBe(false);
    expect(r?.offloadLayers).toBe(59);
  });

  it('权重连计算余量都放不下且不允许部分卸载：无安全上下文（全 null 而不是给 0 硬跑）', () => {
    const r = solveMaxContext({
      info: DENSE, fileSizeBytes: 16 * 1024 * MIB, deviceFreeMiB: 8192,
      systemFreeMiB: null, dtypeBytes: KV_DTYPE_BYTES.f16, allowPartialOffload: false,
    });
    expect(r).toEqual({ contextTokens: null, offloadLayers: null, fullOffload: false });
  });

  it('训练上限未知（context_length 缺失）：封顶落至显存预算而非无限，全卸载结论保留', () => {
    // 无训练上限时求解不产出 Infinity：以预算可容纳的最大上下文为上限
    // （(23749−1024−4) MiB ÷ 0.25 MiB/token = 90884 → 1024 粒度向下 → 90112）
    const r = solveMaxContext({
      info: makeInfo({ context_length: null }), fileSizeBytes: 4 * MIB, deviceFreeMiB: FREE_MIB,
      systemFreeMiB: 21000, dtypeBytes: KV_DTYPE_BYTES.f16, allowPartialOffload: false,
    });
    expect(r?.contextTokens).toBe(90112);
    expect(r?.offloadLayers).toBe(64);
    expect(r?.fullOffload).toBe(true);
  });

  it('输入缺失（层数/KV 头数/文件大小/设备空闲任一）→ null，不猜', () => {
    const base = {
      fileSizeBytes: WEIGHTS, deviceFreeMiB: FREE_MIB, systemFreeMiB: 21000,
      dtypeBytes: KV_DTYPE_BYTES.f16, allowPartialOffload: false,
    };
    expect(solveMaxContext({ ...base, info: makeInfo({ block_count: null }) })).toBeNull();
    expect(solveMaxContext({ ...base, info: makeInfo({ attention_head_count: null, attention_head_count_kv: null }) })).toBeNull();
    expect(solveMaxContext({ ...base, info: DENSE, fileSizeBytes: null })).toBeNull();
    expect(solveMaxContext({ ...base, info: DENSE, deviceFreeMiB: null })).toBeNull();
  });
});

describe('resolveSessionCtxTokens（会话上下文折算，唯一实现）', () => {
  it('显式给定直接用；0/缺省按训练上限折算（-c 0 的引擎回退语义）', () => {
    expect(resolveSessionCtxTokens(8192, DENSE)).toBe(8192);
    expect(resolveSessionCtxTokens(0, DENSE)).toBe(32768); // DENSE 训练上限 32768
  });

  it('ctx=0 且无训练上限元数据 → null（未知，不猜）', () => {
    expect(resolveSessionCtxTokens(0, makeInfo({ context_length: null }))).toBeNull();
    expect(resolveSessionCtxTokens(0, makeInfo({ context_length: 0 }))).toBeNull();
  });
});

describe('partialOffloadLayers（逐层均摊的部分卸载估算）', () => {
  it('空闲显存减去计算余量后按每层体积取整：预算 7168 MiB / 每层 256 MiB → 28 层', () => {
    expect(partialOffloadLayers(DENSE, 16 * 1024 * MIB, 8192)).toBe(28);
  });

  it('空闲显存连计算余量都覆盖不了 → 0 层（而不是负数）', () => {
    expect(partialOffloadLayers(DENSE, 16 * 1024 * MIB, 512)).toBe(0);
  });

  it('显存远超权重 → 全部层数；缺层数/缺文件大小 → null', () => {
    expect(partialOffloadLayers(DENSE, 4 * MIB, FREE_MIB)).toBe(64);
    expect(partialOffloadLayers(makeInfo({ block_count: null }), 16 * MIB, 8192)).toBeNull();
    expect(partialOffloadLayers(DENSE, 0, 8192)).toBeNull();
  });

  it('KV 口径（T03）：预算同时扣 GPU 侧 KV——ctx 越大建议层数越少', () => {
    // DENSE f16 KV = 0.25 MiB/token：ctx 32768 → KV 共 8192 MiB，每层摊 128 MiB
    // divisor = 256 + 128 = 384 → floor(7168/384) = 18（纯权重口径是 28，差出的 10 层
    // 在真机上就是 2.5 GiB 的 KV 无处安放）
    expect(partialOffloadLayers(DENSE, 16 * 1024 * MIB, 8192, 32768, KV_DTYPE_BYTES.f16)).toBe(18);
  });

  it('ctx 未知（null/0）退回纯权重口径——不猜上下文', () => {
    expect(partialOffloadLayers(DENSE, 16 * 1024 * MIB, 8192, null)).toBe(28);
    expect(partialOffloadLayers(DENSE, 16 * 1024 * MIB, 8192, 0)).toBe(28);
  });
});

describe('estimateOccupancy - auto 模式的放不下分支（既有用例只盖了放得下）', () => {
  it('auto + 权重超出空闲显存：按部分卸载层数估算，而不是错报全卸载', () => {
    const o = estimateOccupancy({
      info: DENSE,
      fileSizeBytes: 16 * 1024 * MIB, // 16384 MiB + 1024 余量 > 8320 空闲
      deviceFreeMiB: 8320,
      deviceTotalMiB: 8320,
      systemTotalMiB: 32768,
      systemFreeMiB: 21000,
      ngl: 'auto',
      ctxSize: 1024,
      kvDtype: 'f16',
    });
    // 每层 16384/64 = 256 MiB，可用 8320−1024 = 7296 → 28 层
    expect(o.offloadLayers).toBe(28);
    // 组成口径复核：28/64 权重 7168 + GPU 侧 KV 112 + 余量 1024 = 8304 ≤ 8320
    expect(o.vram.fits).toBe(true);
  });

  it('auto + 放不下 + ctx 大：层数按 KV 口径折算，占用侧自洽 fits（T03 回归）', () => {
    const o = estimateOccupancy({
      info: DENSE,
      fileSizeBytes: 16 * 1024 * MIB,
      deviceFreeMiB: 8320,
      deviceTotalMiB: 8320,
      systemTotalMiB: 32768,
      systemFreeMiB: 21000,
      ngl: 'auto',
      ctxSize: 32768, // f16 KV 0.25 MiB/token × 32768 = 8192 MiB，每层摊 128 MiB
      kvDtype: 'f16',
    });
    // KV 口径：divisor = 256 + 128 = 384 → floor(7296/384) = 19 层
    //（纯权重口径会错给 28 层：那档下 7168 权重 + 3584 KV + 1024 余量 = 11776 > 8320，
    // 旧实现里同一份结果自己都会报 fits=false——建议与占用自相矛盾）
    expect(o.offloadLayers).toBe(19);
    // 自洽性：19 层权重 4864 + GPU 侧 KV 2432 + 余量 1024 = 8320 ≤ 8320
    expect(o.vram.fits).toBe(true);
  });
});
