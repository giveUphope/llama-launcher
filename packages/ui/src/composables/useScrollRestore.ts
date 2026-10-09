/**
 * 切页滚动位置恢复（TODO T09，用户裁定 A / 2026-10-09）。
 *
 * 为什么可行了：0.0.52 时代滚动容器是外层共享的 `.app-content`（不在 keep-alive 缓存内，
 * 切回后「容器还没长回原高度」→ 写入被夹回 0，两次实测失败已回退）。#82 骨架链改版把
 * 纵向滚动下移进每页自己的 `.page-frame`（随页面组件一起被 keep-alive 缓存），mock 实测
 * 切回时内容高度**立即**等于离开前（缓存 DOM 完整）——「等高度」只剩防御意义。
 * 因此恢复 = 激活后把存的 scrollTop 写回去；等待循环只为兜住异常路径（上限 30 帧）。
 *
 * 保存时机：route.fullPath 变化的 watch 回调（pre 阶段，旧页 DOM 仍在文档里）读旧页容器；
 * 恢复时机：nextTick（新页 DOM 已插回）后逐帧等高度就绪再写入。
 */
import { nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';

/** 恢复等待的帧数上限（60fps 下 ≈0.5s）：超限强制写入，不比不写差 */
const MAX_FRAMES = 30;

/** 滚动恢复需要的最小结构（lib.dom 的 scrollHeight 是 readonly，测试用普通对象充当容器，
 *  所以这里按结构而不是 HTMLElement 约束——生产侧传入的 .page-frame 天然满足） */
export interface ScrollHost {
  scrollTop: number;
  scrollHeight: number;
}

export interface ScrollRestore {
  save: (fullPath: string) => void;
  restore: (fullPath: string) => void;
  dispose: () => void;
}

export function createScrollRestore(getEl: () => ScrollHost | null, raf = requestAnimationFrame, caf = cancelAnimationFrame): ScrollRestore {
  /** fullPath → 离开时的 { scrollTop, scrollHeight }（高度是「内容已就绪」的判据） */
  const saved = new Map<string, { top: number; height: number }>();
  let rafId = 0;

  function save(fullPath: string) {
    const el = getEl();
    if (!el) return;
    saved.set(fullPath, { top: el.scrollTop, height: el.scrollHeight });
    // 快速连切：打断上一页还没写完的恢复，避免旧值污染新页
    caf(rafId);
  }

  function restore(fullPath: string) {
    const rec = saved.get(fullPath);
    if (!rec) return;
    let frames = 0;
    const tick = () => {
      const el = getEl();
      if (!el) return;
      frames++;
      // 内容高度达到离开时的量级才写——DOM 未插回/未布局时写入会被夹回 0
      if (el.scrollHeight >= rec.height || frames > MAX_FRAMES) {
        el.scrollTop = rec.top;
        return;
      }
      rafId = raf(tick);
    };
    rafId = raf(tick);
  }

  function dispose() {
    caf(rafId);
    saved.clear();
  }

  return { save, restore, dispose };
}

/** 接线：路由变化时保存旧页滚动、恢复新页滚动（PageHost 调用，host 是页面根容器） */
export function useScrollRestore(getEl: () => HTMLElement | null): ScrollRestore {
  const route = useRoute();
  const impl = createScrollRestore(getEl);
  watch(
    () => route.fullPath,
    async (_to, from) => {
      impl.save(from);
      await nextTick(); // keep-alive 完成组件替换后再恢复
      impl.restore(route.fullPath);
    },
  );
  return impl;
}
