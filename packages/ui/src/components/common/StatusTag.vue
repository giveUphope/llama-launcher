<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;     // 'ok' | 'warn' | 'error' | 'idle' | 'loading'
  label: string;      // 文字标签
}>();

const cls = computed(() => `status-tag status-${props.status}`);

const dotColor = computed(() => {
  switch (props.status) {
    case 'ok': return 'var(--success)';
    case 'warn': return 'var(--warn)';
    case 'error': return 'var(--danger)';
    case 'loading': return 'var(--info)';
    default: return 'var(--fg-muted)';
  }
});
</script>

<template>
  <span :class="cls" role="status">
    <span v-if="status === 'loading'" class="status-dot spin"></span>
    <span v-else class="status-dot" :style="{ background: dotColor }"></span>
    <span>{{ label }}</span>
  </span>
</template>

<style scoped lang="scss">
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
}

.status-ok {
  color: var(--success-text);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}

.status-warn {
  color: var(--warn-text);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}

.status-error {
  color: var(--danger-text);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.status-idle {
  color: var(--fg-muted);
  background: var(--bg-hover);
}

.status-loading {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 14%, transparent);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.spin {
  animation: dot-pulse 1.2s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
</style>
