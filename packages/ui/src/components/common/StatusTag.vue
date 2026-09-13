<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
  label: string;
}>();

// 状态色映射为 a-tag 预设物理色——Arco Tag 仅认 13 个预设色名（red/green/…/gray），
// success/warning/danger/processing 语义名会落入 custom-color 分支（bg 内联为非法
// CSS 颜色被丢弃），浅灰底 + 继承文字色在深浅色下都不可读
const arcoStatus = computed(() => {
  if (props.status === 'ok') return 'green';
  if (props.status === 'warn') return 'orange';
  if (props.status === 'error') return 'red';
  if (props.status === 'loading') return 'arcoblue';
  return 'gray';
});
</script>

<template>
  <a-tag :color="arcoStatus" size="small" bordered>
    <template #icon><a-spin v-if="status === 'loading'" :size="10" /></template>
    {{ label }}
  </a-tag>
</template>
