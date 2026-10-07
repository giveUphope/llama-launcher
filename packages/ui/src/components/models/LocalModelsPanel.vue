<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import type { ModelInfo, ModelFitResult, LlamaBenchJobState } from '@llama-launcher/shared';
import { MODEL_KEY } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import PageFrame from '@/components/common/PageFrame.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import ModelMetaCard from '@/components/common/ModelMetaCard.vue';
import Icon from '@/components/common/Icon.vue';
import { useSettingsStore } from '@/stores/settings';
import { useParamsStore } from '@/stores/params';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { useModelPreset } from '@/composables/useModelPreset';

const settings = useSettingsStore();
const params = useParamsStore();
const server = useServerStore();
const i18n = useI18nStore();
// 智能预设：模型切换时自动发现该模型已保存的预设并询问应用
const { applyModelPresetIfAny } = useModelPreset();

// 扫描结果用浅响应式：模型对象整体替换（无原地变更），避免数百个 ModelInfo
// 逐个深响应式包装的开销（大模型库扫描后过滤/渲染更快）。
const models = shallowRef<ModelInfo[]>([]);
const scanning = ref(false);
const searchQuery = ref('');

// 模型文件所在目录（打开目录 / 按子目录移除使用）
function modelDir(m: ModelInfo): string {
  const idx = Math.max(m.path.lastIndexOf('/'), m.path.lastIndexOf('\\'));
  return idx >= 0 ? m.path.slice(0, idx) : m.path;
}

// 在系统文件管理器中打开模型文件所在目录
async function onOpenModelDir(m: ModelInfo) {
  const dir = modelDir(m);
  if (!dir) return;
  try {
    await window.api.openPath(dir);
  } catch {
    // 忽略打开失败
  }
}

// 按模型文件移除：删除前主进程会判断模型目录内容——
// 目录下存在其他量化版本/用户文件 → 仅删除选中文件；
// 目录无其他内容 → 连同 mmproj/mtp/dflash 伴随文件与空目录一并删除
async function onRemoveModel(m: ModelInfo) {
  const confirmed = await confirm({
    title: i18n.t('btn_remove_model'),
    message: i18n.t('msg_remove_model_confirm', [m.name]),
    variant: 'danger',
  });
  if (!confirmed) return;
  try {
    const res = await window.api.models.remove(m.path);
    if (res && res.ok) {
      void onRefresh();
    } else {
      server.pushOutput({
        kind: 'error',
        data: i18n.t('msg_remove_model_failed', [res?.error ?? 'unknown']) + '\n',
        ts: Date.now(),
      });
    }
  } catch (e: any) {
    server.pushOutput({
      kind: 'error',
      data: i18n.t('msg_remove_model_failed', [e?.message ?? String(e)]) + '\n',
      ts: Date.now(),
    });
  }
}

// 按搜索词过滤模型列表（大小写不敏感，匹配文件名）
const filteredModels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return models.value;
  return models.value.filter((m) => m.name.toLowerCase().includes(q));
});

// 表格列定义：columns prop 模式（a-table-column 子组件模式在当前版本组合下渲染为空）
const tableColumns = computed(() => [
  { title: i18n.t('col_name'), slotName: 'name' },
  { title: i18n.t('col_size'), dataIndex: 'size_str', width: 90 },
  // 操作列 260px：3 个文本内联小按钮（71px×3 + gap 6×2 = 225）+ 单元格左右 padding 16×2，
  // 190px 时溢出向左压入「大小」列造成重叠
  { title: i18n.t('col_actions'), slotName: 'actions', width: 260 },
]);

// 当前选中模型行高亮（rowClass：arco Table 合法 prop，替代串成 DOM 属性的 row-class-name）
function rowClass(record: any): string {
  return record.path === modelPath.value ? 'row-selected' : '';
}

