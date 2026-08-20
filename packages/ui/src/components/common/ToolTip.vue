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
  left: 50%;
  transform: translateX(-50%);
  background: var(--tooltip-bg);
  color: var(--tooltip-fg);
  font-size: var(--fs-sm);
  line-height: 1.4;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
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
  transition: opacity var(--dur-med) var(--ease-jelly), transform var(--dur-med) var(--ease-jelly);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(3px) scale(0.96);
}
</style>
