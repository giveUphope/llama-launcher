import { computed, type ComputedRef } from 'vue';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';

/**
 * 「运行中 ≠ 当前参数」差异数 —— 全站唯一信号源（2026-10-09 起）。
 * 消费方：设置页常规面板引擎提示、参数页状态条提示槽、顶栏重启按钮注意力脉冲。
 * 口径（原 GeneralPanel 本地实现原样收编）：服务 running/starting 且
 * `params.countDiffers(server.runningValues)` > 0；未运行或无运行快照时恒 0。
 * 差异比较逻辑只在 params store 的 countDiffers 一处——调整口径改那里，
 * 任何地方都不得再写第二套比较实现。
 */
export function useStaleParams(): ComputedRef<number> {
  const server = useServerStore();
  const params = useParamsStore();
  return computed(() => {
    if (server.status !== 'running' && server.status !== 'starting') return 0;
    return params.countDiffers(server.runningValues);
  });
}
