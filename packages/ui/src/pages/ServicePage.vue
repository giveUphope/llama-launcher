<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useServerStore, type ConsoleTone } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import CommandPreviewCard from '@/components/service/CommandPreviewCard.vue';
import ParamSummaryCard from '@/components/service/ParamSummaryCard.vue';
import TrashCleanCard from '@/components/service/TrashCleanCard.vue';

const server = useServerStore();
const i18n = useI18nStore();

// 服务运行状态（状态/模型/API 地址/主机/端口/PID/运行时长/基线徽章）已迁至
// 概览页 ServiceStatusCard（页面级唯一展示区，避免两页重复显示同一组信息）；
// 本页聚焦：命令预览、参数摘要、配置清理与后端完整输出控制台。

// ---- 控制台输出 ----
// 关键词分类已下沉到 server store 的入队环节（OutputLine.tone），渲染期只做一次映射；
// 此前每条新日志都会对最多 1000 个渲染行各跑 3 条正则
const TONE_CLASS: Record<ConsoleTone, string> = {
  error: 'kind-error',
  warn: 'kind-warn',
  success: 'kind-success',
  info: 'kind-info',
  plain: 'kind-default',
};

const consoleEl = ref<HTMLElement | null>(null);
const renderedLimit = 1000;
const renderedOutputs = computed(() => {
  const outs = server.outputs;
  return outs.length > renderedLimit ? outs.slice(-renderedLimit) : outs;
});

const autoScroll = ref(true);
const hasNewLogs = ref(false);
// keep-alive 下本页停用后仍会收到日志推送：滚动会强制布局，停用时不再滚动（回来时补滚到底）
const pageActive = ref(true);

// 多条日志同帧到达时只滚一次：直接读 scrollHeight 是强制同步布局，
// 原实现每条日志一次 nextTick + 赋值，刷屏启动阶段（数百行）代价叠加
let scrollScheduled = false;
function scheduleScrollToBottom() {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    const el = consoleEl.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    autoScroll.value = true;
    hasNewLogs.value = false;
  });
}

watch(
  () => server.outputs.length,
  () => {
    if (!pageActive.value) {
      hasNewLogs.value = true;
      return;
    }
    if (autoScroll.value) {
      scheduleScrollToBottom();
    } else {
      hasNewLogs.value = true;
    }
  },
);

onActivated(() => {
  pageActive.value = true;
  scheduleScrollToBottom();
});
onDeactivated(() => { pageActive.value = false; });

function onScroll() {
  if (!consoleEl.value) return;
  const el = consoleEl.value;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  autoScroll.value = dist < 60;
  if (autoScroll.value) hasNewLogs.value = false;
}

function onClearConsole() { server.clearOutputs(); }

async function onCopyConsole() {
  const outs = server.outputs;
  if (outs.length === 0) return;
  await window.api.clipboard.write(outs.map((o) => o.data).join(''));
}

// ---- 控制台行数 ----
const logCount = computed(() => server.outputs.length);
</script>

<template>
  <PageFrame>
    <!-- 阶段四：从 LaunchPage 迁入的命令预览与参数摘要 -->
    <CommandPreviewCard />
    <ParamSummaryCard />
    <TrashCleanCard />

    <!-- 控制台输出 -->
    <Card title-key="card_service_console">
      <template #actions>
        <a-button
          size="small"
          :disabled="server.outputs.length === 0"
          :title="i18n.t('copy_console')"
          @click="onCopyConsole"
        >
          <template #icon><Icon name="copy" :size="12" /></template>
          {{ i18n.t('copy_console') }}
        </a-button>
        <a-button size="small" status="danger" :title="i18n.t('clear_console')" @click="onClearConsole">
          <template #icon><Icon name="trash" :size="12" /></template>
          {{ i18n.t('clear_console') }}
        </a-button>
        <span class="log-count">{{ logCount }} {{ i18n.t('col_lines') }}</span>
      </template>
      <!-- 有新日志胶囊：a-button 基座（点击回到底部），仅在有提示时渲染 -->
      <div v-if="hasNewLogs" class="console-header">
        <a-button class="new-logs" type="text" size="mini" @click="scheduleScrollToBottom()">
          <Icon name="chevron_down" :size="12" />
          <span>{{ i18n.t('msg_new_logs') }}</span>
        </a-button>
      </div>
      <div
        ref="consoleEl"
        class="console"
        @scroll="onScroll"
      >
        <span v-for="line in renderedOutputs" :key="line.id" :class="['output-line', TONE_CLASS[line.tone]]">{{ line.data }}</span>
      </div>
    </Card>
  </PageFrame>
</template>

<style scoped lang="scss">
/* 控制台 */
.console-header {
  display: flex;
  align-items: center;
  justify-content: flex-end; // 自动滚动提示已移除（b8c1d59），胶囊槽保持右侧
  gap: 8px;
  margin-bottom: 4px;
  font-size: var(--fs-sm);
  color: var(--color-text-3);
}

/* 有新日志胶囊行：仅提示时渲染（不再常驻占位，卡片体顶部无空白条） */
.new-logs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, rgb(var(--primary-6)) 14%, transparent);
  color: rgb(var(--primary-6));
  border-radius: var(--radius-pill);
  font-weight: 600;
  height: auto;

  &:hover {
    background: color-mix(in srgb, rgb(var(--primary-6)) 24%, transparent);
    color: rgb(var(--primary-6));
  }
}

.log-count {
  font-family: var(--font-mono);
  color: var(--color-text-3);
  font-size: var(--fs-sm);
}

.console {
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  height: 320px;
  overflow: auto;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;

  .output-line {
    white-space: pre-wrap;
    word-break: break-all;
    display: block;
    &.kind-error { color: rgb(var(--danger-6)); }
    &.kind-warn { color: rgb(var(--orange-6)); }
    &.kind-success { color: rgb(var(--success-6)); }
    &.kind-info { color: rgb(var(--arcoblue-6)); }
  }
}
</style>
