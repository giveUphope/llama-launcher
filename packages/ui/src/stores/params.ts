import { defineStore } from 'pinia';
import { reactive, computed, ref, watch } from 'vue';
import { PARAMS, MODEL_KEY, modelBaseName } from '@llama-launcher/shared';
import type { ParamDef, PresetValues, GgufModelInfo, GgufSuggestedParam, SessionBaseline } from '@llama-launcher/shared';
import { useSettingsStore } from './settings';
import { useServerStore } from './server';
import { useI18nStore } from './i18n';
import { confirm } from '@/composables/useConfirm';

// 推测解码类型 → 推荐最大草稿数
const SPEC_DRAFT_N_MAX_BY_TYPE: Record<string, number> = {
  'draft-simple': 8,
  'draft-eagle3': 8,
  'draft-dflash': 15,
  'draft-dspark': 8,
  'draft-mtp': 5,
  'ngram-simple': 5,
  'ngram-map-k': 5,
  'ngram-map-k4v': 5,
  'ngram-mod': 5,
  'ngram-cache': 5,
};

const EXTERNAL_DRAFT_TYPES = new Set<string>(['draft-simple', 'draft-eagle3', 'draft-dflash', 'draft-dspark']);

// 作为依赖源出现的参数 key（dependsOn.key）。仅这些参数变化才联动清理下游。
const DEP_SOURCE_KEYS = new Set<string>(
  PARAMS.filter((p) => p.dependsOn).map((p) => p.dependsOn!.key),
);

// 自动检测/自动填充的参数，不计入"已修改"指示（mmproj / 草稿模型路径由 app 管理）
const IGNORE_FOR_DIRTY = new Set<string>(['mmproj', 'spec_draft_model']);

function findParamDef(key: string): ParamDef | undefined {
  return PARAMS.find((p) => p.key === key);
}

/**
 * 声明式依赖判定（纯函数）：依赖是否满足。
 * 满足条件：依赖参数的值"已生效"，且其值不在 notValues、且在 values（若声明）中。
 * "已生效"语义与命令构建器（core `isDependencyMet`）保持一致：
 * - checkbox 依赖源按布尔语义判定（true = 生效，false = 未生效）——默认值为 true 的
 *   checkbox（如 cache_prompt）无法用"值 ≠ 默认值"判定，若照搬会误判为"不满足"，
 *   导致依赖参数（cache_reuse）被误清空/误禁用，与命令实际发射相反；
 * - 其余类型以"值 ≠ 其默认值"判定（默认值 = 未启用）。
 */
export function isDependencySatisfied(
  dep: ParamDef['dependsOn'],
  values: Record<string, string | number | boolean>,
): boolean {
  if (!dep) return true;
  const depDef = PARAMS.find((p) => p.key === dep.key);
  if (!depDef) return false;
  const depValue = values[dep.key] ?? '';
  if (depDef.type === 'checkbox') {
    const b = depValue === true || depValue === 'true' || depValue === 1 || depValue === '1';
    if (!b) return false;
  } else {
    if (depValue === depDef.default) return false;
  }
  const depValueStr = String(depValue);
  if (dep.notValues && dep.notValues.includes(depValueStr)) return false;
  if (dep.values && dep.values.length > 0 && !dep.values.includes(depValueStr)) return false;
  return true;
}

/** 返回所有依赖不满足、需要重置的参数定义。 */
export function computeViolatedParams(values: Record<string, string | number | boolean>): ParamDef[] {
  return PARAMS.filter((p) => p.dependsOn && !isDependencySatisfied(p.dependsOn, values));
}

