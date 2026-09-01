<script setup lang="ts">
import { computed } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import { useConfirmQueue, type ConfirmVariant } from '@/composables/useConfirm';
import Icon from './Icon.vue';

const i18n = useI18nStore();
const { queue, resolve } = useConfirmQueue();

// 仅展示队首弹窗（其余排队等待）
const current = computed(() => queue.value[0] ?? null);

// 弹窗类型 → Icon 图标名（§7「不使用 Emoji 作为正式功能图标」）
const iconMap: Record<ConfirmVariant, string> = {
  info: 'info',
  warning: 'alert',
  danger: 'error',
};

function confirmText(key?: string): string {
  return i18n.t(key ?? 'dlg_confirm');
}
function cancelText(key?: string): string {
  return i18n.t(key ?? 'dlg_cancel');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="current" class="modal-backdrop" @click.self="current.showCancel !== false && resolve(current.id, false)">
        <div class="modal-panel" :class="`variant-${current.variant ?? 'info'}`" role="dialog" aria-modal="true">
          <div class="modal-head">
            <span class="modal-icon">
              <Icon :name="iconMap[(current.variant ?? 'info') as ConfirmVariant]" :size="20" />
            </span>
            <h3 class="modal-title">{{ current.title }}</h3>
          </div>
          <div class="modal-body">
            <p class="modal-message">{{ current.message }}</p>
          </div>
          <div class="modal-actions">
            <button
              v-if="current.showCancel !== false"
              class="modal-btn ghost"
              @click="resolve(current.id, false)"
            >{{ cancelText(current.cancelKey) }}</button>
            <button
              class="modal-btn primary"
              :class="{ danger: current.variant === 'danger', warning: current.variant === 'warning' }"
              @click="resolve(current.id, true)"
            >{{ confirmText(current.confirmKey) }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(var(--glass-blur));
}

.modal-panel {
  width: min(440px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  overflow: auto;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-modal);
  padding: 18px 20px 16px;
  color: var(--fg-primary);
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.modal-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}
.variant-warning .modal-icon { color: var(--warn); }
.variant-danger .modal-icon { color: var(--danger); }

.modal-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--fg-primary);
}

.modal-message {
  margin: 0;
  font-size: var(--fs-base);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-secondary);
}

.modal-actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.modal-btn {
  min-width: 84px;
  height: 32px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

}

.modal-btn.primary {
  background: var(--primary-bg);
  color: var(--primary-fg);
  &:hover { background: var(--primary-hover); }
  &:active { background: var(--primary-pressed); }
}
.modal-btn.primary.warning {
  background: var(--warn);
  color: #1a1a1a;
  &:hover { filter: brightness(1.08); }
}
.modal-btn.primary.danger {
  background: var(--danger);
  color: #fff;
  &:hover { background: var(--danger-hover); }
}

.modal-btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--fg-secondary);
  &:hover { background: var(--bg-hover); }
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity var(--dur-med) var(--ease-smooth);
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-active .modal-panel,
.modal-fade-leave-active .modal-panel {
  transition: transform var(--dur-med) var(--ease-jelly);
}
.modal-fade-enter-from .modal-panel,
.modal-fade-leave-to .modal-panel {
  transform: translateY(12px) scale(0.96);
}
</style>
