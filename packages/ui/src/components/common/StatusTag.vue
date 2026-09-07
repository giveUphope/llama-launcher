<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
  label: string;
}>();

const arcoStatus = computed(() => {
  if (props.status === 'ok') return 'success';
  if (props.status === 'warn') return 'warning';
  if (props.status === 'error') return 'danger';
  if (props.status === 'loading') return 'processing';
  return 'gray';
});
</script>

<template>
  <a-tag :color="arcoStatus" size="small" bordered>
    <template #icon><a-spin v-if="status === 'loading'" :size="10" /></template>
    {{ label }}
  </a-tag>
</template>
