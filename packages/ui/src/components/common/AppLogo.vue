<script setup lang="ts">
// 应用 Logo 唯一呈现组件：所有出现位置（TopBar / 关于页品牌头 / favicon 同源）
// 统一使用同一 svg 资源与胶囊圆角；尺寸按场景以 prop 指定。
import appIcon from '@/assets/app-icon.svg';

withDefaults(defineProps<{ size?: number }>(), { size: 20 });
</script>

<template>
  <img class="app-logo" :src="appIcon" :width="size" :height="size" alt="" draggable="false" />
</template>

<style scoped lang="scss">
.app-logo {
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  -webkit-user-drag: none;
  user-select: none;
}
</style>
