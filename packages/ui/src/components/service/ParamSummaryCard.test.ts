// @vitest-environment happy-dom
/**
 * 参数摘要 chip 的浮层归属判据（TODO T30，2026-10-11 用户三条批注）。
 * 守的三条行为：
 *  - **一处一事**：键名那只提示挂 CLI flag、值区那只挂完整值，两层不再叠在同一块文本上
 *    （改前外层包着整只 chip，悬停值区会内外两层同时命中 → 屏幕上一角一只、两只气泡）；
 *  - **等号不属任何命中区**：鼠标停在「=」上不该冒出参数气泡；
 *  - **值区提示只在量出截断时启用**：`0.7` 这种短值不弹，长路径被省略号截断才弹。
 * happy-dom 不做布局，`scrollWidth` / `clientWidth` 恒 0，故两态都由桩给出——
 * 这里钉的是「组件按量到的结果决定 disabled」这条逻辑，浏览器里真的截断没有另测。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import ArcoVue, { Tooltip as ArcoTooltip } from '@arco-design/web-vue';
import ParamSummaryCard from './ParamSummaryCard.vue';
import ToolTip from '@/components/common/ToolTip.vue';

const lang = ref<'zh' | 'en'>('zh');
const i18nMock = reactive({
  lang,
  t: (key: string) => key,
  paramLabel: (key: string) => `label_${key}`,
});

// 模型长路径（必然要省略）+ temperature 0.7（默认值 0.8 之外，短值）
const paramsMock = reactive({
  values: {
    model: 'D:/Models/Qwen3-32B-A3B-Instruct/Qwen3-32B-A3B-Instruct-Q4_K_M.gguf',
    temperature: 0.7,
  } as Record<string, unknown>,
});

vi.mock('@/stores/i18n', () => ({ useI18nStore: () => i18nMock }));
vi.mock('@/stores/params', () => ({ useParamsStore: () => paramsMock }));

/** 把「是否截断」做成可切换的桩：组件量的是 scrollWidth vs clientWidth */
function stubOverflow(truncated: boolean) {
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => (truncated ? 400 : 21) });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => (truncated ? 200 : 21) });
}

async function mountCard(truncated: boolean) {
  stubOverflow(truncated);
  const wrapper = mount(ParamSummaryCard, { global: { plugins: [ArcoVue] } });
  await flushPromises();
  await nextTick();
  await nextTick();
  await nextTick(); // ToolTip 的截断测量在自身 onMounted 的 nextTick 里，多等一帧取到结果
  return wrapper;
}

/** 按提示文本取**内层 a-tooltip** 的 disabled：截断判定已下沉到 ToolTip（T32），
 *  读组件自己的 prop 会永远得到 false，等于没测。 */
function tipsByText(wrapper: Awaited<ReturnType<typeof mountCard>>) {
  const map = new Map<string, { disabled: boolean }>();
  for (const tip of wrapper.findAllComponents(ToolTip)) {
    const text = String(tip.props('text') ?? '');
    const inner = tip.findComponent(ArcoTooltip);
    expect(inner.exists(), `提示「${text}」必须渲染出 a-tooltip`).toBe(true);
    map.set(text, { disabled: Boolean(inner.props('disabled')) });
  }
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as { scrollWidth?: unknown }).scrollWidth;
  delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth;
});

describe('参数摘要 chip 的浮层归属', () => {
  it('未截断时值区提示保持禁用，键名提示照常', async () => {
    const wrapper = await mountCard(false);
    const tips = tipsByText(wrapper);
    expect(tips.get('0.7')?.disabled, '短值没被省略号截断，不该弹完整值').toBe(true);
    expect(tips.get('-m')?.disabled, '键名那只与截断无关，照常可用').toBe(false);
  });

  it('值被截断时值区提示启用', async () => {
    const wrapper = await mountCard(true);
    const tips = tipsByText(wrapper);
    expect(tips.get('0.7')?.disabled, '量出截断就必须给出完整值，否则用户读不到被省略的部分').toBe(false);
  });

  it('等号不落在任何提示的命中区里', async () => {
    const wrapper = await mountCard(false);
    const eqs = wrapper.findAll('.chip-eq');
    expect(eqs.length, '样本要求：摘要里必须有等号').toBeGreaterThan(0);
    for (const eq of eqs) {
      expect(eq.element.closest('.tooltip-host'), '悬停等号不该出气泡').toBeNull();
    }
  });

  it('chip 自身不被提示包裹（外层那只只包键名，不再嵌套）', async () => {
    const wrapper = await mountCard(false);
    const chips = wrapper.findAll('.summary-chip');
    expect(chips.length, '样本要求：至少模型 + 温度两只 chip').toBeGreaterThanOrEqual(2);
    for (const chip of chips) {
      expect(chip.element.closest('.tooltip-host'), 'chip 被整只包进提示 = 两层嵌套回潮').toBeNull();
      const hosts = chip.findAll('.tooltip-host');
      expect(hosts.length, '键名与值各一只宿主，不多不少').toBe(2);
      for (const host of hosts) {
        expect(host.element.parentElement, '宿主必须直接挂在 chip 上').toBe(chip.element);
      }
    }
  });
});
