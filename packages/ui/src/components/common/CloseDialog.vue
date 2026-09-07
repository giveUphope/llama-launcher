<script setup lang="ts">
// 关闭窗口应用内弹窗：替代 Electron 原生 dialog（app-exit.ts 发送 WINDOW_SHOW_CLOSE_DIALOG 请求）。
// 两种模式：ask（close_behavior=ask 首次询问，含"记住选择"复选框）/ exit-confirm（模型服务运行中退出二次确认）。
// 已迁移到 Arco Modal：遮罩/动画/居中由 a-modal 承载，移除自定义 backdrop/panel。
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

// 点遮罩 / Esc / 关闭按钮 统一按「取消」处理（不应用响应，留在应用内）
function onMaskClose() {
  respond('cancel');
}

onMounted(() => window.api.window.onCloseDialog(onShow));
onUnmounted(() => {
  request.value = null;
});

const isAsk = () => request.value?.mode === 'ask';
</script>

<template>
  <a-modal
    class="fc-close-dialog"
    :visible="!!request"
    :style="{ width: '400px' }"
    :mask-closable="true"
    :esc-to-close="true"
    :closable="true"
    @cancel="onMaskClose"
  >
    <template #title>
      <span class="fc-dialog-title">
        <Icon :name="isAsk() ? 'info' : 'alert'" :size="16" :class="isAsk() ? 'fc-ico-info' : 'fc-ico-warn'" />
        <span>{{ isAsk() ? i18n.t('lbl_close_title') : i18n.t('dlg_close_service_title') }}</span>
      </span>
    </template>
    <p class="fc-dialog-msg">
      {{ isAsk() ? i18n.t('msg_close_ask') : i18n.t('dlg_close_service_msg') }}
    </p>
    <a-checkbox v-if="isAsk()" v-model="remember">
      {{ i18n.t('lbl_close_remember') }}
    </a-checkbox>
    <template #footer>
      <a-button v-if="isAsk()" @click="respond('tray')">{{ i18n.t('btn_close_tray') }}</a-button>
      <a-button v-else @click="respond('cancel')">{{ i18n.t('dlg_cancel') }}</a-button>
      <a-button type="primary" :status="isAsk() ? undefined : 'warning'" @click="respond('exit')">
        {{ i18n.t('btn_close_exit') }}
      </a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.fc-dialog-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.fc-ico-info { color: var(--accent); }
.fc-ico-warn { color: var(--warn-text); }
.fc-dialog-msg {
  margin: 0;
  font-size: var(--fs-base);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-secondary);
}
</style>