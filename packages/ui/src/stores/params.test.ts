import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useParamsStore, isDependencySatisfied, computeViolatedParams } from './params';
import { PARAMS, MODEL_KEY, DEFAULT_HOST, DEFAULT_PORT, PORT_MIN, PORT_MAX, isValidPort } from '@llama-launcher/shared';

vi.useFakeTimers();

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.runOnlyPendingTimers();
});

// 每模型参数集 API 桩：save/load 接成真实内存往返（切模型再切回可恢复）；
// load 默认无存储；各用例可预置或覆写
const storedParams = new Map<string, { format_version: number; model_path: string; updated_at: string; values: Record<string, unknown> }>();
const loadParamsMock = vi.fn<(p: string) => Promise<unknown>>((p) => Promise.resolve(storedParams.get(p) ?? null));
const saveParamsMock = vi.fn<(p: string, v: Record<string, unknown>) => Promise<unknown>>((p, v) => {
  storedParams.set(p, { format_version: 1, model_path: p, updated_at: new Date().toISOString(), values: v });
  return Promise.resolve(storedParams.get(p));
});
const clearParamsMock = vi.fn<(p: string) => Promise<boolean>>((p) => Promise.resolve(storedParams.delete(p)));
const readGgufMock = vi.fn<(p: string) => Promise<unknown>>(() => Promise.resolve(null));

// 全局 window 桩：测试环境（node）无 Electron，避免 detectMmproj/detectDraft/loadGguf 抛出
(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = (globalThis as any).window.api ?? {
  modelParams: {
    load: (p: string) => loadParamsMock(p),
    save: (p: string, v: Record<string, unknown>) => saveParamsMock(p, v),
    clear: (p: string) => clearParamsMock(p),
  },
  models: {
    detectMmproj: () => Promise.resolve(''),
    detectDraft: () => Promise.resolve(''),
    readGgufMeta: (p: string) => readGgufMock(p),
  },
};

beforeEach(() => {
  // mockReset（而非 mockClear）：前序用例的 mockResolvedValue/mockRejectedValue
  // 覆写不得泄漏到后续用例；基础实现每次重新接线
  storedParams.clear();
  loadParamsMock.mockReset().mockImplementation((p) => Promise.resolve(storedParams.get(p) ?? null));
  saveParamsMock.mockReset().mockImplementation((p, v) => {
    storedParams.set(p, { format_version: 1, model_path: p, updated_at: new Date().toISOString(), values: v });
    return Promise.resolve(storedParams.get(p));
  });
  clearParamsMock.mockReset().mockImplementation((p) => Promise.resolve(storedParams.delete(p)));
  readGgufMock.mockReset().mockResolvedValue(null);
});

vi.mock('./settings', () => ({
  useSettingsStore: () => ({ settings: null, save: () => Promise.resolve() }),
}));
vi.mock('./server', () => ({
  useServerStore: () => ({ pushOutput: () => {}, clearOutputs: () => {} }),
}));
vi.mock('./i18n', () => ({
  useI18nStore: () => ({ t: (k: string) => k }),
}));

describe('每模型自动持久化：applyModel 载入已存参数 / 首载自动应用建议', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('有已存参数集时：applyModel 载入该模型的参数（参数跟模型走）', async () => {
    loadParamsMock.mockResolvedValue({
      format_version: 1,
      model_path: 'C:/models/foo.gguf',
      updated_at: '',
      values: { ctx_size: 8192, temperature: 0.7 },
    });
    const params = useParamsStore();

    await params.applyModel('C:/models/foo.gguf');

    expect(params.values[MODEL_KEY]).toBe('C:/models/foo.gguf');
    expect(params.values['ctx_size']).toBe(8192);
    expect(params.values['temperature']).toBe(0.7);
    // 别名随模型派生
    expect(params.values['alias']).toBe('foo');
  });

  it('已存参数的 mmproj/草稿模型不被检测覆盖（检测只填空字段）', async () => {
    loadParamsMock.mockResolvedValue({
      format_version: 1, model_path: 'C:/models/foo.gguf', updated_at: '',
      values: { mmproj: 'C:/stored/mmproj.gguf', spec_draft_model: 'C:/stored/draft.gguf' },
    });
    const params = useParamsStore();

    await params.applyModel('C:/models/foo.gguf');

    expect(params.values['mmproj']).toBe('C:/stored/mmproj.gguf');
    expect(params.values['spec_draft_model']).toBe('C:/stored/draft.gguf');
  });

  it('首载（无已存参数）且模型带推荐参数时自动应用建议', async () => {
    readGgufMock.mockResolvedValue({
      ok: true,
      data: {
        info: { path: 'C:/models/foo.gguf', version: 2, tensor_count: 1, metadata_kv_count: 0, metadata: {} },
        suggestions: [
          { key: 'temperature', value: 1, source: 'general.sampling.temp' },
          { key: 'top_k', value: 20, source: 'general.sampling.top_k' },
        ],
      },
    });
    const params = useParamsStore();

    await params.applyModel('C:/models/foo.gguf');

    expect(params.values['temperature']).toBe(1);
    expect(params.values['top_k']).toBe(20);
  });

  it('载入失败（load 抛错）按无存储处理：回落默认 + 建议，不阻塞切换', async () => {
    loadParamsMock.mockRejectedValue(new Error('io'));
    readGgufMock.mockResolvedValue({
      ok: true,
      data: {
        info: { path: 'C:/models/foo.gguf', version: 2, tensor_count: 1, metadata_kv_count: 0, metadata: {} },
        suggestions: [{ key: 'temperature', value: 1, source: 'x' }],
      },
    });
    const params = useParamsStore();

    await expect(params.applyModel('C:/models/foo.gguf')).resolves.toBe(true);
    expect(params.values['temperature']).toBe(1);
  });
});

