<script setup lang="ts">
// 模型库（远程模型浏览）面板：Models 页「模型库」子标签。
// 沿用 DownloadCard 既有 URL 解析 + 搜索 + 文件选择 + 启动下载全流程。
import { onActivated, onDeactivated } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import DownloadCard from '@/components/common/DownloadCard.vue';
import { useDownloadStore } from '@/stores/download';

const download = useDownloadStore();

// 进度静默门控（G3）：停在「本地模型」页签或其他页面时跳过高频进度应用，
// 隐藏的任务行不随每次进度推送重渲染；回签即解除（≤120ms 采样节拍内字节计数自愈），
// 终态事件（完成/失败/取消移除）不受门控影响，状态始终正确
onActivated(() => download.setProgressMuted(false));
onDeactivated(() => download.setProgressMuted(true));
</script>

<template>
  <PageFrame>
    <DownloadCard />
  </PageFrame>
</template>
