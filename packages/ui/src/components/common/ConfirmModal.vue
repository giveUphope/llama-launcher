<script setup lang="ts">
import { computed } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import { useConfirmQueue, type ConfirmVariant } from '@/composables/useConfirm';
import { useDialogFocus } from '@/composables/useDialogFocus';

const i18n = useI18nStore();
const { queue, resolve } = useConfirmQueue();
const current = computed(() => queue.value[0] ?? null);
const visible = computed(() => Boolean(current.value));
const { titleId } = useDialogFocus({ visible, containerClass: 'fc-confirm-modal' });

function buttonStatus(variant?: ConfirmVariant | 'primary' | 'danger' | 'warning' | 'ghost') {
  return variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : undefined;
}

// 实底强调色按钮的「底 + 字」配对：Arco 的 solid danger/warning 是「白字压 danger-6 / orange-6」，
// 实测浅色 3.71 / 2.57、深色更低，都不达 §7.5.8 的 4.5，故改用 theme.scss 的配对 token
// （浅色取更深一档底配白字，深色改浅底配深字）。尺寸、圆角、边框仍由 Arco 承载。
function solidFillClass(variant?: ConfirmVariant | 'primary' | 'danger' | 'warning' | 'ghost') {
  if (variant === 'danger') return 'solid-danger';
  if (variant === 'warning') return 'solid-warning';
  return '';
}
</script>

<template>
  <a-modal
    class="fc-confirm-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    :aria-labelledby="titleId"
    :visible="visible"
    :mask-closable="true"
    :esc-to-close="true"
    :closable="false"
    :footer="false"
    @cancel="current && resolve(current.id, current.actions?.length ? '' : false)"
  >
    <!-- 标题改插槽而非 :title prop：为的是给标题节点一个可引用的 id（aria-labelledby 用），
         Arco 渲染出的 .arco-modal-title 结构与文案不变 -->
    <template #title><span :id="titleId">{{ current?.title }}</span></template>
    <p v-if="current" class="confirm-message">{{ current.message }}</p>
    <template v-if="current">
      <div class="confirm-actions">
        <template v-if="current.actions?.length">
          <a-button
            v-for="action in current.actions"
            :key="action.key"
            :class="solidFillClass(action.variant)"
            :type="action.variant === 'ghost' ? 'secondary' : 'primary'"
            :status="buttonStatus(action.variant)"
            @click="resolve(current.id, action.key)"
          >{{ i18n.t(action.labelKey) }}</a-button>
        </template>
        <template v-else>
          <a-button v-if="current.showCancel !== false" @click="resolve(current.id, false)">
            {{ i18n.t(current.cancelKey ?? 'dlg_cancel') }}
          </a-button>
          <a-button
            type="primary"
            :class="solidFillClass(current.variant)"
            :status="buttonStatus(current.variant)"
            @click="resolve(current.id, true)"
          >
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

/* 实底 danger / warning 按钮的「底 + 字」配对取 theme.scss 的角色 token（配对值见其注释）；
   :not([disabled]) 保留 Arco 的禁用观感，边框/尺寸/圆角不覆写 */
.confirm-actions .solid-warning:not([disabled]) {
  background-color: var(--btn-warning-fill);
  color: var(--btn-warning-fg);
}

.confirm-actions .solid-danger:not([disabled]) {
  background-color: var(--btn-danger-fill);
  color: var(--btn-danger-fg);
}
</style>
