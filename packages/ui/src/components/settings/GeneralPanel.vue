<script setup lang="ts">
// 阶段三：设置页「常规」分组 —— 模型目录、llama 后端（引擎目录）+ 引擎检测、关闭窗口行为。
// 设计稿 §14.10 / 补充指南 §14.10：模型目录提供「打开目录」；
// 原独立「llama.cpp」标签（LlamaPanel）已整合为本卡片内的引擎目录行。
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { pickDir } from '@/composables/useFilePicker';
import type { CloseBehavior } from '@llama-launcher/shared';

const settings = useSettingsStore();
const i18n = useI18nStore();

// ---- 模型目录 ----
const modelsDir = computed<string>({
  get: () => settings.settings?.models_dir ?? '',
  set: (v) => { if (settings.settings) { settings.settings.models_dir = v; void settings.save(); } },
});

async function onBrowseModelDir() {
  const dir = await pickDir({ title: i18n.t('msg_select_dir'), defaultPath: modelsDir.value || undefined });
  if (dir) modelsDir.value = dir;
}

async function onOpenModelDir() {
  if (!modelsDir.value) return;
  try { await window.api.openPath(modelsDir.value); } catch { /* 静默 */ }
}

// ---- llama 后端：引擎目录 + 引擎检测（原 LlamaPanel 整合） ----
const llamaDir = computed<string>({
  get: () => settings.settings?.llama_dir ?? '',
  set: (v) => { if (settings.settings) { settings.settings.llama_dir = v; void settings.save(); } },
});

type ExeStatus = 'idle' | 'detecting' | 'ok' | 'missing' | 'not_found';
const exeStatus = ref<ExeStatus>('idle');
const detectedExePath = ref('');

async function detectExe() {
  const dir = llamaDir.value;
  if (!dir) {
    exeStatus.value = 'idle';
    detectedExePath.value = '';
    if (settings.settings && settings.settings.server_exe) {
      settings.settings.server_exe = '';
      void settings.save();
    }
    return;
  }
  exeStatus.value = 'detecting';
  let path = '';
  try {
    const result = await window.api.system.findLlamaExe(dir);
    path = typeof result === 'string' ? result : '';
    if (path) {
      let exists = false;
      try { exists = !!(await window.api.system.fileExists(path)); } catch { exists = false; }
      exeStatus.value = exists ? 'ok' : 'missing';
    } else {
      exeStatus.value = 'not_found';
    }
  } catch {
    path = '';
    exeStatus.value = 'not_found';
  }
  detectedExePath.value = path;
  if (settings.settings && path !== settings.settings.server_exe) {
    settings.settings.server_exe = path;
    void settings.save();
  }
}

let detectTimer: ReturnType<typeof setTimeout> | null = null;
watch(llamaDir, () => {
  if (detectTimer) clearTimeout(detectTimer);
  detectTimer = setTimeout(() => { detectTimer = null; void detectExe(); }, 400);
}, { immediate: true });

const exeBadge = computed<{ icon: string; cls: string; tip: string; label: string; spin?: boolean } | null>(() => {
  switch (exeStatus.value) {
    case 'idle':
      return { icon: 'info', cls: 'idle', tip: i18n.t('msg_no_exe_hint'), label: i18n.t('lbl_exe_state_idle') };
    case 'detecting':
      return { icon: 'refresh', cls: 'detecting', tip: i18n.t('msg_exe_detecting'), label: i18n.t('lbl_exe_state_detecting'), spin: true };
    case 'ok':
      return {
        icon: 'file_check', cls: 'ok',
        tip: detectedExePath.value
          ? i18n.t('lbl_exe_detected_path', [detectedExePath.value])
          : i18n.t('lbl_exe_state_ready'),
        label: i18n.t('lbl_exe_state_ready'),
      };
    case 'missing':
      return { icon: 'alert', cls: 'missing', tip: i18n.t('msg_exe_file_missing'), label: i18n.t('lbl_exe_state_missing') };
    default:
      return { icon: 'alert', cls: 'not_found', tip: i18n.t('msg_exe_not_found'), label: i18n.t('lbl_exe_state_not_found') };
  }
});