function normalizePresetValue(p: ParamDef, raw: string | number | boolean): string | number | boolean {
  if (p.type === 'checkbox') {
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
  }
  if (p.type === 'int_entry' || p.type === 'int_slider') {
    let n = Math.round(Number(raw));
    if (Number.isNaN(n)) n = Number(p.default);
    if (p.min !== undefined && n < p.min) n = p.min;
    if (p.max !== undefined && n > p.max) n = p.max;
    return n;
  }
  if (p.type === 'float_slider') {
    let n = Number(raw);
    if (Number.isNaN(n)) n = Number(p.default);
    n = Math.round(n * 100) / 100;
    if (p.min !== undefined && n < p.min) n = p.min;
    if (p.max !== undefined && n > p.max) n = p.max;
    return n;
  }
  if (p.type === 'dropdown') {
    const s = String(raw);
    if (p.options && p.options.length > 0) {
      if (p.options.includes(s)) return s;
      if (p.key === 'spec_type' && s === 'draft-model') return 'draft-simple';
      // editable 下拉（chat_template 等）：合法的自定义输入值得保留
      // （值 ∉ 内置 options 不代表非法，这正是 editable 的用途），
      // 否则预设保存后重新加载会把自定义模板回退成默认值，造成配置丢失
      if (p.editable && s !== '') return s;
      return p.default;
    }
    return s;
  }
  return String(raw);
}

