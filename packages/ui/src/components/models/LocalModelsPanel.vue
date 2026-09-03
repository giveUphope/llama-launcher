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

const totalSizeStr = computed(() => {
  const bytes = models.value.reduce((sum, m) => sum + m.size, 0);
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
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
function onRefreshModelsShortcut() { void onRefresh(); }
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
  // 订阅 Ctrl+R 快捷键刷新
  window.addEventListener('app:refresh-models', onRefreshModelsShortcut);
});

onUnmounted(() => {
  if (unsubModelsChanged) { unsubModelsChanged(); unsubModelsChanged = null; }
  window.removeEventListener('app:refresh-models', onRefreshModelsShortcut);
});

async function onRefresh() {
  const dir = modelsDir.value;
  if (!dir) return;
  scanning.value = true;
  try {
    const result = await window.api.models.scan(dir);
    // 防御性检查：浏览器预览/mock 环境下 scan 可能返回 null
    models.value = Array.isArray(result) ? result : [];
    // 选中态为模板级路径比较，扫描替换 models 后自动同步，无需手动重置
  } catch (e: any) {
    // 目录不存在：用自定义弹窗询问是否创建（替代原生消息框）
    if (e?.code === 'DIR_NOT_FOUND') {
      const ok = await confirm({
        title: i18n.t('msg_ask_create_title'),
        message: i18n.t('msg_ask_create_dir').replace('{0}', dir),
        confirmKey: 'dlg_confirm',
        cancelKey: 'dlg_cancel',
        variant: 'warning',
      });
      if (ok) {
        try {
          const result = await window.api.models.scan(dir, { createIfMissing: true });
          models.value = Array.isArray(result) ? result : [];
          return;
        } catch (e2: any) {
          server.pushOutput({
            kind: 'error',
            data: `[Models] ${i18n.t('msg_dir_create_failed').replace('{0}', e2?.message ?? String(e2))}\n`,
            ts: Date.now(),
          });
          return;
        }
      }
    }
    console.error('scan models failed:', e);
  } finally {
    scanning.value = false;
  }
}

// 点击列表行直接应用模型（统一走 params.applyModel：
// 保留参数值 + 自动检测 mmproj + 加载 GGUF 元数据，控制台切换时自动清理）
function selectRow(idx: number) {
  if (idx >= 0 && idx < filteredModels.value.length) {
    const path = filteredModels.value[idx].path;
    void (async () => {
      // 有未固化的临时调整时先确认丢弃（用户取消则中止后续预设应用）
      const ok = await params.applyModel(path);
      if (!ok) return;
      // 智能预设：该模型存在已保存预设时静默应用（建立预设基线）
      await applyModelPresetIfAny(path);
    })();
  }
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
      <!-- 统计横条 -->
      <div class="stats-row">
        <div class="stat">
          <Icon name="models" :size="14" />
          <div class="stat-body">
            <span class="stat-value">{{ models.length }}</span>
            <span class="stat-label">{{ i18n.t('lbl_model_count') }}</span>
          </div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat">
          <Icon name="disk" :size="14" />
          <div class="stat-body">
            <span class="stat-value">{{ totalSizeStr }}</span>
            <span class="stat-label">{{ i18n.t('lbl_total_size') }}</span>
          </div>
        </div>
        <!-- 已选统计与刷新按钮已移除：选中态见当前模型胶囊；列表由文件监听自动维护 -->
      </div>

      <!-- 引擎目录 / 模型目录 / 镜像源等应用设置已统一移至「应用设置」页（/settings） -->
      <Card title-key="card_models">
        <div class="search-row">
          <input
            class="search-input"
            type="text"
            v-model="searchQuery"
            :placeholder="i18n.t('lbl_search_models')"
          />
          <span class="search-count" v-if="searchQuery">
            {{ filteredModels.length }} / {{ models.length }}
          </span>
          <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">
            <Icon name="close" :size="11" />
          </button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ i18n.t('col_name') }}</th>
                <th class="col-size">{{ i18n.t('col_size') }}</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredModels.length">
                <td colspan="3" class="empty">{{ searchQuery ? i18n.t('msg_no_search_results') : '—' }}</td>
              </tr>
              <tr
                v-for="(m, idx) in filteredModels"
                :key="m.path"
                :class="{ selected: m.path === modelPath }"
                @click="selectRow(idx)"
              >
                <td>
                  <div class="model-name-cell">
                    <Icon v-if="m.path === modelPath" name="star" :size="12" class="selected-icon" />
                    <!-- 路径不再单列展示：悬停名称可见完整路径，「打开目录」按钮直达所在目录 -->
                    <div class="model-name-row" :title="m.path">{{ m.name }}</div>
                  </div>
                  <!-- 伴随文件标签 + 显存适配 + 体检结果合并同一行 -->
                  <div v-if="(m.tags && m.tags.length) || fitOf(m)?.verdict || benchBadge(m)" class="model-tags">
                    <span v-for="t in m.tags ?? []" :key="t" class="model-tag" :class="tagCls(t)">{{ t }}</span>
                    <span
                      v-if="fitOf(m)?.verdict"
                      class="model-tag"
                      :class="`fit-${fitOf(m)!.verdict}`"
                      :title="fitTitle(m)"
                    >{{ fitBadge(m) }}</span>
                    <span v-if="benchBadge(m)" class="model-tag bench-chip" :title="benchTitle(m)">{{ benchBadge(m) }}</span>
                  </div>
                </td>
                <td class="col-size">{{ m.size_str }}</td>
                <td class="col-actions">
                  <div class="row-actions">
                    <button class="row-btn" :title="i18n.t('btn_open_dir')" @click.stop="onOpenModelDir(m)">
                      <Icon name="folder_open" :size="13" />
                    </button>
                    <button
                      class="row-btn"
                      :title="i18n.t('bench_llama_title')"
                      :disabled="benchJobs[m.path]?.state === 'running'"
                      @click.stop="onBench(m)"
                    >
                      <Icon name="clock" :size="13" />
                    </button>
                    <button class="row-btn danger" :title="i18n.t('btn_remove_model')" @click.stop="onRemoveModel(m)">
                      <Icon name="trash" :size="13" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
          <button class="action-btn primary" @click="applySuggestions">
            {{ i18n.t('gguf_apply_suggestions') }} ({{ params.ggufSuggestions.length }})
          </button>
        </div>
        <div class="suggestions-compact">
          <span v-for="(s, idx) in params.ggufSuggestions" :key="idx" class="suggestion-chip">
            <span class="chip-key">{{ s.key }}</span>
            <span class="chip-eq">=</span>
            <span class="chip-val">{{ formatValue(s.value) }}</span>
          </span>
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

