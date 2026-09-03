/**
 * 显存/上下文容量估算模型（纯函数，无 IO）。
 *
 * 用途：把「这个模型在我的显卡上能开多大上下文」从拍脑袋变成可计算——
 * KV 缓存每 token 字节完全由 GGUF 元数据决定：
 *   kvBytes/token = 2(K+V) × 有KV层数 × head_count_kv × key_length × dtype字节
 * 其中「有KV层数」按混合架构折算（full_attention_interval=N → 仅每 N 层中的 1 层为
 * 全注意力、持有 KV；线性注意力层以固定状态存在，不随上下文线性增长）。
 * 权重体积 ≈ GGUF 文件大小。计算缓冲 + 安全余量取固定保守值。
 *
 * 所有输出都是估算值（表述带 "~"），与运行时实测（bench/日志）互补而非替代。
 */
import type { GgufModelInfo, HardwareOccupancy, OccupancySide } from '@llama-launcher/shared';

/** KV 缓存 dtype → 每 weight 字节数（块量化按 32 weights 块折算） */
export const KV_DTYPE_BYTES: Record<string, number> = {
  f32: 4,
  f16: 2,
  bf16: 2,
  q8_0: 1.0625, // (2 + 32) / 32
  q5_0: 0.6875, // (2 + 4 + 16) / 32
  q5_1: 0.75, // (2 + 4 + 16 + 2) / 32
  q4_0: 0.5625, // (2 + 16) / 32
  q4_1: 0.625, // (2 + 4 + 14) / 32
  iq4_nl: 0.5625, // ~4.5 bpw
};

/** 计算缓冲 + 安全余量（MiB）：logits/计算缓冲随 batch×vocab 增长，取固定保守值 */
export const COMPUTE_RESERVE_MIB = 1024;

const BYTES_PER_MIB = 1024 * 1024;

/** 有 KV 缓存的层数：混合架构按 full_attention_interval 向上取整折算；无法估算为 null */
export function kvLayersOf(info: GgufModelInfo): number | null {
  const blocks = info.block_count;
  if (!blocks || blocks <= 0) return null;
  const interval = info.full_attention_interval;
  if (interval && interval > 1) return Math.ceil(blocks / interval);
  return blocks;
}

/**
 * KV 缓存每 token 字节数。
 * head_count_kv 缺省回退 head_count（非 GQA），key_length 缺省 128（llama.cpp 默认）。
 */
export function kvBytesPerTokenOf(info: GgufModelInfo, dtypeBytes: number): number | null {
  const layers = kvLayersOf(info);
  if (!layers) return null;
  const heads = info.attention_head_count_kv ?? info.attention_head_count;
  if (!heads || heads <= 0) return null;
  const dim = info.attention_key_length ?? 128;
  return 2 * layers * heads * dim * dtypeBytes;
}

export interface VramEstimateInput {
  info: GgufModelInfo;
  /** GGUF 文件字节数（权重体积近似） */
  fileSizeBytes: number | null;
  /** 主设备空闲显存字节数 */
  freeBytes: number | null;
  /** KV dtype 每 weight 字节数（KV_DTYPE_BYTES 取值） */
  dtypeBytes: number;
}

export interface VramEstimate {
  weightsMiB: number | null;
  kvLayers: number | null;
  kvBytesPerToken: number | null;
  maxContext: number | null;
  fullOffloadFits: boolean | null;
}

/**
 * 估算：全卸载时最大空闲设备可支撑的上下文上限。
 * maxContext = min(训练上限, (空闲 − 权重 − 计算余量) / kvBytesPerToken)，1024 粒度向下取整。
 * 权重 + 余量已超空闲时为 0（表示全卸载放不下任何有意义上下文）。
 */
