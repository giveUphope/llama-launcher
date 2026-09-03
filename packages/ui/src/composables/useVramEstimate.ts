/**
 * 显存/硬件占用估算 composable：调用主进程 `system:estimateVram`
 * （--list-devices 探测 + GGUF KV 内存模型 + 会话参数驱动的硬件占用估算 + 性能目标联动建议），
 * 结果随模型路径/KV dtype/性能目标/会话占用配置（卸载层数、上下文）变化自动刷新。
 * 主进程侧已按 (模型|dtype|target|ngl|ctx) 缓存 60s，此处不做额外缓存；
 * 估算失败/无设备时 estimate 为 null（调用方降级显示，静默不报错）。
 */
import { ref, watch, type Ref } from 'vue';
import type { VramEstimateResult, PerfTarget, OccupancyConfig } from '@llama-launcher/shared';

export function useVramEstimate(
  modelPath: Ref<string>,
  dtype: Ref<string>,
  target: Ref<PerfTarget>,
  occ: Ref<OccupancyConfig>,
) {
  const estimate = ref<VramEstimateResult | null>(null);
  const loading = ref(false);

  async function refresh() {
    const p = modelPath.value;
    if (!p) {
      estimate.value = null;
      return;
    }
    loading.value = true;
    try {
      estimate.value = await window.api.system.estimateVram(p, dtype.value, target.value, occ.value);
    } catch {
      estimate.value = null; // 浏览器预览/主进程异常时静默降级
    } finally {
      loading.value = false;
    }
  }

  watch([modelPath, dtype, target, occ], () => { void refresh(); }, { immediate: true, deep: true });

  return { estimate, loading, refresh };
}
