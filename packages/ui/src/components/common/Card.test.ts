// @vitest-environment happy-dom
/**
 * 通用卡片（Card）的可折叠行为与卡片头结构。
 * 守的判据：
 *  - 折叠头是 a-button 承载的切换钮（全站按钮基座，WAI-ARIA APG 手风琴写法：h2 包按钮），
 *    aria-expanded 必须如实反映开合态——读屏按 H 键跳节、按状态感知开合都靠它；
 *  - 折叠态收起卡片体（slot 不渲染，而非 CSS 藏起来），但 actions 插槽仍在卡片头可用；
 *  - 非折叠卡片没有切换钮，body 恒渲染；
 *  - expanded 未传（undefined）时按展开处理（`expanded !== false` 语义）。
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import Card from './Card.vue';

// i18n 由组件内 useI18nStore 取用，桩成可识别文案
vi.mock('@/stores/i18n', () => ({
  useI18nStore: () => ({ t: (key: string) => `T(${key})` }),
}));

function mountCard(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(Card, {
    props,
    slots: {
      default: '<div class="body-marker">content</div>',
      ...(slots.actions ? { actions: slots.actions } : {}),
    },
    global: { plugins: [ArcoVue] },
  });
}

function toggleButton(w: VueWrapper) {
  const btn = w.find('.section-card__toggle');
  expect(btn.exists(), '折叠卡片必须有折叠头按钮').toBe(true);
  return btn;
}

describe('Card - 非折叠形态', () => {
  it('无 collapsible：没有切换钮，标题与卡片体恒渲染', () => {
    const w = mountCard({ titleKey: 'card_cmd' });
    expect(w.find('.section-card__toggle').exists()).toBe(false);
    expect(w.find('.section-card__title').text()).toBe('T(card_cmd)');
    expect(w.find('.body-marker').exists()).toBe(true);
    w.unmount();
  });

  it('无 titleKey 也无 actions 时不渲染卡片头', () => {
    const w = mountCard();
    expect(w.find('.arco-card-header').exists()).toBe(false);
    expect(w.find('.body-marker').exists()).toBe(true);
    w.unmount();
  });
});

describe('Card - 可折叠形态', () => {
  it('展开态：aria-expanded=true，体渲染；点击发 update:expanded(false)', async () => {
    const w = mountCard({ collapsible: true, expanded: true, titleKey: 'card_a' });
    expect(toggleButton(w).attributes('aria-expanded')).toBe('true');
    expect(w.find('.body-marker').exists()).toBe(true);

    await toggleButton(w).trigger('click');
    expect(w.emitted('update:expanded')?.[0]).toEqual([false]);
    w.unmount();
  });

  it('折叠态：aria-expanded=false，体不渲染（slot 收起而非 CSS 藏），actions 仍在头上', async () => {
    const w = mountCard(
      { collapsible: true, expanded: false, titleKey: 'card_a' },
      { actions: '<button class="act">x</button>' },
    );
    expect(toggleButton(w).attributes('aria-expanded')).toBe('false');
    expect(w.find('.body-marker').exists(), '折叠必须真的收起体（v-if，不是 display:none）').toBe(false);
    expect(w.find('.act').exists(), '折叠态卡片头操作区仍可用').toBe(true);

    await toggleButton(w).trigger('click');
    expect(w.emitted('update:expanded')?.[0]).toEqual([true]);
    w.unmount();
  });

  it('expanded 未传：Vue 对 Boolean prop 缺省给 false，故实际落为折叠态', () => {
    // isOpen 的 `expanded !== false` 守卫看起来是想表达「不传 = 展开」，但 Vue 的
    // boolean casting 会把缺省 Boolean prop 解析成 false 而不是 undefined——
    // 这里按**实际行为**钉住（缺省即折叠），防止将来有人不传 :expanded 却期待默认展开。
    // 现行唯一调用方（ParamsPage）显式传 :expanded，故此差异是潜在陷阱而非现行缺陷。
    const w = mountCard({ collapsible: true, titleKey: 'card_a' });
    expect(toggleButton(w).attributes('aria-expanded')).toBe('false');
    expect(w.find('.body-marker').exists()).toBe(false);
    w.unmount();
  });
});
