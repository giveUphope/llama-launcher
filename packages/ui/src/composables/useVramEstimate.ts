/**
 * 显存/硬件占用估算 composable：调用主进程 `system:estimateVram`
 * （--list-devices 探测 + GGUF KV 内存模型 + 会话参数驱动的硬件占用估算 + 性能目标联动建议），
 * 结果随模型路径/KV dtype/性能目标/会话占用配置（卸载层数、上下文）变化自动刷新。
 * 主进程侧已按 (模型|dtype|target|ngl|ctx) 缓存 60s，此处不重复缓存，只做请求节流；
 * 估算失败/无设备时 estimate 为 null（调用方降级显示，静默不报错）。
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { VramEstimateResult, PerfTarget, OccupancyConfig } from '@llama-launcher/shared';

// 拖动滑块/连打数字时 occ 的对象身份每键都变（调用方传的是 computed），
// 不去抖就是每键一次跨进程估算——且主进程缓存 key 含 ctxSize，每个中间值都是 miss。
const REFRESH_DEBOUNCE_MS = 300;

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

  let timer: ReturnType<typeof setTimeout> | null = null;
  // 首次立即估算（进入页面即要有数），其后变化去抖合并
  let first = true;
  // occ 传的是 computed（每次求值都是新对象），故按引用比较即可，无需 deep 遍历
  watch([modelPath, dtype, target, occ], () => {
    if (first) {
      first = false;
      void refresh();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, { immediate: true });

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  return { estimate, loading, refresh };
}
