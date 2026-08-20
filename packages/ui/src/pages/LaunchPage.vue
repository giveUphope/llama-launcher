<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { useStartServer } from '@/composables/useStartServer';
import { PARAMS, PARAM_GROUPS, MODEL_KEY } from '@llama-launcher/shared';
import type { OutputEntry, ParamDef, TrashKind } from '@llama-launcher/shared';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();
const router = useRouter();

// 统一的启动/重启前置校验与流程（TopBar 共用）
const { start: launchStart, restart: launchRestart } = useStartServer();

const isRunning = computed(() => server.status === 'running' || server.status === 'starting');

// 运行时模型名：优先显示用户设置的模型别名（alias），无 alias 时回退到文件名
const runtimeModelName = computed(() => {
  const alias = String(params.values['alias'] ?? '').trim();
  if (alias) return alias;
  const p = String(params.values[MODEL_KEY] ?? '');
  if (!p) return '';
  return p.split(/[\\/]/).pop() ?? p;
});

const commandPreview = ref('');

async function updatePreview() {
  if (!settings.settings) return;
  try {
    commandPreview.value = await server.previewCommand(params.snapshot(), settings.settings);
  } catch (err: any) {
    commandPreview.value = `# Error building preview: ${err.message}`;
  }
}

// 命令预览防抖：拖滑块/应用预设时 params 高频变更（每次变更都走 IPC + 整页重渲染，
// keep-alive 下即使不在本页也在后台消耗主进程），合并为 150ms 一次
const PREVIEW_DEBOUNCE_MS = 150;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    void updatePreview();
  }, PREVIEW_DEBOUNCE_MS);
}

// 参数或设置变化时刷新命令预览（enabled 状态变化也包含在 deep watch 中）
// immediate: 确保从其他页面导航到 Launch 页时，已有参数也能立即生成预览
watch(() => params.values, schedulePreview, { deep: true, immediate: true });
watch(() => params.enabled, schedulePreview, { deep: true });
watch(() => settings.settings, schedulePreview, { deep: true });

async function onCopyCmd() {
  await window.api.clipboard.write(commandPreview.value);
}

// 复制反馈状态
const copiedKey = ref<'url' | 'model' | null>(null);
let copiedTimer: number | null = null;

async function copyText(text: string, key: 'url' | 'model') {
  if (!text) return;
  await window.api.clipboard.write(text);
  copiedKey.value = key;
  if (copiedTimer != null) window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copiedKey.value = null;
  }, 1200);
}

async function onCopyUrl() {
  const u = server.url || (isRunning.value ? `http://${server.host}:${server.port}` : '');
  if (u) await copyText(u, 'url');
}

async function onCopyModel() {
  if (runtimeModelName.value) await copyText(runtimeModelName.value, 'model');
}

// ----- 控制台输出划词复制 -----
// 若用户在控制台内已划选文本，则复制选区；否则复制全部输出。
const consoleCopied = ref(false);
let consoleCopyTimer: number | null = null;

async function onCopyConsole() {
  if (server.outputs.length === 0) return;
  let text = '';
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    // 仅当选区位于控制台容器内时才采用选区文本
    if (consoleEl.value && consoleEl.value.contains(range.commonAncestorContainer)) {
      text = sel.toString();
    }
  }
  if (!text) {
    text = server.outputs.map((o) => o.data).join('');
  }
  if (!text) return;
  await window.api.clipboard.write(text);
  consoleCopied.value = true;
  if (consoleCopyTimer != null) window.clearTimeout(consoleCopyTimer);
  consoleCopyTimer = window.setTimeout(() => {
    consoleCopied.value = false;
  }, 1200);
}

