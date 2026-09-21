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
import type { GgufModelInfo, PerfTarget, TargetRecommendation } from '@llama-launcher/shared';
import { KV_DTYPE_BYTES, solveMaxContext } from './vram-estimate.js';

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
 */
export function recommendForTarget(
  target: PerfTarget,
  info: GgufModelInfo,
  fileSizeBytes: number | null,
  freeMiB: number | null,
  systemFreeMiB: number | null,
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

  return recs;
}