/* 统计横条 */
.stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  // 与 status-bar / params-status-bar 的容器间距一致（8px）
  margin-bottom: 8px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--fg-secondary);
}

.stat-body {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.3;
}

.stat-value {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--fg-primary);
  font-family: var(--font-mono);
}

.stat-label {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: var(--border);
}

/* 清除搜索按钮 */
.clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-smooth), background var(--dur-fast) var(--ease-smooth);

  &:hover {
    color: var(--fg-primary);
    background: var(--bg-hover);
  }
}

/* 统计条与搜索行 */
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* 建议参数一键应用按钮（复用全局 action-btn 语义） */
.search-input {
  flex: 1;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);

  &:focus {
    border-color: var(--accent);
    outline: none;
  }

  &::placeholder {
    color: var(--fg-muted);
  }
}

.search-count {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.table-wrap {
  max-height: 340px;
  overflow: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-base);

  thead th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--glass-border);
    color: var(--fg-secondary);
    font-weight: 600;
    position: sticky;
    top: 0;
    /* 粘性表头必须不透明：行滚动穿过表头时半透明玻璃会透底（且滚动容器禁 blur） */
    background: var(--bg-card);
  }

  tbody td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-primary);
  }

  tbody tr {
    cursor: pointer;

    &:hover {
      background: var(--bg-hover);
    }

    &.selected {
      background: var(--bg-active);
    }
  }

  .col-size {
    width: 90px;
  }

  // 名称列保底宽度：保证伴随标签 + 适配徽章 + 体检结果同行展示
  th:first-child,
  td:first-child {
    min-width: 210px;
  }

  .col-actions {
    width: 84px;
    text-align: right;

    // 操作按钮固定单行（flex 消除 inline 空白节点，路径列收缩时不再换行）
    .row-actions {
      display: flex;
      justify-content: flex-end;
      gap: 4px;
    }

    .row-btn {
      flex-shrink: 0;
    }
  }

  .empty {
    text-align: center;
    color: var(--fg-muted);
    padding: 20px;
  }
}

/* 模型名 + 伴随文件标签 */
.model-name-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.selected-icon {
  color: var(--accent);
}

.model-name-row {
  font-weight: 600;
}

.model-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  margin-top: 4px;
  // 标签恒单行：超出时整行省略（名称列已有 min-width 保底）
  overflow: hidden;
}

/* 伴随文件标签徽章（mmproj / dflash / draft），淡底配色对齐全局徽章风格 */
.model-tag {
  display: inline-block;
  font-size: var(--fs-xs);
  font-weight: 600;
  font-family: var(--font-mono);
  border-radius: var(--radius-pill);
  padding: 1px 6px;
  letter-spacing: 0.2px;
  line-height: 1.5;

  &.mmproj {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  &.dflash {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }

  &.draft {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }

  // 显存适配徽章（估算结果）：成功绿 / 需部分卸载橙 / 建议降档红
  &.fit-fit {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }

  &.fit-partial {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }

  &.fit-no {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }

  // llama-bench 体检结果徽章：中性灰底 + mono 数值
  &.bench-chip {
    color: var(--fg-secondary);
    background: var(--bg-hover);
  }
}

/* 行内操作按钮（打开目录 / 移除） */
.row-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    color: var(--fg-primary);
  }


  &.danger:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
  }
}

/* GGUF 状态提示 */
.gguf-status {
  padding: 12px;
  font-size: var(--fs-md);
  color: var(--fg-muted);
  text-align: center;

  &.error {
    color: var(--danger);
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}

.chip-key {
  color: var(--accent);
  font-weight: 600;
}

.chip-eq {
  color: var(--fg-muted);
}

.chip-val {
  color: var(--fg-primary);
}
</style>
