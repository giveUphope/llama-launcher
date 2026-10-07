<script setup lang="ts">
// 日志页 = 推理框架（llama-server）输出的唯一出口。
// 归位前：这一页展示的是应用操作日志，而框架原始输出在「服务」页控制台——两类信息各在一页，
// 两页都带「复制输出 / 清空控制台」。按用户 2026-10-07 的决定（档 B）改成一处一类：
// 框架输出 → 本页（唯一复制/清空出口），应用操作日志 → 概览页的日志区。
import type { IconName } from '@/components/common/icon-map';
import { computed, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import ConsolePanel from '@/components/common/ConsolePanel.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useServerStore, type ConsoleTone } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';

const server = useServerStore();
const i18n = useI18nStore();

// 关键词分类在 server store 的入队环节就算好了（OutputLine.tone），渲染期只做一次映射；
// 此前每条新日志都会对最多 1000 个渲染行各跑 3 条正则
const TONE_CLASS: Record<ConsoleTone, string> = {
  error: 'kind-error',
  warn: 'kind-warn',
  success: 'kind-success',
  info: 'kind-info',
  plain: 'kind-default',
};

type Level = ConsoleTone | 'all';

const LEVELS: Array<{ key: Level; label: string; icon: IconName }> = [
  { key: 'all', label: i18n.t('lbl_all'), icon: 'info' },
  { key: 'info', label: 'INFO', icon: 'info' },
  { key: 'success', label: 'SUCCESS', icon: 'check' },
  { key: 'warn', label: 'WARN', icon: 'alert' },
  { key: 'error', label: 'ERROR', icon: 'error' },
];

const levelFilter = ref<Level>('all');
const searchQuery = ref('');
const deferredQuery = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;
// 每次按键都重算筛选会得到新数组身份，进而整表重渲染：去抖 150ms 后才参与筛选
watch(searchQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { deferredQuery.value = q; }, 150);
});

const filteredOutputs = computed(() => {
  const q = deferredQuery.value.trim().toLowerCase();
  return server.outputs.filter((line) => {
    if (levelFilter.value !== 'all' && line.tone !== levelFilter.value) return false;
    if (q && !line.data.toLowerCase().includes(q)) return false;
    return true;
  });
});

// 渲染上限：后端缓冲本身就是 1000 行，再给更高的数是永不触发的死余量
const RENDER_LIMIT = 1000;
const displayOutputs = computed(() => {
  const outs = filteredOutputs.value;
  return outs.length > RENDER_LIMIT ? outs.slice(-RENDER_LIMIT) : outs;
});

const filteredCount = computed(() => filteredOutputs.value.length);

// 复制的是「当前看到的」：带筛选/搜索时把看不见的行一起复制走会误导排查
async function onCopyAll() {
  const text = filteredOutputs.value.map((o) => o.data).join('');
  if (!text) return;
  await window.api.clipboard.write(text);
}

function onClear() {
  server.clearOutputs();
}

// 滚动（停用门控 / rAF 合帧 / 「有新日志」判定）一律由 ConsolePanel 内的 useAutoScroll 承担
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
        @change="(v) => (levelFilter = v as Level)"
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
            :disabled="filteredOutputs.length === 0"
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

    <!-- 框架输出内容区 -->
    <div class="console-wrap">
      <div class="scope-hint">
        <Icon name="info" :size="11" />
        <span>{{ i18n.t('msg_framework_logs_hint') }}</span>
      </div>
      <!-- count 取 outputs 而非 filteredOutputs 的长度：两个都监听过，同一行会触发两次滚动 -->
      <ConsolePanel class="console-fill" :count="server.outputs.length">
        <div v-if="displayOutputs.length === 0" class="empty-log">
          <Icon name="empty" :size="32" class="empty-icon" />
          <span>{{ i18n.t('msg_empty_no_logs') }}</span>
        </div>
        <span
          v-for="line in displayOutputs"
          :key="line.id"
          :class="['output-line', TONE_CLASS[line.tone]]"
        >{{ line.data }}</span>
      </ConsolePanel>
      <div class="scroll-hint-bar">
        <!-- 自动滚动状态文案已移除（b8c1d59：暂停态由「有新日志」胶囊传达），仅保留行数 -->
        <span class="show-limit">{{ Math.min(displayOutputs.length, filteredCount) }} / {{ filteredCount }} {{ i18n.t('col_lines') }}</span>
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
   STYLE_TODO #82）。同一个面板在概览页是定高小窗，两种给法都由外层决定，面板本体不写 */
.console-fill {
  flex: 1 1 0%;
  min-height: 0;
}

/* 后端原始输出一行一段；级别色由 ConsolePanel 打在行上（.kind-* → --log-kind-*） */
.output-line {
  white-space: pre-wrap;
  word-break: break-all;
  display: block;
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
