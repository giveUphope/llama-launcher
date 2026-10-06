import { getCurrentInstance, nextTick, onScopeDispose, watch } from 'vue';

/** 可 Tab 到的原生控件 + 显式 tabindex（Arco 的弹窗关闭 ✕ 是 tabindex="-1"，不进 Tab 序列） */
const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export interface UseDialogFocusOptions {
  /** 与 `<a-modal :visible>` 同源的那份可见性 */
  visible: { readonly value: boolean };
  /** 挂在 `<a-modal>` 上的唯一 class：Arco 把它透传到 `.arco-modal-container`，据此定位弹窗 DOM */
  containerClass: string;
}

export interface UseDialogFocusReturn {
  /** 供 `aria-labelledby` 引用、渲染在 `#title` 插槽里的标题节点 id */
  titleId: string;
}

function isVisibleElement(el: HTMLElement): boolean {
  // 关闭态的 .arco-modal-container 是 display:none，其后代 getClientRects() 为空数组（实测），
  // 据此把藏在关闭弹窗里的控件排除出 Tab 环；聚焦态一并放行，避免正被操作时被当成不可见
  return el.getClientRects().length > 0 || el === document.activeElement;
}

/**
 * 给 Arco a-modal 补上焦点管理：打开时移入弹窗内首个可交互控件、Tab/Shift+Tab 在弹窗内循环、
 * 关闭时把焦点归还给打开它的元素。对话框语义（role/aria-modal/aria-labelledby）在模板上声明，
 * 这里只管焦点——三个弹窗挂在 App 层而非 keep-alive 页面，收口一律跟着 visible 开/关配对。
 */
export function useDialogFocus(options: UseDialogFocusOptions): UseDialogFocusReturn {
  const uid = getCurrentInstance()?.uid ?? 0;
  const titleId = `dlg-title-${uid}`;
  let opener: HTMLElement | null = null;

  const getContainer = () => document.querySelector<HTMLElement>(`.${options.containerClass}`);

  const tabbables = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(isVisibleElement);

  function focusIntoDialog(root: HTMLElement) {
    const items = tabbables(root);
    if (items.length > 0) {
      items[0].focus();
      return;
    }
    // 无常规控件时退而聚焦 Arco 的关闭按钮，再退而聚焦对话框本身（模板上带 tabindex="-1"）
    const closeBtn = root.querySelector<HTMLElement>('.arco-modal-close-btn');
    (closeBtn ?? root).focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const root = getContainer();
    if (!root) return;
    const items = tabbables(root);
    if (items.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) {
      // 焦点已在弹窗外（被别处抢走 / 打开即点在遮罩上）：拉回弹窗边缘
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    const idx = items.indexOf(active);
    if (e.shiftKey && idx <= 0) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && idx === items.length - 1) {
      e.preventDefault();
      first.focus();
    }
  }

  function attach() {
    document.addEventListener('keydown', onKeydown, true);
  }
  function detach() {
    document.removeEventListener('keydown', onKeydown, true);
  }

  watch(
    () => options.visible.value,
    (opened) => {
      if (opened) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        attach();
        void nextTick(() => {
          if (!options.visible.value) return;
          const root = getContainer();
          if (root) focusIntoDialog(root);
        });
        return;
      }
      detach();
      const target = opener;
      opener = null;
      if (!target || !target.isConnected) return;
      const active = document.activeElement;
      const root = getContainer();
      const inDialog = !!root && !!active && root.contains(active);
      // 用户已把焦点移到别处（点了页面其它控件）时不抢回，否则关弹窗会改写用户的焦点
      if (!active || active === document.body || inDialog) target.focus();
    },
  );

  onScopeDispose(detach);

  return { titleId };
}
