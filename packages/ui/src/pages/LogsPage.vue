<script setup lang="ts">
// 应用日志页：展示应用自身生命周期/操作日志（服务启停、下载、错误等）。
// 区别于「服务」页控制台——控制台保留后端 llama-server 原始输出（server store）。
// 数据源：主进程 app-log 缓冲（logs:list 拉取 + logs:onlog 实时推送）。
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import { useAppLogStore } from '@/stores/appLog';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import type { AppLogKind } from '@llama-launcher/shared';

const appLog = useAppLogStore();
const settings = useSettingsStore();
const i18n = useI18nStore();

// ---- 搜索 + 级别筛选 ----
const searchQuery = ref('');
const levelFilter = ref<AppLogKind | 'all'>('all');

const LEVELS: Array<{ key: AppLogKind | 'all'; label: string; icon: string }> = [
  { key: 'all', label: i18n.t('lbl_all'), icon: 'info' },
  { key: 'info', label: 'INFO', icon: 'info' },
  { key: 'success', label: 'SUCCESS', icon: 'check' },
  { key: 'warn', label: 'WARN', icon: 'alert' },
  { key: 'error', label: 'ERROR', icon: 'error' },
];

function setLevel(l: AppLogKind | 'all') {
  levelFilter.value = l;
}

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return appLog.entries.filter((entry) => {
    if (levelFilter.value !== 'all' && entry.kind !== levelFilter.value) return false;
    if (q && !entry.data.toLowerCase().includes(q)) return false;
    return true;
  });
});

const filteredCount = computed(() => filteredEntries.value.length);

// ---- 行数限制 ----
const RENDER_LIMIT = 3000;
const renderLimit = ref(RENDER_LIMIT);
const displayEntries = computed(() => {
  const outs = filteredEntries.value;
  return outs.length > renderLimit.value ? outs.slice(-renderLimit.value) : outs;
});

// ---- 行着色：按日志级别直接映射（应用日志不含 stdout/stderr，无需正则探测） ----
function lineClass(entry: { kind: AppLogKind }): string {
  switch (entry.kind) {
    case 'error': return 'kind-error';
    case 'warn': return 'kind-warn';
    case 'success': return 'kind-success';
    default: return 'kind-info';
  }
}

// ---- 格式化时间戳 ----
function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(settings.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---- 复制全部 ----
async function onCopyAll() {
  const text = filteredEntries.value.map((e) => e.data).join('\n');
  if (!text) return;
  await window.api.clipboard.write(text);
}

// ---- 清空 ----
function onClear() {
  appLog.clear();
}

// ---- 自动滚动 ----
const consoleEl = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const hasNewLogs = ref(false);

async function scrollConsoleToBottom() {
  await nextTick();
  if (consoleEl.value) {
    consoleEl.value.scrollTop = consoleEl.value.scrollHeight;
    autoScroll.value = true;
    hasNewLogs.value = false;
  }
}

watch(
  () => appLog.entries.length,
  () => {
    if (autoScroll.value) {
      void scrollConsoleToBottom();
    } else {
      hasNewLogs.value = true;
    }
  },
);

watch(
  () => filteredEntries.value.length,
  () => { void scrollConsoleToBottom(); },
);

onMounted(() => appLog.subscribe());
onActivated(() => { void scrollConsoleToBottom(); });
onUnmounted(() => {
  // 无显式退订（store 全局单例，保留订阅以持续接收实时日志）
});

function onScroll() {
  if (!consoleEl.value) return;
  const el = consoleEl.value;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  autoScroll.value = dist < 80;
  if (autoScroll.value) hasNewLogs.value = false;
}
</script>

<template>
  <PageFrame>
    <!-- 级别筛选 + 搜索 + 操作按钮：同一行（按钮右对齐） -->
    <div class="filter-row">
      <a-radio-group
        class="level-filter"
        type="button"
        size="small"
        :model-value="levelFilter"
        @change="(v) => setLevel(v as AppLogKind | 'all')"
      >
        <a-radio v-for="l in LEVELS" :key="l.key" :value="l.key">
          <Icon :name="l.icon" :size="11" />
          <span>{{ l.label }}</span>
        </a-radio>
      </a-radio-group>
      <div class="search-box">
        <a-input
          v-model="searchQuery"
          :placeholder="i18n.t('lbl_search_logs')"
          allow-clear
        >
          <template #prefix><Icon name="search" :size="13" /></template>
        </a-input>
      </div>
      <div class="toolbar-right">
        <a-button
          size="small"
          :disabled="filteredEntries.length === 0"
          :title="i18n.t('copy_console')"
          @click="onCopyAll"
        >
          <template #icon><Icon name="copy" :size="12" /></template>
          {{ i18n.t('copy_console') }}
        </a-button>
        <a-button size="small" status="danger" :title="i18n.t('clear_console')" @click="onClear">
          <template #icon><Icon name="trash" :size="12" /></template>
          {{ i18n.t('clear_console') }}
        </a-button>
      </div>
    </div>

    <!-- 应用日志内容区 -->
    <div class="console-wrap">
      <div class="scope-hint">
        <Icon name="info" :size="11" />
        <span>{{ i18n.t('msg_app_logs_hint') }}</span>
      </div>
      <!-- 有新日志胶囊：a-button 基座（点击回到底部），仅在有提示时渲染 -->
      <a-button v-if="hasNewLogs" class="new-logs-bar" type="text" size="mini" @click="void scrollConsoleToBottom()">
        <Icon name="chevron_down" :size="12" />
        <span>{{ i18n.t('msg_new_logs') }}</span>
      </a-button>
      <div
        ref="consoleEl"
        class="console"
        @scroll="onScroll"
      >
        <div v-if="displayEntries.length === 0" class="empty-log">
          <Icon name="empty" :size="32" class="empty-icon" />
          <span>{{ i18n.t('msg_empty_no_logs') }}</span>
        </div>
        <div
          v-for="(entry, idx) in displayEntries"
          :key="idx"
          :class="['log-line', lineClass(entry)]"
        >
          <span class="log-ts">{{ formatTs(entry.ts) }}</span>
          <span class="log-kind">{{ entry.kind.toUpperCase() }}</span>
          <span class="log-text">{{ entry.data }}</span>
        </div>
      </div>
      <div class="scroll-hint-bar">
        <!-- 自动滚动状态文案已移除（b8c1d59：暂停态由「有新日志」胶囊传达），仅保留行数 -->
        <span class="show-limit">{{ Math.min(filteredCount, renderLimit) }} / {{ filteredCount }} {{ i18n.t('col_lines') }}</span>
      </div>
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
/* 操作按钮行：独立按钮（无提示条容器） */
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  // 与筛选 chips/搜索框同行，按钮组右对齐
  margin-left: auto;
}

