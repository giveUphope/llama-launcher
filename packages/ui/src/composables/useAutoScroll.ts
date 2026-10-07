// 控制台/日志列表的自动滚动（此前 LogsPage / ServicePage / DashboardPage 各抄一份，
// 且已经抄漂：距底阈值一版 60 一版 80、三处只有两处有 pageActive 门控，见 STYLE_TODO #83）。
// 守的三条规则（frontend.md §7.1 铁律①③）：
//   ① keep-alive 停用期不滚动——读 scrollHeight 是强制同步布局，后台页不该每来一行做一次；
//      回到本页时补滚一次到底。
//   ② 同帧多条日志只滚一次（rAF 合帧）。
//   ③ 「用户是否在底部」只由距底距离判定，判定阈值只在这里定义一次。
import { onActivated, onBeforeUnmount, onDeactivated, ref, watch, type Ref } from 'vue';

export interface UseAutoScrollOptions {
  /** 行数来源：值变化即视为「来了新行」（各页传自己数据源的长度，这里不认 store） */
  count: () => number;
  /** 是否维护「有新日志」提示；概览页的迷你问题列表没有胶囊，传 false */
  pill?: boolean;
}

export function useAutoScroll(
  containerRef: Ref<HTMLElement | null>,
  options: UseAutoScrollOptions,
) {
  const withPill = options.pill !== false;
  const autoScroll = ref(true);
  const hasNewLogs = ref(false);
  const pageActive = ref(true);
  let scrollScheduled = false;
  let scrollFrame = 0;

  /** force = 显式请求（胶囊点击 / 页面重回可见）：即便用户已拨离底部也执行；
   *  默认（日志到达的自动滚动）则尊重排队期间的用户滚动——见帧内守卫 */
  function scrollToBottom(force = false) {
    if (scrollScheduled) {
      if (!force) return;
      cancelPendingScroll();
    }
    scrollScheduled = true;
    const isForced = force;
    scrollFrame = requestAnimationFrame(() => {
      scrollScheduled = false;
      const el = containerRef.value;
      if (!el) return;
      // 排队期间用户可能已把滚动条拨走（scroll 事件把 autoScroll 置假）：此刻尊重用户位置，
      // 不再强行拨底——否则排队帧会把用户刚拨到的位置覆盖掉，「有新日志」状态也随之丢失
      // （e2e logs-scroll 胶囊用例的间歇失败即此竞态：拨 0 恰好落在排队帧之前）。
      if (!autoScroll.value && !isForced) return;
      el.scrollTop = el.scrollHeight;
      autoScroll.value = true;
      hasNewLogs.value = false;
    });
  }

  // 停用既不再排新帧，也要撤掉已排队未执行的那一帧（keep-alive 下 onUnmounted 不会执行）
  function cancelPendingScroll() {
    if (!scrollScheduled) return;
    cancelAnimationFrame(scrollFrame);
    scrollScheduled = false;
  }

  function onScroll() {
    const el = containerRef.value;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScroll.value = dist < 60;
    if (autoScroll.value) hasNewLogs.value = false;
  }

  watch(
    () => options.count(),
    () => {
      if (!pageActive.value) {
        if (withPill) hasNewLogs.value = true;
        return;
      }
      if (autoScroll.value) scrollToBottom();
      else if (withPill) hasNewLogs.value = true;
    },
  );

  onActivated(() => {
    pageActive.value = true;
    scrollToBottom(true);
  });
  onDeactivated(() => {
    pageActive.value = false;
    cancelPendingScroll();
  });
  onBeforeUnmount(cancelPendingScroll);

  return { autoScroll, hasNewLogs, pageActive, scrollToBottom, onScroll };
}
