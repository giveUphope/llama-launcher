<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, modelBaseName } from '@llama-launcher/shared';

const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();

const statusText = computed(() => {
  const s = server.effectiveStatus;
  if (s === 'crashed') return i18n.t('svc_status_crashed');
  if (s === 'failed') return i18n.t('svc_status_failed');
  if (s === 'running') return i18n.t('status_running');
  if (s === 'starting' || s === 'stopping') return i18n.t('status_starting');
  return i18n.t('status_stopped');
});

// 状态色映射为 Arco 状态语义色（a-tag color），浅色/深色主题由 Arco 令牌自动适配
const statusColor = computed(() => {
  const s = server.effectiveStatus;
  if (s === 'failed' || s === 'crashed') return 'danger';
  if (s === 'running') return 'success';
  if (s === 'starting' || s === 'stopping') return 'warning';
  return 'gray';
});

const pidText = computed(() => {
  if (server.pid != null) return i18n.t('status_pid', [server.pid]);
  return '';
});

// 优先使用用户设置的模型别名（alias 参数），无别名时回退到文件名（去 .gguf 后缀）
const modelName = computed(() => {
  const alias = String(params.values['alias'] ?? '').trim();
  if (alias) return alias;
  const m = params.get(MODEL_KEY);
  if (!m) return i18n.t('status_model_none');
  return modelBaseName(String(m));
});

// 复制反馈状态
const copiedKey = ref<'url' | 'model' | null>(null);
let copiedTimer: number | null = null;

async function copyText(text: string, key: 'url' | 'model') {
  if (!text) return;
  await window.api.clipboard.write(text);
  copiedKey.value = key;
  if (copiedTimer != null) window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copiedKey.value = null;
  }, 1200);
}

async function onCopyUrl() {
  if (server.apiUrl) await copyText(server.apiUrl, 'url');
}

async function onCopyModel() {
  if (modelName.value) await copyText(modelName.value, 'model');
}

onUnmounted(() => {
  if (copiedTimer != null) {
    window.clearTimeout(copiedTimer);
    copiedTimer = null;
  }
});
</script>

<template>
  <footer class="statusbar">
    <div class="left">
      <!-- 状态：a-tag 承载动作状态色胶囊 + Arco 状态文案（替代手写状态圆点/文本） -->
      <a-tag :color="statusColor" size="small">{{ statusText }}</a-tag>
      <a-typography-text v-if="pidText" class="pid">{{ pidText }}</a-typography-text>
      <span
        v-if="server.apiUrl"
        class="url clickable"
        :title="i18n.t('copy_url')"
        @click="onCopyUrl"
      >
        <span class="url-text">{{ server.apiUrl }}</span>
        <a-tag v-if="copiedKey === 'url'" size="small" color="success">{{ i18n.t('msg_url_copied') }}</a-tag>
      </span>
      <span
        v-if="params.get(MODEL_KEY)"
        class="model clickable"
        :title="i18n.t('copy_model')"
        @click="onCopyModel"
      >
        <span class="model-text">{{ modelName }}</span>
        <a-tag v-if="copiedKey === 'model'" size="small" color="success">{{ i18n.t('msg_model_copied') }}</a-tag>
      </span>
      <span v-else class="model">{{ modelName }}</span>
    </div>
    <div class="right">
      <a-typography-text class="shortcut">{{ i18n.t('status_shortcut') }}</a-typography-text>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.statusbar {
  height: var(--statusbar-h);
  flex: 0 0 var(--statusbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  /* 语义主色保留，叠一层向强调色过渡的微妙渐变 */
  background: linear-gradient(90deg, var(--statusbar-blue), color-mix(in srgb, var(--statusbar-blue) 78%, rgb(var(--primary-6))));
  color: #ffffff;
  font-size: var(--fs-sm);
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 可点击复制项 */
.clickable {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  margin: -2px -6px;
  border-radius: var(--radius-pill);
  position: relative;
  transition: background var(--dur-fast) var(--ease-smooth), opacity var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--statusbar-hover);
    opacity: 1;
  }
}
</style>
