import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useParamsStore, isDependencySatisfied, computeViolatedParams } from './params';
import { PARAMS, MODEL_KEY } from '@llama-launcher/shared';

vi.useFakeTimers();

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.runOnlyPendingTimers();
});

// 全局 window 桩：测试环境（node）无 Electron，避免 detectMmproj/detectDraft/loadGguf 抛出
(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = (globalThis as any).window.api ?? {
  presets: { list: () => Promise.resolve([]), save: () => Promise.resolve() },
  models: {
    detectMmproj: () => Promise.resolve(''),
    detectDraft: () => Promise.resolve(''),
    readGgufMeta: () => Promise.resolve(null),
  },
};

vi.mock('./settings', () => ({
  useSettingsStore: () => ({ settings: null, save: () => Promise.resolve() }),
}));
vi.mock('./server', () => ({
  useServerStore: () => ({ pushOutput: () => {}, clearOutputs: () => {} }),
}));
vi.mock('./i18n', () => ({
  useI18nStore: () => ({ t: (k: string) => k }),
}));

describe('params store applyPreset（预设完全覆盖语义）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('预设完全覆盖 values', () => {
    const params = useParamsStore();
    params.set('ctx_size', 4096);
    params.set('port', 9999);

    params.applyPreset({ ctx_size: 8192, port: 8080, [MODEL_KEY]: 'C:/models/foo.gguf' });

    expect(params.values['ctx_size']).toBe(8192);
    expect(params.values['port']).toBe(8080);
    expect(params.values[MODEL_KEY]).toBe('C:/models/foo.gguf');
  });

  it('预设未包含的参数回到默认值', () => {
    const params = useParamsStore();
    params.set('batch_size', 4096);

    const preset: Record<string, string | number | boolean> = { ctx_size: 8192 };
    params.applyPreset(preset);

    expect(params.values['batch_size']).toBe(2048);
  });

  it('旧格式预设（值非默认即生效）兼容', () => {
    const params = useParamsStore();
    params.applyPreset({ ctx_size: 8192, flash_attn: 'on' });

    expect(params.values['ctx_size']).toBe(8192);
    expect(params.values['flash_attn']).toBe('on');
    expect(params.values['port']).toBe(8080); // 默认值
  });

  it('预设无模型时保留当前模型；有模型时以预设为准', () => {
    const params = useParamsStore();
    params.values[MODEL_KEY] = 'C:/models/current.gguf';

    params.applyPreset({ ctx_size: 8192 });
    expect(params.values[MODEL_KEY]).toBe('C:/models/current.gguf');

    params.applyPreset({ model: 'C:/models/other.gguf', ctx_size: 8192 });
    expect(params.values[MODEL_KEY]).toBe('C:/models/other.gguf');
  });

  it('应用后清理依赖不满足的下游参数（文件类型保留路径，由命令构建器跳过发射）', () => {
    const params = useParamsStore();
    const preset: Record<string, string | number | boolean> = {
      spec_type: 'draft-mtp',
      spec_draft_model: 'C:/models/draft.gguf',
    };
    params.applyPreset(preset);
    // 文件类型依赖不满足时保留用户路径（避免切换时丢失），命令构建器会跳过发射
    expect(params.values['spec_draft_model']).toBe('C:/models/draft.gguf');
  });

  it('智能归一化：超范围钳制、字符串布尔转换、旧版 draft-model 映射', () => {
    const params = useParamsStore();
    params.applyPreset({
      ctx_size: 999999999,
      cont_batching: 'false',
      spec_type: 'draft-model',
    });

    expect(params.values['ctx_size']).toBe(262144);
    expect(params.values['cont_batching']).toBe(false);
    expect(params.values['spec_type']).toBe('draft-simple');
  });

  it('丢弃未知 key，并返回应用后非默认参数数量', () => {
    const params = useParamsStore();
    const preset: Record<string, string | number | boolean> = {
      removed_param_old: 'x',
      ctx_size: 8192,
    };

    const count = params.applyPreset(preset);

    expect('removed_param_old' in params.values).toBe(false);
    expect(count).toBe(1);
  });

  it('快照往返是恒等变换', () => {
    const params = useParamsStore();
    params.set('ctx_size', 16384);
    params.set('flash_attn', 'on');
    params.set('metrics', true);
    const snapshot = params.snapshot();

    params.applyPreset(snapshot);

    expect(params.values['ctx_size']).toBe(16384);
    expect(params.values['flash_attn']).toBe('on');
    expect(params.values['metrics']).toBe(true);
  });
});

