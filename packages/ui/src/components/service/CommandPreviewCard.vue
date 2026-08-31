<script setup lang="ts">
// 阶段四：命令预览卡（从原 LaunchPage 迁入 ServicePage）。
// 双文本框，职责清晰：
//  - 【内置参数命令】：只读展示，由参数表实时自动生成（previewCommand，不含扩展参数）。
//    不可编辑——要改内置参数请去参数设置页控件；本框永远与 store 同步，无需「还原」。
//  - 【扩展参数】：唯一可编辑区，绑定 settings.custom_args（持久化），原样追加到实际
//    启动命令末尾（buildCommand customArgs）。
// 复制命令 = 内置命令 + 扩展参数合并。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();

// 内置参数命令（只读展示）
const commandPreview = ref('');

async function updatePreview() {
  if (!settings.settings) {
    commandPreview.value = '';
    return;
  }
  try {
    commandPreview.value = await server.previewCommand(params.snapshot(), settings.settings);
  } catch (err: any) {
    // 生成失败时给出友好提示（i18n），不直接暴露底层错误文本
    commandPreview.value = i18n.t('msg_cmd_preview_error').replace('{0}', err?.message ?? String(err));
  }
}

// 高频参数变更防抖（150ms 合并）：拖滑块/应用预设时 params 频繁变化，
// 避免每次变更都走 IPC + 整页重渲染
const PREVIEW_DEBOUNCE_MS = 150;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    void updatePreview();
  }, PREVIEW_DEBOUNCE_MS);
}

watch(() => params.values, schedulePreview, { deep: true, immediate: true });
watch(() => settings.settings, schedulePreview, { deep: true });

// ---- 扩展参数框（绑定 settings.custom_args，持久化）----
const extraArgs = computed<string>({
  get: () => settings.settings?.custom_args ?? '',
  set: (v) => {
    if (!settings.settings) return;
    settings.settings.custom_args = v;
    void settings.save();
  },
});

// 复制/展示用完整命令 = 内置 + 扩展
const fullCommand = computed(() => {
  const extra = extraArgs.value.trim();
  return extra ? `${commandPreview.value} ${extra}` : commandPreview.value;
});

async function onCopyCmd() {
  if (!fullCommand.value) return;
  await window.api.clipboard.write(fullCommand.value);
}

// Ctrl+Shift+C 全局快捷键（App.vue 派发）→ 复制当前命令预览
onMounted(() => {
  window.addEventListener('app:copy-command', onCopyCmd);
});
onUnmounted(() => {
  window.removeEventListener('app:copy-command', onCopyCmd);
  if (previewTimer) clearTimeout(previewTimer);
});
</script>

<template>
  <Card title-key="card_cmd">
    <div class="cmd-wrap">
      <!-- 内置参数命令：只读展示，随参数实时自动生成 -->
      <div class="cmd-section">
        <span class="cmd-section-label">{{ i18n.t('lbl_cmd_builtin') }}</span>
        <textarea
          class="cmd-preview"
          :value="commandPreview"
          :placeholder="i18n.t('msg_cmd_preview_placeholder')"
          rows="4"
          spellcheck="false"
          readonly
        ></textarea>
      </div>

      <!-- 扩展参数：唯一可编辑区，持久化，追加到实际启动命令末尾 -->
      <div class="cmd-section">
        <span class="cmd-section-label">{{ i18n.t('lbl_cmd_extra') }}</span>
        <textarea
          class="cmd-preview"
          v-model="extraArgs"
          :placeholder="i18n.t('cmd_extra_placeholder')"
          rows="2"
          spellcheck="false"
        ></textarea>
        <div class="cmd-hint">
          <Icon name="info" :size="11" />
          <span>{{ i18n.t('cmd_extra_hint') }}</span>
        </div>
      </div>

      <div class="cmd-actions">
        <button class="action-btn" :disabled="!fullCommand" @click="onCopyCmd">
          <Icon name="copy" :size="12" />
          <span>{{ i18n.t('copy_cmd') }}</span>
        </button>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.cmd-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cmd-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cmd-section-label {
  font-size: var(--fs-sm);
  color: var(--fg-secondary);
  font-weight: 600;
}

.cmd-preview {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  padding: 8px 10px;
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;

  // 只读内置命令：不可编辑，光标默认、文字仍可选中复制
  &[readonly] {
    cursor: default;
    color: var(--fg-secondary);
  }

  &:focus {
    outline: none;
    border-color: var(--accent);
  }
}

.cmd-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

.cmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
