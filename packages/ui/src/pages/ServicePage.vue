<script setup lang="ts">
import { computed, nextTick, onActivated, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import type { OutputEntry } from '@llama-launcher/shared';
import CommandPreviewCard from '@/components/service/CommandPreviewCard.vue';
import ParamSummaryCard from '@/components/service/ParamSummaryCard.vue';
import TrashCleanCard from '@/components/service/TrashCleanCard.vue';

const server = useServerStore();
const i18n = useI18nStore();

// 服务运行状态（状态/模型/API 地址/主机/端口/PID/运行时长/基线徽章）已迁至
// 概览页 ServiceStatusCard（页面级唯一展示区，避免两页重复显示同一组信息）；
// 本页聚焦：命令预览、参数摘要、配置清理与后端完整输出控制台。

// ---- 控制台输出 ----
const ERROR_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault)\b/i;
const WARN_RE = /\b(warn|warning|deprecat|slow|out of)\b/i;
const SUCCESS_RE = /\b(listening|loaded|ready|initialized|running|success)\b/i;

const consoleEl = ref<HTMLElement | null>(null);
const renderedLimit = 1000;
const renderedOutputs = computed(() => {
  const outs = server.outputs;
  return outs.length > renderedLimit ? outs.slice(-renderedLimit) : outs;
});

function lineClass(entry: OutputEntry): string {
  if (entry.kind === 'error') return 'kind-error';
  if (entry.kind === 'success') return 'kind-success';
  if (entry.kind === 'info') return 'kind-info';
  const text = entry.data || '';
  if (ERROR_RE.test(text)) return 'kind-error';
  if (WARN_RE.test(text)) return 'kind-warn';
  if (SUCCESS_RE.test(text)) return 'kind-success';
  return 'kind-default';
}

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
  () => server.outputs.length,
  () => {
    if (autoScroll.value) {
      void scrollConsoleToBottom();
    } else {
      hasNewLogs.value = true;
    }
  },
);

onActivated(() => { void scrollConsoleToBottom(); });

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
      <!-- 有新日志胶囊：仅在有提示时渲染（原常驻占位行会在卡片体顶部留下空白条，
           2026-09-07 移除占位；胶囊为用户滚动离底后的瞬时反馈，出现时轻微下移可接受） -->
      <div v-if="hasNewLogs" class="console-header">
        <span class="new-logs-slot has-new" @click="void scrollConsoleToBottom()">
          <span class="new-logs">
            <Icon name="chevron_down" :size="12" />
            <span>{{ i18n.t('msg_new_logs') }}</span>
          </span>
        </span>
      </div>
      <div
        ref="consoleEl"
        class="console"
        @scroll="onScroll"
      >
        <span v-for="(line, idx) in renderedOutputs" :key="idx" :class="['output-line', lineClass(line)]">{{ line.data }}</span>
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
.new-logs-slot {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
}

.new-logs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, rgb(var(--primary-6)) 14%, transparent);
  color: rgb(var(--primary-6));
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    background: color-mix(in srgb, rgb(var(--primary-6)) 24%, transparent);
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