// a-statistic 的 :value 仅支持 number|Date（字符串会被其内部 dayjs 分支格式化成
// Invalid Date），故拆为数值 + 单位后缀（#suffix 仅在 value 有定义时渲染）
const totalSize = computed(() => {
  const bytes = models.value.reduce((sum, m) => sum + m.size, 0);
  if (bytes === 0) return { num: 0, unit: ' B' };
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return {
    num: Number((bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)),
    unit: ' ' + units[i],
  };
});

// GGUF 元数据/建议/加载状态统一由 params store 管理（applyModel 加载），
// 模板直接读 params.ggufInfo / params.ggufSuggestions / params.ggufLoading / params.ggufError

// 模型目录（只读；由「应用设置」页统一编辑，本页监听变化自动重扫）
const modelsDir = computed(() => settings.settings?.models_dir ?? '');

const modelPath = computed<string>({
  get: () => String(params.values[MODEL_KEY] ?? ''),
  set: (v) => params.set(MODEL_KEY, v),
});

// 模型目录变化时自动刷新扫描（用户修改路径后触发）
// 同时重启文件系统监听
watch(modelsDir, (nv, ov) => {
  if (nv && nv !== ov) {
    void onRefresh();
    try { void window.api.models.watch(nv); } catch { /* 浏览器预览容错 */ }
  }
});

// 格式化建议参数显示值
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

// 应用模型推荐参数：弹出确认对话框预览将要应用的参数，用户确认后
// 统一走 params.applyModelWithSuggestions（重置所有参数为默认 → 恢复模型 → 重新检测 mmproj → 批量应用建议）
async function applySuggestions() {
  if (params.ggufSuggestions.length === 0) return;

  // 构造预览文案
  const previewLines = params.ggufSuggestions
    .map((s) => `  ${s.key} = ${formatValue(s.value)}`)
    .join('\n');
  const message = `${i18n.t('msg_apply_suggestions_preview', [String(params.ggufSuggestions.length)])}\n\n${previewLines}\n\n${i18n.t('msg_apply_suggestions_confirm')}`;

  const confirmed = await confirm({
    title: i18n.t('gguf_apply_suggestions'),
    message,
    variant: 'info',
  });
  if (!confirmed) return;

  const currentModelPath = modelPath.value;
  await params.applyModelWithSuggestions(currentModelPath);
}

// 组件挂载时主动扫描已持久化的模型目录
// 首次打开时 models_dir 为空则跳过，设置后每次进入自动刷新
// 同时订阅文件系统变更，运行期间新增/删除 .gguf 文件时自动刷新
let unsubModelsChanged: (() => void) | null = null;
onMounted(() => {
  if (modelsDir.value) {
    // 懒加载：仅列表为空时才初始扫描（models_dir 变化由上方 watch 自动重扫，
    // 运行期变更由下方文件监听维护）——避免每次进入页面重复全量扫描
    if (!models.value.length) void onRefresh();
    // 启动文件系统监听
    try { void window.api.models.watch(modelsDir.value); } catch { /* 浏览器预览容错 */ }
  }
  // 已有选中模型时补齐 mmproj 自动检测 + GGUF 元数据加载
  // （启动时由 App.vue 恢复会话/模型路径，此处走 reattachModelRuntime 仅补运行时检测：
  //   不弹确认、不重建基线、不覆盖会话中的自定义别名）
  if (modelPath.value) {
    void params.reattachModelRuntime(modelPath.value);
  }
  // 选中态由模板直接比较 m.path === modelPath（O(1)/行），扫描完成后自动同步，无需手动恢复
});

// keep-alive 下本页失活后组件并不卸载，onUnmounted 永不触发：文件变更订阅与体检轮询必须
// 配对 activate/deactivate，否则离开模型页后仍会在每次 .gguf 变更时整树重扫、每 2.5s 轮询作业状态
function subscribeModelsChanged() {
  if (unsubModelsChanged) return;
  try {
    unsubModelsChanged = window.api.models.onChanged(() => {
      void onRefresh();
    });
  } catch {
    // 浏览器预览环境(无 Electron preload)下 window.api.models 未定义,忽略事件订阅
  }
}
function unsubscribeModelsChanged() {
  if (unsubModelsChanged) { unsubModelsChanged(); unsubModelsChanged = null; }
}

