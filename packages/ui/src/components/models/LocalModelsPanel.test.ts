// @vitest-environment happy-dom
/**
 * 模型表行内徽章（伴随文件标签 / 显存适配 / 体检结果）的回归用例。
 *
 * 守的规矩是 docs/zh/frontend.md §7.1 铁律②：列表行的派生值必须在数据落地时算一次并随条目
 * 携带，不得放在 v-for 的函数调用里逐行重算。这里用两条手段把规矩变成可执行判据：
 *  ① 把 fit 结果的 verdict 做成计数 getter——渲染路径若还去现算徽章，读取次数就会随重渲染上涨
 *    （STYLE_TODO #85 要求补的「制造第二次重渲染再断言」那条用例即 ②）；
 *  ② 断言「徽章仍跟着数据变」：模型集变化触发重新估算后徽章要换、体检推送要改写那一行的徽章与
 *    按钮禁用态、界面语言切换要重算徽章文本（预计算后语言切换不再走渲染路径，最容易漏的一环）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import type { LlamaBenchJobState, ModelFitResult, ModelInfo } from '@llama-launcher/shared';
import LocalModelsPanel from './LocalModelsPanel.vue';
import ToolTip from '@/components/common/ToolTip.vue';

// ---- 夹具 ----
const DIR = 'D:/models';
function model(name: string, tags?: string[]): ModelInfo {
  return {
    name,
    path: `${DIR}/${name}`,
    size: 1000,
    size_str: '1 KB',
    modified: '2026-08-01T00:00:00.000Z',
    ...(tags ? { tags } : {}),
  };
}
const A = model('a.gguf');
const B = model('b.gguf', ['mmproj']);

/** verdict 读取次数：渲染路径本来不该再读它（铁律②的探针） */
let verdictReads = 0;
function fitFixture(verdict: ModelFitResult['verdict']): ModelFitResult {
  return {
    get verdict() {
      verdictReads += 1;
      return verdict;
    },
    maxContext: 20480,
    weightsMiB: 19968,
    dtype: 'q8_0',
  } as ModelFitResult;
}

// ---- store 桩（i18n 用 reactive 包 ref，与真实 setup store 的属性解包行为一致）----
const lang = ref<'zh' | 'en'>('zh');
/** 桩文案 = 键名|语言|占位符槽数：既证明走了 i18n，也顺带盯住槽数没写错 */
const t = vi.fn((key: string, args?: (string | number)[]) => `${key}|${lang.value}|${args?.length ?? 0}`);
const i18nMock = reactive({ lang, t });
const settingsMock = reactive({ settings: { models_dir: DIR } });
const paramsMock = reactive({
  values: {} as Record<string, unknown>,
  ggufSuggestions: [] as unknown[],
  ggufLoading: false,
  ggufError: null as string | null,
  set: (k: string, v: unknown) => { paramsMock.values[k] = v; },
  applyModel: async () => true,
  applyModelWithSuggestions: async () => {},
  reattachModelRuntime: async () => {},
});
const serverMock = { pushOutput: vi.fn(), pushOutputBatch: vi.fn() };
const appLogMock = { push: vi.fn() };

vi.mock('@/stores/i18n', () => ({ useI18nStore: () => i18nMock }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => settingsMock }));
vi.mock('@/stores/params', () => ({ useParamsStore: () => paramsMock }));
vi.mock('@/stores/server', () => ({ useServerStore: () => serverMock }));
vi.mock('@/stores/appLog', () => ({ useAppLogStore: () => appLogMock }));
vi.mock('@/composables/useConfirm', () => ({ confirm: async () => true }));

// ---- window.api 桩 ----
let scanList: ModelInfo[] = [];
let fitResponse: Record<string, ModelFitResult> = {};
let changedCb: (() => void) | null = null;
let benchCb: ((job: LlamaBenchJobState) => void) | null = null;

const api = {
  models: {
    scan: vi.fn(async () => scanList),
    watch: vi.fn(async () => {}),
    onChanged: vi.fn((cb: () => void) => { changedCb = cb; return () => { changedCb = null; }; }),
    remove: vi.fn(async () => ({ ok: true })),
    detectMmproj: vi.fn(async () => ''),
    detectDraft: vi.fn(async () => ''),
    readGgufMeta: vi.fn(async () => null),
  },
  system: {
    estimateModelFit: vi.fn(async () => fitResponse),
    benchLlamaStatus: vi.fn(async () => null),
    benchLlamaRun: vi.fn(async (p: string) => ({
      ok: true as const,
      data: { modelPath: p, state: 'running' as const },
    })),
    onBenchStatus: vi.fn((cb: (job: LlamaBenchJobState) => void) => { benchCb = cb; return () => { benchCb = null; }; }),
  },
  openPath: vi.fn(async () => ''),
};

