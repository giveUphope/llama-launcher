import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useParamsStore, ENABLED_KEY, isDependencySatisfied, computeViolatedParams } from './params';
import { PARAMS, MODEL_KEY, BASELINE_ENABLED_KEYS } from '@llama-launcher/shared';

// 仅测试 applyPreset 的纯逻辑：mock 掉无关 store（set/detect 等不在本测试范围）。
// applyPreset 内部只读写 values/enabled/PARAMS，不触发这些 store 的方法。
vi.mock('./settings', () => ({
  useSettingsStore: () => ({ settings: null, save: () => Promise.resolve() }),
}));
vi.mock('./server', () => ({
  useServerStore: () => ({ pushOutput: () => {}, clearOutputs: () => {} }),
}));
vi.mock('./i18n', () => ({
  useI18nStore: () => ({ t: (k: string) => k }),
}));

// 构造"新格式"预设：包含全部参数 key + 全量 _enabled（与 snapshot() 输出一致）
function freshPreset(extra: Record<string, string | number | boolean> = {}) {
  const values: Record<string, string | number | boolean> = {};
  for (const p of PARAMS) values[p.key] = p.default;
  const enabled: Record<string, boolean> = {};
  for (const p of PARAMS) enabled[p.key] = false;
  values[MODEL_KEY] = 'C:/models/foo.gguf';
  Object.assign(values, extra);
  values[ENABLED_KEY] = JSON.stringify(enabled);
  return values;
}

// 便捷：打开预设中某个参数的启用开关
function enableInPreset(preset: Record<string, string | number | boolean>, key: string) {
  const en = JSON.parse(String(preset[ENABLED_KEY])) as Record<string, boolean>;
  en[key] = true;
  preset[ENABLED_KEY] = JSON.stringify(en);
}

describe('params store applyPreset（预设完全覆盖语义）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('新格式预设完全覆盖 values 与 enabled', () => {
    const params = useParamsStore();
    // 手工改动当前配置
    params.values['ctx_size'] = 4096;
    params.enabled['ctx_size'] = true;
    params.values['port'] = 9999;

    const preset = freshPreset({ ctx_size: 8192, port: 8080 });
    enableInPreset(preset, 'ctx_size');

    params.applyPreset(preset);

    expect(params.values['ctx_size']).toBe(8192);
    expect(params.enabled['ctx_size']).toBe(true);
    expect(params.values['port']).toBe(8080);
    expect(params.enabled['port']).toBe(false);
    expect(params.values[MODEL_KEY]).toBe('C:/models/foo.gguf');
  });

  it('预设未包含的参数不残留会话配置（回到默认值并禁用）', () => {
    const params = useParamsStore();
    params.values['batch_size'] = 4096;
    params.enabled['batch_size'] = true;

    // 预设不包含 batch_size（模拟旧版本保存的预设缺失新参数）
    const preset = freshPreset({ ctx_size: 8192 });
    enableInPreset(preset, 'ctx_size');

    params.applyPreset(preset);

    expect(params.values['batch_size']).toBe(2048); // 默认值
    expect(params.enabled['batch_size']).toBe(false);
  });

  it('旧格式预设（无 _enabled）按"值非默认自动启用"兼容', () => {
    const params = useParamsStore();
    params.applyPreset({ ctx_size: 8192, flash_attn: 'on' });

    expect(params.enabled['ctx_size']).toBe(true);
    expect(params.enabled['flash_attn']).toBe(true);
    expect(params.enabled['port']).toBe(false); // 默认值参数不启用
  });

  it('预设无模型时保留当前模型；有模型时以预设为准', () => {
    const params = useParamsStore();
    params.values[MODEL_KEY] = 'C:/models/current.gguf';

    params.applyPreset({ ctx_size: 8192 }); // 无模型
    expect(params.values[MODEL_KEY]).toBe('C:/models/current.gguf');

    params.applyPreset({ model: 'C:/models/other.gguf', ctx_size: 8192 });
    expect(params.values[MODEL_KEY]).toBe('C:/models/other.gguf');
  });

  it('应用后清理依赖不满足的下游参数（draft-mtp 下 -md 被清空禁用）', () => {
    const params = useParamsStore();
    // spec_draft_model 仅对外部草稿类型有效；draft-mtp 用主模型 MTP 头，不需要外部草稿
    const preset = freshPreset({ spec_type: 'draft-mtp', spec_draft_model: 'C:/models/draft.gguf' });
    enableInPreset(preset, 'spec_type');
    enableInPreset(preset, 'spec_draft_model');

    params.applyPreset(preset);

    expect(params.values['spec_draft_model']).toBe('');
    expect(params.enabled['spec_draft_model']).toBe(false);
  });

  it('智能归一化：超范围钳制、字符串布尔转换、旧版 draft-model 映射', () => {
    const params = useParamsStore();
    const preset = freshPreset({
      ctx_size: 999999999,      // 超出 max 262144
      cont_batching: 'false',   // 字符串形式的布尔
      spec_type: 'draft-model', // 旧版本选项 → draft-simple
    });
    enableInPreset(preset, 'ctx_size');
    enableInPreset(preset, 'cont_batching');
    enableInPreset(preset, 'spec_type');

    params.applyPreset(preset);

    expect(params.values['ctx_size']).toBe(262144);
    expect(params.values['cont_batching']).toBe(false);
    expect(params.values['spec_type']).toBe('draft-simple');
  });

  it('丢弃未知 key，并返回应用后启用的参数数量', () => {
    const params = useParamsStore();
    const preset = freshPreset({ removed_param_old: 'x', ctx_size: 8192 });
    enableInPreset(preset, 'ctx_size');

    const count = params.applyPreset(preset);

    expect('removed_param_old' in params.values).toBe(false);
    expect(count).toBe(1);
  });

  it('快照往返是恒等变换（bench 应用场景：把测试快照应用回当前配置，状态保持不变）', () => {
    const params = useParamsStore();
    // 模拟一次测试后的配置状态（含自动启用的参数）
    params.set('ctx_size', 16384);
    params.set('flash_attn', 'on');
    params.set('metrics', true);
    const snapshot = params.snapshot(); // 与 bench 历史记录保存的快照结构一致

    params.applyPreset(snapshot);

    expect(params.values['ctx_size']).toBe(16384);
    expect(params.enabled['ctx_size']).toBe(true);
    expect(params.values['flash_attn']).toBe('on');
    expect(params.enabled['flash_attn']).toBe(true);
    expect(params.values['metrics']).toBe(true);
    expect(params.enabled['metrics']).toBe(true);
  });
});