onActivated(() => {
  subscribeModelsChanged();
  subscribeBench();
  // 失活期间的迁移不会补发，回来时对在跑的作业补一次状态
  void resyncBench();
});

onDeactivated(() => {
  unsubscribeModelsChanged();
  unsubscribeBench();
});

onUnmounted(() => {
  unsubscribeModelsChanged();
  unsubscribeBench();
});

async function onRefresh() {
  const dir = modelsDir.value;
  if (!dir) return;
  scanning.value = true;
  try {
    // 目录不存在时主进程返回 {ok:false, code:'DIR_NOT_FOUND'}（已降噪，不再抛错刷屏）
    const result = (await window.api.models.scan(dir)) as ModelInfo[] | { ok: false; code: string; dir?: string };
    if (!Array.isArray(result) && result.code === 'DIR_NOT_FOUND') {
      // 用自定义弹窗询问是否创建（替代原生消息框）
      const ok = await confirm({
        title: i18n.t('msg_ask_create_title'),
        message: i18n.t('msg_ask_create_dir', [dir]),
        confirmKey: 'dlg_confirm',
        cancelKey: 'dlg_cancel',
        variant: 'warning',
      });
      if (ok) {
        try {
          const created = await window.api.models.scan(dir, { createIfMissing: true });
          models.value = Array.isArray(created) ? created : [];
        } catch (e2: any) {
          server.pushOutput({
            kind: 'error',
            data: `[Models] ${i18n.t('msg_dir_create_failed', [e2?.message ?? String(e2)])}\n`,
            ts: Date.now(),
          });
        }
      } else {
        models.value = [];
      }
      return;
    }
    // 防御性检查：浏览器预览/mock 环境下 scan 可能返回 null
    models.value = Array.isArray(result) ? result : [];
    // 选中态为模板级路径比较，扫描替换 models 后自动同步，无需手动重置
  } catch (e: any) {
    console.error('scan models failed:', e);
  } finally {
    scanning.value = false;
  }
}

// 点击列表行直接应用模型（统一走 params.applyModel：
// 保留参数值 + 自动检测 mmproj + 加载 GGUF 元数据，控制台切换时自动清理）
function handleSelect(m: ModelInfo) {
  void (async () => {
    // 有未固化的临时调整时先确认丢弃（用户取消则中止后续预设应用）
    const ok = await params.applyModel(m.path);
    if (!ok) return;
    // 智能预设：该模型存在已保存预设时静默应用（建立预设基线）
    await applyModelPresetIfAny(m.path);
  })();
}

// ---- 显存适配徽章：批量估算每个模型文件的显存适配判定（fit/partial/no）+ 上下文上限 ----
// fitMap 只存主进程返回的事实；徽章文本/配色/悬浮文案由下方 rowMeta 在数据落地时算一次。
const fitMap = ref<Record<string, ModelFitResult>>({});

watch(() => models.value.map((m) => m.path).join('|'), (joined) => {
  if (!joined) return;
  const paths = joined.split('|');
  void refreshFit(paths);
  void hydrateBenchRecords(paths);
});

async function refreshFit(paths: string[]) {
  try {
    const res = await window.api.system.estimateModelFit(paths);
    if (res && typeof res === 'object') {
      fitMap.value = res;
      writeRowMeta();
    }
  } catch {
    // 浏览器预览/主进程异常：无 fit 徽章（静默降级）
  }
}

// ---- llama-bench 离线体检：单模型单作业，run 启动 + 主进程推送状态，结果徽章展示 ----
const benchJobs = ref<Record<string, LlamaBenchJobState>>({});
/** 仍在跑的作业：页签失活期间收不到推送，回来时按这张表补一次状态 */
const benchInFlight = new Set<string>();
let unsubBench: (() => void) | null = null;

/**
 * 就地写单个 key（不整体替换）：整体替换会让每一行的 rowMeta 依赖全部失效、表格被整表重渲染。
 * 徽章条目 rowMeta 同样按路径就地写（见 writeRowMetaFor），一次推送只改写那一行。
 */