/** 行内徽章排的文本序列（顺序即 DOM 顺序：标签 → fit → 体检） */
function badgeTexts(el: Element): string[] {
  return [...el.querySelectorAll('.model-tags .arco-tag')].map((n) => (n.textContent ?? '').trim());
}
/** 行内第 i 枚徽章的悬浮文案（ToolTip 的 text prop；原生 title 边界已于 2026-10-08 撤销） */
function badgeTip(row: ReturnType<typeof modelRows>[number], i: number): string {
  return (row.find('.model-tags').findAllComponents(ToolTip)[i]?.props('text') ?? '') as string;
}
function badgeTipDisabled(row: ReturnType<typeof modelRows>[number], i: number): boolean {
  return (row.find('.model-tags').findAllComponents(ToolTip)[i]?.props('disabled') ?? false) as boolean;
}
/** 行内「体检」钮（三只行操作钮里文本为 act_bench 的那只） */
function benchButton(row: Element): HTMLButtonElement {
  const found = [...row.querySelectorAll('.row-action')].find((b) => (b.textContent ?? '').includes('act_bench|'));
  return found as HTMLButtonElement;
}

let wrapper: ReturnType<typeof mount>;

async function mountPanel() {
  // 包进 KeepAlive：onActivated 才会触发（面板的 fit/体检订阅都配对在 activate/deactivate 上）。
  // show 开关供 deactivate/activate 循环使用（v-if=false 是「失活缓存」而非卸载——
  // 正是「切到模型库页签再切回本地模型」的测试态）。
  wrapper = mount(
    {
      components: { LocalModelsPanel },
      template: '<KeepAlive><LocalModelsPanel v-if="show" /></KeepAlive>',
      data: () => ({ show: true }),
    },
    { global: { plugins: [ArcoVue] } },
  );
  await flushPromises();
  await nextTick();
  await flushPromises();
}

/** KeepAlive 失活/重入（模拟「切到模型库页签 / 切回本地模型」） */
async function setActive(show: boolean) {
  (wrapper.vm as unknown as { show: boolean }).show = show;
  await nextTick();
  await flushPromises();
  await nextTick();
  await flushPromises();
}

/** 模型行（跳过 Arco 的 measure / placeholder 行——它们没有徽章排） */
function modelRows() {
  return wrapper.findAll('.models-table tbody .arco-table-tr').filter((r) => r.find('.model-tags').exists());
}
function rowOf(name: string) {
  return modelRows().find((r) => r.find('.model-name-row').text() === name)!;
}

beforeEach(async () => {
  vi.useRealTimers();
  scanList = [A, B];
  fitResponse = { [A.path]: fitFixture('fit'), [B.path]: fitFixture('partial') };
  verdictReads = 0;
  changedCb = null;
  benchCb = null;
  lang.value = 'zh';
  paramsMock.values = {};
  api.models.scan.mockClear();
  api.system.estimateModelFit.mockClear();
  (globalThis as any).window.api = api;
  await mountPanel();
});

