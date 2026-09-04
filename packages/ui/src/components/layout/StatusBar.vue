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

const statusColor = computed(() => {
  const s = server.effectiveStatus;
  if (s === 'failed' || s === 'crashed') return 'var(--danger)';
  if (s === 'running') return 'var(--success)';
  if (s === 'starting' || s === 'stopping') return 'var(--warn)';
  return 'var(--fg-muted)';
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
      <span class="dot" :style="{ background: statusColor }"></span>
      <span class="status-text">{{ statusText }}</span>
      <span v-if="pidText" class="pid">{{ pidText }}</span>
      <span
        v-if="server.apiUrl"
        class="url clickable"
        :title="i18n.t('copy_url')"
        @click="onCopyUrl"
      >
        <span class="url-text">{{ server.apiUrl }}</span>
        <span v-if="copiedKey === 'url'" class="copied-tip">{{ i18n.t('msg_url_copied') }}</span>
      </span>
      <span
        v-if="params.get(MODEL_KEY)"
        class="model clickable"
        :title="i18n.t('copy_model')"
        @click="onCopyModel"
      >
        <span class="model-text">{{ modelName }}</span>
        <span v-if="copiedKey === 'model'" class="copied-tip">{{ i18n.t('msg_model_copied') }}</span>
      </span>
      <span v-else class="model">{{ modelName }}</span>
    </div>
    <div class="right">
      <span class="shortcut">{{ i18n.t('status_shortcut') }}</span>
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
  background: linear-gradient(90deg, var(--statusbar-blue), color-mix(in srgb, var(--statusbar-blue) 78%, var(--accent)));
  color: #ffffff;
  font-size: var(--fs-sm);
  font-family: var(--font-family);
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-text {
  font-weight: 600;
}

/* 状态栏文字全不透明纯白：蓝底（--statusbar-blue→accent 渐变）上纯白满不透明仅约 4.5:1（AA 下限），
   任何 opacity 降级都跌破 AA（原 .url/.model 0.85→~3.7:1、.shortcut 0.65→~2.6:1，蓝底上看不清）。
   视觉层级改由 .status-text 的 font-weight:600 承担，不再用不透明度削弱可读性。 */

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

.copied-tip {
  color: #fff;
  font-weight: 600;
  background: var(--success);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
</style>
