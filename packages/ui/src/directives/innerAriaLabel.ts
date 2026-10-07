import type { Directive } from 'vue';

/** 当前名称（focusin 自愈时用，避免为每次聚焦重算绑定值） */
const current = new WeakMap<HTMLElement, string>();

function applyLabels(root: HTMLElement, text: string) {
  if (!text) return;
  root
    .querySelectorAll<HTMLElement>('input:not([aria-label]), [role="slider"]:not([aria-label])')
    .forEach((node) => node.setAttribute('aria-label', text));
}

/**
 * 给「Arco 把可聚焦节点藏在内层、又不给属性钩子」的控件补可读名称。
 *
 * 存在的理由（两处库层事实，均已读 es 产物确认）：
 * - Slider：`slider-button.js` 的句柄确实 `mergeProps(_ctx.$attrs, …)`，但 `slider.js` 从不把
 *   `$attrs` 传下去，所以写在 `<a-slider>` 上的 `aria-label` 只能停在 `.arco-slider` 外层，
 *   键盘真正停靠的 `div[role=slider]` 仍然无名。
 * - Select：`a-select` 没有 `input-attrs` 这类 prop，键盘事件实际落在内层
 *   `input.arco-select-view-input` 上，它的名字来自 `placeholder`（即首个选项文案，如 `auto`），
 *   对读屏等于「auto 编辑框」而不是「下拉模式」。
 *
 * 只写「还没有 aria-label」的节点，绝不覆盖组件自己声明的名称。
 * 这是命名兜底而不是第二套命名机制——名称文本仍由调用方从 i18n 取，这里只负责送到内层节点。
 *
 * **用法约束：指令必须挂在单根元素上（现有调用点都挂在 `a-form-item` 这一层）。**
 * Vue 对多根组件的自定义指令会整体跳过（不报错、静默失效），而 `a-select` 正是多根
 * （select-view + popup），实测挂在 `<a-slider>` 上生效、挂在 `<a-select>` 上一点痕迹都没有。
 * 挂在 form-item 上顺带覆盖整行的内层可聚焦节点。**它只管两类库没有命名入口的节点**：
 * 滑杆的 `div[role=slider]`（Slider 不透传 `$attrs` 给手柄）与下拉的内层
 * `input.arco-select-view-input`（Select 没有 `input-attrs`）。数字框 / 文本框 / 文件框
 * 走的是官方 `input-attrs`（`IntEntryParam` / `SliderParam` 的数值侧 / `TextParam` /
 * `FileParam` 四处），不经过本指令——**别把它当重复删掉那些 `input-attrs`**，删了那些
 * 控件的名字就没了。
 */
export const vInnerAriaLabel: Directive<HTMLElement, string> = {
  created: (el, binding) => {
    current.set(el, binding.value);
  },
  mounted: (el, binding) => {
    applyLabels(el, binding.value);
    // Select 的内层 input 在 mounted 之后还会被 Arco 重建（实测冷加载时滑杆补得上、Select 补不上），
    // 所以再挂一个捕获期 focusin 自愈：读屏取名字发生在焦点落上之后，同步监听必然先执行。
    // 不用 MutationObserver——参数页 68 行各挂一个观察器，代价远超这条兜底的价值。
    el.addEventListener('focusin', () => applyLabels(el, current.get(el) ?? ''), true);
  },
  updated: (el, binding) => {
    current.set(el, binding.value);
    if (binding.value !== binding.oldValue) applyLabels(el, binding.value);
  },
};
