<script setup lang="ts">
import { ref, onUnmounted } from 'vue';

const props = defineProps<{
  text: string;
}>();

const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function show() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    visible.value = true;
  }, 500);
}

function hide() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  visible.value = false;
}

onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <span class="tooltip-host" @mouseenter="show" @mouseleave="hide">
    <slot />
    <transition name="fade">
      <span v-if="visible && text" class="tooltip">{{ text }}</span>
    </transition>
  </span>
</template>

<style scoped lang="scss">
.tooltip-host {
  position: relative;
  display: inline-flex;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  // 左边缘锚定（而非居中）：气泡只向右生长，绝不向左越出内容区而撞上侧边栏；
  // 否则居中锚定在左边缘参数上会向左溢出，被内容区 overflow 在侧边栏边界处裁掉
  left: 0;
  background: var(--tooltip-bg);
  color: var(--tooltip-fg);
  font-size: var(--fs-sm);
  line-height: 1.4;
  padding: 6px 12px;
  // 方形圆角（浮层层级对应下拉面板的 --radius-row），不用胶囊 --radius-pill
  border-radius: var(--radius-row);
  // 标签列 text-align: right 会继承进来——多行气泡内容强制左对齐，避免右对齐错位
  text-align: left;
  white-space: pre-wrap;
  max-width: 280px;
  width: max-content;
  pointer-events: none;
  z-index: 1000;
  box-shadow: var(--shadow-tooltip);
  border: 1px solid var(--glass-border);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-med) var(--ease-smooth), transform var(--dur-med) var(--ease-jelly);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(3px) scale(0.96);
}
</style>
