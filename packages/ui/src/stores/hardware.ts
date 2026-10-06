/**
 * 权重落位 / 减负建议 store（服务页命令预览卡 + 概览页状态卡共用一份取数）。
 *
 * 出了什么事：llama-server 可以把模型里「当下用不到的那块权重」留在系统内存，只让显卡算
 * 要用的部分——24 GB 显存因此能跑远超显存的模型（MoE 类最明显），代价是内存→显卡的搬运
 * 决定出字速度。这两件事此前界面一句都没说过：装不下时只报错，跑起来慢也不知道为什么。
 *
 * 取数一律走**已有**的 `system:estimateVram` 通道（`--list-devices` 探测 + 占用估算 + 建议，
 * 主进程侧按 30s/60s 缓存），通道总数保持 57 不变；本 store 不新开 IPC。
 *
 * 分工边界：「装不下 ⇒ 该改哪个参数」这条判据只存在于 core 的
 * `recommendOffloadAdvice`（packages/core/src/target-recommend.ts），随建议条目下发
 * `offloadRelief` 标记；本文件只做两件事——把 MiB 换算成 GiB 数字、按标记分流展示。
 * 在这里再算一遍「weightsMiB > freeMiB」就是第二套判据，core 改了界面不会跟着改。
 */
import { defineStore } from 'pinia';
import { computed, ref, watch, type ComputedRef } from 'vue';
import { MODEL_KEY } from '@llama-launcher/shared';
import type { TargetRecommendation, VramEstimateResult } from '@llama-launcher/shared';
import { useParamsStore } from './params';

/** 参数改动去抖：拖滑块/连打数字时每次按键都跨进程估算会打爆主进程缓存 */
const REFRESH_DEBOUNCE_MS = 300;

/** 减负建议取的目标档：落位与「装不下」判定与目标无关，固定用均衡档的求解口径 */
const ADVICE_TARGET = 'balanced' as const;

/** 一句「权重落在哪」的展示派生值（文案键 + 纯数值 args，渲染端 t() 翻译） */
export interface PlacementLine {
  /** i18n 键：place_all_vram / place_split / place_all_ram */
  key: string;
  /** 只放数字与设备名——数据层不产文案 */
  args: (string | number)[];
  /** 有权重落在内存侧 ⇒ 存在搬运开销（界面用警示色，不用错误色） */
  spilled: boolean;
}

const mibToGiB = (mib: number): string => (mib / 1024).toFixed(1);

export const useHardwareStore = defineStore('hardware', () => {
  const params = useParamsStore();

  const estimate = ref<VramEstimateResult | null>(null);
  const loading = ref(false);

  // 估算入参全部来自会话参数（与参数页 useVramEstimate 同一口径，两侧显示的数才是一个数）
  const modelPath = computed(() => String(params.values[MODEL_KEY] ?? ''));
  const kvDtype = computed(() => String(params.values.cache_type_k ?? 'f16') || 'f16');
  const ngl = computed(() => String(params.values.gpu_layers ?? 'auto'));
  const ctxSize = computed(() => Number(params.values.ctx_size ?? 0) || 0);
  // 请求签名：只有真正影响估算结果的四项变了才重发。occ 每次求值都是新对象，
  // 按引用比较会在无关参数上反复跨进程取数。
  const signature = computed(() => `${modelPath.value}|${kvDtype.value}|${ngl.value}|${ctxSize.value}`);

  let timer: ReturnType<typeof setTimeout> | null = null;
  // 迟到的响应不得覆盖新一轮结果（改模型时两次请求会重叠）
  let seq = 0;

  async function refresh(): Promise<void> {
    const path = modelPath.value;
    if (!path) {
      estimate.value = null;
      return;
    }
    const mine = ++seq;
    loading.value = true;
    try {
      const res = await window.api.system.estimateVram(path, kvDtype.value, ADVICE_TARGET, {
        ngl: ngl.value,
        ctxSize: ctxSize.value,
        kvDtype: kvDtype.value,
      });
      if (mine === seq) estimate.value = res;
    } catch {
      // 浏览器预览缺函数 / 主进程异常：静默降级（两行常驻槽都会转入隐藏态）
      if (mine === seq) estimate.value = null;
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  // 订阅计数：keep-alive 页面不卸载（§7.1 铁律①），取数必须随「本页真的可见」进出，
  // 否则后台页会一直跟着参数改动敲主进程。返回 release，与 server.enterPropsWatch 同形。
  let subscribers = 0;
  let stopWatch: (() => void) | null = null;

  function enter(): () => void {
    subscribers += 1;
    if (subscribers === 1) {
      void refresh();
      stopWatch = watch(signature, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void refresh();
        }, REFRESH_DEBOUNCE_MS);
      });
    }
    let released = false;
    return () => {
      if (released) return; // release 幂等（activated/deactivated/unmounted 三处都可能调到）
      released = true;
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers > 0) return;
      stopWatch?.();
      stopWatch = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }

  /**
   * 「主体在显卡、闲置部分在内存」那一句的派生：只在同时拿到设备与占用估算时成立，
   * 缺任一项就返回 null（隐藏整行）。数字全部来自 core estimateOccupancy，未测得的量
   * （例如「慢多少 token/s」）一概不出现在文案里。
   */
  const placement: ComputedRef<PlacementLine | null> = computed(() => {
    const e = estimate.value;
    const occ = e?.occupancy;
    if (!e || !occ || e.devices.length === 0) return null;
    const gpuW = occ.vram.weightsMiB;
    const ramW = occ.ram.weightsMiB;
    if (gpuW === null) return null;
    // 显存侧归属「空闲最多的那块」——与 core 计算 ngl 用的那块一致
    const primary = [...e.devices].sort((a, b) => b.freeMiB - a.freeMiB)[0];
    if (gpuW <= 0) return { key: 'place_all_ram', args: [], spilled: true };
    if (ramW !== null && ramW > 0) {
      return { key: 'place_split', args: [mibToGiB(gpuW), primary.name, mibToGiB(ramW)], spilled: true };
    }
    return { key: 'place_all_vram', args: [mibToGiB(gpuW), primary.name], spilled: false };
  });

  /**
   * 减负建议条目：core 已判定「装不下」并发了条目，这里只滤掉「会话里本来就是这个值」的
   * （已经在正确位置上，不必再让用户点一次）。
   */
  const relief: ComputedRef<TargetRecommendation[]> = computed(() => {
    const recs = estimate.value?.recommendations ?? [];
    return recs.filter(
      (r) => r.offloadRelief === true && String(params.values[r.key] ?? '') !== String(r.value),
    );
  });

  return { estimate, loading, refresh, enter, placement, relief, modelPath, kvDtype };
});