// ----- 启动前参数摘要预览（3.12）-----
// 将已启用的参数按分组整理，供用户启动前快速核对
function formatParamValue(p: ParamDef): string {
  const v = params.values[p.key];
  if (v === undefined || v === null || v === '') return '—';
  if (p.type === 'checkbox') return v ? '✓' : '✗';
  if (p.key === 'api_key') return '••••••'; // 脱敏
  if (p.key === 'model' || p.key === 'mmproj' || p.key === 'spec_draft_model') {
    // 仅显示文件名
    return String(v).split(/[\\/]/).pop() ?? String(v);
  }
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

interface SummaryRow {
  key: string;
  label: string;
  value: string;
  flag: string;
}

interface SummaryGroup {
  groupKey: string;
  labelKey: string;
  rows: SummaryRow[];
}

const summaryGroups = computed<SummaryGroup[]>(() => {
  const groups: SummaryGroup[] = [];
  // 模型单独作为一组置顶
  const modelPath = String(params.values[MODEL_KEY] ?? '');
  const modelRow: SummaryRow = {
    key: MODEL_KEY,
    label: i18n.t('lbl_model_path'),
    value: modelPath ? (modelPath.split(/[\\/]/).pop() ?? modelPath) : i18n.t('status_model_none'),
    flag: '-m',
  };
  groups.push({ groupKey: '_model', labelKey: 'card_current', rows: [modelRow] });

  // 按定义的分组顺序整理已启用参数（排除 model/mmproj/spec_draft_model，它们已脱敏或属模型组）
  const skipKeys = new Set([MODEL_KEY, 'mmproj', 'spec_draft_model']);
  for (const g of PARAM_GROUPS) {
    const rows: SummaryRow[] = [];
    for (const p of PARAMS) {
      if (p.group !== g.key) continue;
      if (skipKeys.has(p.key)) continue;
      // 仅展示已启用的参数
      if (!params.isEnabled(p.key)) continue;
      rows.push({
        key: p.key,
        label: i18n.paramLabel(p.key),
        value: formatParamValue(p),
        flag: p.flag,
      });
    }
    if (rows.length > 0) {
      groups.push({ groupKey: g.key, labelKey: g.labelKey, rows });
    }
  }
  return groups;
});

const enabledParamCount = computed(() => {
  let n = 0;
  for (const p of PARAMS) if (params.isEnabled(p.key)) n++;
  return n;
});

// ----- 启动前校验（增强版） -----
// 前置校验、错误输出与跨页引导统一收敛到 useStartServer（与 TopBar 共用同一套逻辑）
async function onStart() {
  await launchStart();
}

async function onStop() {
  await server.stop();
}

async function onRestart() {
  await launchRestart();
}

async function onOpenWeb() {
  // 内嵌 Web UI：跳转侧边栏「Web UI」标签页，不再跳转外部浏览器
  void router.push('/webui');
}

function onClearConsole() {
  server.clearOutputs();
}

// ----- 控制台输出分类 -----
// llama-server 将所有日志（包括 info）输出到 stderr，
// 仅按 OutputKind 判断会导致普通信息也显示为红色。
// 改为按内容关键词分类：仅真正的错误/警告才用红/黄色。
const ERROR_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault)\b/i;
const WARN_RE = /\b(warn|warning|deprecat|slow|out of)\b/i;
const SUCCESS_RE = /\b(listening|loaded|ready|initialized|running|success)\b/i;

// ----- 控制台自动滚动 -----
const consoleEl = ref<HTMLElement | null>(null);

// 渲染窗口上限：控制台 DOM 节点数有界，长会话（llama-server 日志可达 5000 行）
// 时避免整表渲染拖慢主线程；复制/清空等操作仍使用 server.outputs 完整缓冲。
const CONSOLE_RENDER_LIMIT = 1000;
const renderedOutputs = computed(() =>
  server.outputs.length > CONSOLE_RENDER_LIMIT
    ? server.outputs.slice(-CONSOLE_RENDER_LIMIT)
    : server.outputs,
);