export function estimateVram(input: VramEstimateInput): VramEstimate {
  const weightsMiB =
    input.fileSizeBytes && input.fileSizeBytes > 0
      ? input.fileSizeBytes / BYTES_PER_MIB
      : null;
  const layers = kvLayersOf(input.info);
  const kvBpt =
    input.dtypeBytes > 0 ? kvBytesPerTokenOf(input.info, input.dtypeBytes) : null;

  const freeBytes = input.freeBytes && input.freeBytes > 0 ? input.freeBytes : null;
  let maxContext: number | null = null;
  if (weightsMiB !== null && kvBpt && freeBytes) {
    const budgetBytes = freeBytes - weightsMiB * BYTES_PER_MIB - COMPUTE_RESERVE_MIB * BYTES_PER_MIB;
    if (budgetBytes <= 0) {
      maxContext = 0;
    } else {
      const trained = input.info.context_length && input.info.context_length > 0
        ? input.info.context_length
        : Number.POSITIVE_INFINITY;
      const raw = Math.min(trained, budgetBytes / kvBpt);
      maxContext = Math.max(0, Math.floor(raw / 1024) * 1024);
    }
  }

  const fullOffloadFits =
    weightsMiB !== null && freeBytes !== null
      ? freeBytes - weightsMiB * BYTES_PER_MIB >= COMPUTE_RESERVE_MIB * BYTES_PER_MIB
      : null;

  return {
    weightsMiB,
    kvLayers: layers,
    kvBytesPerToken: kvBpt,
    maxContext,
    fullOffloadFits,
  };
}

/** 内存侧固定开销估算（进程 + 运行时 + 计算缓冲的 CPU 部分） */
export const RAM_OVERHEAD_MIB = 512;

export interface OccupancyComputationInput {
  info: GgufModelInfo;
  fileSizeBytes: number | null;
  deviceFreeMiB: number | null;
  deviceTotalMiB: number | null;
  systemTotalMiB: number | null;
  systemFreeMiB: number | null;
  /** 会话 gpu_layers 值：'all' / 数字字符串 / 'auto' 或空串（引擎自适应） */
  ngl: string | null;
  /** 会话 ctx_size（0 = 从模型加载 → 训练上限） */
  ctxSize: number;
  /** 会话 cache_type_k（KV dtype） */
  kvDtype: string;
}

/**
 * 硬件资源占用估算 v2（显存 + 内存双侧，会话参数驱动）。
 *
 * 与 v1（全卸载上限）的区别：输入是用户当前的实际配置（卸载层数 / 上下文 / KV 档位），
 * 输出是两侧的占用构成——
 * - 显存 = 已卸载层权重 + GPU 侧 KV + 计算缓冲余量，对照设备空闲显存；
 * - 内存 = 未卸载层权重 + CPU 侧 KV + 进程开销，对照系统可用内存。
 * KV 按卸载层比例在 GPU/CPU 间分摊（近似：未卸载层的 KV 留在系统内存）。
 * 主进程（main/ipc/system.ts）与渲染端共用本函数的同一份结果结构，保证链路一致。
 */
