<script setup lang="ts">
defineProps<{
  text: string;
}>();
</script>

<template>
  <a-tooltip :content="text" position="top" :mini="true">
    <span class="tooltip-host"><slot /></span>
  </a-tooltip>
</template>

<style scoped>
.tooltip-host {
  display: inline-flex;
  min-width: 0;
}
</style>
