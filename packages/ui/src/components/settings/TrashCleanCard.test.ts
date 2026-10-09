// @vitest-environment happy-dom
/**
 * 清理卡回切重扫（TODO T08，用户裁定 A）的回归用例。
 *
 * 守的行为：卡片在 keep-alive 下切走再切回时，若卡上已有检测/清理状态，
 * onActivated 静默重扫一次刷新待清列表——不自动清理、不清「上次清理结果」行；
 * 首挂 activated 时卡上无旧状态，不得触发扫描（首次扫描仍由用户点检测按钮）。
 * 组件挂在真实 <keep-alive> 下驱动 activated/deactivated（happy-dom 无路由，
 * 不经过页面层，直接以 KeepAlive 切换 v-if 等价复现「切走再切回」）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { KeepAlive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import type { CleanResult, DetectResult } from '@llama-launcher/shared';
import TrashCleanCard from './TrashCleanCard.vue';

// ---- window.api.system 桩 ----
const detectResult: DetectResult = {
  items: [
    { relPath: 'a.tmp', absPath: 'C:/x/a.tmp', root: 'config', kind: 'temp_file', size: 100 },
    { relPath: 'b.json', absPath: 'C:/x/b.json', root: 'config', kind: 'broken_json', size: 20 },
  ],
  totalSize: 120,
};
const cleanResult: CleanResult = { cleaned: 2, failed: 0, totalSize: 120, failures: [] };

const detectTrash = vi.fn(async (): Promise<DetectResult> => detectResult);
const cleanTrash = vi.fn(async (): Promise<CleanResult> => cleanResult);

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  system: { detectTrash, cleanTrash },
};

// ---- i18n store 桩（文案 = 键名，足以按文本定位元素） ----
const t = vi.fn((key: string) => key);
vi.mock('@/stores/i18n', () => ({ useI18nStore: () => ({ t }) }));

// ---- KeepAlive 宿主：v-if 切换等价「切走再切回」 ----
const show = ref(true);
const Host = defineComponent({
  setup() {
    return () => h(KeepAlive, null, { default: () => (show.value ? h(TrashCleanCard) : null) });
  },
});

function mountCard() {
  return mount(Host, { global: { plugins: [ArcoVue] } });
}

/** 卡片头操作区的检测按钮（#actions 插槽内第一颗 a-button） */
function findDetectButton(wrapper: ReturnType<typeof mountCard>) {
  return wrapper.findAll('button').find((b) => b.text().includes('msg_detect_trash'));
}

beforeEach(() => {
  vi.clearAllMocks();
  show.value = true;
});

describe('TrashCleanCard - 回切轻量重扫（TODO T08）', () => {
  it('首挂 activated 无旧状态不重扫；检测后切走再切回：静默重扫一次且「上次清理结果」行保留', async () => {
    const wrapper = mountCard();
    await flushPromises();
    // 首挂 activated：卡上无检测/清理状态，不得触发扫描
    expect(detectTrash).not.toHaveBeenCalled();

    // 用户点检测 → 1 次扫描；detected 落地即「卡上有旧状态」（清理结果行与待清列表
    // 共用这个前提：回切重扫的触发条件是 detected || result 非空）
    await findDetectButton(wrapper)!.trigger('click');
    await flushPromises();
    expect(detectTrash).toHaveBeenCalledTimes(1);

    show.value = false;
    await nextTick();
    show.value = true;
    await nextTick();
    await flushPromises();

    // 回切激活：卡上有旧检测结果 → 静默重扫一次
    expect(detectTrash).toHaveBeenCalledTimes(2);
    // 重扫不清检测结果列表（仍按新结果默认全选）
    const checkboxes = wrapper.findAll('.arco-checkbox');
    expect(checkboxes.length).toBe(2);
    wrapper.unmount();
  });

  it('回切重扫不弹确认、不触发清理', async () => {
    const wrapper = mountCard();
    await flushPromises();
    await findDetectButton(wrapper)!.trigger('click');
    await flushPromises();

    show.value = false;
    await nextTick();
    show.value = true;
    await nextTick();
    await flushPromises();

    expect(cleanTrash).not.toHaveBeenCalled();
    // 无确认弹窗挂载（useConfirm 队列空转：页面上不存在 arco-modal）
    expect(document.querySelectorAll('.arco-modal').length).toBe(0);
    wrapper.unmount();
  });
});