export function estimateOccupancy(input: OccupancyComputationInput): HardwareOccupancy {
  const MiB = 1024 * 1024;
  const blocks = input.info.block_count && input.info.block_count > 0 ? input.info.block_count : null;
  const weightsTotalMiB =
    input.fileSizeBytes && input.fileSizeBytes > 0 ? input.fileSizeBytes / MiB : null;
  const trained = input.info.context_length && input.info.context_length > 0 ? input.info.context_length : null;
  const ctxTokens = input.ctxSize > 0 ? input.ctxSize : trained;
  const dtypeBytes = KV_DTYPE_BYTES[input.kvDtype] ?? KV_DTYPE_BYTES.f16;

  // 卸载层数：显式数字 / all 直接取；auto（引擎自适应）按「放得下则全卸载，否则按余量均摊」近似
  const freeMiB = input.deviceFreeMiB;
  let offloadLayers: number | null = null;
  if (blocks) {
    const ngl = (input.ngl ?? '').trim().toLowerCase();
    if (ngl === 'all') offloadLayers = blocks;
    else if (ngl !== '' && Number.isFinite(Number(ngl))) {
      offloadLayers = Math.max(0, Math.min(blocks, Math.floor(Number(ngl))));
    } else if (weightsTotalMiB !== null && freeMiB !== null) {
      offloadLayers =
        weightsTotalMiB + COMPUTE_RESERVE_MIB <= freeMiB
          ? blocks
          : partialOffloadLayers(input.info, input.fileSizeBytes ?? 0, freeMiB);
    }
  }
  const ratio = blocks && offloadLayers !== null ? offloadLayers / blocks : null;

  const kvLayers = kvLayersOf(input.info);
  const kvBpt = kvBytesPerTokenOf(input.info, dtypeBytes);
  const kvTotalMiB = kvBpt !== null && ctxTokens ? (kvBpt * ctxTokens) / MiB : null;

  // 显存侧
  const vramWeightsMiB = weightsTotalMiB !== null && ratio !== null ? weightsTotalMiB * ratio : null;
  const vramKvMiB = kvTotalMiB !== null && ratio !== null ? kvTotalMiB * ratio : null;
  const vramTotalMiB =
    vramWeightsMiB !== null && vramKvMiB !== null
      ? vramWeightsMiB + vramKvMiB + COMPUTE_RESERVE_MIB
      : null;
  const vram: OccupancySide = {
    weightsMiB: vramWeightsMiB,
    kvMiB: vramKvMiB,
    reserveMiB: vramTotalMiB !== null ? COMPUTE_RESERVE_MIB : null,
    totalMiB: vramTotalMiB,
    capacityMiB: input.deviceTotalMiB ?? null,
    availableMiB: freeMiB,
    fits:
      vramTotalMiB !== null && freeMiB !== null ? vramTotalMiB <= freeMiB : null,
  };

  // 内存侧：未卸载部分留在系统内存
  const ramWeightsMiB =
    weightsTotalMiB !== null && vramWeightsMiB !== null ? weightsTotalMiB - vramWeightsMiB : null;
  const ramKvMiB = kvTotalMiB !== null && vramKvMiB !== null ? kvTotalMiB - vramKvMiB : null;
  const ramTotalMiB =
    ramWeightsMiB !== null && ramKvMiB !== null ? ramWeightsMiB + ramKvMiB + RAM_OVERHEAD_MIB : null;
  const ram: OccupancySide = {
    weightsMiB: ramWeightsMiB,
    kvMiB: ramKvMiB,
    reserveMiB: ramTotalMiB !== null ? RAM_OVERHEAD_MIB : null,
    totalMiB: ramTotalMiB,
    capacityMiB: input.systemTotalMiB ?? null,
    availableMiB: input.systemFreeMiB ?? null,
    fits:
      ramTotalMiB !== null && input.systemFreeMiB !== null
        ? ramTotalMiB <= input.systemFreeMiB
        : null,
  };

  // 全卸载上下文上限（当前 dtype）——供目标选择器与「还能开多大」参考
  const maxContext =
    freeMiB !== null
      ? estimateVram({ info: input.info, fileSizeBytes: input.fileSizeBytes, freeBytes: freeMiB * MiB, dtypeBytes }).maxContext
      : null;

  return {
    vram,
    ram,
    contextTokens: ctxTokens,
    offloadLayers,
    totalLayers: blocks,
    maxContext,
  };
}

/** 部分卸载估算：权重超出空闲显存时，按逐层均摊体积估算可放入 GPU 的层数 */
export function partialOffloadLayers(info: GgufModelInfo, fileSizeBytes: number, freeMiB: number): number | null {
  const blocks = info.block_count;
  if (!blocks || blocks <= 0 || fileSizeBytes <= 0) return null;
  const perLayerBytes = fileSizeBytes / blocks;
  const budgetBytes = freeMiB * BYTES_PER_MIB - COMPUTE_RESERVE_MIB * BYTES_PER_MIB;
  if (budgetBytes <= 0) return 0;
  return Math.max(0, Math.min(blocks, Math.floor(budgetBytes / perLayerBytes)));
}

export interface ContextSolveResult {
  /** 建议上下文（token，1024 粒度、按训练上限钳制）；无法推算为 null */
  contextTokens: number | null;
  /** 建议卸载层数（联合预算需要部分卸载时 < 总层数；全卸载 = 总层数） */
  offloadLayers: number | null;
  /** 是否无需部分卸载（权重与 KV 全在 GPU） */
  fullOffload: boolean;
}

export interface ContextSolveInput {
  info: GgufModelInfo;
  fileSizeBytes: number | null;
  deviceFreeMiB: number | null;
  /** 系统可用内存 MiB（null = 未知，不把 RAM 计入预算） */
  systemFreeMiB: number | null;
  dtypeBytes: number;
  /** 允许部分卸载换更大上下文（联合显存+内存预算；false = 仅全卸载） */
  allowPartialOffload: boolean;
}

