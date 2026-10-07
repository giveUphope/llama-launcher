<script setup lang="ts">
import { computed } from 'vue';
import { icons, FALLBACK_ICON, type IconName } from './icon-map';

const props = withDefaults(defineProps<{
  name: IconName;
  size?: number;
}>(), { size: 18 });

const component = computed(() => icons[props.name] ?? FALLBACK_ICON);
</script>

<template>
  <component :is="component" class="icon" :style="{ fontSize: `${size}px` }" aria-hidden="true" />
</template>

<style scoped>
/* 图标居中交给各容器（Arco button/menu 有自带 vertical-align 校准如 -2px），
   此处不得设 vertical-align: middle——会以更高特异性覆盖 Arco 校准，
   导致按钮内图标相对文本偏下 ~1.5px（历史：tb-model 等按钮图标与文本不齐） */
.icon { display: inline-flex; flex-shrink: 0; }
</style>
