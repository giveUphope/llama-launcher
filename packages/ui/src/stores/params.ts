import { defineStore } from 'pinia';
import { reactive, computed, ref } from 'vue';
import { PARAMS, MODEL_KEY, BASELINE_ENABLED_KEYS } from '@llama-launcher/shared';
import type { ParamDef, PresetValues, GgufModelInfo, GgufSuggestedParam } from '@llama-launcher/shared';
import { useSettingsStore } from './settings';
import { useServerStore } from './server';
import { useI18nStore } from './i18n';

/**
 * 启用状态编码到 PresetValues 中的保留 key。
 * 值为 JSON 字符串，解码后为 Record<string, boolean>。
 * 预设保存/加载时自动包含，无需额外 IPC 改动。
 */
export const ENABLED_KEY = '_enabled';

// 不参与"填写后自动勾选启用"逻辑的特殊 key
// - MODEL_KEY: 模型路径，命令构建器单独处理（-m 参数），不需要 enabled 控制
// - mmproj: 由 autoDetectMmproj 单独控制启用状态
const SPECIAL_KEYS = new Set<string>([MODEL_KEY, 'mmproj']);

// 需要外部草稿模型文件的推测解码类型（-md/-ngld/-ctkd/-ctvd 仅对它们有意义）
// draft-mtp 使用主模型 MTP 头、ngram-* 基于 n-gram，均不需要外部草稿模型
const EXTERNAL_DRAFT_TYPES = new Set<string>(['draft-simple', 'draft-eagle3', 'draft-dflash', 'draft-dspark']);

// 投机采样类型 → 推荐最大草稿数（--spec-draft-n-max）：
// 选择类型时自动应用——仅选 spec_type 而不配草稿数，无法达到该方式的最佳效率。
// draft-simple/eagle3/dspark 用独立小草稿模型，取 8；dflash 深度草稿需较多草稿且依赖
// Flash Attention，取 15；draft-mtp 草稿长度受主模型 MTP 层数限制，取 5；ngram-* 收益有限，取 5。
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

function findParamDef(key: string): ParamDef | undefined {
  return PARAMS.find((p) => p.key === key);
}

/** 依赖规则（dependsOn 声明的形状） */
export interface DependencyRule {
  key: string;
  values?: string[];
  notValues?: string[];
}

/**
 * 声明式依赖判定（纯函数，可独立测试）：依赖是否满足。
 * 满足条件：依赖参数已启用，且其值不在 notValues、且在 values（若声明）中。
 * 与 ParamRow.dependencyMet 的判定保持一致。
 */
export function isDependencySatisfied(
  dep: DependencyRule,
  values: Record<string, string | number | boolean>,
  enabled: Record<string, boolean>,
): boolean {
  const depValue = String(values[dep.key] ?? '');
  const depEnabled = enabled[dep.key] ?? false;
  if (!depEnabled) return false;
  if (dep.notValues && dep.notValues.includes(depValue)) return false;
  if (dep.values && dep.values.length > 0 && !dep.values.includes(depValue)) return false;
  return true;
}

/**
 * 声明式清理规则（纯函数，可独立测试）：返回所有「依赖不满足、需要重置」的参数定义。
 * 联动清理 = 遍历该集合逐个 reset，不再在循环里内联判定逻辑。
 */
export function computeViolatedParams(
  paramDefs: ParamDef[],
  values: Record<string, string | number | boolean>,
  enabled: Record<string, boolean>,
): ParamDef[] {
  return paramDefs.filter((p) => p.dependsOn && !isDependencySatisfied(p.dependsOn, values, enabled));
}

/**
 * 预设值智能归一化：把预设 JSON 中的原始值适配到当前参数定义。
 * 旧版本保存的预设可能包含已调整范围/已移除的选项，直接写入会产生非法命令行参数：
 * - checkbox: 布尔化（手写 JSON 可能是字符串 "true"/"1"）
 * - int/float: 数值化 + 钳制到 [min, max] + 取整 / 保留 2 位小数
 * - dropdown: 校验是否在当前选项中，旧版 spec_type draft-model → draft-simple 兼容映射，非法值回退默认
 * - text/file/dir: 字符串化
 */
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
      // 旧版预设兼容：draft-model 已从选项移除，映射为 llama-server 实际支持的 draft-simple
      if (p.key === 'spec_type' && s === 'draft-model') return 'draft-simple';
      return p.default;
    }
    return s;
  }
  // text / file / dir
  return String(raw);
}