function applyBenchState(st: LlamaBenchJobState | null) {
  if (!st) return;
  benchJobs.value[st.modelPath] = st;
  if (st.state !== 'running') benchInFlight.delete(st.modelPath);
  writeRowMetaFor(st.modelPath);
}

function subscribeBench() {
  if (unsubBench) return;
  try {
    unsubBench = window.api.system.onBenchStatus(applyBenchState);
  } catch {
    // 浏览器预览环境无 preload：没有推送，也没有真作业在跑
  }
}
function unsubscribeBench() {
  if (unsubBench) { unsubBench(); unsubBench = null; }
}

/** 失活期间的状态迁移不会补发，回来时对在跑的作业补一次；之后完全靠推送驱动 */
async function resyncBench() {
  // 先取快照再遍历：applyBenchState 会在回调里从 benchInFlight 删除元素，
  // 边遍历边删会漏掉后续项（oxlint 的 no-useless-spread 只看形状，这里不是多余转换）
  for (const p of Array.from(benchInFlight)) {
    try {
      applyBenchState(await window.api.system.benchLlamaStatus(p));
    } catch {
      benchInFlight.delete(p);
    }
  }
}

/**
 * 取回「以前测过」的体检记录：结果留在主进程（应用重启后由 bench-records.json 回灌），
 * 界面按模型路径问一次即可，与显存徽章同一时机、同一批路径。
 * 问过记在案，所以文件监听反复触发扫描也只问一轮；本地已有状态的路径不查询——
 * 那可能是正在跑的作业，异步晚到的旧记录不该把它盖掉。
 * 单批上限与主进程 fit 批量的 100 对齐：库里模型很多时也不会在一次扫描后发太多请求。
 */
const benchHydrated = new Set<string>();
const BENCH_HYDRATE_MAX = 100;

async function hydrateBenchRecords(paths: string[]) {
  const todo = paths.filter((p) => !benchHydrated.has(p) && !benchJobs.value[p]).slice(0, BENCH_HYDRATE_MAX);
  if (!todo.length) return;
  todo.forEach((p) => benchHydrated.add(p));
  for (const p of todo) {
    try {
      applyBenchState(await window.api.system.benchLlamaStatus(p));
    } catch {
      // 浏览器预览环境（无 preload）或主进程异常：这条没问到，摘掉标记下次扫描再试
      benchHydrated.delete(p);
    }
  }
}

async function onBench(m: ModelInfo) {
  const ok = await confirm({
    title: i18n.t('bench_llama_title'),
    message: i18n.t('bench_llama_confirm'),
    variant: 'info',
  });
  if (!ok) return;
  try {
    const res = await window.api.system.benchLlamaRun(m.path);
    if (res.ok) {
      // 走 applyBenchState 就地写单个路径（原先整体替换 benchJobs 会让整表重渲染）
      applyBenchState(res.data);
      if (res.data.state === 'running') benchInFlight.add(m.path);
    } else {
      server.pushOutput({ kind: 'error', data: `[Bench] ${res.error}\n`, ts: Date.now() });
    }
  } catch (e: any) {
    server.pushOutput({ kind: 'error', data: `[Bench] ${e?.message ?? String(e)}\n`, ts: Date.now() });
  }
}

// ---- 行内徽章：派生值随条目携带（docs/zh/frontend.md §7.1 铁律②）----
/**
 * 徽章文本 / a-tag 配色 / 悬浮文案原先由模板在 v-for 里逐行调用 fitOf·fitColor·fitTitle·
 * fitBadge·benchBadge·benchTitle 现算——mock 页 6 行表实测每次整表重渲染跑 32 次派生
 * （fitOf 24 + benchBadge 7 + benchTitle 1），按同行开销外推 64 行的库约 340 次/渲染（未实测）。
 * 现改为在任何渲染路径之外算一次，按模型路径存进 rowMeta，模板只做一次 O(1) 取值。
 * 写入时机即数据落地时机：扫描完成 / fit 批量返回 / 体检记录回灌 / 体检状态推送 / 语言切换。
 * 单行状态迁移沿用 applyBenchState 的「就地写单个 key」，不改写其余行的条目。
 */