async function onBrowseExeDir() {
  const dir = await pickDir({ title: i18n.t('msg_select_exe_dir'), defaultPath: llamaDir.value || undefined });
  if (dir) llamaDir.value = dir;
}

async function onOpenLlamaReleases() {
  try { await window.api.openExternal('https://github.com/ggml-org/llama.cpp/releases'); } catch { /* 静默 */ }
}

// 悬浮帮助面板（引擎获取指引）
const helpVisible = ref(false);
const helpIconRef = ref<HTMLElement | null>(null);
const helpPanelStyle = ref<Record<string, string>>({});
let helpShowTimer: ReturnType<typeof setTimeout> | null = null;
let helpHideTimer: ReturnType<typeof setTimeout> | null = null;

const helpSteps = computed(() =>
  i18n.t('msg_exe_help_steps').split('\n').map((text, i) => ({ num: i + 1, text })),
);

function updateHelpPanelPosition() {
  if (!helpIconRef.value) return;
  const rect = helpIconRef.value.getBoundingClientRect();
  const width = 320;
  const left = Math.min(rect.right, window.innerWidth - width - 8);
  helpPanelStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(8, left)}px`,
    width: `${width}px`,
  };
}
function showHelp() {
  if (helpHideTimer) { clearTimeout(helpHideTimer); helpHideTimer = null; }
  if (helpShowTimer) return;
  helpShowTimer = setTimeout(() => {
    helpShowTimer = null;
    updateHelpPanelPosition();
    helpVisible.value = true;
  }, 300);
}
function hideHelp() {
  if (helpShowTimer) { clearTimeout(helpShowTimer); helpShowTimer = null; }
  if (helpHideTimer) clearTimeout(helpHideTimer);
  helpHideTimer = setTimeout(() => { helpHideTimer = null; helpVisible.value = false; }, 150);
}
function onHelpReposition() {
  if (helpVisible.value) updateHelpPanelPosition();
}
onMounted(() => {
  window.addEventListener('resize', onHelpReposition);
  window.addEventListener('scroll', onHelpReposition, true);
});
onUnmounted(() => {
  if (detectTimer) { clearTimeout(detectTimer); detectTimer = null; }
  if (helpShowTimer) clearTimeout(helpShowTimer);
  if (helpHideTimer) clearTimeout(helpHideTimer);
  window.removeEventListener('resize', onHelpReposition);
  window.removeEventListener('scroll', onHelpReposition, true);
});

// ---- 关闭窗口行为 ----
const closeBehavior = computed<CloseBehavior>({
  get: () => settings.settings?.close_behavior ?? 'ask',
  set: (v) => { if (settings.settings) { settings.settings.close_behavior = v; void settings.save(); } },
});
</script>

<template>
  <Card title-key="nav_settings_general">
    <template #title-extra>
      <span ref="helpIconRef" class="card-help-icon" @mouseenter="showHelp" @mouseleave="hideHelp">
        <Icon name="info" :size="13" />
      </span>
    </template>

    <a-form :model="{}" layout="horizontal" label-align="right"
            :label-col-style="{ flex: '0 1 110px', minWidth: '64px', marginRight: '8px' }"
            :wrapper-col-style="{ flex: '1 1 0', minWidth: '0' }">
      <a-form-item :label="i18n.t('lbl_dir_path')">
        <div class="path-row">
          <a-input v-model="modelsDir" class="path-input" size="small" />
          <a-button size="small" @click="onBrowseModelDir">
            <template #icon><Icon name="folder" :size="12" /></template>
            {{ i18n.t('btn_change_dir') }}
          </a-button>
          <a-button size="small" :disabled="!modelsDir" @click="onOpenModelDir" :title="i18n.t('btn_open_dir')">
            <template #icon><Icon name="folder_open" :size="12" /></template>
            {{ i18n.t('btn_open_dir') }}
          </a-button>
        </div>
      </a-form-item>

      <a-form-item :label="i18n.t('lbl_exe_dir')">
        <div class="path-row">
          <a-input v-model="llamaDir" class="path-input" size="small" />
          <a-button size="small" @click="onBrowseExeDir">
            <template #icon><Icon name="folder" :size="12" /></template>
            {{ i18n.t('btn_change_dir') }}
          </a-button>
          <ToolTip v-if="exeBadge" :text="exeBadge.tip">
            <span class="exe-status" :class="exeBadge.cls">
              <Icon :name="exeBadge.icon" :size="12" :class="{ spinning: exeBadge.spin }" />
              <span>{{ exeBadge.label }}</span>
            </span>
          </ToolTip>
        </div>
      </a-form-item>

      <a-form-item :label="i18n.t('lbl_close_behavior')">
        <a-select class="fc-select" v-model="closeBehavior" :style="{ width: '160px' }">
          <a-option value="ask">{{ i18n.t('opt_close_ask') }}</a-option>
          <a-option value="exit">{{ i18n.t('opt_close_exit') }}</a-option>
          <a-option value="tray">{{ i18n.t('opt_close_tray') }}</a-option>
        </a-select>
      </a-form-item>
    </a-form>

    <Teleport to="body">
      <div v-if="helpVisible" class="exe-help-panel" :style="helpPanelStyle"
           @mouseenter="showHelp" @mouseleave="hideHelp">
        <div v-for="step in helpSteps" :key="step.num" class="exe-help-step">
          <span class="exe-help-step-num">{{ step.num }}</span>
          <span class="exe-help-step-text">{{ step.text }}</span>
        </div>
        <a-button size="small" class="exe-help-open-btn" @click="onOpenLlamaReleases">
          <template #icon><Icon name="external" :size="12" /></template>
          {{ i18n.t('btn_open_llama_releases') }}
        </a-button>
      </div>
    </Teleport>
  </Card>
</template>

<style scoped lang="scss">
.path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

// 路径输入：Arco a-input（small=28px 与原自绘同高），仅保留布局尺寸与 mono 字体覆盖
// （input 原生不继承 font，mono 需打在内层 .arco-input 上，§7.5.1 路径一律 --font-mono）
.path-input {
  flex: 1 1 200px;
  min-width: 160px;
  max-width: 460px; // 限制最大宽度：避免宽窗口下路径输入框拉满整行，表单行节奏更紧凑
  :deep(.arco-input) {
    font-family: var(--font-mono);
    font-size: var(--fs-md);
  }
}

.exe-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  &.idle, &.detecting { color: var(--color-text-3); background: var(--color-fill-3); }
  &.ok { color: rgb(var(--success-6)); background: color-mix(in srgb, rgb(var(--success-6)) 14%, transparent); }
  &.missing { color: rgb(var(--danger-6)); background: color-mix(in srgb, rgb(var(--danger-6)) 14%, transparent); }
  &.not_found { color: rgb(var(--orange-6)); background: color-mix(in srgb, rgb(var(--orange-6)) 14%, transparent); }
}
/* 检测中图标走 Arco IconLoading 自带旋转动画（不再自定义 spin） */

.card-help-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 4px;
  color: var(--color-text-3);
  cursor: help;
  border-radius: var(--radius-pill);
  &:hover { color: rgb(var(--primary-6)); background: var(--color-fill-3); }
}
</style>

<style lang="scss">
.exe-help-panel {
  z-index: 9999;
  padding: 10px 12px;
  border-radius: var(--radius-row);
  // 实底浮层（STYLE_TODO #41 / §7.5.6）：可读性优先，不用半透明玻璃 + backdrop-filter
  background: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  box-shadow: var(--shadow-dropdown);
  animation: exe-help-panel-in var(--dur-fast) var(--ease-jelly);
}
@keyframes exe-help-panel-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.exe-help-panel .exe-help-step {
  display: flex;
  gap: 8px;
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--color-text-2);
  // 步骤间距单一机制：仅 margin-top 4px（间距刻度最小档），不再叠加 padding
  & + .exe-help-step { margin-top: 4px; }
}
.exe-help-panel .exe-help-step-num {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px; height: 18px;
  margin-top: 1px;
  border-radius: 50%;
  background: rgb(var(--primary-6));
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 600;
  line-height: 1;
}
.exe-help-panel .exe-help-step-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
</style>