describe('模型表行内徽章：派生值随条目携带（frontend.md §7.1 铁律②）', () => {
  it('扫描 + fit 落地后徽章按条目渲染：标签在前、fit 在后', () => {
    const rows = modelRows();
    expect(rows).toHaveLength(2);
    // 徽章文本自带勾/三角符号；两个槽（上下文上限 + dtype）落在悬浮文案上，不在文本里。
    // 悬浮文案挂在 ToolTip 的 text prop 上（2026-10-08 撤销 §7.5 原生 title 边界）
    expect(badgeTexts(rows[0].element)).toEqual(['✓ fit_full|zh|0']);
    expect(badgeTip(rows[0], 0)).toBe('msg_fit_full_tip|zh|2');
    expect(badgeTexts(rows[1].element)).toEqual(['mmproj', '△ fit_partial|zh|0']);
    expect(badgeTip(rows[1], 1)).toBe('msg_fit_partial_tip|zh|1');
    // 伴随文件标签本就没有悬浮文案（不因合并进同一数组而多出悬浮内容：text 空 + disabled）
    expect(badgeTip(rows[1], 0)).toBe('');
    expect(badgeTipDisabled(rows[1], 0)).toBe(true);
  });

  it('制造第二次重渲染：徽章文本不变，且不再逐行现算（verdict 读取次数不涨）', async () => {
    const before = badgeTexts(rowOf('b.gguf').element);
    const afterLoad = verdictReads;
    // 搜索框输入 → 清空 → 再输入：三次纯重渲染（两次都保持两行在场），期间没有任何 fit / 体检数据变更
    const input = wrapper.find('.search-row input');
    for (const q of ['.gguf', '', '.gguf']) {
      await input.setValue(q);
      await flushPromises();
      await nextTick();
      expect(modelRows()).toHaveLength(2);
    }
    expect(badgeTexts(rowOf('b.gguf').element)).toEqual(before);
    expect(verdictReads, `三次重渲染让 verdict 多读了 ${verdictReads - afterLoad} 次——渲染路径仍在逐行现算徽章`)
      .toBe(afterLoad);
  });

  it('模型集变化触发重新估算后，fit 结论变化会换掉徽章（含无占位符的键）', async () => {
    const C = model('c.gguf');
    fitResponse = { [A.path]: fitFixture('no'), [B.path]: fitFixture('no'), [C.path]: fitFixture('no') };
    scanList = [A, B, C];
    expect(changedCb, '页签激活时未订阅 models:onChanged').toBeTypeOf('function');
    changedCb!();
    await flushPromises();
    await nextTick();
    await flushPromises();
    const rows = modelRows();
    expect(rows).toHaveLength(3);
    expect(badgeTexts(rows[0].element)).toEqual(['✗ fit_no|zh|0']);
    expect(badgeTip(rows[0], 0)).toBe('msg_fit_no_tip|zh|0');
  });

  it('路径集合不变、只是多了伴随文件标签时，徽章照样当场补上（不等 fit 重估）', async () => {
    // 真实场景：模型目录里新增一个 mmproj/dflash 伴随文件——扫描回来的路径集合一模一样，
    // 只有 tags 变了，所以 refreshFit 根本不会被再次触发
    scanList = [A, model('b.gguf', ['mmproj', 'dflash'])];
    changedCb!();
    await flushPromises();
    await nextTick();
    await flushPromises();
    expect(api.system.estimateModelFit, '路径集合未变，不该重新发一次 fit 批量估算').toHaveBeenCalledTimes(1);
    expect(badgeTexts(rowOf('b.gguf').element)).toEqual(['mmproj', 'dflash', '△ fit_partial|zh|0']);
  });

  it('体检状态迁移只改写那一行：running 出徽章并禁用按钮，done 换成结果文本', async () => {
    // 点行内「体检」（第二只行操作钮），mock 的 run 返回 running → 走 applyBenchState 就地写单个 key
    await rowOf('a.gguf').findAll('.row-action')[1].trigger('click');
    await flushPromises();
    expect(badgeTexts(rowOf('a.gguf').element)).toEqual(['✓ fit_full|zh|0', 'bench_llama_running|zh|0']);
    expect(benchButton(rowOf('a.gguf').element).disabled).toBe(true);
    // 另一行不受这次单行改写影响：徽章没多出体检项，按钮也仍可用
    expect(badgeTexts(rowOf('b.gguf').element)).toEqual(['mmproj', '△ fit_partial|zh|0']);
    expect(benchButton(rowOf('b.gguf').element).disabled).toBe(false);

    const done: LlamaBenchJobState = {
      modelPath: A.path,
      state: 'done',
      summary: {
        modelPath: A.path, ppTokS: 1421.6, tgTokS: 96.4, ngl: 99,
        backend: 'Vulkan', modelType: 'qwen3 8B', testedAt: '2026-10-05T00:00:00.000Z',
      },
    };
    expect(benchCb, '页签激活时未订阅 system:onBenchStatus').toBeTypeOf('function');
    benchCb!(done);
    await flushPromises();
    await nextTick();
    // 期望值用与实现同一套取整/分组写法，避免被 Node 的 locale 分组差异绊倒
    const want = `pp ${Math.round(1421.6).toLocaleString()} · tg ${Math.round(96.4).toLocaleString()}`;
    expect(badgeTexts(rowOf('a.gguf').element)[1]).toBe(want);
    expect(benchButton(rowOf('a.gguf').element).disabled).toBe(false);
  });

  it('切换界面语言重算徽章文本（预算值不会停在旧语言）', async () => {
    expect(badgeTexts(modelRows()[0].element)).toEqual(['✓ fit_full|zh|0']);
    lang.value = 'en';
    await nextTick();
    await flushPromises();
    expect(badgeTexts(modelRows()[0].element)).toEqual(['✓ fit_full|en|0']);
  });

  it('onActivated 重入补扫：失活期完成的下载切回即重扫（B3，订阅失活期不补发）', async () => {
    scanList = [A];
    await mountPanel();
    const scansAfterMount = api.models.scan.mock.calls.length;
    expect(scansAfterMount).toBeGreaterThan(0);
    expect(changedCb, '挂载即订阅文件变更').toBeTypeOf('function');

    // 失活（切到模型库页签）：文件变更订阅退订——下载完成的 MODELS_CHANGED 不会补发
    await setActive(false);
    expect(changedCb).toBeNull();

    // 失活期间下载完成：本地多了一个新模型
    scanList = [A, B];

    // 切回：onActivated 重入立即补扫（core 有扫描缓存，非全量代价），
    // 不需要等下一次 .gguf 文件事件或重启
    await setActive(true);
    expect(changedCb, '重入即恢复订阅').toBeTypeOf('function');
    expect(api.models.scan.mock.calls.length).toBeGreaterThan(scansAfterMount);
    expect(modelRows().length).toBe(2);
  });
});