/**
 * 无 OOM 最大上下文求解：在显存与内存双侧预算内找可容纳的最大上下文。
 *
 * 记 W_C = 权重 + kvBpt×C（总"质量"，随上下文线性增长），卸载比例 f ∈ [0,1]：
 * - 显存约束：f×W_C + COMPUTE_RESERVE ≤ deviceFree → f ≤ (deviceFree−reserve)/W_C
 * - 内存约束：(1−f)×W_C + RAM_OVERHEAD ≤ systemFree → f ≥ 1 − (systemFree−overhead)/W_C
 * 可行 ⇔ W_C ≤ (deviceFree−reserve) + (systemFree−overhead)。
 * 于是 C_max = min(训练上限, (两侧预算和 − 权重) / kvBpt)，
 * 且速度优先取最大 GPU 卸载比例 f_max = (deviceFree−reserve)/W_C → ngl = floor(f_max×blocks)。
 */
export function solveMaxContext(input: ContextSolveInput): ContextSolveResult | null {
  const blocks = input.info.block_count && input.info.block_count > 0 ? input.info.block_count : null;
  const kvBpt = kvBytesPerTokenOf(input.info, input.dtypeBytes);
  const weightsMiB =
    input.fileSizeBytes && input.fileSizeBytes > 0 ? input.fileSizeBytes / BYTES_PER_MIB : null;
  if (!blocks || kvBpt === null || kvBpt <= 0 || weightsMiB === null || input.deviceFreeMiB === null) {
    return null;
  }
  const trainedCap =
    input.info.context_length && input.info.context_length > 0
      ? input.info.context_length
      : Number.POSITIVE_INFINITY;
  // 预算与权重均以 MiB 计，kvBpt 是字节/token → 统一换算成 MiB/token 再解
  const kvBptMiB = kvBpt / BYTES_PER_MIB;
  const vramBudgetMiB = input.deviceFreeMiB - COMPUTE_RESERVE_MIB;
  const ramBudgetMiB =
    input.systemFreeMiB !== null ? Math.max(0, input.systemFreeMiB - RAM_OVERHEAD_MIB) : 0;

  const floorCtx = (c: number) => Math.max(0, Math.floor(c / 1024) * 1024);

  // 全卸载可行域
  const fullCtx = (vramBudgetMiB - weightsMiB) / kvBptMiB;
  const finishFull = (): ContextSolveResult => ({
    contextTokens: Math.min(trainedCap, Math.max(0, fullCtx)) === Number.POSITIVE_INFINITY
      ? null
      : floorCtx(Math.min(trainedCap, Math.max(0, fullCtx))),
    offloadLayers: blocks,
    fullOffload: true,
  });

  // 全卸载即可达训练上限（或非常充裕）：无需部分卸载
  if (fullCtx >= trainedCap) {
    return {
      contextTokens: trainedCap === Number.POSITIVE_INFINITY ? null : floorCtx(trainedCap),
      offloadLayers: blocks,
      fullOffload: true,
    };
  }

  // 全卸载放不下训练上限：视 allowPartialOffload 决定是否用内存分担
  if (input.allowPartialOffload && ramBudgetMiB > 0) {
    const joint = (vramBudgetMiB + ramBudgetMiB - weightsMiB) / kvBptMiB;
    const c = Math.max(0, Math.min(trainedCap, joint));
    if (c > fullCtx) {
      // 速度优先：取最大 GPU 卸载比例（严格保持余量，不越界）
      const wC = weightsMiB + kvBptMiB * c;
      const fMax = Math.min(1, Math.max(0, vramBudgetMiB / wC));
      const ngl = Math.max(1, Math.floor(fMax * blocks));
      return { contextTokens: floorCtx(c), offloadLayers: ngl, fullOffload: false };
    }
    return finishFull();
  }

  // 仅全卸载预算：C 为可容纳的最大值（可能小于训练上限，也可能为 0）
  if (!input.allowPartialOffload) {
    if (fullCtx <= 0 && weightsMiB + COMPUTE_RESERVE_MIB > input.deviceFreeMiB) {
      // 权重连余量都放不下：无安全的全卸载上下文
      return { contextTokens: null, offloadLayers: null, fullOffload: false };
    }
    return finishFull();
  }
  // allowPartial 但无 RAM 预算：退化为全卸载结果
  return finishFull();
}
