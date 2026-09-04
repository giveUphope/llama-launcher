<script setup lang="ts">
// 关闭窗口应用内弹窗：替代 Electron 原生 dialog（app-exit.ts 发送 WINDOW_SHOW_CLOSE_DIALOG 请求）。
// 两种模式：ask（close_behavior=ask 首次询问，含"记住选择"复选框）/ exit-confirm（模型服务运行中退出二次确认）。
// 风格与 ConfirmModal 一致（遮罩 + 毛玻璃面板 + 语义按钮），图标走 Icon 组件而非 emoji。
import { ref, onMounted, onUnmounted } from 'vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';
import type { CloseDialogRequest, CloseDialogResult } from '@llama-launcher/shared';

const i18n = useI18nStore();

const request = ref<CloseDialogRequest | null>(null);
const remember = ref(false);

function onShow(req: CloseDialogRequest) {
  request.value = req;
  remember.value = false;
}

function respond(action: CloseDialogResult['action']) {
  const req = request.value;
  request.value = null;
  if (!req) return;
  void window.api.window.respondCloseDialog(req.id, action, action === 'exit' ? remember.value : false);
}

onMounted(() => window.api.window.onCloseDialog(onShow));
onUnmounted(() => {
  request.value = null;
});

const isAsk = () => request.value?.mode === 'ask';
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="request"
        class="modal-backdrop"
        @click.self="respond('cancel')"
      >
        <div
          class="modal-panel"
          :class="`variant-${isAsk() ? 'info' : 'warning'}`"
          role="dialog"
          aria-modal="true"
        >
          <div class="modal-head">
            <span class="modal-icon">
              <Icon :name="isAsk() ? 'info' : 'alert'" :size="16" />
            </span>
            <h3 class="modal-title">
              {{ isAsk() ? i18n.t('lbl_close_title') : i18n.t('dlg_close_service_title') }}
            </h3>
          </div>
          <div class="modal-body">
            <p class="modal-message">
              {{ isAsk() ? i18n.t('msg_close_ask') : i18n.t('dlg_close_service_msg') }}
            </p>
            <label v-if="isAsk()" class="remember-row">
              <input type="checkbox" v-model="remember" />
              <span>{{ i18n.t('lbl_close_remember') }}</span>
            </label>
          </div>
          <div class="modal-actions">
            <button
              v-if="isAsk()"
              class="modal-btn ghost"
              @click="respond('tray')"
            >
              {{ i18n.t('btn_close_tray') }}
            </button>
            <button
              v-else
              class="modal-btn ghost"
              @click="respond('cancel')"
            >
              {{ i18n.t('dlg_cancel') }}
            </button>
            <button
              class="modal-btn primary"
              :class="{ warning: !isAsk() }"
              @click="respond('exit')"
            >
              {{ isAsk() ? i18n.t('btn_close_exit') : i18n.t('btn_close_exit') }}
            </button>
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
  // 遮罩暗底 + 模糊移到 ::before 独立叶子层：panel 文字不再落入 backdrop-filter 合成层
  // 而失去亚像素抗锯齿发虚（与 #41「下拉实底」同理；§7.5.6 弹窗背板 blur 视觉语义不变）
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--overlay);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
  }
}

.modal-panel {
  position: relative; // 置于 backdrop::before 遮罩层之上（文字保持锐利）
  z-index: 1;
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
  line-height: 1;
  color: var(--accent);
}
.variant-warning .modal-icon { color: var(--warn-text); }

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

/* "记住我的选择"复选框行（ask 模式） */
.remember-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: var(--fs-base);
  color: var(--fg-secondary);
  cursor: pointer;
  user-select: none;

  input[type='checkbox'] {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }
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
  transform: scale(0.96);
}
</style>
