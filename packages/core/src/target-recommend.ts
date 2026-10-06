/**
 * 性能目标联动建议引擎（纯函数）。
 *
 * 四档目标的差异化在「策略」而非人为封顶——上下文一律按当前硬件预算推算无 OOM 最大值：
 * - max-context：q8_0 KV + 允许部分卸载（显存+内存联合预算，必要时以速度换上下文）
 * - balanced：q8_0 KV + 优先全卸载（放不下时回退联合预算，无 OOM 优先）
 * - latency：f16 KV（质量优先）+ 全卸载 + MTP 推测解码
 * - memory：q4_0 KV（最小占用）+ 全卸载优先
 * 输出不做「与当前会话值对比」——差集过滤由渲染端完成（主进程不知道会话值）。
 */
import type { DeviceMemInfo, GgufModelInfo, PerfTarget, TargetRecommendation } from '@llama-launcher/shared';
import {
  COMPUTE_RESERVE_MIB,
  KV_DTYPE_BYTES,
  RAM_OVERHEAD_MIB,
  partialOffloadLayers,
  solveMaxContext,
} from './vram-estimate.js';

const TARGET_KV_DTYPE: Record<PerfTarget, string> = {
  'max-context': 'q8_0',
  balanced: 'q8_0',
  latency: 'f16',
  memory: 'q4_0',
};

/**
 * 生成目标联动参数建议。理由以 `reasonKey`（i18n 键）+ 数值实参下发，本模块不产文案——
 * 否则主进程算好的中文字面量会在英文界面直出（原 `TARGET_LABEL` + 模板串已因此删除）。
 * freeMiB = 最大空闲设备空闲显存；systemFreeMiB = 系统可用内存（null = 未知，不把 RAM 计入预算）。
 * 任一为 null/≤0（无设备）时不产生任何建议。
 * `devices`（可选）= `--list-devices` 探测到的全部设备，**顺序即引擎顺序**：传了才可能产出
 * `-dev` / `-ts` 这两条多卡建议（单卡没有「选哪块卡 / 怎么分摊」可说）。
 */
export function recommendForTarget(
  target: PerfTarget,
  info: GgufModelInfo,
  fileSizeBytes: number | null,
  freeMiB: number | null,
  systemFreeMiB: number | null,
  devices?: DeviceMemInfo[] | null,
): TargetRecommendation[] {
  const recs: TargetRecommendation[] = [];
  if (freeMiB === null || freeMiB <= 0) return recs;
  const dtype = TARGET_KV_DTYPE[target];
  const dtypeBytes = KV_DTYPE_BYTES[dtype] ?? KV_DTYPE_BYTES.f16;

  // Flash Attention：prefill 提速 + KV 量化前置（所有目标受益）
  recs.push({ key: 'flash_attn', value: 'on', reasonKey: 'target_rec_fa' });

  // 上下文 + 卸载层数：按目标 dtype 在显存（+内存）预算内求解无 OOM 最大值
  const allowPartial = target === 'max-context';
  let solve = solveMaxContext({
    info,
    fileSizeBytes,
    deviceFreeMiB: freeMiB,
    systemFreeMiB,
    dtypeBytes,
    allowPartialOffload: allowPartial,
  });
  // 非部分卸载目标若全卸载放不下，回退联合预算（无 OOM 优先于速度）
  if ((!solve || !solve.contextTokens || solve.contextTokens <= 0) && !allowPartial) {
    solve = solveMaxContext({
      info,
      fileSizeBytes,
      deviceFreeMiB: freeMiB,
      systemFreeMiB,
      dtypeBytes,
      allowPartialOffload: true,
    });
  }

  if (solve && solve.contextTokens !== null && solve.contextTokens > 0) {
    recs.push({
      key: 'ctx_size',
      value: solve.contextTokens,
      reasonKey: solve.fullOffload ? 'target_rec_ctx_full' : 'target_rec_ctx_partial',
    });
    if (!solve.fullOffload && solve.offloadLayers !== null && info.block_count) {
      recs.push({
        key: 'gpu_layers',
        value: solve.offloadLayers,
        reasonKey: 'target_rec_layers',
        reasonArgs: [solve.offloadLayers, info.block_count],
      });
    }
  }

  // KV 缓存档位（目标策略的核心差异）
  recs.push({ key: 'cache_type_k', value: dtype, reasonKey: 'target_rec_kv', reasonArgs: [dtype] });
  recs.push({ key: 'cache_type_v', value: dtype, reasonKey: 'target_rec_kv', reasonArgs: [dtype] });

  // MTP 推测解码：decode 提速（模型含 MTP 头时，对延迟/均衡目标有意义）
  if ((target === 'latency' || target === 'balanced') && info.nextn_predict_layers && info.nextn_predict_layers > 0) {
    recs.push({
      key: 'spec_type',
      value: 'draft-mtp',
      reasonKey: 'target_rec_mtp',
      reasonArgs: [info.nextn_predict_layers],
    });
  }

  // 「装不下」减负建议同批下发（§5.6 第 3 项）：走这条已有的 recommendations 数组，
  // 不新开 IPC 通道。同 key 已在目标建议里出现时不重复给一条（`-ngl` 是重灾区：
  // 联合预算求解本来就可能给出一档卸载层数），目标建议的取值更贴合本目标，保留它。
  for (const relief of recommendOffloadAdvice({
    info,
    fileSizeBytes,
    deviceFreeMiB: freeMiB,
    systemFreeMiB,
    devices,
  })) {
    if (!recs.some((r) => r.key === relief.key)) recs.push(relief);
  }

  return recs;
}

