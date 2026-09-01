import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useParamsStore } from '@/stores/params';
import { useModelPreset } from './useModelPreset';
import type { Preset } from '@llama-launcher/shared';

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

const listMock = vi.fn<() => Preset[]>(() => []);
const detectDraftMock = vi.fn(() => Promise.resolve(''));
function mockWindow() {
  (globalThis as unknown as { window: unknown }).window = {
    api: {
      presets: { list: listMock, save: () => Promise.resolve() },
      models: {
        detectMmproj: () => Promise.resolve(''),
        detectDraft: detectDraftMock,
        readGgufMeta: () => Promise.resolve(null),
      },
    },
  };
}

function presetFoo(overrides: Partial<Preset['values']> = {}): Preset {
  // v2 结构：model 为顶层元数据字段，values 仅含纯参数（不含 model）
  return {
    preset_version: 2,
    name: 'foo',
    created_at: '',
    saved_at: '',
    app_version: '',
    model: 'C:/models/foo.gguf',
    values: {
      ctx_size: 8192,
      ...overrides,
    },
  };
}

// 模块级 applyingPath 状态在文件内共享，测试顺序即依赖顺序
describe('useModelPreset applyModelPresetIfAny（静默匹配，无弹窗）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockSettingsState = { last_preset: '', selected_model: '', models_dir: '' };
    mockWindow();
    listMock.mockReset();
    listMock.mockReturnValue([]);
    detectDraftMock.mockReset();
    detectDraftMock.mockResolvedValue('');
  });

  it('检测到模型预设时直接静默应用，不弹确认框', async () => {
    listMock.mockReturnValue([presetFoo()]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(true);
    expect(params.values['ctx_size']).toBe(8192);
    expect(params.values['model']).toBe('C:/models/foo.gguf');
    expect(mockSettingsState.last_preset).toBe('foo');
  });

  it('按别名优先匹配预设（alias 命中时优先于文件名）', async () => {
    listMock.mockReturnValue([presetFoo({ model: 'C:/models/foo.gguf' })]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    // 给当前模型设置别名 alias=foo，匹配到预设
    params.values['alias'] = 'foo';

    await applyModelPresetIfAny('C:/models/other.gguf');

    expect(params.values['ctx_size']).toBe(8192);
  });

  it('无匹配预设时直接返回 false，不改变当前参数', async () => {
    listMock.mockReturnValue([presetFoo()]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    params.values['ctx_size'] = 4096;

    const ok = await applyModelPresetIfAny('C:/models/other.gguf');

    expect(ok).toBe(false);
    // 参数未被预设覆盖，保持内存记录（关闭应用即丢弃）
    expect(params.values['ctx_size']).toBe(4096);
  });

  it('无预设列表时直接返回 false', async () => {
    listMock.mockReturnValue([]);
    const { applyModelPresetIfAny } = useModelPreset();

    expect(await applyModelPresetIfAny('C:/models/foo.gguf')).toBe(false);
  });

  it('预设携带旧模型路径时，以用户刚选择的模型为准', async () => {
    listMock.mockReturnValue([presetFoo({ model: 'C:/models/old.gguf' })]);
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(params.values['model']).toBe('C:/models/foo.gguf');
    expect(mockSettingsState.selected_model).toBe('C:/models/foo.gguf');
  });

  it('已应用过的预设（last_preset 匹配）不再重复应用', async () => {
    listMock.mockReturnValue([presetFoo()]);
    mockSettingsState.last_preset = 'foo';
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    params.values['ctx_size'] = 4096;

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(false);
    expect(params.values['ctx_size']).toBe(4096); // 未被覆盖
  });

  it('并发触发时只应用一次（双击/快速连点防护）', async () => {
    listMock.mockReturnValue([presetFoo()]);
    const { applyModelPresetIfAny } = useModelPreset();

    const p1 = applyModelPresetIfAny('C:/models/foo.gguf');
    const p2 = applyModelPresetIfAny('C:/models/foo.gguf');

    expect(await p2).toBe(false);
    expect(await p1).toBe(true);
  });
});