describe('基线启用参数（BASELINE_ENABLED_KEYS）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const defaultValue = (key: string) => PARAMS.find((p) => p.key === key)!.default;

  it('初始化即启用基线参数（cache_type_k/v、load_mode、fit），非基线禁用', () => {
    const params = useParamsStore();
    for (const k of BASELINE_ENABLED_KEYS) {
      expect(params.enabled[k]).toBe(true);
    }
    expect(params.enabled['ctx_size']).toBe(false);
    expect(params.enabled['gpu_layers']).toBe(false);
  });

  it('resetAll 恢复基线启用（出厂推荐状态），值回到默认', () => {
    const params = useParamsStore();
    params.setEnabled('cache_type_k', false);
    params.set('ctx_size', 8192);
    params.resetAll();
    for (const k of BASELINE_ENABLED_KEYS) {
      expect(params.enabled[k]).toBe(true);
      expect(params.values[k]).toBe(defaultValue(k));
    }
    expect(params.enabled['ctx_size']).toBe(false);
    expect(params.values['ctx_size']).toBe(0);
  });

  it('changedGroups / groupHasChanges 不计入基线参数', () => {
    const params = useParamsStore();
    // 仅基线启用：无分组显示"已修改"蓝点
    expect(params.groupHasChanges('basic')).toBe(false);
    expect(params.groupHasChanges('advanced')).toBe(false);
    expect(params.changedGroups['basic']).toBeFalsy();
    expect(params.changedGroups['advanced']).toBeFalsy();
    // 改动非基线参数 → basic 分组出现蓝点
    params.set('ctx_size', 8192);
    expect(params.groupHasChanges('basic')).toBe(true);
    expect(params.changedGroups['basic']).toBe(true);
    // 改动基线参数值（fit: off → on）也不产生蓝点
    params.resetAll();
    params.set('fit', 'on');
    expect(params.groupHasChanges('basic')).toBe(false);
  });

  it('applyPreset 的新格式 _enabled 可覆盖基线启用状态', () => {
    const params = useParamsStore();
    const preset = freshPreset(); // 全量 _enabled = false
    params.applyPreset(preset);
    for (const k of BASELINE_ENABLED_KEYS) {
      expect(params.enabled[k]).toBe(false);
    }
  });

  it('旧格式预设（无 _enabled）保留基线启用', () => {
    const params = useParamsStore();
    params.applyPreset({ ctx_size: 8192 });
    for (const k of BASELINE_ENABLED_KEYS) {
      expect(params.enabled[k]).toBe(true);
    }
    expect(params.enabled['ctx_size']).toBe(true); // 旧格式按"值非默认"自动启用
  });
});