// lineClass 缓存：输出条目对象追加后不可变，按条目缓存分类结果，
// 避免每次输出批次/切页激活时对全部渲染行重跑正则（1500 行 × 3 条正则 = 主要渲染开销）
const lineClassCache = new WeakMap<OutputEntry, string>();
function lineClass(entry: OutputEntry): string {
  const cached = lineClassCache.get(entry);
  if (cached) return cached;
  let cls: string;
  // 应用自身显式标记的 error/success/info 保持不变
  if (entry.kind === 'error') cls = 'kind-error';
  else if (entry.kind === 'success') cls = 'kind-success';
  else if (entry.kind === 'info') cls = 'kind-info';
  else {
    // stdout/stderr 按内容关键词判断
    const text = entry.data || '';
    if (ERROR_RE.test(text)) cls = 'kind-error';
    else if (WARN_RE.test(text)) cls = 'kind-warn';
    else if (SUCCESS_RE.test(text)) cls = 'kind-success';
    else cls = 'kind-default';
  }
  lineClassCache.set(entry, cls);
  return cls;
}

// 滚动到控制台最底部（输出增长或切回本页时调用）
async function scrollConsoleToBottom() {
  await nextTick();
  if (consoleEl.value) {
    consoleEl.value.scrollTop = consoleEl.value.scrollHeight;
  }
}

watch(
  () => server.outputs.length,
  () => { void scrollConsoleToBottom(); },
);

// 从其他页面切回控制台（keep-alive 缓存组件，切回触发 onActivated）时，
// outputs.length 未变化不会触发 watch，需手动滚动到最底部，确保看到最新日志
onActivated(() => {
  void scrollConsoleToBottom();
});

// ----- Ctrl+Shift+C 复制命令行快捷键 -----
function onCopyCommandShortcut() {
  void updatePreview().then(() => {
    void window.api.clipboard.write(commandPreview.value);
  });
}

