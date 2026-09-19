<script setup lang="ts">
defineProps<{
  text: string;
}>();
</script>

<template>
  <a-tooltip position="top" :mini="true">
    <template #content>
      <span class="tooltip-text">{{ text }}</span>
    </template>
    <span class="tooltip-host"><slot /></span>
  </a-tooltip>
</template>

<style scoped>
.tooltip-host {
  display: inline-flex;
  min-width: 0;
}

/* 浮层传的是带 \n 的多段文本（标签 / 值 / 操作提示），Arco tooltip 默认 white-space: normal
   会把换行折成空格；popup 传送到 body，故写在内容插槽的自有元素上（scoped 属性仍随元素走）。 */
.tooltip-text {
  white-space: pre-line;
}
</style>
