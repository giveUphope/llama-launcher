<script setup lang="ts">
import { computed } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import { useConfirmQueue, type ConfirmVariant } from '@/composables/useConfirm';

const i18n = useI18nStore();
const { queue, resolve } = useConfirmQueue();
const current = computed(() => queue.value[0] ?? null);

function buttonStatus(variant?: ConfirmVariant | 'primary' | 'danger' | 'warning' | 'ghost') {
  return variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : undefined;
}
</script>

<template>
  <a-modal
    :visible="Boolean(current)"
    :title="current?.title"
    :mask-closable="true"
    :esc-to-close="true"
    :closable="false"
    :footer="false"
    @cancel="current && resolve(current.id, current.actions?.length ? '' : false)"
  >
    <p v-if="current" class="confirm-message">{{ current.message }}</p>
    <template v-if="current">
      <div class="confirm-actions">
        <template v-if="current.actions?.length">
          <a-button
            v-for="action in current.actions"
            :key="action.key"
            :type="action.variant === 'ghost' ? 'secondary' : 'primary'"
            :status="buttonStatus(action.variant)"
            @click="resolve(current.id, action.key)"
          >{{ i18n.t(action.labelKey) }}</a-button>
        </template>
        <template v-else>
          <a-button v-if="current.showCancel !== false" @click="resolve(current.id, false)">
            {{ i18n.t(current.cancelKey ?? 'dlg_cancel') }}
          </a-button>
          <a-button type="primary" :status="buttonStatus(current.variant)" @click="resolve(current.id, true)">
            {{ i18n.t(current.confirmKey ?? 'dlg_confirm') }}
          </a-button>
        </template>
      </div>
    </template>
  </a-modal>
</template>

<style scoped>
.confirm-message {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
</style>