interface RowBadge {
  key: string;
  text: string;
  color: string;
  /** undefined = 不渲染 title 属性（伴随文件标签本就无悬浮文案） */
  title?: string;
}
interface RowMeta {
  badges: RowBadge[];
  /** 体检进行中 → 行内「体检」按钮禁用（原先模板直读 benchJobs，同样是逐行取值） */
  benchRunning: boolean;
}

const rowMeta = ref<Record<string, RowMeta>>({});

/** path → ModelInfo 索引：仅在数据落地时随 writeRowMeta 重建，供单行回写取回标签 */
let modelIndex = new Map<string, ModelInfo>();

// 伴随文件标签（mmproj / dflash / draft）→ a-tag 配色
function badgesForTags(m: ModelInfo): RowBadge[] {
  return (m.tags ?? []).map((t) => ({
    key: `tag:${t}`,
    text: t,
    color: t === 'mmproj' ? 'arcoblue' : t === 'dflash' ? 'green' : 'orange',
  }));
}

function badgesForFit(f: ModelFitResult | undefined): RowBadge[] {
  const v = f?.verdict;
  if (!f || !v) return [];
  if (v === 'no') return [{ key: 'fit', text: `✗ ${i18n.t('fit_no')}`, color: 'red', title: i18n.t('msg_fit_no_tip') }];
  if (v === 'partial') {
    return [{
      key: 'fit',
      text: `△ ${i18n.t('fit_partial')}`,
      color: 'orange',
      title: i18n.t('msg_fit_partial_tip', [f.maxContext ? f.maxContext.toLocaleString() : '—']),
    }];
  }
  return [{
    key: 'fit',
    text: `✓ ${i18n.t('fit_full')}`,
    color: 'green',
    title: f.maxContext !== null ? i18n.t('msg_fit_full_tip', [f.maxContext.toLocaleString(), f.dtype]) : '',
  }];
}

function benchTitleOf(job: LlamaBenchJobState): string {
  if (job.state === 'error') return job.error ?? '';
  const s = job.summary;
  if (!s) return '';
  return `${s.modelType ?? ''} · ${s.backend ?? ''} · ${new Date(s.testedAt).toLocaleString()}`;
}

function badgesForBench(job: LlamaBenchJobState | undefined): RowBadge[] {
  if (!job) return [];
  if (job.state === 'running') {
    return [{ key: 'bench', text: i18n.t('bench_llama_running'), color: 'gray', title: benchTitleOf(job) }];
  }
  if (job.state === 'error') {
    return [{ key: 'bench', text: i18n.t('bench_llama_failed'), color: 'gray', title: benchTitleOf(job) }];
  }
  const s = job.summary;
  if (!s) return [];
  const pp = s.ppTokS !== null ? Math.round(s.ppTokS).toLocaleString() : '—';
  const tg = s.tgTokS !== null ? Math.round(s.tgTokS).toLocaleString() : '—';
  return [{ key: 'bench', text: `pp ${pp} · tg ${tg}`, color: 'gray', title: benchTitleOf(job) }];
}

function buildRowMeta(m: ModelInfo): RowMeta {
  const job = benchJobs.value[m.path];
  return {
    badges: [...badgesForTags(m), ...badgesForFit(fitMap.value[m.path]), ...badgesForBench(job)],
    benchRunning: job?.state === 'running',
  };
}

/** 整体重算并剪掉已不在库里的路径（扫描 / fit 批量 / 语言切换三个数据变更点） */
function writeRowMeta() {
  const ms = models.value;
  modelIndex = new Map(ms.map((m) => [m.path, m]));
  for (const p of Object.keys(rowMeta.value)) {
    if (!modelIndex.has(p)) delete rowMeta.value[p];
  }
  for (const m of ms) rowMeta.value[m.path] = buildRowMeta(m);
}

