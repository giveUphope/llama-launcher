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
        <button
          class="action-btn"
          @click="onCopyConsole"
          :disabled="server.outputs.length === 0"
          :title="i18n.t('copy_console')"
        >
          <Icon name="copy" :size="12" />
          <span>{{ i18n.t('copy_console') }}</span>
        </button>
        <button class="action-btn" @click="onClearConsole" :title="i18n.t('clear_console')">
          <Icon name="trash" :size="12" />
          <span>{{ i18n.t('clear_console') }}</span>
        </button>
        <span class="log-count">{{ logCount }} {{ i18n.t('col_lines') }}</span>
      </template>
      <div class="console-header">
        <!-- 左槽位常驻：预留 new-logs 胶囊的宽度，无新日志时隐藏但占位，
             保证右侧 scroll-hint 在 new-logs 出现/消失时水平位置稳定（不跳动）。 -->
        <span
          class="new-logs-slot"
          :class="{ 'has-new': hasNewLogs }"
          @click="hasNewLogs && void scrollConsoleToBottom()"
        >
          <span v-if="hasNewLogs" class="new-logs">
            <Icon name="chevron_down" :size="12" />
            <span>{{ i18n.t('msg_new_logs') }}</span>
          </span>
        </span>
        <span class="scroll-hint">{{ autoScroll ? i18n.t('msg_autoscroll_on') : i18n.t('msg_autoscroll_off') }}</span>
      </div>
      <div
        ref="consoleEl"
        class="console"
        @scroll="onScroll"
      >
        <span v-for="(line, idx) in renderedOutputs" :key="idx" :class="['output-line', lineClass(line)]">{{ line.data }}</span>
      </div>
    </Card>
    <!-- 性能测试（BenchPanel）已迁至「参数设置 → 性能测试」子标签（调参与测试强相关） -->
  </PageFrame>
</template>

<style scoped lang="scss">
/* 控制台 */
.console-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

/* new-logs 左槽位常驻：预留胶囊宽度，无新日志时隐藏但占位（scroll-hint 右缘稳定） */
.new-logs-slot {
  display: inline-flex;
  align-items: center;
  min-height: 22px; // 与胶囊行高一致，避免出现时撑高 header

  &:not(.has-new) {
    visibility: hidden; // 保留宽度占位，隐藏胶囊
  }
}

.new-logs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }
}

.scroll-hint {
  opacity: 0.7;
}

.log-count {
  font-family: var(--font-mono);
  color: var(--fg-muted);
  font-size: var(--fs-sm);
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
  user-select: text;
  -webkit-user-select: text;
  cursor: text;

  .output-line {
    white-space: pre-wrap;
    word-break: break-all;
    display: block;
    &.kind-error { color: var(--danger); }
    &.kind-warn { color: var(--warn); }
    &.kind-success { color: var(--success); }
    &.kind-info { color: var(--info); }
  }
}
</style>
