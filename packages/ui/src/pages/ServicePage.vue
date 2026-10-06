<script setup lang="ts">
import { computed } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Card from '@/components/common/Card.vue';
import ConsolePanel from '@/components/common/ConsolePanel.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
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

const renderedLimit = 1000;
const renderedOutputs = computed(() => {
  const outs = server.outputs;
  return outs.length > renderedLimit ? outs.slice(-renderedLimit) : outs;
});

// 滚动（停用门控 / rAF 合帧 / 「有新日志」判定）一律由 ConsolePanel 内的 useAutoScroll 承担

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
        <ToolTip :text="i18n.t('copy_console')">
          <a-button
            size="small"
            :disabled="server.outputs.length === 0"
            @click="onCopyConsole"
          >
            <template #icon><Icon name="copy" :size="12" /></template>
            {{ i18n.t('copy_console') }}
          </a-button>
        </ToolTip>
        <ToolTip :text="i18n.t('clear_console')">
          <a-button size="small" class="clear-console" status="danger" @click="onClearConsole">
            <template #icon><Icon name="trash" :size="12" /></template>
            {{ i18n.t('clear_console') }}
          </a-button>
        </ToolTip>
        <span class="log-count">{{ logCount }} {{ i18n.t('col_lines') }}</span>
      </template>
      <!-- 控制台定高 320px（卡片体内不参与弹性）：高度由外层 class 给，面板本体不写 -->
      <ConsolePanel class="console-fixed" :count="server.outputs.length">
        <span v-for="line in renderedOutputs" :key="line.id" :class="['output-line', TONE_CLASS[line.tone]]">{{ line.data }}</span>
      </ConsolePanel>
    </Card>
  </PageFrame>
</template>

<style scoped lang="scss">
.console-fixed {
  height: 320px;
}

.log-count {
  font-family: var(--font-mono);
  color: var(--fg-hint);
  font-size: var(--fs-sm);
}

/* 卡片头「清空控制台」danger 按钮文字取角色色（Arco danger-6 作文字压 red-1 底实测 3.25，
   不达 §7.5.8 的 4.5）；底与边仍由 Arco 承载，禁用态保留 Arco 观感 */
.arco-card-header .clear-console:not([disabled]) {
  color: var(--fg-danger-text);
}

/* 后端原始输出一行一段；级别色由 ConsolePanel 打在行上（.kind-* → --log-kind-*），这里只留排版 */
.output-line {
  white-space: pre-wrap;
  word-break: break-all;
  display: block;
}
</style>