describe('依赖规则纯函数（isDependencySatisfied / computeViolatedParams）', () => {
  const valuesRule = { key: 'spec_type', values: ['draft-simple', 'draft-dflash'] };
  const notValuesRule = { key: 'reasoning', notValues: ['off'] };

  it('依赖未启用则不满足', () => {
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-simple' }, {})).toBe(false);
  });

  it('依赖启用且值在 values 中则满足', () => {
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-simple' }, { spec_type: true })).toBe(true);
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-dflash' }, { spec_type: true })).toBe(true);
  });

  it('依赖启用但值不在 values 中则不满足', () => {
    expect(isDependencySatisfied(valuesRule, { spec_type: 'draft-mtp' }, { spec_type: true })).toBe(false);
    expect(isDependencySatisfied(valuesRule, { spec_type: '' }, { spec_type: true })).toBe(false);
  });

  it('notValues 命中则不满足', () => {
    expect(isDependencySatisfied(notValuesRule, { reasoning: 'off' }, { reasoning: true })).toBe(false);
    expect(isDependencySatisfied(notValuesRule, { reasoning: 'on' }, { reasoning: true })).toBe(true);
  });

  it('computeViolatedParams 返回全部违规参数，且跳过无依赖参数', () => {
    const defs: any[] = [
      { key: 'a', dependsOn: valuesRule },
      { key: 'b', dependsOn: notValuesRule },
      { key: 'c' }, // 无依赖
    ];
    const violated = computeViolatedParams(
      defs,
      { spec_type: 'draft-mtp', reasoning: 'off' },
      { spec_type: true, reasoning: true },
    );
    expect(violated.map((p) => p.key)).toEqual(['a', 'b']);
  });
});

describe('依赖联动稳定态（先填下游、后选依赖源不被误清；幂等收敛）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('先填下游值、后选外部草稿类型：下游保留（中间态不被误清）', () => {
    const params = useParamsStore();
    // 用户先填了草稿模型路径（此时 spec_type 未选）
    params.set('spec_draft_model', 'C:/models/draft.gguf');
    expect(params.values['spec_draft_model']).toBe('C:/models/draft.gguf');
    // 再选择外部草稿类型 draft-simple：依赖满足，路径不被清空
    params.set('spec_type', 'draft-simple');
    expect(params.values['spec_draft_model']).toBe('C:/models/draft.gguf');
    expect(params.enabled['spec_draft_model']).toBe(true);
  });

  it('切到不需要外部草稿的类型（draft-mtp）清空下游并禁用', () => {
    const params = useParamsStore();
    params.set('spec_draft_model', 'C:/models/draft.gguf');
    params.set('spec_type', 'draft-simple');
    params.set('spec_type', 'draft-mtp');
    expect(params.values['spec_draft_model']).toBe('');
    expect(params.enabled['spec_draft_model']).toBe(false);
  });

  it('重复设置依赖源是幂等的（收敛到稳定态，无级联误清）', () => {
    const params = useParamsStore();
    params.set('spec_draft_model', 'C:/models/draft.gguf');
    params.set('spec_type', 'draft-mtp'); // 第一次清理
    expect(params.values['spec_draft_model']).toBe('');
    params.set('spec_type', 'draft-mtp'); // 再次设置同一依赖源：状态不变
    expect(params.values['spec_draft_model']).toBe('');
    // 无关参数不受级联影响
    expect(params.values['batch_size']).toBe(2048);
    expect(params.enabled['batch_size']).toBe(false);
  });
});

describe('推测解码联动（spec_type → 推荐草稿数）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('选择投机采样类型自动应用该类型的推荐最大草稿数并启用', () => {
    const params = useParamsStore();
    params.set('spec_type', 'draft-dflash');
    expect(params.values['spec_draft_n_max']).toBe(15);
    expect(params.enabled['spec_draft_n_max']).toBe(true);

    params.set('spec_type', 'draft-mtp');
    expect(params.values['spec_draft_n_max']).toBe(5);
    expect(params.enabled['spec_draft_n_max']).toBe(true);

    params.set('spec_type', 'ngram-simple');
    expect(params.values['spec_draft_n_max']).toBe(5);
  });

  it('切换类型时保持 n_min ≤ n_max（超出部分被钳制到推荐 n_max）', () => {
    const params = useParamsStore();
    params.set('spec_draft_n_min', 10);
    params.set('spec_type', 'draft-mtp'); // 推荐 n_max=5
    expect(params.values['spec_draft_n_min']).toBe(5);
    expect(Number(params.values['spec_draft_n_min'])).toBeLessThanOrEqual(
      Number(params.values['spec_draft_n_max']),
    );
  });

  it('手动调小最大草稿数时同步钳制最小草稿数', () => {
    const params = useParamsStore();
    params.set('spec_type', 'draft-simple'); // 联动 n_max=8
    params.set('spec_draft_n_min', 6);
    params.set('spec_draft_n_max', 3);
    expect(params.values['spec_draft_n_max']).toBe(3);
    expect(params.values['spec_draft_n_min']).toBe(3);
  });

  it('关闭推测解码（none/空）时草稿数回默认并禁用', () => {
    const params = useParamsStore();
    params.set('spec_type', 'draft-simple');
    expect(params.enabled['spec_draft_n_max']).toBe(true);

    params.set('spec_type', 'none');
    expect(params.values['spec_draft_n_max']).toBe(3); // 默认
    expect(params.enabled['spec_draft_n_max']).toBe(false);
    expect(params.enabled['spec_draft_n_min']).toBe(false);
  });
});
