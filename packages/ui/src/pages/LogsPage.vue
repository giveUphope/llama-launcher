<script setup lang="ts">
// 应用日志页：展示应用自身生命周期/操作日志（服务启停、下载、错误等）。
// 区别于「服务」页控制台——控制台保留后端 llama-server 原始输出（server store）。
// 数据源：主进程 app-log 缓冲（logs:list 拉取 + logs:onlog 实时推送）。
import type { IconName } from '@/components/common/icon-map';
import { computed, onMounted, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import ConsolePanel from '@/components/common/ConsolePanel.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useAppLogStore, APP_LOG_MAX_LINES } from '@/stores/appLog';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import type { AppLogKind } from '@llama-launcher/shared';

const appLog = useAppLogStore();
const settings = useSettingsStore();
const i18n = useI18nStore();

// ---- 搜索 + 级别筛选 ----
// searchQuery 绑定输入框，deferredQuery 去抖 150ms 后才参与筛选：
// 每次按键都重算 2000 行筛选会得到新数组身份，进而整表重渲染
const searchQuery = ref('');
const deferredQuery = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { deferredQuery.value = q; }, 150);
});
const levelFilter = ref<AppLogKind | 'all'>('all');

const LEVELS: Array<{ key: AppLogKind | 'all'; label: string; icon: IconName }> = [
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
  const q = deferredQuery.value.trim().toLowerCase();
  return appLog.entries.filter((entry) => {
    if (levelFilter.value !== 'all' && entry.kind !== levelFilter.value) return false;
    // lower 由 store 在入队时算好，避免逐行 toLowerCase
    if (q && !entry.lower.includes(q)) return false;
    return true;
  });
});

const filteredCount = computed(() => filteredEntries.value.length);

// ---- 行数限制 ----
// 与应用日志缓冲同上限：缓冲本身就只留 2000 行，渲染再给更高的数只是永不触发的死余量
const RENDER_LIMIT = APP_LOG_MAX_LINES;
const renderLimit = ref(RENDER_LIMIT);
const displayEntries = computed(() => {
  const outs = filteredEntries.value;
  return outs.length > renderLimit.value ? outs.slice(-renderLimit.value) : outs;
});

// 行着色与时间戳格式化均已前置到 appLog store 入队时（entry.cls / entry.time）：
// 此前每次重渲染都要对最多 2000 行各调一次 Intl 格式化，而每条新日志都触发重渲染。

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

// ---- 生命周期 ----
// 滚动（停用门控 / rAF 合帧 / 「有新日志」判定）一律由 ConsolePanel 内的 useAutoScroll 承担
onMounted(() => appLog.subscribe());

// 语言切换只需重算已缓存行的时间串（store 内一次遍历）
watch(() => settings.language, (lang) => { if (lang) appLog.setLocale(lang); }, { immediate: true });
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
        <ToolTip :text="i18n.t('copy_console')">
          <a-button
            size="small"
            :disabled="filteredEntries.length === 0"
            @click="onCopyAll"
          >
            <template #icon><Icon name="copy" :size="12" /></template>
            {{ i18n.t('copy_console') }}
          </a-button>
        </ToolTip>
        <ToolTip :text="i18n.t('clear_console')">
          <a-button size="small" class="clear-console" status="danger" @click="onClear">
            <template #icon><Icon name="trash" :size="12" /></template>
            {{ i18n.t('clear_console') }}
          </a-button>
        </ToolTip>
      </div>
    </div>

    <!-- 应用日志内容区 -->
    <div class="console-wrap">
      <div class="scope-hint">
        <Icon name="info" :size="11" />
        <span>{{ i18n.t('msg_app_logs_hint') }}</span>
      </div>
      <!-- count 取 entries 而非 filteredEntries 的长度：两个都监听过，同一条日志会触发两次滚动 -->
      <ConsolePanel class="console-fill" :count="appLog.entries.length">
        <div v-if="displayEntries.length === 0" class="empty-log">
          <Icon name="empty" :size="32" class="empty-icon" />
          <span>{{ i18n.t('msg_empty_no_logs') }}</span>
        </div>
        <div
          v-for="entry in displayEntries"
          :key="entry.id"
          :class="['log-line', entry.cls]"
        >
          <span class="log-ts">{{ entry.time }}</span>
          <span class="log-kind">{{ entry.kind.toUpperCase() }}</span>
          <span class="log-text">{{ entry.data }}</span>
        </div>
      </ConsolePanel>
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
// 仅保留换行与图标对齐覆盖，其余走 Arco 默认。
// 图标+文本在 .arco-radio-button-content 内（content 默认 block：图标与文本
// baseline 对齐偏下 2px 且无间距），需显式 inline-flex + gap 对齐
.level-filter {
  flex-wrap: wrap;
  :deep(.arco-radio-button-content) {
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
  color: var(--fg-hint);
}

/* 面板高度：日志页要撑满剩余可视高（骨架链给的是确定高度 + 弹性列，缺这一环等于没写，
   STYLE_TODO #82），服务页则是定高——同一个面板两种给法，都由外层这一层决定 */
.console-fill {
  flex: 1 1 0%;
  min-height: 0;
}

.log-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-ts {
  flex-shrink: 0;
  color: var(--color-text-3);
  font-size: var(--fs-sm);
  min-width: 64px;
}

/* 级别标签与正文不写 color：级别色由 ConsolePanel 打在行上，这里只留排版 */
.log-kind {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  min-width: 52px;
}

.log-text {
  flex: 1;
  min-width: 0;
}

/* info 行只给级别标签着色，正文保持控制台前景色（error/warn/success 整行着色） */
.log-line.kind-info .log-text {
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
  color: var(--fg-hint);
  padding: 4px;
}

.show-limit {
  font-family: var(--font-mono);
  color: var(--fg-hint);
}
</style>