export const useParamsStore = defineStore('params', () => {
  const values = reactive<PresetValues>({});
  const ggufInfo = ref<GgufModelInfo | null>(null);
  const ggufSuggestions = ref<GgufSuggestedParam[]>([]);
  const ggufLoading = ref(false);
  const ggufError = ref('');
  // 参数会话基线（双轨逻辑的锚点）：当前会话加载的预设（名称 + 应用时刻完整快照）；
  // null = 无预设基线（出厂默认轨道）。hasChanges 与「恢复基线」都相对基线计算。
  const baseline = ref<SessionBaseline | null>(null);
  init();

  function init() {
    for (const p of PARAMS) {
      values[p.key] = p.default;
    }
    values[MODEL_KEY] = '';
  }

  /** 会话持久化：当前参数快照 + 基线写入 settings（临时轨道专用，永不触碰预设文件）。 */
  function persistSession() {
    const settings = useSettingsStore();
    if (!settings.settings) return;
    settings.settings.session_values = snapshot();
    settings.settings.session_baseline = baseline.value ? JSON.parse(JSON.stringify(baseline.value)) : null;
    void settings.save();
  }

  function get(key: string): string | number | boolean {
    return values[key];
  }

  function set(key: string, value: string | number | boolean) {
    values[key] = value;
    if (key === MODEL_KEY) {
      const settings = useSettingsStore();
      if (settings.settings) {
        settings.settings.selected_model = String(value);
        void settings.save();
      }
      // 模型名使用别名参数：随模型自动派生别名（文件名去 .gguf 后缀），
      // 命令构建自动携带 -a/--alias，API 侧模型名不带扩展名；换模型时别名跟随更新
      values['alias'] = modelBaseName(String(value));
      return;
    }
    // 依赖源参数变化时联动清理下游
    if (DEP_SOURCE_KEYS.has(key)) {
      syncDependencies();
    }
    // 选择推测解码类型时，自动应用该类型的推荐最大草稿数
    if (key === 'spec_type') {
      const t = String(value);
      const recNMax = t !== '' && t !== 'none' ? SPEC_DRAFT_N_MAX_BY_TYPE[t] : undefined;
      if (recNMax !== undefined) {
        values['spec_draft_n_max'] = recNMax;
        const nMin = Number(values['spec_draft_n_min'] ?? 0);
        if (Number.isFinite(nMin) && nMin > recNMax) {
          values['spec_draft_n_min'] = recNMax;
        }
      }
    }
    if (key === 'spec_draft_n_max') {
      const nMin = Number(values['spec_draft_n_min'] ?? 0);
      const nMax = Number(value);
      if (Number.isFinite(nMin) && Number.isFinite(nMax) && nMin > nMax) {
        values['spec_draft_n_min'] = nMax;
      }
    }
    // 切回外部草稿模型类型时自动重新检测草稿模型路径
    if (key === 'spec_type' && EXTERNAL_DRAFT_TYPES.has(String(value))) {
      if (!String(values['spec_draft_model'] ?? '')) {
        void detectDraftModel(String(values[MODEL_KEY] ?? ''));
      }
    }
  }

  function resetParam(key: string) {
    const def = findParamDef(key);
    if (def) values[key] = def.default;
  }

  function resetGroup(group: string) {
    for (const p of PARAMS) {
      if (p.group === group) {
        values[p.key] = p.default;
      }
    }
  }

  function resetAll() {
    for (const p of PARAMS) {
      values[p.key] = p.default;
    }
    values[MODEL_KEY] = '';
  }

  /**
   * 应用预设（完全覆盖），并以该预设建立会话基线。返回应用后非默认参数数量，供调用方反馈。
   * 值做智能归一化；加载后清理依赖不满足的参数，保证预设内部自洽。
   * presetName：预设名（建立基线用；空 = 自定义参数集基线，如 bench 参数应用）。
   */
  function applyPreset(presetValues: PresetValues, presetName = ''): number {
    const currentModel = String(values[MODEL_KEY] ?? '');
    resetAll();
    if (!presetValues[MODEL_KEY] && currentModel) {
      values[MODEL_KEY] = currentModel;
    }
    for (const k of Object.keys(presetValues)) {
      if (k === MODEL_KEY) {
        values[k] = String(presetValues[k]);
        continue;
      }
      const def = findParamDef(k);
      if (!def) continue;
      values[k] = normalizePresetValue(def, presetValues[k]);
    }
    // 预设携带模型但未存别名（旧预设）：按模型文件名派生别名（去 .gguf 后缀）
    if (presetValues[MODEL_KEY] && !String(values['alias'] ?? '').trim()) {
      values['alias'] = modelBaseName(String(values[MODEL_KEY]));
    }
    syncDependencies();
    // 应用预设 = 建立新基线（双轨逻辑：预设完整轨道的锚点）
    markBaseline(presetName);
    let count = 0;
    for (const p of PARAMS) {
      if (values[p.key] !== p.default) count++;
    }
    return count;
  }

  function snapshot(): PresetValues {
    return { ...values };
  }

  /**
   * 已修改（脏）标记：相对【基线】的偏离（双轨逻辑语义）。
   * - 有基线（已加载预设）：逐键与基线快照比较（忽略自动检测字段）→ 红点 = 有未固化的临时调整
   * - 无基线（出厂默认轨道）：与出厂默认比较（原语义）
   */
  const hasChanges = computed(() => {
    const isIgnored = (k: string) => IGNORE_FOR_DIRTY.has(k);
    if (!baseline.value) {
      for (const p of PARAMS) {
        if (isIgnored(p.key)) continue;
        if (values[p.key] !== p.default) return true;
      }
      return false;
    }
    const b = baseline.value.values;
    const keys = new Set([...Object.keys(b), ...PARAMS.map((p) => p.key)]);
    for (const k of keys) {
      if (isIgnored(k)) continue;
      if (String(values[k] ?? '') !== String(b[k] ?? '')) return true;
    }
    return false;
  });

  /** 建立基线：以当前参数快照为基线（presetName 空 = 自定义参数集/无命名基线），并持久化会话。 */
  function markBaseline(presetName: string) {
    baseline.value = { preset_name: presetName, values: snapshot() };
    persistSession();
  }

  /** 恢复基线：参数回到基线快照（≠ 重置出厂默认），并持久化会话。 */
  function restoreBaseline() {
    if (!baseline.value) return;
    resetAll();
    const restored = JSON.parse(JSON.stringify(baseline.value.values)) as PresetValues;
    for (const [k, v] of Object.entries(restored)) values[k] = v;
    syncDependencies();
    persistSession();
  }

  /** 清除会话：回出厂默认并清空基线（慎用；仅由「清除会话参数」确认后调用）。 */
  function clearSession() {
    baseline.value = null;
    resetAll();
    persistSession();
  }

  /** 恢复会话（启动链）：以上次会话参数为当前状态 + 恢复基线，再补运行时检测。 */
  async function restoreSession(sessionValues: PresetValues, baselineInfo: SessionBaseline | null) {
    resetAll();
    for (const [k, v] of Object.entries(sessionValues)) values[k] = v;
    baseline.value = baselineInfo ? JSON.parse(JSON.stringify(baselineInfo)) : null;
    const settings = useSettingsStore();
    if (settings.settings && values[MODEL_KEY]) {
      settings.settings.selected_model = String(values[MODEL_KEY]);
    }
    persistSession();
    const model = String(values[MODEL_KEY] ?? '');
    await Promise.all([detectMmproj(model), detectDraftModel(model), loadGguf(model)]);
  }

  /** 切换模型/应用完整参数集前的防丢确认：相对基线有未固化修改时询问丢弃。 */
  async function confirmDiscardDirty(): Promise<boolean> {
    if (!hasChanges.value) return true;
    const i18n = useI18nStore();
    // 无基线（出厂默认轨道）时脏 = 偏离默认值，来源显示「默认参数」
    const from = baseline.value
      ? baseline.value.preset_name
        ? i18n.t('baseline_preset').replace('{0}', baseline.value.preset_name)
        : i18n.t('baseline_custom')
      : i18n.t('baseline_default');
    return (await confirm({
      title: i18n.t('msg_discard_dirty_title'),
      message: i18n.t('msg_discard_dirty').replace('{0}', from),
      variant: 'warning',
    })) === true;
  }

  function setGgufInfo(info: GgufModelInfo | null, suggestions: GgufSuggestedParam[]) {
    ggufInfo.value = info;
    ggufSuggestions.value = suggestions;
  }

  /** 联动清理：依赖不满足的参数恢复到默认（文件/目录保留用户路径，由命令构建器跳过发射）。 */
  function syncDependencies() {
    for (const p of computeViolatedParams(values)) {
      resetDep(p);
    }
  }

  function resetDep(p: ParamDef) {
    if (values[p.key] === p.default) return;
    // 文件/目录路径：依赖不满足时保留用户路径，由命令构建器根据依赖跳过发射，
    // 避免切换依赖源时丢失用户已选文件；切回兼容类型或自动检测会恢复填充。
    if (p.type === 'file' || p.type === 'dir') {
      return;
    }
    values[p.key] = p.default;
  }

  async function detectMmproj(modelPathValue: string): Promise<void> {
    const server = useServerStore();
    const i18n = useI18nStore();
    if (!modelPathValue) {
      values['mmproj'] = '';
      return;
    }
    const currentMmproj = String(values['mmproj'] ?? '').trim();
    if (currentMmproj) return;
    try {
      const mmprojPath = await window.api.models.detectMmproj(modelPathValue);
      if (mmprojPath) {
        values['mmproj'] = mmprojPath;
        server.pushOutput({
          kind: 'info',
          data: `[mmproj] ${i18n.t('msg_mmproj_detected').replace('{0}', mmprojPath)}\n`,
          ts: Date.now(),
        });
      } else {
        server.pushOutput({
          kind: 'info',
          data: `[mmproj] ${i18n.t('msg_mmproj_not_detected')}\n`,
          ts: Date.now(),
        });
      }
    } catch {
      // 检测失败时保持当前状态
    }
  }

  async function detectDraftModel(modelPathValue: string): Promise<void> {
    if (!modelPathValue) {
      values['spec_draft_model'] = '';
      return;
    }
    const currentDraft = String(values['spec_draft_model'] ?? '').trim();
    if (currentDraft) return;
    try {
      const draftPath = await window.api.models.detectDraft(modelPathValue);
      if (draftPath) {
        const server = useServerStore();
        const i18n = useI18nStore();
        const st = String(values.spec_type ?? '');
        if (st !== '' && st !== 'none' && !EXTERNAL_DRAFT_TYPES.has(st)) {
          return;
        }
        const isDflash = draftPath.toLowerCase().includes('dflash');
        values['spec_draft_model'] = draftPath;
        if (st === '' || st === 'none') {
          if (isDflash) {
            values['spec_type'] = 'draft-dflash';
            values['flash_attn'] = 'on';
            values['spec_draft_n_max'] = 15;
            server.pushOutput({
              kind: 'success',
              data: `[spec] ${i18n.t('msg_dflash_detected').replace('{0}', draftPath)}\n`,
              ts: Date.now(),
            });
          } else {
            values['spec_type'] = 'draft-simple';
            server.pushOutput({
              kind: 'success',
              data: `[spec] ${i18n.t('msg_draft_detected').replace('{0}', draftPath)}\n`,
              ts: Date.now(),
            });
          }
        }
      }
    } catch {
      // 检测失败时保持当前状态
    }
  }

  async function loadGguf(modelPathValue: string): Promise<void> {
    if (!modelPathValue) {
      ggufInfo.value = null;
      ggufSuggestions.value = [];
      ggufError.value = '';
      return;
    }
    // 懒加载守卫：同一模型的元数据已加载时跳过重复读取
    // （页面往返/启动补检测不重复占用 IO；换模型或强制刷新路径不同自然重读）
    if (!ggufLoading.value && ggufInfo.value?.path === modelPathValue) return;
    ggufLoading.value = true;
    ggufError.value = '';
    try {
      const res = await window.api.models.readGgufMeta(modelPathValue);
      if (res && res.ok) {
        ggufInfo.value = res.data.info;
        ggufSuggestions.value = res.data.suggestions;
      } else {
        ggufInfo.value = null;
        ggufSuggestions.value = [];
        ggufError.value = res?.error ?? 'unknown';
      }
    } catch (e: any) {
      ggufInfo.value = null;
      ggufSuggestions.value = [];
      ggufError.value = e?.message ?? String(e);
    } finally {
      ggufLoading.value = false;
    }
  }

  /** 应用模型（用户切换动作）：有未固化临时调整时先确认丢弃；false = 用户取消。 */
  async function applyModel(path: string): Promise<boolean> {
    if (!(await confirmDiscardDirty())) return false;
    const server = useServerStore();
    const prev = String(values[MODEL_KEY] ?? '');
    if (path && path !== prev) {
      server.clearOutputs();
    }
    set(MODEL_KEY, path);
    // 无预设基线轨道：应用模型即重建"临时"基线（该模型的当前参数；
    // 若随后智能预设匹配命中，applyPreset 会以预设名重建基线）
    markBaseline('');
    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);
    return true;
  }

  /**
   * 启动补检测（非用户切换）：为已恢复的模型补齐 mmproj/draft 检测与 GGUF 元数据。
   * 不确认、不重建基线、不重派生别名（会话里的自定义别名不被覆盖）。
   */
  async function reattachModelRuntime(path: string): Promise<void> {
    values[MODEL_KEY] = path;
    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);
  }

  /** 应用模型 + GGUF 建议参数（用户动作）：确认防丢；false = 用户取消。 */
  async function applyModelWithSuggestions(path: string): Promise<boolean> {
    if (!(await confirmDiscardDirty())) return false;
    const server = useServerStore();
    const i18n = useI18nStore();
    resetAll();
    set(MODEL_KEY, path);
    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);
    let count = 0;
    for (const s of ggufSuggestions.value) {
      set(s.key, s.value);
      count++;
    }
    // GGUF 建议应用 = 重建"临时"基线（建议值即该模型的起始参数）
    markBaseline('');
    if (count > 0) {
      server.pushOutput({
        kind: 'success',
        data: i18n.t('msg_gguf_applied').replace('{0}', String(count)) + '\n',
        ts: Date.now(),
      });
    }
    return true;
  }

  // 自动保存（临时轨道）：参数变化时节流写入 settings.session_values——
  // 重启可恢复会话，但**永不写入预设文件**（预设文件只由显式保存写入，
  // 消除旧 autoSave 静默覆盖预设导致的临时/预设混杂）。
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  watch(values, async () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (typeof window?.api?.settings?.save === 'undefined') return;
    autoSaveTimer = setTimeout(() => {
      persistSession();
    }, 800);
  }, { deep: true });

  return {
    values, baseline, ggufInfo, ggufSuggestions, ggufLoading, ggufError,
    get, set, resetParam, resetGroup, resetAll,
    applyPreset, snapshot, hasChanges,
    markBaseline, restoreBaseline, clearSession, restoreSession, confirmDiscardDirty, reattachModelRuntime,
    setGgufInfo, detectMmproj, detectDraftModel, loadGguf, applyModel, applyModelWithSuggestions,
  };
});
