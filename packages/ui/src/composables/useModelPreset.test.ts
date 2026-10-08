import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useParamsStore } from '@/stores/params';
import { useModelPreset, sameModelFile } from './useModelPreset';
import type { Preset, PresetSummary } from '@llama-launcher/shared';

let mockSettingsState: { last_preset: string; last_preset_id?: string; selected_model: string; models_dir: string };
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

const listMock = vi.fn<() => PresetSummary[]>(() => []);
const loadMock = vi.fn<(id: string) => Promise<Preset | null>>(() => Promise.resolve(null));
const detectDraftMock = vi.fn(() => Promise.resolve(''));
function mockWindow() {
  (globalThis as unknown as { window: unknown }).window = {
    api: {
      presets: {
        list: listMock,
        load: loadMock,
        save: () => Promise.resolve({ id: 'x', name: 'x', created_at: '', saved_at: '', model: null }),
        rename: () => Promise.resolve({ id: 'x', name: 'x', created_at: '', saved_at: '', model: null }),
        delete: () => Promise.resolve(true),
      },
      models: {
        detectMmproj: () => Promise.resolve(''),
        detectDraft: detectDraftMock,
        readGgufMeta: () => Promise.resolve(null),
      },
    },
  };
}

function summary(id: string, model: string | null): PresetSummary {
  return { id, name: id, created_at: '', saved_at: '', model };
}

function presetEntity(id: string, values: Preset['values']): Preset {
  // v3 实体：values 为纯参数（model 在顶层元数据，不随 values 下发）
  return { preset_version: 3, id, name: id, created_at: '', saved_at: '', app_version: '', model: null, values };
}

// 模块级 applyingPath 状态在文件内共享，测试顺序即依赖顺序
describe('useModelPreset applyModelPresetIfAny（按绑定模型身份静默匹配）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockSettingsState = { last_preset: '', last_preset_id: '', selected_model: '', models_dir: '' };
    mockWindow();
    listMock.mockReset();
    listMock.mockReturnValue([]);
    loadMock.mockReset();
    loadMock.mockResolvedValue(null);
    detectDraftMock.mockReset();
    detectDraftMock.mockResolvedValue('');
  });

  it('预设绑定的模型文件 = 当前模型时静默应用，并写回 last_preset_id', async () => {
    listMock.mockReturnValue([summary('p-foo', 'C:/models/foo.gguf')]);
    loadMock.mockImplementation((id) => Promise.resolve(id === 'p-foo' ? presetEntity('p-foo', { ctx_size: 8192 }) : null));
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(true);
    expect(params.values['ctx_size']).toBe(8192);
    expect(mockSettingsState.last_preset_id).toBe('p-foo');
    // 旧版按名字段被单向迁移清空
    expect(mockSettingsState.last_preset).toBe('');
  });

  it('模型目录移动后（路径不同、文件名相同）仍按文件名命中', async () => {
    listMock.mockReturnValue([summary('p-moved', 'D:/old-loc/foo.gguf')]);
    loadMock.mockImplementation((id) => Promise.resolve(id === 'p-moved' ? presetEntity('p-moved', { ctx_size: 4096 }) : null));
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();

    const ok = await applyModelPresetIfAny('C:/new-loc/foo.gguf');

    expect(ok).toBe(true);
    expect(params.values['ctx_size']).toBe(4096);
  });

  it('未绑定模型的纯参数集预设永不自动应用', async () => {
    listMock.mockReturnValue([summary('p-free', null)]);
    loadMock.mockReturnValue(Promise.resolve(presetEntity('p-free', { ctx_size: 8192 })));
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    params.values['ctx_size'] = 2048;

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(false);
    expect(params.values['ctx_size']).toBe(2048);
  });

  it('无匹配（路径与文件名都对不上）返回 false，不改变当前参数', async () => {
    listMock.mockReturnValue([summary('p-foo', 'C:/models/foo.gguf')]);
    loadMock.mockReturnValue(Promise.resolve(presetEntity('p-foo', { ctx_size: 8192 })));
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    params.values['ctx_size'] = 4096;

    const ok = await applyModelPresetIfAny('C:/models/other.gguf');

    expect(ok).toBe(false);
    expect(params.values['ctx_size']).toBe(4096);
  });

  it('应用后当前模型保持用户选择（预设值不携带模型路径）', async () => {
    listMock.mockReturnValue([summary('p-foo', 'C:/models/foo.gguf')]);
    loadMock.mockReturnValue(Promise.resolve(presetEntity('p-foo', { ctx_size: 8192 })));
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    // 调用方（applyModel/选行）已先把模型设为用户选择
    params.set('model', 'C:/models/foo.gguf');

    await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(params.values['model']).toBe('C:/models/foo.gguf');
    expect(mockSettingsState.selected_model).toBe('C:/models/foo.gguf');
  });

  it('已是当前预设（last_preset_id 相同）不再重复应用', async () => {
    listMock.mockReturnValue([summary('p-foo', 'C:/models/foo.gguf')]);
    loadMock.mockReturnValue(Promise.resolve(presetEntity('p-foo', { ctx_size: 8192 })));
    mockSettingsState.last_preset_id = 'p-foo';
    const { applyModelPresetIfAny } = useModelPreset();
    const params = useParamsStore();
    params.values['ctx_size'] = 4096;

    const ok = await applyModelPresetIfAny('C:/models/foo.gguf');

    expect(ok).toBe(false);
    expect(params.values['ctx_size']).toBe(4096); // 未被覆盖
  });

  it('并发触发时只应用一次（双击/快速连点防护）', async () => {
    listMock.mockReturnValue([summary('p-foo', 'C:/models/foo.gguf')]);
    loadMock.mockReturnValue(Promise.resolve(presetEntity('p-foo', { ctx_size: 8192 })));
    const { applyModelPresetIfAny } = useModelPreset();

    const p1 = applyModelPresetIfAny('C:/models/foo.gguf');
    const p2 = applyModelPresetIfAny('C:/models/foo.gguf');

    expect(await p2).toBe(false);
    expect(await p1).toBe(true);
  });
});

describe('sameModelFile（模型文件身份比较）', () => {
  it('全路径一致（分隔符/大小写归一）命中', () => {
    expect(sameModelFile('C:\\Models\\Foo\\a.gguf', 'c:/models/foo/a.gguf')).toBe(true);
  });

  it('路径不同但文件名相同视为同一模型（跨盘/移动目录退化匹配）', () => {
    expect(sameModelFile('D:/old/a.gguf', 'C:/new/a.gguf')).toBe(true);
  });

  it('路径与文件名都不同 / 空串不命中', () => {
    expect(sameModelFile('D:/old/a.gguf', 'C:/new/b.gguf')).toBe(false);
    expect(sameModelFile('', 'C:/new/a.gguf')).toBe(false);
    expect(sameModelFile('C:/a.gguf', '')).toBe(false);
  });
});