describe('hasChanges（任一参数值非默认即为已修改）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('初始状态无修改', () => {
    const params = useParamsStore();
    expect(params.hasChanges).toBe(false);
  });

  it('改动任一参数即标记已修改', () => {
    const params = useParamsStore();
    expect(params.hasChanges).toBe(false);
    params.set('ctx_size', 8192);
    expect(params.hasChanges).toBe(true);
  });

  it('改回默认值即取消已修改标记', () => {
    const params = useParamsStore();
    params.set('ctx_size', 8192);
    params.resetParam('ctx_size');
    expect(params.hasChanges).toBe(false);
  });

  it('resetAll 清除已修改标记', () => {
    const params = useParamsStore();
    params.set('ctx_size', 8192);
    params.set('port', 9999);
    params.resetAll();
    expect(params.hasChanges).toBe(false);
  });

  it('resetParam 单参数恢复默认', () => {
    const params = useParamsStore();
    params.set('ctx_size', 8192);
    params.set('port', 9999);
    params.resetParam('ctx_size');
    expect(params.values['ctx_size']).toBe(0);
    expect(params.values['port']).toBe(9999);
    expect(params.hasChanges).toBe(true); // port 仍非默认
  });

  it('自动检测/填充的字段（mmproj、spec_draft_model）不计入已修改', () => {
    const params = useParamsStore();
    params.values['mmproj'] = 'C:/models/mmproj.gguf';
    params.values['spec_draft_model'] = 'C:/models/draft.gguf';
    expect(params.hasChanges).toBe(false);
  });
});

describe('resetGroup / resetAll', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('resetGroup 只重置该 group 的参数', () => {
    const params = useParamsStore();
    params.set('ctx_size', 8192); // basic
    params.set('cache_type_k', 'f16'); // advanced
    params.resetGroup('basic');
    expect(params.values['ctx_size']).toBe(0);
    expect(params.values['cache_type_k']).toBe('f16');
  });

  it('resetAll 重置全部参数并清空模型', () => {
    const params = useParamsStore();
    params.set('ctx_size', 8192);
    params.values[MODEL_KEY] = 'C:/models/foo.gguf';
    params.resetAll();
    expect(params.values['ctx_size']).toBe(0);
    expect(params.values[MODEL_KEY]).toBe('');
  });
});

describe('依赖规则纯函数（isDependencySatisfied / computeViolatedParams）', () => {
  const valuesRule = { key: 'spec_type', values: ['draft-simple', 'draft-dflash'] };
  const notValuesRule = { key: 'reasoning', notValues: ['off'] };

  it('依赖参数值等于默认则不满足', () => {
    expect(isDependencySatisfied(valuesRule, { spec_type: '' })).toBe(false);
  });

  it('依赖参数非默认且值在 values 中则满足', () => {
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-simple' })).toBe(true);
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-dflash' })).toBe(true);
  });

  it('依赖参数非默认但值不在 values 中则不满足', () => {
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-mtp' })).toBe(false);
  });

  it('notValues 命中则不满足', () => {
    expect(isDependencySatisfied(notValuesRule, { reasoning: 'off' })).toBe(false);
    expect(isDependencySatisfied(notValuesRule, { reasoning: 'on' })).toBe(true);
  });

  it('computeViolatedParams 返回依赖不满足的参数，依赖满足的保留', () => {
    // spec_type='' 为默认 → 依赖它的所有参数（spec_draft_model、spec_cache_type_*、spec_draft_n_max 等）均违规
    const violatedWhenNone = computeViolatedParams({ spec_type: '' });
    expect(violatedWhenNone.some((p) => p.key === 'spec_draft_model')).toBe(true);
    // 切到外部草稿类型后，依赖满足，不再违规
    const violatedWhenSimple = computeViolatedParams({ spec_type: 'draft-simple' });
    expect(violatedWhenSimple.some((p) => p.key === 'spec_draft_model')).toBe(false);
    expect(violatedWhenSimple.some((p) => p.key === 'spec_cache_type_k')).toBe(false);
  });
});

describe('依赖联动稳定态（先填下游、后选依赖源不被误清）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('先填下游值、后选外部草稿类型：下游保留（中间态不被误清）', () => {
    const params = useParamsStore();
    params.set('spec_draft_model', 'C:/models/draft.gguf');
    expect(params.values['spec_draft_model']).toBe('C:/models/draft.gguf');
    params.set('spec_type', 'draft-simple');
    expect(params.values['spec_draft_model']).toBe('C:/models/draft.gguf');
  });

  it('切到不需要外部草稿的类型（draft-mtp）：文件路径保留（由命令构建器跳过发射）', () => {
    const params = useParamsStore();
    params.set('spec_draft_model', 'C:/models/draft.gguf');
    params.set('spec_type', 'draft-simple');
    params.set('spec_type', 'draft-mtp');
    // 文件/目录类型依赖不满足时保留用户路径
    expect(params.values['spec_draft_model']).toBe('C:/models/draft.gguf');
  });

  it('非文件类型依赖不满足时被重置为默认', () => {
    const params = useParamsStore();
    params.set('spec_cache_type_k', 'q8_0');
    params.set('spec_type', 'draft-mtp'); // 依赖不满足：spec_cache_type_k 依赖外部草稿类型
    expect(params.values['spec_cache_type_k']).toBe('f16'); // 默认
  });
});