describe('每模型自动持久化：节流自动保存与全部重置', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('参数变化后 800ms 节流写入当前模型名下（快照含模型键，存储层负责剔除）', async () => {
    const params = useParamsStore();
    await params.applyModel('C:/models/foo.gguf');
    saveParamsMock.mockClear();

    params.set('ctx_size', 4096);
    await vi.advanceTimersByTimeAsync(500);
    expect(saveParamsMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(saveParamsMock).toHaveBeenCalledTimes(1);
    const [path, values] = saveParamsMock.mock.calls[0];
    expect(path).toBe('C:/models/foo.gguf');
    expect((values as Record<string, unknown>)['ctx_size']).toBe(4096);
  });

  it('未选择模型时不触发自动保存', async () => {
    const params = useParamsStore();
    params.set('ctx_size', 4096);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveParamsMock).not.toHaveBeenCalled();
  });

  it('resetCurrentModel：回出厂默认 + 保留模型 + 立即持久化覆盖该模型参数集', async () => {
    const params = useParamsStore();
    await params.applyModel('C:/models/foo.gguf');
    params.set('ctx_size', 9999);
    saveParamsMock.mockClear();

    await params.resetCurrentModel();

    const def = PARAMS.find((p) => p.key === 'ctx_size')!.default;
    expect(params.values['ctx_size']).toBe(def);
    expect(params.values[MODEL_KEY]).toBe('C:/models/foo.gguf');
    expect(params.hasChanges).toBe(false);
    expect(saveParamsMock).toHaveBeenCalledWith('C:/models/foo.gguf', expect.objectContaining({ [MODEL_KEY]: 'C:/models/foo.gguf' }));
  });

  it('resetCurrentModel：自动检测字段清空后立即重探回填（对齐 applyModel，不等下次启动）', async () => {
    const api = (globalThis as any).window.api;
    const origMmproj = api.models.detectMmproj;
    api.models.detectMmproj = () => Promise.resolve('C:/detected/mmproj.gguf');
    try {
      const params = useParamsStore();
      await params.applyModel('C:/models/foo.gguf');
      // 上一模型的 mmproj 探测值在重置时被清空
      params.set('mmproj', 'D:/old/mmproj-a.gguf');

      await params.resetCurrentModel();

      expect(params.values['mmproj']).toBe('C:/detected/mmproj.gguf');
    } finally {
      api.models.detectMmproj = origMmproj;
    }
  });

  it('autoSave 不再写预设文件（预设机制已移除，双轨核心回归沿用）', async () => {
    const params = useParamsStore();
    await params.applyModel('C:/models/foo.gguf');
    params.set('ctx_size', 4096);
    await vi.advanceTimersByTimeAsync(1000);
    // window.api 上已不存在 presets 域；save 只发生在 modelParams
    expect((globalThis as any).window.api.presets).toBeUndefined();
    expect(saveParamsMock).toHaveBeenCalled();
  });
});

