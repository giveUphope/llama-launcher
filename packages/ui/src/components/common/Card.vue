<script setup lang="ts">
import { computed } from 'vue';
import { useI18nStore } from '@/stores/i18n';

const props = defineProps<{
  titleKey?: string;
}>();
const i18n = useI18nStore();
const title = computed(() => (props.titleKey ? i18n.t(props.titleKey) : ''));
</script>

<template>
  <a-card class="section-card" :bordered="true">
    <template v-if="titleKey || $slots.actions" #title>
      <a-space>
        <span v-if="titleKey">{{ title }}</span>
        <slot name="title-extra" />
      </a-space>
    </template>
    <template v-if="$slots.actions" #extra><slot name="actions" /></template>
    <slot />
  </a-card>
</template>

<style scoped>
.section-card {
  margin-bottom: 16px;
}
</style>