/* 筛选行 */
.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

// 级别筛选：Arco radio-group（button 型）替代自绘筛选 chip；
// 仅保留换行与图标对齐覆盖，其余走 Arco 默认
.level-filter {
  flex-wrap: wrap;
  :deep(.arco-radio) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
}

.search-box {
  flex: 1;
  min-width: 200px;
  max-width: 380px;
}

/* 内容区 */
.console-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.scope-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--color-text-3);
}

/* 有新日志胶囊：a-button 基座，仅提示时渲染（不再常驻占位，控制台顶部无空白条） */
.new-logs-bar {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, rgb(var(--primary-6)) 16%, transparent);
  color: rgb(var(--primary-6));
  border: 1px solid rgb(var(--primary-6));
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  height: auto;
  font-weight: 600;
  animation: pulse-glow 2s ease-in-out infinite;

  &:hover {
    background: color-mix(in srgb, rgb(var(--primary-6)) 26%, transparent);
  }
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.console {
  flex: 1;
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  overflow: auto;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.55;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
  min-height: 0;
}

.log-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: pre-wrap;
  word-break: break-all;

  &.kind-error .log-kind { color: rgb(var(--danger-6)); }
  &.kind-error .log-text { color: rgb(var(--danger-6)); }
  &.kind-warn .log-kind { color: rgb(var(--orange-6)); }
  &.kind-warn .log-text { color: rgb(var(--orange-6)); }
  &.kind-success .log-kind { color: rgb(var(--success-6)); }
  &.kind-success .log-text { color: rgb(var(--success-6)); }
  &.kind-info .log-kind { color: rgb(var(--arcoblue-6)); }
}

.log-ts {
  flex-shrink: 0;
  color: var(--color-text-3);
  font-size: var(--fs-sm);
  min-width: 64px;
}

.log-kind {
  flex-shrink: 0;
  color: var(--color-text-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  min-width: 52px;
}

.log-text {
  flex: 1;
  min-width: 0;
  color: var(--console-fg);
}

.empty-log {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 20px;
  color: var(--color-text-3);
  font-size: var(--fs-base);
}

.empty-icon {
  opacity: 0.4;
}

/* 底部状态栏 */
.scroll-hint-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end; // 自动滚动提示已移除，行数保持右侧
  font-size: var(--fs-sm);
  color: var(--color-text-3);
  padding: 4px;
}

.show-limit {
  font-family: var(--font-mono);
  color: var(--color-text-3); // 原 opacity 0.7 叠 --fg-muted 偏淡，改纯色达 AA
}
</style>