/** `recommendOffloadAdvice` 的入参（与 `recommendForTarget` 同源的事实集） */
export interface OffloadAdviceInput {
  info: GgufModelInfo;
  /** 权重体积（≈GGUF 文件字节数，主进程侧已含同目录 mmproj 投影器） */
  fileSizeBytes: number | null;
  /** 最大空闲设备的空闲显存 MiB；null/≤0 = 探不到设备，不产建议 */
  deviceFreeMiB: number | null;
  /** 系统可用内存 MiB；null = 未知，按「内存也接不住」保守处理（不劝人往未知的地方挪） */
  systemFreeMiB: number | null;
  /** `--list-devices` 的全部设备（顺序即引擎顺序）；≥2 块才产出 `-dev` / `-ts` */
  devices?: DeviceMemInfo[] | null;
}

/**
 * 显存装不下时的减负建议（docs/zh/params-system.md §5.6 第 3 项）。
 *
 * 出了什么事：权重比显存大时，llama-server 可以把「当下用不到的那块」留在系统内存、
 * 只让显卡算要用的部分，于是 24 GB 显存也能跑远超显存的模型（MoE 类最明显），
 * 代价是内存→显卡的搬运决定出字速度。此前界面只在进程**已经炸了**之后才提示，
 * 装不下的时候一片沉默——本函数就是把「沉默」换成「可以这么改」。
 *
 * 判据（两条，缺一不出建议，写死在此处以免渲染端再算一遍）：
 * 1. 权重 + 计算缓冲 > 最大空闲设备的空闲显存 —— 显存确实装不下；
 * 2. 装不下的那部分 ≤ 系统可用内存 − 进程开销 —— 内存接得住，减负开关才有意义。
 *    两条都成立才建议；第 2 条不成立是「总容量不够」，`-ngl`/`-cmoe` 都救不了，
 *    该看的是更小量化（模型页的「建议降档」徽章负责那条），这里就闭嘴。
 *
 * 建议内容只用参数表里真实存在的 key：`cpu_moe`(-cmoe) / `gpu_layers`(-ngl) /
 * `device`(-dev) / `tensor_split`(-ts)。**不建议 `override_tensor`(-ot)**——它的取值是
 * 张量名模式串，help 只给了语法 `<pattern>=<buffer type>` 没给可复制的模式，
 * 凭猜写一个模式等于给用户一条我们没验证过的命令行。
 */
export function recommendOffloadAdvice(input: OffloadAdviceInput): TargetRecommendation[] {
  const recs: TargetRecommendation[] = [];
  const { info, fileSizeBytes, deviceFreeMiB, systemFreeMiB } = input;
  if (!fileSizeBytes || fileSizeBytes <= 0) return recs;
  if (deviceFreeMiB === null || deviceFreeMiB <= 0) return recs;

  const MiB = 1024 * 1024;
  const weightsMiB = fileSizeBytes / MiB;
  // 判据 1：连「权重 + 计算缓冲」都放不进空闲显存，才谈减负
  if (weightsMiB + COMPUTE_RESERVE_MIB <= deviceFreeMiB) return recs;
  const mustSpillMiB = weightsMiB + COMPUTE_RESERVE_MIB - deviceFreeMiB;
  // 判据 2：内存侧接不住就一条都不发（systemFreeMiB 未知按 0 预算，与 solveMaxContext 同一保守口径）
  const ramBudgetMiB = systemFreeMiB === null ? 0 : Math.max(0, systemFreeMiB - RAM_OVERHEAD_MIB);
  if (mustSpillMiB > ramBudgetMiB) return recs;

  // MoE：专家权重整体挪内存是最省事的一刀（显卡只留当下要用的那几个专家）
  if ((info.expert_count ?? 0) > 1) {
    recs.push({ key: 'cpu_moe', value: true, reasonKey: 'offload_rec_cmoe', offloadRelief: true });
  }
  // 卸载层数降档：放得下多少层就放多少层（其余层权重进内存），稠密/MoE 都适用
  const ngl = partialOffloadLayers(info, fileSizeBytes, deviceFreeMiB);
  if (ngl !== null && info.block_count && ngl < info.block_count) {
    recs.push({
      key: 'gpu_layers',
      value: ngl,
      reasonKey: 'offload_rec_ngl',
      reasonArgs: [ngl, info.block_count],
      offloadRelief: true,
    });
  }
  // 多卡：先只用空闲显存最多的那块，再按空闲显存比例把权重摊到各卡上（合计容量才够）
  const devices = input.devices ?? [];
  if (devices.length >= 2) {
    const best = [...devices].sort((a, b) => b.freeMiB - a.freeMiB)[0];
    recs.push({
      key: 'device',
      value: best.id,
      reasonKey: 'offload_rec_device',
      reasonArgs: [best.id],
      offloadRelief: true,
    });
    // 份数按各卡空闲 GiB 取整（≥1，全 0 的设备不参与），顺序沿用入参数组顺序
    const split = devices.map((d) => Math.max(1, Math.round(d.freeMiB / 1024))).join(',');
    recs.push({
      key: 'tensor_split',
      value: split,
      reasonKey: 'offload_rec_split',
      reasonArgs: [split],
      offloadRelief: true,
    });
  }

  return recs;
}
