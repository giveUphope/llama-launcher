<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onUnmounted } from 'vue';
import type { ModelInfo, ModelFitResult, LlamaBenchJobState } from '@llama-launcher/shared';
import { MODEL_KEY } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import PageFrame from '@/components/common/PageFrame.vue';
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
    message: i18n.t('msg_remove_model_confirm').replace('{0}', m.name),
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
        data: i18n.t('msg_remove_model_failed').replace('{0}', res?.error ?? 'unknown') + '\n',
        ts: Date.now(),
      });
    }
  } catch (e: any) {
    server.pushOutput({
      kind: 'error',
      data: i18n.t('msg_remove_model_failed').replace('{0}', e?.message ?? String(e)) + '\n',
      ts: Date.now(),
    });
  }
}

// 伴随文件标签徽章配色（mmproj / dflash / draft）
function tagCls(tag: string): string {
  return tag === 'mmproj' ? 'mmproj' : tag === 'dflash' ? 'dflash' : 'draft';
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
  const message = `${i18n.t('msg_apply_suggestions_preview').replace('{0}', String(params.ggufSuggestions.length))}\n\n${previewLines}\n\n${i18n.t('msg_apply_suggestions_confirm')}`;

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
  // 订阅文件变更通知，自动刷新模型列表
  try {
    unsubModelsChanged = window.api.models.onChanged(() => {
      void onRefresh();
    });
  } catch {
    // 浏览器预览环境(无 Electron preload)下 window.api.models 未定义,忽略事件订阅
  }
});

