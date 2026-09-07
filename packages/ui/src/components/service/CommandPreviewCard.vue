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
    <!-- 复制命令上移至卡片头（与标题同行，§7.5.4 卡片头操作区） -->
    <template #actions>
      <a-button size="small" :disabled="!fullCommand" @click="onCopyCmd">
        <template #icon><Icon name="copy" :size="12" /></template>
        {{ i18n.t('copy_cmd') }}
      </a-button>
    </template>
    <div class="cmd-wrap">
      <!-- 内置参数命令：只读展示，随参数实时自动生成 -->
      <div class="cmd-section">
        <span class="cmd-section-label">{{ i18n.t('lbl_cmd_builtin') }}</span>
        <a-textarea
          class="cmd-preview"
          :model-value="commandPreview"
          :placeholder="i18n.t('msg_cmd_preview_placeholder')"
          :auto-size="{ minRows: 4, maxRows: 12 }"
          :textarea-attrs="{ readonly: true, spellcheck: false }"
        />
      </div>

      <!-- 扩展参数：唯一可编辑区，持久化，追加到实际启动命令末尾 -->
      <div class="cmd-section">
        <span class="cmd-section-label">{{ i18n.t('lbl_cmd_extra') }}</span>
        <a-textarea
          class="cmd-preview"
          v-model="extraArgs"
          :placeholder="i18n.t('cmd_extra_placeholder')"
          :auto-size="{ minRows: 2, maxRows: 8 }"
          :textarea-attrs="{ spellcheck: false }"
        />
        <div class="cmd-hint">
          <Icon name="info" :size="11" />
          <span>{{ i18n.t('cmd_extra_hint') }}</span>
        </div>
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
  color: var(--color-text-2);
  font-weight: 600;
}

// 命令预览框：Arco a-textarea（class 落在 wrapper）+ 恒定深色控制台表面（§7.5.1，
// 双主题不变）。auto-size 按内容自动增高（min/max 行数封顶），多行容器圆角走
// --radius-row（§7.5.3 禁 pill）。
.cmd-preview {
  background: var(--console-bg);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);

  :deep(.arco-textarea) {
    padding: 8px 10px;
    background: transparent;
    color: var(--console-fg);
    font-family: var(--font-mono);
    font-size: var(--fs-base);
    line-height: 1.5;
    resize: none; // auto-size 已按内容增高，禁手动拖拽（避免与 mirror 高度互相打架）
    word-break: break-all;

    // 占位符：恒深底上统一对比度（console-fg 半透明），避免空态两框观感不一致
    &::placeholder {
      color: color-mix(in srgb, var(--console-fg) 60%, transparent);
      opacity: 1; // Firefox 默认把 placeholder 再降 opacity
    }

    // 只读内置命令：不可编辑，光标默认、文字仍可选中复制。
    // 文字色与可编辑框统一用 --console-fg（配合恒定深底 --console-bg），
    // 不能用 --fg-secondary——浅色主题下它是深灰，深底上对比度不足。
    &[readonly] {
      cursor: default;
    }
  }

  // 聚焦描边打在 wrapper 边框上（边框由 wrapper 承载，内层无边框）
  &:focus-within {
    border-color: rgb(var(--primary-6));
  }
}

.cmd-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--color-text-3);
}
</style>