// ----- 配置目录清理 -----
// 强校验机制：仅清理明确识别的无效/过时文件，settings.json 永不清理
const TRASH_KIND_LABEL_KEY: Record<TrashKind, string> = {
  stale_presets_dir: 'lbl_trash_stale_presets_dir',
  temp_file: 'lbl_trash_temp_file',
  broken_json: 'lbl_trash_broken_json',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function trashKindLabel(kind: TrashKind): string {
  return i18n.t(TRASH_KIND_LABEL_KEY[kind]);
}

// 清理配置目录流程的错误提示（复用统一控制台输出）
function pushConsoleError(message: string) {
  server.pushOutput({ kind: 'error', data: `[Clean] ${message}\n`, ts: Date.now() });
}

async function onCleanTrash() {
  // 1. 检测
  let detected;
  try {
    detected = await window.api.system.detectTrash();
  } catch (e: any) {
    pushConsoleError(i18n.t('msg_trash_detect_failed').replace('{0}', String(e?.message ?? e)));
    return;
  }

  // 防御性检查：浏览器预览/mock 环境下 detectTrash 可能返回 null
  if (!detected || !detected.items) {
    pushConsoleError(i18n.t('msg_trash_detect_failed').replace('{0}', 'no response'));
    return;
  }

  if (detected.items.length === 0) {
    server.pushOutput({ kind: 'info', data: `[Clean] ${i18n.t('msg_trash_empty')}\n`, ts: Date.now() });
    return;
  }

  // 2. 构建简短确认信息（无清单，按类型汇总）
  const kindCount = new Map<TrashKind, { count: number; size: number }>();
  for (const item of detected.items) {
    const cur = kindCount.get(item.kind) ?? { count: 0, size: 0 };
    cur.count++;
    cur.size += item.size;
    kindCount.set(item.kind, cur);
  }
  const summary = Array.from(kindCount.entries())
    .map(([kind, { count, size }]) => `${trashKindLabel(kind)}×${count} (${formatSize(size)})`)
    .join(', ');

  const msg = i18n.t('msg_trash_confirm')
    .replace('{0}', String(detected.items.length))
    .replace('{1}', formatSize(detected.totalSize))
    + '\n\n' + summary;

  const confirmed = await confirm({
    title: i18n.t('msg_trash_confirm_title'),
    message: msg,
    variant: 'danger',
  });
  if (!confirmed) return;

  // 3. 执行清理
  try {
    const result = await window.api.system.cleanTrash(detected.items);
    // 防御性检查：浏览器预览/mock 环境下 cleanTrash 可能返回 null
    if (!result) {
      pushConsoleError('cleanTrash returned no response');
      return;
    }
    if (result.failed > 0) {
      server.pushOutput({
        kind: 'warn',
        data: `[Clean] ${i18n.t('msg_trash_failed').replace('{0}', String(result.cleaned)).replace('{1}', String(result.failed))}\n`,
        ts: Date.now(),
      });
    } else {
      server.pushOutput({
        kind: 'success',
        data: `[Clean] ${i18n.t('msg_trash_cleaned').replace('{0}', String(result.cleaned)).replace('{1}', formatSize(result.totalSize))}\n`,
        ts: Date.now(),
      });
    }
  } catch (e: any) {
    pushConsoleError(String(e?.message ?? e));
  }
}

onMounted(() => {
  window.addEventListener('app:copy-command', onCopyCommandShortcut);
});

onUnmounted(() => {
  window.removeEventListener('app:copy-command', onCopyCommandShortcut);
  if (copiedTimer != null) {
    window.clearTimeout(copiedTimer);
    copiedTimer = null;
  }
  if (consoleCopyTimer != null) {
    window.clearTimeout(consoleCopyTimer);
    consoleCopyTimer = null;
  }
});
</script>

<template>
  <div class="page">
    <Card title-key="card_cmd">
      <div class="cmd-wrap">
        <textarea class="cmd-preview" readonly :value="commandPreview" rows="4"></textarea>
        <div class="cmd-actions">
          <button class="action-btn" @click="onCopyCmd">{{ i18n.t('copy_cmd') }}</button>
        </div>
      </div>
    </Card>

    <!-- 参数摘要预览：统一采用芯片布局，与模型管理页面建议参数卡片样式一致 -->
    <Card title-key="card_param_summary">
      <div class="summary-hint">
        {{ i18n.t('msg_param_summary_hint').replace('{0}', String(enabledParamCount)) }}
      </div>
      <div class="summary-groups">
        <div v-for="g in summaryGroups" :key="g.groupKey" class="summary-group">
          <div class="summary-group-title">{{ i18n.t(g.labelKey) }}</div>
          <div class="summary-chips">
            <span v-for="r in g.rows" :key="r.key" class="summary-chip" :title="r.flag">
              <span class="chip-key">{{ r.label }}</span>
              <span class="chip-eq">=</span>
              <span class="chip-val">{{ r.value }}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>

    <Card title-key="card_control">
      <!-- 运行时地址与模型信息 -->
      <div v-if="isRunning" class="runtime-info">
        <div class="runtime-item">
          <span class="runtime-label">{{ i18n.t('status_url') }}</span>
          <span class="runtime-value">{{ server.url || `http://${server.host}:${server.port}` }}</span>
          <button
            class="copy-mini"
            :title="i18n.t('copy_url')"
            @click="onCopyUrl"
          >
            <Icon name="copy" :size="12" />
            <span v-if="copiedKey === 'url'" class="copied-flag">{{ i18n.t('msg_url_copied') }}</span>
          </button>
        </div>
        <div v-if="runtimeModelName" class="runtime-item">
          <span class="runtime-label">{{ i18n.t('lbl_model_name') }}</span>
          <span class="runtime-value" :title="runtimeModelName">{{ runtimeModelName }}</span>
          <button
            class="copy-mini"
            :title="i18n.t('copy_model')"
            @click="onCopyModel"
          >
            <Icon name="copy" :size="12" />
            <span v-if="copiedKey === 'model'" class="copied-flag">{{ i18n.t('msg_model_copied') }}</span>
          </button>
        </div>
      </div>
      <div class="control-row">
        <button class="action-btn primary" :disabled="isRunning" @click="onStart">
          <Icon name="play" :size="14" />
          <span>{{ i18n.t('start') }}</span>
        </button>
        <button class="action-btn danger" :disabled="!isRunning" @click="onStop">
          <Icon name="stop" :size="14" />
          <span>{{ i18n.t('stop') }}</span>
        </button>
        <button class="action-btn warn" :disabled="!isRunning" @click="onRestart">
          <Icon name="refresh" :size="14" />
          <span>{{ i18n.t('restart') }}</span>
        </button>
        <button class="action-btn accent" :disabled="!isRunning" @click="onOpenWeb">
          <Icon name="external" :size="14" />
          <span>{{ i18n.t('open_web') }}</span>
        </button>
      </div>
    </Card>

    <Card title-key="card_console">
      <template #actions>
        <button
          class="clear-btn"
          @click="onCopyConsole"
          :disabled="server.outputs.length === 0"
          :title="i18n.t('copy_console')"
        >
          <Icon name="copy" :size="12" />
          <span v-if="consoleCopied">{{ i18n.t('msg_console_copied') }}</span>
          <span v-else>{{ i18n.t('copy_console') }}</span>
        </button>
        <button class="clear-btn" @click="onCleanTrash" :title="i18n.t('msg_clean_trash')">
          <Icon name="trash" :size="12" />
          <span>{{ i18n.t('msg_detect_trash') }}</span>
        </button>
        <button class="clear-btn" @click="onClearConsole">
          <Icon name="trash" :size="12" />
          <span>{{ i18n.t('clear_console') }}</span>
        </button>
      </template>
      <div ref="consoleEl" class="console">
        <pre><span v-for="(line, idx) in renderedOutputs" :key="idx" :class="['output-line', lineClass(line)]">{{ line.data }}</span></pre>
      </div>
    </Card>
  </div>
</template>

<style scoped lang="scss">
.page {
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cmd-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cmd-preview {
  width: 100%;
  resize: vertical;
  min-height: 80px;
  padding: 8px 10px;
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--border);
  /* 多行文本容器禁用胶囊（高 80px+ 时 999px 圆角成蛋形）；用行级圆角 */
  border-radius: var(--radius-row);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.cmd-actions {
  display: flex;
  justify-content: flex-end;
}

/* 参数摘要预览 */
.summary-hint {
  font-size: var(--fs-base);
  color: var(--fg-muted);
  margin-bottom: 10px;
}

.summary-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-group-title {
  font-size: var(--fs-sm);
  color: var(--fg-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--border);
}

.summary-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
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

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 运行时信息 */
.runtime-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
}

.runtime-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-base);
  min-width: 0;
}