/** 就地写单个路径的条目：一次体检推送只让那一行的徽章换文本 */
function writeRowMetaFor(path: string) {
  const m = modelIndex.get(path);
  if (m) rowMeta.value[path] = buildRowMeta(m);
}

// 徽章文本取自 i18n.t()：预计算后语言切换不会走任何数据变更，必须显式整体重算，
// 否则界面停在旧语言的徽章文案（改前是模板内联调用，切语言当场自动重算，不存在这个口子）
watch(() => i18n.lang, () => writeRowMeta());

// 每次扫描落地（models 整体替换）都重算一遍：上方那条 watch 只盯「路径集合变化」，而
// 伴随文件标签（mmproj / dflash）会在路径集合不变时新增——改前模板直读 record.tags 当场就出，
// 预计算后若不在这里跟进，那枚标签要等到下一次体检推送才显示。
watch(models, () => writeRowMeta());
</script>

<template>
  <PageFrame>
    <div class="content">
      <!-- 统计横条：a-statistic 承载数值+标题，a-divider 分隔（原生统计组件） -->
      <div class="stats-row">
        <div class="stat">
          <Icon name="models" :size="14" />
          <a-statistic :value="models.length" :title="i18n.t('lbl_model_count')" />
        </div>
        <a-divider class="stat-divider" direction="vertical" />
        <div class="stat">
          <Icon name="disk" :size="14" />
          <a-statistic :title="i18n.t('lbl_total_size')" :value="totalSize.num">
            <template #suffix>{{ totalSize.unit }}</template>
          </a-statistic>
        </div>
        <!-- 已选统计与刷新按钮已移除：选中态见当前模型胶囊；列表由文件监听自动维护 -->
      </div>

      <!-- 引擎目录 / 模型目录 / 镜像源等应用设置已统一移至「应用设置」页（/settings） -->
      <Card title-key="card_models">
        <div class="search-row">
          <a-input v-model="searchQuery" :placeholder="i18n.t('lbl_search_models')" allow-clear>
            <template #prefix><Icon name="search" :size="13" /></template>
          </a-input>
          <!-- 计数走常驻定宽槽：无搜索词时留同宽空白，输入框宽度不再随搜索当场变化 -->
          <span class="search-count">
            <template v-if="searchQuery">{{ filteredModels.length }} / {{ models.length }}</template>
          </span>
        </div>
        <!-- 表格列用 columns prop（a-table-column 子组件模式在当前版本组合下渲染为空）；
             行选中态走 :row-class（row-class-name 非合法 prop，会串成 DOM 属性） -->
        <a-table
          class="models-table"
          :columns="tableColumns"
          :data="filteredModels"
          row-key="path"
          :pagination="false"
          :loading="scanning"
          :scroll="{ y: 320 }"
          :bordered="false"
          :row-class="rowClass"
          @row-click="(record: any) => handleSelect(record as ModelInfo)"
        >
          <template #name="{ record }">
            <div class="model-name-cell">
              <!-- 选中星标槽恒在且定宽：出现时不再把名称起点右移、不改名称截断点 -->
              <span class="selected-slot">
                <Icon v-if="record.path === modelPath" name="star" :size="12" class="selected-icon" />
              </span>
              <ToolTip :text="record.path"><div class="model-name-row">{{ record.name }}</div></ToolTip>
            </div>
            <!-- 伴随文件标签 + 显存适配 + 体检结果合并同一行：徽章排容器恒渲染（内部各徽章由
                 派生条目决定有无），min-height 预留一行，fit 批量结果 / 体检记录回灌时行高不再
                 从 1 行变 2 行。徽章文本不在此现算——见脚本末 rowMeta（§7.1 铁律②） -->
            <div class="model-tags">
              <ToolTip v-for="b in rowMeta[record.path]?.badges" :key="b.key" :text="b.title ?? ''" :disabled="!b.title">
                <a-tag size="small" :color="b.color" :class="`badge-${b.color}`">{{ b.text }}</a-tag>
              </ToolTip>
            </div>
          </template>
          <template #actions="{ record }">
            <!-- 行操作：文本内联小按钮（§7.5.5 禁止纯图标操作按钮，预设面板同款范式） -->
            <div class="row-actions">
              <ToolTip :text="i18n.t('btn_open_dir')">
                <a-button size="small" class="row-action" @click.stop="onOpenModelDir(record)">
                  <template #icon><Icon name="folder" :size="11" /></template>
                  {{ i18n.t('act_dir') }}
                </a-button>
              </ToolTip>
              <ToolTip :text="i18n.t('bench_llama_title')">
                <a-button size="small" class="row-action"
                          :disabled="rowMeta[record.path]?.benchRunning" @click.stop="onBench(record)">
                  <template #icon><Icon name="bench" :size="11" /></template>
                  {{ i18n.t('act_bench') }}
                </a-button>
              </ToolTip>
              <ToolTip :text="i18n.t('btn_remove_model')">
                <a-button size="small" class="row-action row-danger" status="danger" @click.stop="onRemoveModel(record)">
                  <template #icon><Icon name="trash" :size="11" /></template>
                  {{ i18n.t('btn_remove_model') }}
                </a-button>
              </ToolTip>
            </div>
          </template>
        </a-table>
      </Card>

      <!-- 模型信息常驻卡：未选模型 / GGUF 读取中 / 读取失败 / 建议参数四态在同一张卡体内切换，
           卡体 min-height 预留一档，不再整块互换或凭空出现顶动下方内容。
           应用建议按钮按 §7.5.4 归入 Card 的 #actions（卡片头高度恒定，按钮显隐不改卡体高度）。 -->
      <Card title-key="card_model_info">
        <template #actions>
          <a-button
            v-if="modelPath && !params.ggufLoading && !params.ggufError && params.ggufSuggestions.length"
            size="small"
            type="primary"
            @click="applySuggestions"
          >
            {{ i18n.t('gguf_apply_suggestions') }} ({{ params.ggufSuggestions.length }})
          </a-button>
        </template>
        <div class="model-info-slot">
          <div v-if="!modelPath" class="model-info-state">{{ i18n.t('msg_no_model') }}</div>
          <div v-else-if="params.ggufLoading" class="model-info-state">{{ i18n.t('msg_gguf_reading') }}</div>
          <div v-else-if="params.ggufError" class="model-info-state error">
            {{ i18n.t('msg_gguf_read_failed', [params.ggufError]) }}
          </div>
          <div v-else-if="params.ggufSuggestions.length" class="suggestions-compact">
            <!-- 建议参数 chips：a-tag 原生承载（同 meta-chip/summary-chip 范式），
                 自定义 span 胶囊（padding/bg/radius）已移除 -->
            <a-tag v-for="(s, idx) in params.ggufSuggestions" :key="idx" size="small" class="suggestion-chip">
              <span class="chip-key">{{ s.key }}</span>
              <span class="chip-eq">=</span>
              <span class="chip-val">{{ formatValue(s.value) }}</span>
            </a-tag>
          </div>
        </div>
      </Card>

      <!-- 精简的模型信息摘要：常驻卡之后的追加块，出现时只延长页面底部，不再顶动上方卡片。
           它自身的整卡 v-if（骨架常驻）属 ModelMetaCard 那一行，本轮不改该文件 -->
      <ModelMetaCard v-if="modelPath" />
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
.content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 统计横条：a-statistic 仅做字号/字体语义覆盖（标题次级灰、数值 mono 加粗） */
.stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: var(--color-fill-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  // 与 status-bar / params-status-bar 的容器间距一致（8px）
  margin-bottom: 8px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-2);

  // 单行统计条：a-statistic 的 title 块默认在 value 上方竖排（行高 ~54px），
  // 改为 title 与 value 同行横排，图标 + 标题 + 数值压到单行（divider 24px 对齐）
  :deep(.arco-statistic-title),
  :deep(.arco-statistic-content) {
    display: inline-block;
  }

  :deep(.arco-statistic-title) {
    font-size: var(--fs-xs);
    line-height: 1.3;
    margin: 0 6px 0 0; // title 与 value 间距 6px（图标-文本间距统一刻度）
  }

  :deep(.arco-statistic-value) {
    font-size: var(--fs-lg);
    font-weight: 700;
    font-family: var(--font-mono);
    line-height: 1.3;
  }
}

