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
    <!-- 操作区统一 a-space（卡片头操作 gap 6px，§7.5.4）：按钮/计数等子元素间距由组件承载，
         避免各页面 actions 内容紧贴 -->
    <template v-if="$slots.actions" #extra>
      <a-space :size="6">
        <slot name="actions" />
      </a-space>
    </template>
    <slot />
  </a-card>
</template>

<style scoped>
.section-card {
  margin-bottom: 16px;
}
</style>
