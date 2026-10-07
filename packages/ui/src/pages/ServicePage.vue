<script setup lang="ts">
import PageFrame from '@/components/common/PageFrame.vue';
import CommandPreviewCard from '@/components/service/CommandPreviewCard.vue';
import ParamSummaryCard from '@/components/service/ParamSummaryCard.vue';
import TrashCleanCard from '@/components/service/TrashCleanCard.vue';

// 服务运行状态（状态/模型/API 地址/主机/端口/PID/运行时长/基线徽章）已迁至
// 概览页 ServiceStatusCard（页面级唯一展示区，避免两页重复显示同一组信息）；
// 后端 llama-server 原始输出的控制台已迁至「日志」页（2026-10-07 档 B：一类信息一个出口，
// 复制/清空按钮不再在两页各有一份）。本页只剩三张操作卡。
</script>

<template>
  <PageFrame>
    <!-- 阶段四：从 LaunchPage 迁入的命令预览与参数摘要 -->
    <CommandPreviewCard />
    <ParamSummaryCard />
    <TrashCleanCard />
  </PageFrame>
</template>