// 作为依赖源出现的参数 key 集合（dependsOn.key）。仅这些参数变化时才需要联动清理下游，
// 避免用户"先填下游值、后选依赖源"时中间态被误清。
const DEP_SOURCE_KEYS = new Set<string>(
  PARAMS.filter((p) => p.dependsOn).map((p) => p.dependsOn!.key),
);

export const useParamsStore = defineStore('params', () => {
  const values = reactive<PresetValues>({});
  const enabled = reactive<Record<string, boolean>>({});
  // GGUF 元数据缓存（应用模型时加载，参数页/元数据卡读取）
  const ggufInfo = ref<GgufModelInfo | null>(null);
  const ggufSuggestions = ref<GgufSuggestedParam[]>([]);
  const ggufLoading = ref(false);
  const ggufError = ref('');
  init();

  function init() {
    for (const p of PARAMS) {
      values[p.key] = p.default;
      // 默认未勾选：未勾选的参数不生成到命令行，使用 llama-server 内置默认值
      enabled[p.key] = false;
    }
    values[MODEL_KEY] = '';
    // 基线参数（实测推荐的内存配置）初始化即启用并下发到命令行：
    // cache_type_k/v q8_0、--load-mode none、--fit off，避免新装用户仍跑在 f16 KV + mmap + fit on 的 OOM 配置上
    applyBaseline();
  }

  /** 启用基线参数（出厂推荐状态，不计入"已修改"提示）。 */
  function applyBaseline() {
    for (const k of BASELINE_ENABLED_KEYS) {
      enabled[k] = true;
    }
  }

  function get(key: string): string | number | boolean {
    return values[key];
  }
  function set(key: string, value: string | number | boolean) {
    values[key] = value;
    // 模型路径需要与 settings.selected_model 保持同步，确保持久化语义清晰
    if (key === MODEL_KEY) {
      const settings = useSettingsStore();
      if (settings.settings) {
        settings.settings.selected_model = String(value);
        void settings.save();
      }
      return;
    }
    // 特殊 key 不参与自动勾选
    if (SPECIAL_KEYS.has(key)) return;
    // 用户修改参数值后，若值与默认值不同则自动勾选启用，确保调整生效
    const def = findParamDef(key);
    if (def && value !== def.default) {
      enabled[key] = true;
    }
    // 依赖源参数变化时联动清理下游参数（须在自动勾选 enabled 之后，保证 depEnabled 判定准确）：
    // 依赖不再满足时，残留的无意义参数（如 draft-mtp 下的 -md、mirostat=0 下的 --mirostat-lr、
    // reasoning=off 下的 --reasoning-budget、--no-cache-prompt 下的 --cache-reuse）会被 llama-server
    // 忽略或（-md）尝试加载不存在的草稿模型文件，必须清空并禁用
    if (DEP_SOURCE_KEYS.has(key)) {
      syncDependencies();
    }
    // 推测解码联动：选择投机采样类型时，自动应用该类型的推荐最大草稿数
    // （仅选 spec_type 不配草稿数无法达到最佳效率），并保持 n_min ≤ n_max
    if (key === 'spec_type') {
      const t = String(value);
      const recNMax = t !== '' && t !== 'none' ? SPEC_DRAFT_N_MAX_BY_TYPE[t] : undefined;
      if (recNMax !== undefined) {
        values['spec_draft_n_max'] = recNMax;
        enabled['spec_draft_n_max'] = true;
        const nMin = Number(values['spec_draft_n_min'] ?? 0);
        if (Number.isFinite(nMin) && nMin > recNMax) {
          values['spec_draft_n_min'] = recNMax;
        }
      }
    }
    // 手动调整最大草稿数时，保持 n_min ≤ n_max（n_min > n_max 时 llama-server 会忽略草稿）
    if (key === 'spec_draft_n_max') {
      const nMin = Number(values['spec_draft_n_min'] ?? 0);
      const nMax = Number(value);
      if (Number.isFinite(nMin) && Number.isFinite(nMax) && nMin > nMax) {
        values['spec_draft_n_min'] = nMax;
      }
    }
    // 切回外部草稿模型类型时自动重新检测草稿模型路径：
    // 用户从 draft-dflash 切到 draft-mtp/ngram（syncDependencies 清空了 spec_draft_model）后，
    // 再切回 draft-dflash/simple 等外部草稿类型时，若路径为空则自动调用 detectDraftModel 重新检测填入
    if (key === 'spec_type' && EXTERNAL_DRAFT_TYPES.has(String(value))) {
      const draftPath = String(values['spec_draft_model'] ?? '');
      if (!draftPath) {
        void detectDraftModel(String(values[MODEL_KEY] ?? ''));
      }
    }
  }

  // 联动清理：声明式规则 = computeViolatedParams 输出的「依赖不满足」参数集合，逐个重置。
  // 判定逻辑收敛到纯函数 isDependencySatisfied（可独立测试），此处不再内联。
  function syncDependencies() {
    for (const p of computeViolatedParams(PARAMS, values, enabled)) {
      resetDep(p);
    }
  }

  function resetDep(p: ParamDef) {
    if (values[p.key] === p.default && !enabled[p.key]) return;
    values[p.key] = p.default;
    enabled[p.key] = false;
  }

  function isEnabled(key: string): boolean {
    return enabled[key] ?? false;
  }
  function setEnabled(key: string, val: boolean) {
    enabled[key] = val;
  }

  function resetGroup(group: string) {
    for (const p of PARAMS) {
      if (p.group === group) {
        values[p.key] = p.default;
        enabled[p.key] = false;
      }
    }
  }
  function resetAll() {
    for (const p of PARAMS) {
      values[p.key] = p.default;
      enabled[p.key] = false;
    }
    values[MODEL_KEY] = '';
    // "重置"= 恢复出厂推荐状态：基线内存参数仍保持启用
    applyBaseline();
  }
  /**
   * 应用预设（完全覆盖语义）。返回应用后实际启用的参数数量（不含模型），供调用方反馈。
   * - 先重置全部参数为默认，预设中未包含的参数不会残留当前会话配置
   * - 值做智能归一化（类型/范围/选项校验），旧预设不会产生非法命令行参数
   */
  function applyPreset(presetValues: PresetValues): number {
    // 先重置参数配置为默认（值 + 未启用），保证"覆盖"而非"合并"
    const currentModel = String(values[MODEL_KEY] ?? '');
    resetAll();
    // 预设未携带模型路径时保留当前模型（模型由调用方单独管理，参数预设不强制切换模型）
    if (!presetValues[MODEL_KEY] && currentModel) {
      values[MODEL_KEY] = currentModel;
    }
    // 先解码 enabled 状态：缺失/损坏的 _enabled（旧格式预设）视为 null，走下方自动启用逻辑
    const enRaw = presetValues[ENABLED_KEY];
    let en: Record<string, boolean> | null = null;
    if (typeof enRaw === 'string') {
      try {
        en = JSON.parse(enRaw) as Record<string, boolean>;
      } catch { /* 忽略损坏的 enabled 数据 */ }
    }
    // 应用参数值（排除保留 key）：仅接收已知参数，并做智能归一化
    for (const k of Object.keys(presetValues)) {
      if (k === ENABLED_KEY) continue;
      if (k === MODEL_KEY) { values[k] = String(presetValues[k]); continue; }
      const def = findParamDef(k);
      if (!def) continue; // 旧版本已移除的参数直接丢弃
      values[k] = normalizePresetValue(def, presetValues[k]);
    }
    if (en) {
      // 新格式预设：启用状态以预设为准（含显式禁用），未列出的参数保持默认禁用；
      // 仅接收已知参数 key，避免旧版本残留的未知 key 累积进 enabled 映射
      for (const k of Object.keys(en)) {
        if (findParamDef(k)) enabled[k] = en[k];
      }
    } else {
      // 旧格式预设（无 _enabled）：值非默认的参数自动启用，保证旧预设实际生效
      for (const p of PARAMS) {
        if (values[p.key] !== p.default) enabled[p.key] = true;
      }
    }
    // 预设加载同样需要联动：依赖源参数与下游参数必须匹配，
    // 否则残留无意义参数（如 draft-mtp 下的 -md、mirostat=0 下的 --mirostat-lr 等）会被发射
    syncDependencies();
    // 统计应用后实际启用的参数数量
    let count = 0;
    for (const p of PARAMS) {
      if (enabled[p.key]) count++;
    }
    return count;
  }
  function snapshot(): PresetValues {
    const out: PresetValues = { ...values };
    // 将 enabled 状态编码为 JSON 字符串，随 snapshot 一起传递到命令构建器
    out[ENABLED_KEY] = JSON.stringify(enabled);
    return out;
  }

  /**
   * 检测指定分组中是否存在"调整"：
   * - 参数值与默认值不同，或
   * - 参数被勾选启用（enabled = true）
   * 用于侧边栏子页面标签的小蓝点提示，减少用户切换页面核对成本。
   */
  function groupHasChanges(group: string): boolean {
    for (const p of PARAMS) {
      if (p.group !== group) continue;
      // 基线参数为出厂推荐状态，不计入"已修改"蓝点
      if (BASELINE_ENABLED_KEYS.includes(p.key)) continue;
      if (enabled[p.key]) return true;
      if (values[p.key] !== p.default) return true;
    }
    return false;
  }

  /**
   * 计算属性：每个分组是否存在调整。
   * key 为 group 名，value 为 boolean。
   */
  const changedGroups = computed<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const p of PARAMS) {
      // 基线参数不计入"已修改"蓝点
      if (BASELINE_ENABLED_KEYS.includes(p.key)) continue;
      if (out[p.group] === undefined) out[p.group] = false;
      if (enabled[p.key] || values[p.key] !== p.default) {
        out[p.group] = true;
      }
    }
    return out;
  });

  /**
   * 设置 GGUF 元数据（应用模型时由本 store 统一加载并同步）
   */
  function setGgufInfo(info: GgufModelInfo | null, suggestions: GgufSuggestedParam[]) {
    ggufInfo.value = info;
    ggufSuggestions.value = suggestions;
  }

  /**
   * 自动检测模型同目录下的多模态投影器文件（mmproj）。
   * 完全自动：检测到则填入路径并启用；未检测到则清空路径，避免残留上一个模型的投影器。
   * 不改变其他参数值，也不要求用户确认或点击"应用推荐参数"。
   */
  async function detectMmproj(modelPathValue: string): Promise<void> {
    const server = useServerStore();
    const i18n = useI18nStore();
    if (!modelPathValue) {
      values['mmproj'] = '';
      enabled['mmproj'] = false;
      return;
    }
    try {
      const mmprojPath = await window.api.models.detectMmproj(modelPathValue);
      if (mmprojPath) {
        values['mmproj'] = mmprojPath;
        enabled['mmproj'] = true;
        server.pushOutput({
          kind: 'info',
          data: `[mmproj] ${i18n.t('msg_mmproj_detected').replace('{0}', mmprojPath)}\n`,
          ts: Date.now(),
        });
    } else {
      // 未检测到：清空路径并禁用，避免残留上一个模型的投影器
      values['mmproj'] = '';
      enabled['mmproj'] = false;
      server.pushOutput({
        kind: 'info',
        data: `[mmproj] ${i18n.t('msg_mmproj_not_detected')}\n`,
        ts: Date.now(),
      });
    }
    } catch {
      // 检测失败时清空路径，不影响主流程
      values['mmproj'] = '';
    }
  }

  /**
   * 在模型同目录自动检测草稿模型（dflash/draft 命名）。
   * 检测到 dflash 文件（如 dflash-kquant.gguf）时自动启用 DFlash 完整组合：
   *   spec_type=draft-dflash + -fa on（Flash Attention 为 DFlash 前置要求）+ --spec-draft-n-max 15
   *   （Muse-Glimmer DFlash 每 block 预测 16 位置，1 个条件位 + 15 个草稿 token）。
   * 检测到普通 draft 文件时仅设 spec_type=draft-simple（常规外部草稿模型推测解码）。
   * 若用户已选择不需要外部草稿模型的类型（draft-mtp / ngram-*），则跳过填充，
   * 避免残留的 -md 与 --spec-type 不匹配。
   * 未检测到时清空路径并禁用，避免残留上一个模型的草稿模型。
   */
  async function detectDraftModel(modelPathValue: string): Promise<void> {
    if (!modelPathValue) {
      values['spec_draft_model'] = '';
      enabled['spec_draft_model'] = false;
      return;
    }
    try {
      const draftPath = await window.api.models.detectDraft(modelPathValue);
      if (draftPath) {
        const server = useServerStore();
        const i18n = useI18nStore();
        const st = String(values.spec_type ?? '');
        // 用户已选择不需要外部草稿模型的类型：不自动填充，保持联动一致性
        if (st !== '' && st !== 'none' && !EXTERNAL_DRAFT_TYPES.has(st)) {
          values['spec_draft_model'] = '';
          enabled['spec_draft_model'] = false;
          return;
        }
        const isDflash = draftPath.toLowerCase().includes('dflash');
        values['spec_draft_model'] = draftPath;
        enabled['spec_draft_model'] = true;
        // 用户尚未选过推测解码类型（空 / none）时自动设置，保证 -md 与 --spec-type 配套
        if (st === '' || st === 'none') {
          if (isDflash) {
            // DFlash 专用实现：需要 Flash Attention 开启，且 n_max=15 才达到加速效果
            values['spec_type'] = 'draft-dflash';
            enabled['spec_type'] = true;
            values['flash_attn'] = 'on';
            enabled['flash_attn'] = true;
            values['spec_draft_n_max'] = 15;
            enabled['spec_draft_n_max'] = true;
            server.pushOutput({
              kind: 'success',
              data: `[spec] ${i18n.t('msg_dflash_detected').replace('{0}', draftPath)}\n`,
              ts: Date.now(),
            });
          } else {
            values['spec_type'] = 'draft-simple';
            enabled['spec_type'] = true;
            server.pushOutput({
              kind: 'success',
              data: `[spec] ${i18n.t('msg_draft_detected').replace('{0}', draftPath)}\n`,
              ts: Date.now(),
            });
          }
        }
      } else {
        // 未检测到：清空路径并禁用，避免残留上一个模型的草稿模型
        values['spec_draft_model'] = '';
        enabled['spec_draft_model'] = false;
      }
    } catch {
      // 检测失败时清空路径，不影响主流程
      values['spec_draft_model'] = '';
      enabled['spec_draft_model'] = false;
    }
  }

  /**
   * 读取模型 GGUF 元数据与建议参数，写入本 store（供元数据卡/参数页参考）。
   */
  async function loadGguf(modelPathValue: string): Promise<void> {
    if (!modelPathValue) {
      ggufInfo.value = null;
      ggufSuggestions.value = [];
      ggufError.value = '';
      return;
    }
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

  /**
   * 应用模型（切换模型的唯一入口，TopBar 下拉与模型管理页共用）：
   * - 切换模型时不重置其他参数值（保留用户手工调整）
   * - 模型变化时清空控制台（旧日志属于上一个模型）
   * - 自动检测 mmproj + 自动加载 GGUF 元数据/建议
   */
  async function applyModel(path: string): Promise<void> {
    const server = useServerStore();
    const prev = String(values[MODEL_KEY] ?? '');
    if (path && path !== prev) {
      server.clearOutputs();
    }
    set(MODEL_KEY, path);
    // 并行：mmproj 自动检测 + 草稿模型自动检测 + GGUF 元数据加载
    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);
  }

  /**
   * 应用模型推荐参数（用户点击"应用推荐参数"时调用）：
   * 先重置所有参数为默认值，再恢复模型并重新检测 mmproj/加载建议，最后批量应用建议。
   */
  async function applyModelWithSuggestions(path: string): Promise<void> {
    const server = useServerStore();
    const i18n = useI18nStore();
    // 先重置当前所有参数选择，避免切换模型后残留的参数选项影响
    resetAll();
    // 恢复当前选中的模型路径
    set(MODEL_KEY, path);
    // 重新检测 mmproj + 草稿模型 + 加载建议（resetAll 后需重新获取）
    await Promise.all([detectMmproj(path), detectDraftModel(path), loadGguf(path)]);
    let count = 0;
    for (const s of ggufSuggestions.value) {
      set(s.key, s.value);
      setEnabled(s.key, true);
      count++;
    }
    if (count > 0) {
      server.pushOutput({
        kind: 'success',
        data: i18n.t('msg_gguf_applied').replace('{0}', String(count)) + '\n',
        ts: Date.now(),
      });
    }
  }

  return { values, enabled, ggufInfo, ggufSuggestions, ggufLoading, ggufError, get, set, isEnabled, setEnabled, resetGroup, resetAll, applyPreset, snapshot, init, groupHasChanges, changedGroups, setGgufInfo, detectMmproj, detectDraftModel, loadGguf, applyModel, applyModelWithSuggestions };
});