.runtime-label {
  color: var(--fg-secondary);
  flex-shrink: 0;
  min-width: 64px;
}

.runtime-value {
  color: var(--fg-primary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.copy-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--fg-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  transition: background var(--dur-fast) var(--ease-jelly), color var(--dur-fast) var(--ease-jelly),
    border-color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    color: var(--fg-primary);
    border-color: var(--accent);
  }

  &:active {
    transform: scale(0.96);
  }
}

.copied-flag {
  color: var(--success);
  font-weight: 600;
  white-space: nowrap;
}

/* 清空控制台按钮 */
.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-secondary);
  font-size: var(--fs-base);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), color var(--dur-fast) var(--ease-jelly),
    border-color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    color: var(--danger);
    border-color: var(--danger);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--btn-h);
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;

    &:hover:not(:disabled) {
      background: var(--accent-hover);
      border-color: var(--accent-hover);
    }
  }

  &.danger {
    color: var(--danger);
    border-color: var(--danger);

    &:hover:not(:disabled) {
      background: var(--danger);
      color: #fff;
    }
  }

  &.warn {
    color: var(--warn);
    border-color: var(--warn);

    &:hover:not(:disabled) {
      background: var(--warn);
      color: #fff;
    }
  }

  &.accent {
    color: var(--accent);
    border-color: var(--accent);

    &:hover:not(:disabled) {
      background: var(--accent);
      color: #fff;
    }
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.console {
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  height: 320px;
  overflow: auto;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  /* 允许划词选择（覆盖全局 user-select: none） */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;

  pre {
    user-select: text;
    -webkit-user-select: text;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .output-line {
    &.kind-default,
    &.kind-stdout {
      color: var(--console-fg);
    }

    &.kind-error {
      color: var(--danger);
    }

    &.kind-warn {
      color: var(--warn);
    }

    &.kind-success {
      color: var(--success);
    }

    &.kind-info {
      color: var(--info);
    }
  }
}
</style>