onUnmounted(() => {
  if (unsubModelsChanged) { unsubModelsChanged(); unsubModelsChanged = null; }
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
        message: i18n.t('msg_ask_create_dir').replace('{0}', dir),
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
            data: `[Models] ${i18n.t('msg_dir_create_failed').replace('{0}', e2?.message ?? String(e2))}\n`,
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

// 伴随文件标签 → a-tag 配色
function tagColor(t: string): string {
  return t === 'mmproj' ? 'arcoblue' : t === 'dflash' ? 'green' : 'orange';
}

// 显存适配徽章 → a-tag 配色
function fitColor(m: ModelInfo): string {
  const v = fitOf(m)?.verdict;
  return v === 'fit' ? 'green' : v === 'partial' ? 'orange' : 'red';
}

// ---- 显存适配徽章：批量估算每个模型文件的显存适配判定（fit/partial/no）+ 上下文上限 ----
const fitMap = ref<Record<string, ModelFitResult>>({});

watch(() => models.value.map((m) => m.path).join('|'), (joined) => {
  if (!joined) return;
  void refreshFit(joined.split('|'));
});

async function refreshFit(paths: string[]) {
  try {
    const res = await window.api.system.estimateModelFit(paths);
    if (res && typeof res === 'object') fitMap.value = res;
  } catch {
    // 浏览器预览/主进程异常：无徽章（静默降级）
  }
}

function fitOf(m: ModelInfo): ModelFitResult | undefined {
  return fitMap.value[m.path];
}

function fitBadge(m: ModelInfo): string | null {
  const v = fitOf(m)?.verdict;
  if (v === 'fit') return `✓ ${i18n.t('fit_full')}`;
  if (v === 'partial') return `△ ${i18n.t('fit_partial')}`;
  if (v === 'no') return `✗ ${i18n.t('fit_no')}`;
  return null;
}

function fitTitle(m: ModelInfo): string {
  const f = fitOf(m);
  if (!f) return '';
  if (f.verdict === 'no') return i18n.t('msg_fit_no_tip');
  if (f.verdict === 'partial') {
    return i18n.t('msg_fit_partial_tip').replace('{0}', f.maxContext ? f.maxContext.toLocaleString() : '—');
  }
  if (f.verdict === 'fit' && f.maxContext !== null) {
    return i18n.t('msg_fit_full_tip').replace('{0}', f.maxContext.toLocaleString()).replace('{1}', f.dtype);
  }
  return '';
}

// ---- llama-bench 离线体检：单模型单作业，run 启动 + 2.5s 轮询状态，结果徽章展示 ----
const benchJobs = ref<Record<string, LlamaBenchJobState>>({});
const polling = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(path: string) {
  polling.add(path);
  if (!pollTimer) pollTimer = setInterval(pollBench, 2500);
}

async function pollBench() {
  for (const p of [...polling]) {
    try {
      const st = await window.api.system.benchLlamaStatus(p);
      if (st) benchJobs.value = { ...benchJobs.value, [p]: st };
      if (st && st.state !== 'running') polling.delete(p);
    } catch {
      polling.delete(p);
    }
  }
  if (polling.size === 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
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
      benchJobs.value = { ...benchJobs.value, [m.path]: res.data };
      if (res.data.state === 'running') startPolling(m.path);
    } else {
      server.pushOutput({ kind: 'error', data: `[Bench] ${res.error}\n`, ts: Date.now() });
    }
  } catch (e: any) {
    server.pushOutput({ kind: 'error', data: `[Bench] ${e?.message ?? String(e)}\n`, ts: Date.now() });
  }
}

function benchBadge(m: ModelInfo): string | null {
  const job = benchJobs.value[m.path];
  if (!job) return null;
  if (job.state === 'running') return i18n.t('bench_llama_running');
  if (job.state === 'error') return i18n.t('bench_llama_failed');
  const s = job.summary;
  if (!s) return null;
  const pp = s.ppTokS !== null ? Math.round(s.ppTokS).toLocaleString() : '—';
  const tg = s.tgTokS !== null ? Math.round(s.tgTokS).toLocaleString() : '—';
  return `pp ${pp} · tg ${tg}`;
}

function benchTitle(m: ModelInfo): string {
  const job = benchJobs.value[m.path];
  if (!job) return '';
  if (job.state === 'error') return job.error ?? '';
  const s = job.summary;
  if (!s) return '';
  return `${s.modelType ?? ''} · ${s.backend ?? ''} · ${new Date(s.testedAt).toLocaleString()}`;
}

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
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
          <span class="search-count" v-if="searchQuery">
            {{ filteredModels.length }} / {{ models.length }}
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
              <Icon v-if="record.path === modelPath" name="star" :size="12" class="selected-icon" />
              <div class="model-name-row" :title="record.path">{{ record.name }}</div>
            </div>
            <!-- 伴随文件标签 + 显存适配 + 体检结果合并同一行 -->
            <div v-if="(record.tags && record.tags.length) || fitOf(record)?.verdict || benchBadge(record)" class="model-tags">
              <a-tag v-for="t in record.tags ?? []" :key="t" size="small" :color="tagColor(t)">{{ t }}</a-tag>
              <a-tag v-if="fitOf(record)?.verdict" size="small" :color="fitColor(record)" :title="fitTitle(record)">
                {{ fitBadge(record) }}
              </a-tag>
              <a-tag v-if="benchBadge(record)" size="small" color="gray" :title="benchTitle(record)">
                {{ benchBadge(record) }}
              </a-tag>
            </div>
          </template>
          <template #actions="{ record }">
            <!-- 行操作：文本内联小按钮（§7.5.5 禁止纯图标操作按钮，预设面板同款范式） -->
            <div class="row-actions">
              <a-button size="small" class="row-action" :title="i18n.t('btn_open_dir')" @click.stop="onOpenModelDir(record)">
                <template #icon><Icon name="folder_open" :size="11" /></template>
                {{ i18n.t('act_dir') }}
              </a-button>
              <a-button size="small" class="row-action" :title="i18n.t('bench_llama_title')"
                        :disabled="benchJobs[record.path]?.state === 'running'" @click.stop="onBench(record)">
                <template #icon><Icon name="bench" :size="11" /></template>
                {{ i18n.t('act_bench') }}
              </a-button>
              <a-button size="small" class="row-action" status="danger" :title="i18n.t('btn_remove_model')" @click.stop="onRemoveModel(record)">
                <template #icon><Icon name="trash" :size="11" /></template>
                {{ i18n.t('btn_remove_model') }}
              </a-button>
            </div>
          </template>
        </a-table>
      </Card>

      <!-- 精简的模型信息摘要（可折叠）+ 建议参数一键应用 -->
      <ModelMetaCard v-if="modelPath" />

      <!-- GGUF 读取状态 -->
      <Card v-if="modelPath && (params.ggufLoading || params.ggufError)" title-key="card_model_info">
        <div v-if="params.ggufLoading" class="gguf-status">{{ i18n.t('msg_gguf_reading') }}</div>
        <div v-else-if="params.ggufError" class="gguf-status error">
          {{ i18n.t('msg_gguf_read_failed').replace('{0}', params.ggufError) }}
        </div>
      </Card>

      <!-- 建议参数（精简：仅显示 key=value 和一键应用按钮） -->
      <Card v-if="modelPath && !params.ggufLoading && !params.ggufError && params.ggufSuggestions.length" title-key="card_suggested_params">
        <div class="suggestions-toolbar">
          <a-button size="small" type="primary" @click="applySuggestions">
            {{ i18n.t('gguf_apply_suggestions') }} ({{ params.ggufSuggestions.length }})
          </a-button>
        </div>
        <div class="suggestions-compact">
          <!-- 建议参数 chips：a-tag 原生承载（同 meta-chip/summary-chip 范式），
               自定义 span 胶囊（padding/bg/radius）已移除 -->
          <a-tag v-for="(s, idx) in params.ggufSuggestions" :key="idx" size="small" class="suggestion-chip">
            <span class="chip-key">{{ s.key }}</span>
            <span class="chip-eq">=</span>
            <span class="chip-val">{{ formatValue(s.value) }}</span>
          </a-tag>
        </div>
      </Card>
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
    color: var(--color-text-3);
    line-height: 1.3;
    margin: 0 6px 0 0; // title 与 value 间距 6px（图标-文本间距统一刻度）
  }

  :deep(.arco-statistic-value) {
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--color-text-1);
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

.search-count {
  font-size: var(--fs-sm);
  color: var(--color-text-3);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.models-table {
  margin-top: 8px;
  :deep(.arco-table-tr) { cursor: pointer; }
  :deep(.arco-table-tr.row-selected > td) { background: var(--bg-active); }
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

.selected-icon {
  color: rgb(var(--primary-6));
  flex-shrink: 0;
}

.model-name-row {
  font-weight: 600;
  /* 长模型名单行截断：悬停 title 已含完整路径，不需要换行堆叠 */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.model-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  margin-top: 4px;
  // 标签恒单行：超出时整行省略（名称列已有 min-width 保底）
  overflow: hidden;
}

/* GGUF 状态提示 */
.gguf-status {
  padding: 12px;
  font-size: var(--fs-md);
  color: var(--color-text-3);
  text-align: center;

  &.error {
    color: rgb(var(--danger-6));
  }
}

/* 建议参数（精简芯片布局） */
.suggestions-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.suggestions-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggestion-chip {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  :deep(.arco-tag-content) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
}

.chip-key {
  color: rgb(var(--primary-6));
  font-weight: 600;
}

.chip-eq {
  color: var(--color-text-3);
}

.chip-val {
  color: var(--color-text-1);
}
</style>
