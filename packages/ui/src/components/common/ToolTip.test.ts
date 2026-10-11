// @vitest-environment happy-dom
/**
 * 统一提示浮层的 `overflowOnly` 判据（2026-10-11 用户两次批注：没被省略号截断的文本
 * 不该弹「把同一句话再说一遍」的气泡）。钉三态：
 *  - 开 `overflowOnly` 且量出截断 ⇒ 内层 `a-tooltip` 不 disabled（完整值必须能读到）；
 *  - 开 `overflowOnly` 但未截断 ⇒ disabled（回声是噪声）；
 *  - 不开 `overflowOnly` ⇒ 恒不 disabled——动作提示（打开目录 / 启动）与「浮层里带着
 *    界面上看不到的信息」的那几处（模型名 → 完整路径、短句 → 长句）不得被牵连。
 * happy-dom 不做布局，`scrollWidth` / `clientWidth` 由桩给出；它也没有 ResizeObserver，
 * 组件侧用 `typeof ResizeObserver !== 'undefined'` 守卫，故首测走的是挂载后的 nextTick 测量。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ArcoVue, { Tooltip as ArcoTooltip } from '@arco-design/web-vue';
import ToolTip from './ToolTip.vue';

function stubOverflow(truncated: boolean) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => (truncated ? 400 : 21) });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => (truncated ? 200 : 21) });
}

afterEach(() => {
  delete (HTMLElement.prototype as unknown as { scrollWidth?: unknown }).scrollWidth;
  delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth;
});

async function renderTip(overflowOnly: boolean) {
  const wrapper = mount(ToolTip, {
    props: { text: 'http://127.0.0.1:9931', overflowOnly },
    slots: { default: '<span class="mono-val">http://127.0.0.1:9931</span>' },
    global: { plugins: [ArcoVue] },
  });
  await nextTick();
  await nextTick();
  const inner = wrapper.findComponent(ArcoTooltip);
  expect(inner.exists(), '样本要求：内层必须渲染出 a-tooltip').toBe(true);
  return Boolean(inner.props('disabled'));
}

describe('ToolTip 的 overflowOnly', () => {
  it('开开关且量出截断：不 disabled（完整值必须读得到）', async () => {
    stubOverflow(true);
    expect(await renderTip(true)).toBe(false);
  });

  it('开开关但未截断：disabled（回声气泡是噪声）', async () => {
    stubOverflow(false);
    expect(await renderTip(true)).toBe(true);
  });

  it('不开开关：恒不 disabled（动作提示与信息补充型提示不受影响）', async () => {
    stubOverflow(false);
    expect(await renderTip(false)).toBe(false);
  });
});