describe('推测解码联动（spec_type → 推荐草稿数）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('选择投机采样类型自动应用该类型的推荐最大草稿数', () => {
    const params = useParamsStore();
    params.set('spec_type', 'draft-dflash');
    expect(params.values['spec_draft_n_max']).toBe(15);

    params.set('spec_type', 'draft-mtp');
    expect(params.values['spec_draft_n_max']).toBe(5);

    params.set('spec_type', 'ngram-simple');
    expect(params.values['spec_draft_n_max']).toBe(5);
  });

  it('切换类型时保持 n_min ≤ n_max（超出部分被钳制到推荐 n_max）', () => {
    const params = useParamsStore();
    params.set('spec_draft_n_min', 10);
    params.set('spec_type', 'draft-mtp');
    expect(params.values['spec_draft_n_min']).toBe(5);
    expect(Number(params.values['spec_draft_n_min'])).toBeLessThanOrEqual(
      Number(params.values['spec_draft_n_max']),
    );
  });

  it('手动调小最大草稿数时同步钳制最小草稿数', () => {
    const params = useParamsStore();
    params.set('spec_type', 'draft-simple');
    params.set('spec_draft_n_min', 6);
    params.set('spec_draft_n_max', 3);
    expect(params.values['spec_draft_n_max']).toBe(3);
    expect(params.values['spec_draft_n_min']).toBe(3);
  });

  it('关闭推测解码（none）时草稿数由联动清理恢复默认', () => {
    const params = useParamsStore();
    params.set('spec_type', 'draft-simple');
    expect(params.values['spec_draft_n_max']).toBe(8);

    params.set('spec_type', 'none');
    // spec_draft_n_max 依赖 notValues:['','none']，none 命中 → 依赖不满足 → 重置
    expect(params.values['spec_draft_n_max']).toBe(3);
    expect(params.values['spec_draft_n_min']).toBe(0);
  });
});

describe('双轨参数逻辑（基线/会话）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('applyPreset 建立命名基线；hasChanges 相对基线计算', () => {
    const params = useParamsStore();
    params.applyPreset({ ctx_size: 8192, [MODEL_KEY]: 'C:/models/foo.gguf' }, 'foo');
    expect(params.baseline?.preset_name).toBe('foo');
    expect(params.hasChanges).toBe(false); // 与基线一致

    params.set('ctx_size', 4096);
    expect(params.hasChanges).toBe(true); // 偏离基线

    params.restoreBaseline();
    expect(params.values['ctx_size']).toBe(8192);
    expect(params.hasChanges).toBe(false);
  });

  it('无基线时 hasChanges 与出厂默认比较（兼容原语义）', () => {
    const params = useParamsStore();
    expect(params.hasChanges).toBe(false);
    params.set('ctx_size', 4096);
    expect(params.hasChanges).toBe(true);
  });

  it('restoreSession 恢复参数与基线，自定义别名不被覆盖', async () => {
    const params = useParamsStore();
    await params.restoreSession(
      { [MODEL_KEY]: 'C:/models/foo.gguf', ctx_size: 12345, alias: 'my-alias' },
      { preset_name: 'foo', values: { [MODEL_KEY]: 'C:/models/foo.gguf', ctx_size: 8192 } as never },
    );
    expect(params.values['ctx_size']).toBe(12345);
    expect(params.values['alias']).toBe('my-alias');
    expect(params.baseline?.preset_name).toBe('foo');
  });

  it('clearSession 回出厂默认并清空基线', () => {
    const params = useParamsStore();
    params.applyPreset({ ctx_size: 8192 }, 'foo');
    params.clearSession();
    const def = PARAMS.find((p) => p.key === 'ctx_size')!.default;
    expect(params.values['ctx_size']).toBe(def);
    expect(params.baseline).toBeNull();
    expect(params.hasChanges).toBe(false);
  });

  it('autoSave 只写会话、不再写预设文件（双轨核心回归）', async () => {
    const savePreset = vi.fn(() => Promise.resolve());
    (globalThis as any).window.api.presets.save = savePreset;
    (globalThis as any).window.api.presets.list = () =>
      Promise.resolve([{ preset_version: 1, name: 'foo', saved_at: '', values: {} }]);
    const params = useParamsStore();
    params.set('ctx_size', 4096);
    await vi.advanceTimersByTimeAsync(1000);
    expect(savePreset).not.toHaveBeenCalled();
  });
});