.stat-divider.arco-divider-vertical {
  height: 24px;
  margin: 0;
}

/* 统计条与搜索行 */
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

// 常驻定宽槽：宽度按双语最宽计数态（「999 / 999」mono）预留，空态留同宽空白
.search-count {
  font-size: var(--fs-sm);
  color: var(--fg-hint);
  font-family: var(--font-mono);
  flex: 0 0 76px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
}

.models-table {
  margin-top: 8px;
  :deep(.arco-table-tr) { cursor: pointer; }

  // 选中行底色走业务语义 token（浅色 = primary-1；深色 = primary-6 半透明蓝染，
  // 深色不用近黑藏青色块），与 DownloadCard/FileBrowserModal 选中态同源。
  // 第二条按 Arco 行 hover 规则同构选择器叠加 .row-selected 反超
  // （arco-table-hover 与本容器是同一元素，不能作为后代前缀复刻），hover 不丢选中态
  :deep(.arco-table-tr.row-selected > td) { background: var(--row-selected-bg); }
  :deep(.arco-table-tr.row-selected:not(.arco-table-tr-empty):not(.arco-table-tr-summary):hover .arco-table-td:not(.arco-table-col-fixed-left):not(.arco-table-col-fixed-right)) { background: var(--row-selected-bg); }

  :deep(.arco-table-th) { color: var(--color-text-2); font-weight: 600; }
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* 模型名 + 伴随文件标签 */
.model-name-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0; /* 允许 flex 子项收缩，让下方 ellipsis 生效 */
}

