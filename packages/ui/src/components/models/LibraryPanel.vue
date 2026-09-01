<script setup lang="ts">
// 模型库（远程模型浏览）面板：Models 页「模型库」子标签。
// 沿用 DownloadCard 既有 URL 解析 + 搜索 + 文件选择 + 启动下载全流程。
import PageFrame from '@/components/common/PageFrame.vue';
import DownloadCard from '@/components/common/DownloadCard.vue';
</script>

<template>
  <PageFrame>
    <DownloadCard />
  </PageFrame>
</template>
