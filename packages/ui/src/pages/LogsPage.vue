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

const filterChips = computed(() => LEVELS);

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
      <div class="level-chips">
        <button
          v-for="l in filterChips"
          :key="l.key"
          class="level-chip"
          :class="{ active: levelFilter === l.key }"
          @click="setLevel(l.key)"
        >
          <Icon :name="l.icon" :size="11" />
          <span>{{ l.label }}</span>
        </button>
      </div>
      <div class="search-box">
        <Icon name="search" :size="13" class="search-icon" />
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          :placeholder="i18n.t('lbl_search_logs')"
        />
      </div>
      <div class="toolbar-right">
        <button class="action-btn" @click="onCopyAll" :disabled="filteredEntries.length === 0" :title="i18n.t('copy_console')">
          <Icon name="copy" :size="12" />
          <span>{{ i18n.t('copy_console') }}</span>
        </button>
        <button class="action-btn" @click="onClear" :title="i18n.t('clear_console')">
          <Icon name="trash" :size="12" />
          <span>{{ i18n.t('clear_console') }}</span>
        </button>
      </div>
    </div>

    <!-- 应用日志内容区 -->
    <div class="console-wrap">
      <div class="scope-hint">
        <Icon name="info" :size="11" />
        <span>{{ i18n.t('msg_app_logs_hint') }}</span>
      </div>
      <!-- new-logs 槽位常驻：预留胶囊等高的固定高度，无新日志时隐藏但占位——
           控制台区域不因胶囊出现/消失而上下跳动（flex:1 的 console 高度稳定）。 -->
      <div class="new-logs-slot" :class="{ 'has-new': hasNewLogs }" @click="hasNewLogs && void scrollConsoleToBottom()">
        <div v-if="hasNewLogs" class="new-logs-bar">
          <Icon name="chevron_down" :size="12" />
          <span>{{ i18n.t('msg_new_logs') }}</span>
        </div>
      </div>
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
        <span class="scroll-hint">{{ autoScroll ? i18n.t('msg_autoscroll_on') : i18n.t('msg_autoscroll_off') }}</span>
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

.level-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.level-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    color var(--dur-fast) var(--ease-smooth), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
    color: var(--primary-fg);
  }
}

.search-box {
  flex: 1;
  min-width: 200px;
  max-width: 380px;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  transition: border-color var(--dur-fast) var(--ease-smooth);

  &:focus-within {
    border-color: var(--accent);
  }

  .search-icon {
    flex-shrink: 0;
    color: var(--fg-muted);
  }
}

.search-input {
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--fg-primary);
  font-size: var(--fs-base);
  outline: none;

  &::placeholder {
    color: var(--fg-muted);
  }
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
  color: var(--fg-muted);
}

/* new-logs 槽位常驻：预留胶囊等高的固定高度，无新日志时隐藏但占位（console 不跳动） */
.new-logs-slot {
  display: flex;
  justify-content: center;
  min-height: 26px; // 与胶囊高度一致（padding 3px×2 + fs-sm 12px 行高 ~1.4 ≈ 23px，向上取整）
  align-items: flex-start;

  &:not(.has-new) {
    visibility: hidden; // 保留占位高度，隐藏胶囊
  }
}

.new-logs-bar {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: 600;
  animation: pulse-glow 2s ease-in-out infinite;

  &:hover {
    background: color-mix(in srgb, var(--accent) 26%, transparent);
  }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 8%, transparent); }
}

.console {
  flex: 1;
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--border);
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

  &.kind-error .log-kind { color: var(--danger); }
  &.kind-error .log-text { color: var(--danger); }
  &.kind-warn .log-kind { color: var(--warn); }
  &.kind-warn .log-text { color: var(--warn); }
  &.kind-success .log-kind { color: var(--success); }
  &.kind-success .log-text { color: var(--success); }
  &.kind-info .log-kind { color: var(--info); }
}

.log-ts {
  flex-shrink: 0;
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  min-width: 64px;
}

.log-kind {
  flex-shrink: 0;
  color: var(--fg-secondary);
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
  color: var(--fg-muted);
  font-size: var(--fs-base);
}

.empty-icon {
  opacity: 0.4;
}

/* 底部状态栏 */
.scroll-hint-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  padding: 4px;
}

.scroll-hint {
  opacity: 0.8;
}

.show-limit {
  font-family: var(--font-mono);
  opacity: 0.7;
}
</style>