import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useParamsStore } from '@/stores/params';
import { useModelPreset } from './useModelPreset';
import type { Preset } from '@llama-launcher/shared';

// 模拟确认弹窗：记录调用次数，默认确认
const confirmMock = vi.fn();
vi.mock('./useConfirm', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

// 模拟 settings store：可变 last_preset，供"已应用跳过"用例控制。
// 注意：用别名 @/stores/* 匹配（与源码导入一致，vitest 按解析后的模块 id 拦截，
// 同时覆盖 params store 内部的 './settings' 相对导入）
let mockSettingsState: { last_preset: string; selected_model: string; models_dir: string };
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    settings: mockSettingsState,
    save: () => Promise.resolve(),
  }),
}));
vi.mock('@/stores/server', () => ({
  useServerStore: () => ({ pushOutput: () => {}, clearOutputs: () => {} }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: () => ({ t: (k: string) => k }),
}));

// window.api mock：预设列表 + 模型检测（node 环境无 Electron preload）
const listMock = vi.fn<() => Preset[]>(() => []);
const detectDraftMock = vi.fn(() => Promise.resolve(''));
function mockWindow() {
  (globalThis as unknown as { window: unknown }).window = {
    api: {
      presets: { list: listMock },
      models: {
        detectMmproj: () => Promise.resolve(''),
        detectDraft: detectDraftMock,
        readGgufMeta: () => Promise.resolve(null),
      },
    },
  };
}

function presetFoo(overrides: Partial<Preset['values']> = {}): Preset {
  return {
    preset_version: 1,
    name: 'foo',
    saved_at: '',
    values: {
      model: 'C:/models/foo.gguf',
      ctx_size: 8192,
      _enabled: JSON.stringify({ ctx_size: true }),
      ...overrides,
    },
  };
}

// 注意：模块级 declined/applyingPath 状态在文件内共享，测试顺序即依赖顺序——
// 拒绝（decline）用例放在最后，其写入的 declined 集合不影响前面的用例。
describe('useModelPreset applyModelPresetIfAny', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockSettingsState = { last_preset: '', selected_model: '', models_dir: '' };
    mockWindow();
    listMock.mockReset();
    listMock.mockReturnValue([]);
    detectDraftMock.mockReset();
    detectDraftMock.mockResolvedValue('');
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  it('检测到模型预设时弹窗确认，并完全覆盖应用参数（含启用状态）', async () => {
    listMock.mockReturnValue([presetFoo()]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(params.values['ctx_size']).toBe(8192);
    expect(params.enabled['ctx_size']).toBe(true);
    expect(params.values['model']).toBe('C:/models/foo.gguf');
    expect(mockSettingsState.last_preset).toBe('foo');
  });

  it('预设携带旧模型路径时，以用户刚选择的模型为准', async () => {
    listMock.mockReturnValue([presetFoo({ model: 'C:/models/old.gguf' })]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(params.values['model']).toBe('C:/models/foo.gguf');
    expect(mockSettingsState.selected_model).toBe('C:/models/foo.gguf');
  });

  it('预设已配置推测解码时不再自动检测草稿模型（避免覆盖预设选择）', async () => {
    listMock.mockReturnValue([presetFoo({ spec_type: 'draft-mtp' })]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(params.values['spec_type']).toBe('draft-mtp');
    expect(detectDraftMock).not.toHaveBeenCalled();
  });

  it('预设未配置推测解码（spec_type 为空）时才自动检测草稿模型', async () => {
    listMock.mockReturnValue([presetFoo({ spec_type: '' })]);
    const { applyModelPresetIfAny } = useModelPreset();

    await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(detectDraftMock).toHaveBeenCalledTimes(1);
    expect(detectDraftMock).toHaveBeenCalledWith('C:/models/foo.gguf');
  });

  it('并发触发时只弹一次确认（双击/快速连点二次弹窗修复）', async () => {
    listMock.mockReturnValue([presetFoo()]);
    const { applyModelPresetIfAny } = useModelPreset();

    const p1 = applyModelPresetIfAny('C:/models/foo.gguf');
    const p2 = applyModelPresetIfAny('C:/models/foo.gguf');

    expect(await p2).toBe(false); // 第二次调用被并发防护拦截
    expect(await p1).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('已应用过的预设（last_preset 匹配）不再弹窗', async () => {
    listMock.mockReturnValue([presetFoo()]);
    mockSettingsState.last_preset = 'foo';
    const { applyModelPresetIfAny } = useModelPreset();

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('本会话内拒绝过的预设不再重复弹窗', async () => {
    listMock.mockReturnValue([presetFoo()]);
    confirmMock.mockResolvedValueOnce(false);
    const { applyModelPresetIfAny } = useModelPreset();

    const ok1 = await applyModelPresetIfAny('C:/models/foo.gguf');
    expect(ok1).toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);

    const ok2 = await applyModelPresetIfAny('C:/models/foo.gguf');
    expect(ok2).toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1); // 未再次弹窗
  });
});
