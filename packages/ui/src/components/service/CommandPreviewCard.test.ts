// @vitest-environment happy-dom
/**
 * 命令预览卡（服务页）：双文本框 + 复制行为的回归用例。
 * 守的行为判据：
 *  - 预览 = IPC 回传的 **argv 数组** 经 formatCommandLines 的一行一参查看形态，参数高频变更
 *    经 150ms 防抖合并后才走 IPC（拖滑块/预设应用时 params 每帧都在变）；
 *  - 复制 = formatCommand 单行形态，且 = 内置 argv + 扩展参数词法切分后的**合并**（二者同源等价，
 *    复制出去的命令要能在 shell 里原样执行）；无命令或生成失败时按钮禁用；
 *  - 生成失败给 i18n 友好提示（parseFailed 占住预览框），不暴露底层错误文本，恢复后自动清掉；
 *  - 扩展参数框是 settings.custom_args 的唯一编辑口，改动即触发持久化。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import CommandPreviewCard from './CommandPreviewCard.vue';

// ---- store 桩 ----
const lang = ref<'zh' | 'en'>('zh');
const t = vi.fn((key: string, args?: (string | number)[]) => `${key}|${lang.value}|${args?.length ?? 0}`);
const i18nMock = reactive({ lang, t });

const settingsMock = reactive({
  settings: { custom_args: '' } as { custom_args?: string } | null,
  save: vi.fn(async () => {}),
});

const paramsMock = reactive({
  values: { model: 'D:/models/m.gguf' } as Record<string, unknown>,
  snapshot: (): Record<string, unknown> => ({ ...paramsMock.values }),
});

const serverMock = {
  previewCommand: vi.fn(async (): Promise<string[]> => []),
};

vi.mock('@/stores/i18n', () => ({ useI18nStore: () => i18nMock }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => settingsMock }));
vi.mock('@/stores/params', () => ({ useParamsStore: () => paramsMock }));
vi.mock('@/stores/server', () => ({ useServerStore: () => serverMock }));

// ---- window.api.clipboard 桩 ----
const clipboardWrites: string[] = [];
(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  clipboard: {
    write: vi.fn(async (s: string) => {
      clipboardWrites.push(s);
    }),
  },
};

/** 预览框一行一参的形态（exe 行 + 缩进两格的 flag 行） */
const ARGV = ['D:/llama/llama-server.exe', '-m', 'D:/models/m.gguf', '-c', '4096'];
const PREVIEW = ['D:/llama/llama-server.exe', '  -m D:/models/m.gguf', '  -c 4096'].join('\n');
/** 防抖窗口：略大于组件里的 150ms */
const DEBOUNCE = 200;

let wrapper: ReturnType<typeof mount>;

async function mountCard() {
  wrapper = mount(CommandPreviewCard, { global: { plugins: [ArcoVue] } });
  await flushPromises();
  await new Promise((r) => setTimeout(r, DEBOUNCE));
  await flushPromises();
  await nextTick();
}

/** 两个文本域：0 = 内置命令（只读），1 = 扩展参数（可编辑） */
function textareas() {
  return wrapper.findAll('textarea');
}
/** 卡片头里的复制按钮（含 copy_cmd 文案的那只） */
function copyButton(): HTMLButtonElement {
  const btn = wrapper.findAll('button').find((b) => (b.text() ?? '').includes('copy_cmd'));
  if (!btn) throw new Error('copy button not found');
  return btn.element as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  clipboardWrites.length = 0;
  lang.value = 'zh';
  settingsMock.settings = { custom_args: '' };
  paramsMock.values = { model: 'D:/models/m.gguf' };
  serverMock.previewCommand.mockImplementation(async () => ARGV);
});

afterEach(() => {
  // 必须卸载：组件的 watch 盯着共享的 mock store，残留卡片的防抖计时器会在
  // 下一条用例的等待窗口里补发 previewCommand，把计数与「失败一次」的桩全部打乱
  wrapper?.unmount();
});

describe('CommandPreviewCard - 预览生成', () => {
  it('挂载防抖后拉取预览，按一行一参形态展示 argv', async () => {
    await mountCard();
    expect(serverMock.previewCommand).toHaveBeenCalledTimes(1);
    expect(textareas()[0].element.value).toBe(PREVIEW);
  });

  it('防抖窗口内的多次参数变更合并为一次 IPC', async () => {
    wrapper = mount(CommandPreviewCard, { global: { plugins: [ArcoVue] } });
    await flushPromises();
    // 窗口内连改三次：只有最后一次落在防抖计时器上
    paramsMock.values.ctx_size = 2048;
    await nextTick();
    paramsMock.values.ctx_size = 4096;
    await nextTick();
    paramsMock.values.model = 'D:/models/other.gguf';
    await flushPromises();
    await new Promise((r) => setTimeout(r, DEBOUNCE));
    await flushPromises();
    expect(serverMock.previewCommand, '150ms 防抖必须合并高频变更').toHaveBeenCalledTimes(1);
  });

  it('无设置对象时清空预览且不发请求', async () => {
    settingsMock.settings = null;
    await mountCard();
    expect(serverMock.previewCommand).not.toHaveBeenCalled();
    expect(textareas()[0].element.value).toBe('');
    expect(copyButton().disabled).toBe(true);
  });
});

describe('CommandPreviewCard - 复制与扩展参数合并', () => {
  it('复制的是内置 argv 与扩展参数合并后的单行形态', async () => {
    settingsMock.settings!.custom_args = '--verbose "my flag value"';
    await mountCard();
    expect(copyButton().disabled).toBe(false);
    await wrapper.findAll('button').find((b) => (b.text() ?? '').includes('copy_cmd'))!.trigger('click');
    await flushPromises();
    expect(clipboardWrites).toEqual([
      'D:/llama/llama-server.exe -m D:/models/m.gguf -c 4096 --verbose "my flag value"',
    ]);
  });

  it('argv 为空时复制按钮禁用，点击不写剪贴板', async () => {
    serverMock.previewCommand.mockImplementation(async () => []);
    await mountCard();
    expect(copyButton().disabled).toBe(true);
    await wrapper.findAll('button').find((b) => (b.text() ?? '').includes('copy_cmd'))!.trigger('click');
    await flushPromises();
    expect(clipboardWrites).toHaveLength(0);
  });

  it('扩展参数框改动写回 settings.custom_args 并触发持久化', async () => {
    await mountCard();
    await textareas()[1].setValue('--no-mmap');
    expect(settingsMock.settings?.custom_args).toBe('--no-mmap');
    expect(settingsMock.save).toHaveBeenCalled();
  });
});

describe('CommandPreviewCard - 生成失败与恢复', () => {
  it('previewCommand 拒绝：预览框换成交好提示，复制禁用；恢复后自动清掉错误', async () => {
    serverMock.previewCommand.mockRejectedValueOnce(new Error('IPC down'));
    await mountCard();
    // 预览框显示 i18n 文案（含底层消息作插值参数），而不是把 argv 混进去
    expect(textareas()[0].element.value).toBe('msg_cmd_preview_error|zh|1');
    expect(copyButton().disabled).toBe(true);

    // 参数再变 → 重走防抖 → 成功 → 错误清掉、预览回来
    paramsMock.values.ctx_size = 8192;
    await flushPromises();
    await new Promise((r) => setTimeout(r, DEBOUNCE));
    await flushPromises();
    await nextTick();
    expect(textareas()[0].element.value).toBe(PREVIEW);
    expect(copyButton().disabled).toBe(false);
  });
});
