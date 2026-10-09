// @vitest-environment happy-dom
/**
 * 参数页「运行中 ≠ 当前参数」提示槽（.stale-slot）的呈现与接线（2026-10-09）：
 *  - 槽常驻（#81 防跳动）：差异数为 0 时 .stale-slot 仍在 DOM，只是不渲染内容；
 *  - 差异数 > 0：orange a-tag 渲染短句（hint_stale_running_s，计数嵌入文案），
 *    完整长句（cmd_stale_running）只进 ToolTip 的 text prop，不出现在可见文本；
 *  - 点「重启」直达 useStartServer().restart()（与顶栏同一流程，点击一次恰好调用一次）。
 * 页面契约是呈现与转发：信号源状态门控归 useStaleParams.test.ts，比较口径归 params.test.ts。
 * 重型子树（PageFrame/Card/ParamRow/Arco 控件）以透传 stub 缩容，页面保持轻量挂载。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';

// ---- 桩：信号源（真 ref，模板里随 .value 响应）+ 重启转发断言 ----
const restartMock = vi.fn(async () => true);
vi.mock('@/composables/useStartServer', () => ({
  useStartServer: () => ({ start: vi.fn(async () => true), restart: restartMock }),
}));

const staleRef = ref(0);
vi.mock('@/composables/useStaleParams', () => ({
  useStaleParams: () => staleRef,
}));

vi.mock('@/composables/useVramEstimate', () => ({
  useVramEstimate: () => ({ estimate: ref(null) }),
}));

vi.mock('@/composables/useConfirm', () => ({
  confirm: vi.fn(async () => true),
}));

const paramsMock = {
  values: { model: 'D:/Models/demo.gguf' } as Record<string, unknown>,
  hasChanges: false,
  set: vi.fn(),
  resetCurrentModel: vi.fn(async () => {}),
};
vi.mock('@/stores/params', () => ({
  useParamsStore: () => paramsMock,
}));

vi.mock('@/stores/i18n', () => ({
  useI18nStore: () => ({ t: (k: string, args?: unknown[]) => k + (args?.length ? `:${args.join(',')}` : '') }),
}));

import ParamsPage from './ParamsPage.vue';

/** 透传 stub：默认/具名槽照常渲染，Arco 控件缩容成原生元素（单根，@click 经 attrs 透传） */
const globalStubs = {
  stubs: {
    PageFrame: { template: '<div><slot /></div>' },
    Card: { template: '<div><slot name="actions" /><slot /></div>' },
    ParamRow: true,
    Icon: true,
    ToolTip: { template: '<span><slot /></span>' },
    'a-statistic': { template: '<span><slot name="suffix" /><slot /></span>' },
    'a-tag': { template: '<span class="tag-stub"><slot /></span>' },
    'a-button': { template: '<button type="button"><slot /></button>' },
    'a-dropdown': { template: '<div><slot /><slot name="content" /></div>' },
    'a-doption': { template: '<div><slot /></div>' },
  },
};

function mountPage() {
  return mount(ParamsPage, { global: globalStubs });
}

beforeEach(() => {
  staleRef.value = 0;
  restartMock.mockClear();
});

describe('ParamsPage 运行中参数差异提示槽', () => {
  it('差异数为 0：槽常驻但内部无内容（无标签、无重启按钮，#81 防跳动）', () => {
    const wrapper = mountPage();
    const slot = wrapper.find('.stale-slot');
    expect(slot.exists()).toBe(true);
    expect(slot.find('.stale-tag').exists()).toBe(false);
    expect(slot.find('button').exists()).toBe(false);
  });

  it('差异数 > 0：orange 标签渲染短句并把计数嵌入文案，长句不出现在可见文本（归 ToolTip）', async () => {
    staleRef.value = 2;
    const wrapper = mountPage();
    await nextTick();
    const slot = wrapper.find('.stale-slot');
    const tag = slot.find('.stale-tag');
    expect(tag.exists()).toBe(true);
    expect(tag.text()).toContain('hint_stale_running_s:2');
    expect(slot.text()).not.toContain('cmd_stale_running');
  });

  it('点「重启」直达 useStartServer().restart()（与顶栏同一流程，每点一次恰好一次）', async () => {
    staleRef.value = 3;
    const wrapper = mountPage();
    await nextTick();
    const btn = wrapper.find('.stale-slot button');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('restart');
    await btn.trigger('click');
    expect(restartMock).toHaveBeenCalledTimes(1);
  });
});
