import { defineStore } from 'pinia';
import { reactive, computed, ref, watch } from 'vue';
import { PARAMS, MODEL_KEY, modelBaseName } from '@llama-launcher/shared';
import type { ParamDef, PresetValues, GgufModelInfo, GgufSuggestedParam } from '@llama-launcher/shared';
import { useSettingsStore } from './settings';
import { useServerStore } from './server';
import { useAppLogStore } from './appLog';
import { useI18nStore } from './i18n';

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

// 不计入「已修改」的自动管理字段：mmproj / 草稿模型路径由检测填充，
// alias 由模型文件名自动派生——三者都不表达用户的自定义意图
const IGNORE_FOR_DIRTY = new Set<string>(['mmproj', 'spec_draft_model', 'alias']);
// 参数键常量表（hasChanges 每次求值都要用它建集合，避免逐次 PARAMS.map 分配）
const PARAM_KEYS: string[] = PARAMS.map((p) => p.key);

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
      // 否则持久化后重新加载会把自定义模板回退成默认值，造成配置丢失
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
  init();

  function init() {
    for (const p of PARAMS) {
      values[p.key] = p.default;
    }
    values[MODEL_KEY] = '';
  }

  /** 把当前参数快照持久化到当前模型名下（自动保存的唯一出口，节流后调用）。 */
  function persistModelParams() {
    const model = String(values[MODEL_KEY] ?? '');
    if (!model) return;
    if (typeof window?.api?.modelParams?.save === 'undefined') return; // 浏览器 mock 环境容错
    void window.api.modelParams.save(model, snapshot());
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

  /** 按已存参数集逐键归一化写入（未知键忽略；模型键不在此流程——模型即存储键）。 */
  function applyStoredValues(stored: PresetValues): number {
    let changed = 0;
    for (const k of Object.keys(stored)) {
      if (k === MODEL_KEY || k === '_enabled') continue;
      const def = findParamDef(k);
      if (!def) continue;
      const v = normalizePresetValue(def, stored[k]);
      if (values[k] !== v) changed++;
      values[k] = v;
    }
    syncDependencies();
    return changed;
  }

  function snapshot(): PresetValues {
    return { ...values };
  }

  /**
   * 与给定参数集比较，返回不同的项数（忽略自动检测字段，口径同 hasChanges）。
   * 用途：命令预览卡提示「运行中的服务用的是启动那一刻的参数」——预览显示的是
   * 下次启动会用的命令，两者不一致时必须说出来，否则用户会以为屏幕上的就是正在跑的。
   * other 为空（服务未运行/无快照）返回 0。
   */
  function countDiffers(other: PresetValues | null | undefined): number {
    if (!other) return 0;
    let n = 0;
    for (const p of PARAMS) {
      if (IGNORE_FOR_DIRTY.has(p.key)) continue;
      if (String(values[p.key] ?? '') !== String(other[p.key] ?? '')) n++;
    }
    if (String(values[MODEL_KEY] ?? '') !== String(other[MODEL_KEY] ?? '')) n++;
    return n;
  }

  /**
   * 已修改标记：当前参数相对**出厂默认**的偏离（2026-10-08 起，双轨基线机制随
   * 每模型自动持久化移除——参数永远已保存，不再有「未固化修改」概念）。
   * 语义 = 「该模型有自定义参数」：侧栏橙点与「全部重置」可用性都看它。
   */
  const hasChanges = computed(() => {
    const isIgnored = (k: string) => IGNORE_FOR_DIRTY.has(k);
    for (const k of PARAM_KEYS) {
      const def = findParamDef(k);
      if (!def || isIgnored(k)) continue;
      if (values[k] !== def.default) return true;
    }
    return false;
  });

  /**
   * 全部重置：当前模型参数回出厂默认（保留模型选择），随后自动持久化覆盖该模型的参数集。
   * 对齐 applyModel 语义（2026-10-08）：重置把 mmproj/草稿模型等自动检测字段清空后，
   * **立即重探回填**——不等下次启动，本会话内多模态/推测解码不因重置而失效；
   * 探测只在字段为空时填充，不会覆盖已存参数集里的值。
   */
  async function resetCurrentModel() {
    const model = String(values[MODEL_KEY] ?? '');
    resetAll();
    if (model) {
      values[MODEL_KEY] = model;
      values['alias'] = modelBaseName(model);
    }
    persistModelParams();
    if (model) {
      await Promise.all([detectMmproj(model), detectDraftModel(model)]);
    }
  }

  /**
   * 应用模型（唯一入口，2026-10-08 起每模型自动持久化）：
   *  1. 回出厂默认并设定模型（派生别名、写回 selected_model）；
   *  2. 载入该模型的已存参数集（有则覆盖叠加——参数跟模型走）；
   *  3. 补运行时检测（mmproj/草稿模型只在字段为空时探测，不覆盖已存值）；
   *  4. 首次见面（无已存参数集）且模型元数据带推荐参数时自动应用——
   *     每个「任一模型」都能自动匹配到属于它的配置参数，全程无需手动保存。
   * 调整即保存：应用完成后 800ms 节流把最终状态写回该模型名下（见底部 watch）。
   * 注：旧版「清上一模型目录里的伴随残留」规则随之消亡——伴随路径本就自动存进
   * 各自模型的参数集，切换 = 回到该模型自己的状态，不存在跨模型残留。
   */
  async function applyModel(path: string): Promise<boolean> {
    const server = useServerStore();
    const i18n = useI18nStore();
    const appLog = useAppLogStore();
    const prev = String(values[MODEL_KEY] ?? '');
    if (path && path !== prev) {
      server.clearOutputs();
    }
    resetAll();
    set(MODEL_KEY, path);

    let storedChanged: number | null = null;
    if (path && typeof window?.api?.modelParams?.load !== 'undefined') {
      try {
        const stored = await window.api.modelParams.load(path);
        if (stored) storedChanged = applyStoredValues(stored.values);
      } catch {
        // 读取失败按无已存参数处理（回落默认 + GGUF 建议）
      }
    }

    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);

    if (path) {
      if (storedChanged !== null) {
        appLog.push({
          kind: 'info',
          data: `[params] ${i18n.t('msg_model_params_loaded', [
            path.split(/[\\/]/).pop() ?? path,
            String(storedChanged),
          ])}\n`,
          ts: Date.now(),
        });
      } else if (ggufSuggestions.value.length > 0) {
        let count = 0;
        for (const s of ggufSuggestions.value) {
          set(s.key, s.value);
          count++;
        }
        appLog.push({
          kind: 'success',
          data: `[gguf] ${i18n.t('msg_gguf_applied', [String(count)])}\n`,
          ts: Date.now(),
        });
      }
    }
    return true;
  }

  /** 应用模型 + GGUF 建议参数（用户显式动作，可用于重新应用建议）：应用后自动持久化。 */
  async function applyModelWithSuggestions(path: string): Promise<boolean> {
    const server = useServerStore();
    const i18n = useI18nStore();
    const appLog = useAppLogStore();
    const prev = String(values[MODEL_KEY] ?? '');
    if (path && path !== prev) server.clearOutputs();
    resetAll();
    set(MODEL_KEY, path);
    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);
    let count = 0;
    for (const s of ggufSuggestions.value) {
      set(s.key, s.value);
      count++;
    }
    if (count > 0) {
      appLog.push({
        kind: 'success',
        data: `[gguf] ${i18n.t('msg_gguf_applied', [String(count)])}\n`,
        ts: Date.now(),
      });
    }
    return true;
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
    const i18n = useI18nStore();
    const appLog = useAppLogStore();
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
        appLog.push({
          kind: 'info',
          data: `[mmproj] ${i18n.t('msg_mmproj_detected', [mmprojPath])}\n`,
          ts: Date.now(),
        });
      } else {
        appLog.push({
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
        const i18n = useI18nStore();
        const appLog = useAppLogStore();
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
            appLog.push({
              kind: 'success',
              data: `[spec] ${i18n.t('msg_dflash_detected', [draftPath])}\n`,
              ts: Date.now(),
            });
          } else {
            values['spec_type'] = 'draft-simple';
            appLog.push({
              kind: 'success',
              data: `[spec] ${i18n.t('msg_draft_detected', [draftPath])}\n`,
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

  // 自动保存（每模型轨道）：参数变化时节流写入该模型名下的参数集——
  // 参数永远已保存，切模型/重启即自动载回（2026-10-08 取代 session_values + 手存预设双轨）。
  // 节流窗口 800ms 沿用历史契约（原双轨自动保存同值），改这里须同步文档。
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const SESSION_SAVE_THROTTLE_MS = 800;
  watch(values, () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (typeof window?.api?.modelParams?.save === 'undefined') return;
    autoSaveTimer = setTimeout(() => {
      persistModelParams();
    }, SESSION_SAVE_THROTTLE_MS);
  }, { deep: true });

  return {
    values, ggufInfo, ggufSuggestions, ggufLoading, ggufError,
    get, set, resetParam, resetGroup, resetAll,
    snapshot, hasChanges, countDiffers,
    resetCurrentModel, applyModel, applyModelWithSuggestions,
    detectMmproj, detectDraftModel, loadGguf,
  };
});