describe('hasChanges（当前参数相对出厂默认的偏离；自动管理字段不计入）', () => {
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

  it('自动管理字段（mmproj、spec_draft_model、alias）不计入已修改', async () => {
    const params = useParamsStore();
    await params.applyModel('C:/models/foo.gguf'); // 派生 alias + 探测字段
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

  it('checkbox 依赖源按布尔语义判定（默认值为 true 的 cache_prompt 勾选即满足）', () => {
    // cache_reuse dependsOn cache_prompt（checkbox, default true, values: ['true']）
    const checkboxRule = { key: 'cache_prompt', values: ['true'] };
    expect(isDependencySatisfied(checkboxRule, {})).toBe(false);
    expect(isDependencySatisfied(checkboxRule, { cache_prompt: false })).toBe(false);
    expect(isDependencySatisfied(checkboxRule, { cache_prompt: 'false' })).toBe(false);
    expect(isDependencySatisfied(checkboxRule, { cache_prompt: true })).toBe(true);
    expect(isDependencySatisfied(checkboxRule, { cache_prompt: 'true' })).toBe(true);
    // 数值 1 虽按布尔语义"生效"，但 String(1)="1" 不匹配 values:['true'] → 不满足（与命令构建器一致）
    expect(isDependencySatisfied(checkboxRule, { cache_prompt: 1 })).toBe(false);
  });

  it('checkbox 依赖源未勾选时不满足（与命令构建器 isDependencyMet 语义一致）', () => {
    expect(computeViolatedParams({ cache_prompt: false })).toContainEqual(
      expect.objectContaining({ key: 'cache_reuse' }),
    );
    expect(computeViolatedParams({ cache_prompt: true })).not.toContainEqual(
      expect.objectContaining({ key: 'cache_reuse' }),
    );
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

// 网络常量派生自 PARAMS 表（唯一起点见 definitions.ts）：表里改 min/max/default，
// 这些常量与校验必须跟着变，否则会出现「参数页允许、启动前检查拒绝」的分裂。
describe('网络常量派生与端口校验', () => {
  const portDef = PARAMS.find((p) => p.key === 'port')!;
  const hostDef = PARAMS.find((p) => p.key === 'host')!;

  it('PORT_MIN / PORT_MAX 等于参数表 port 条目的 min / max', () => {
    expect(PORT_MIN).toBe(portDef.min);
    expect(PORT_MAX).toBe(portDef.max);
    expect(Number.isFinite(PORT_MIN)).toBe(true);
    expect(Number.isFinite(PORT_MAX)).toBe(true);
  });

  it('默认值自洽：DEFAULT_PORT 落在合法区间，DEFAULT_HOST 非空', () => {
    expect(isValidPort(DEFAULT_PORT)).toBe(true);
    expect(DEFAULT_PORT).toBe(portDef.default);
    expect(DEFAULT_HOST).toBe(hostDef.default);
    expect(DEFAULT_HOST.length).toBeGreaterThan(0);
  });

  it('isValidPort 边界：两端合法，越界/小数/NaN/0 全拒', () => {
    expect(isValidPort(PORT_MIN)).toBe(true);
    expect(isValidPort(PORT_MAX)).toBe(true);
    expect(isValidPort(PORT_MIN - 1)).toBe(false);
    expect(isValidPort(PORT_MAX + 1)).toBe(false);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(8080.5)).toBe(false);
    expect(isValidPort(Number.NaN)).toBe(false);
    // 空串经 Number() 得 0，同样视为非法（与删除的 TextParam 死分支语义一致）
    expect(isValidPort(Number(''))).toBe(false);
  });
});

describe('params store 换模型：每模型自动持久化下的切换语义（2026-10-08）', () => {
  it('切到新模型 = 回到新模型自己的状态：旧模型的伴随路径不再跨模型残留', async () => {
    const params = useParamsStore();
    const api = (globalThis as any).window.api;
    const origMmproj = api.models.detectMmproj;
    const probed: string[] = [];
    api.models.detectMmproj = (p: string) => {
      probed.push(p);
      return Promise.resolve(p.includes('new') ? 'D:/Models/new/mmproj-b.gguf' : '');
    };
    try {
      await params.applyModel('D:/Models/old/a.gguf');
      params.set('mmproj', 'D:/Models/old/mmproj-a.gguf');   // 自动保存进旧模型的参数集
      params.set('spec_draft_model', 'E:/shared/draft.gguf'); // 同上
      await vi.advanceTimersByTimeAsync(800); // 推过节流窗：调整落盘为旧模型的参数集

      await params.applyModel('D:/Models/new/b.gguf');

      // 新模型无已存参数 ⇒ 回默认 + 为新模型重探 mmproj（旧模型的伴随路径不残留）
      expect(probed, '换模型后必须为新模型重探 mmproj').toContain('D:/Models/new/b.gguf');
      expect(params.values.mmproj).toBe('D:/Models/new/mmproj-b.gguf');
      expect(params.values.spec_draft_model).toBe('');

      // 切回旧模型：刚才的调整已自动保存，随模型整体恢复
      await params.applyModel('D:/Models/old/a.gguf');
      expect(params.values.mmproj).toBe('D:/Models/old/mmproj-a.gguf');
      expect(params.values.spec_draft_model).toBe('E:/shared/draft.gguf');
    } finally {
      api.models.detectMmproj = origMmproj;
    }
  });
});

// ---- countDiffers：与给定参数集的比较口径（「运行中 ≠ 当前参数」信号源的地基，
// 2026-10-09 补测——useStaleParams.test.ts 只测状态门控，比较口径归这里） ----
describe('countDiffers', () => {
  it('other 为空（服务未运行/无快照）返回 0', () => {
    const params = useParamsStore();
    expect(params.countDiffers(null)).toBe(0);
    expect(params.countDiffers(undefined)).toBe(0);
  });

  it('逐键按 String 比较：数字与同值字符串不算差异（other 语义 = 完整快照，先 snapshot 打底）', () => {
    const params = useParamsStore();
    params.set('ctx_size', 4096);
    const snap = params.snapshot();
    snap['ctx_size'] = '4096';
    expect(params.countDiffers(snap)).toBe(0);
    snap['ctx_size'] = '8192';
    expect(params.countDiffers(snap)).toBe(1);
  });

  it('自动检测字段不计入差异（mmproj/spec_draft_model/alias 随模型自动管理）', () => {
    const params = useParamsStore();
    params.set('mmproj', 'D:/a.mmproj');
    params.set('spec_draft_model', 'D:/draft.gguf');
    params.set('alias', 'x');
    const snap = params.snapshot();
    snap['mmproj'] = 'D:/b.mmproj';
    snap['spec_draft_model'] = 'E:/draft2.gguf';
    snap['alias'] = 'y';
    expect(params.countDiffers(snap)).toBe(0);
  });

  it('模型键差异计入（运行中的服务用的不是当前选中的模型）', () => {
    const params = useParamsStore();
    const snap = params.snapshot();
    snap[MODEL_KEY] = 'D:/other.gguf';
    expect(params.countDiffers(snap)).toBe(1);
  });
});