// 星标槽恒在且定宽（与 Icon :size=12 同档）：选中态切换不改该行起点
.selected-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 12px;
  min-height: 12px;
}

.selected-icon {
  color: var(--fg-accent);
  flex-shrink: 0;
}

.model-name-row {
  font-weight: 600;
  /* 长模型名单行截断：悬停 ToolTip 已含完整路径，不需要换行堆叠 */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.model-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  margin-top: 4px;
  // 单行预留：a-tag size=small 实测 h20，徽章排容器常驻后行高与徽章数量无关
  min-height: 20px;
  // 标签恒单行：超出时整行省略（名称列已有 min-width 保底）
  overflow: hidden;

  /* 徽章配色：纯官方预设对（#105 范式纯化裁定——此前的角色色文字修正层删除，
     「跟随库官方观感」豁免延伸至 tag 预设配对；预设对浅色 2.63~4.2 的对比度
     差距如实记录于该条） */
}

/* 常驻卡体：min-height 预留一档（单行状态文案 + 上下内距），四态切换不改卡体高度 */
.model-info-slot {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 46px;
}

/* 卡体内状态提示（未选模型 / 读取中 / 读取失败） */
.model-info-state {
  padding: 12px;
  font-size: var(--fs-md);
  color: var(--fg-hint);
  text-align: center;

  &.error {
    color: var(--fg-danger-text);
  }
}

/* 建议参数（精简芯片布局） */

.suggestions-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* gap 写在 a-tag 根元素上：Arco 无 .arco-tag-content 包装层（插槽子节点直接挂在
   .arco-tag 下），:deep(.arco-tag-content) 是死规则，见 STYLE_TODO #69 */
.suggestion-chip {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  align-items: center;
  gap: 5px;
}

.chip-key {
  color: var(--fg-accent);
  font-weight: 600;
}

// 装饰符号：信息由 key/val 两段承载，等号本身不携带内容，保留 text-3 不并入 --fg-hint
.chip-eq {
  color: var(--color-text-3);
}

.chip-val {
  color: var(--color-text-1);
}
</style>
