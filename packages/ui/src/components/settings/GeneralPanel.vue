<script setup lang="ts">
// 阶段三：设置页「常规」分组 —— 模型目录、llama 后端（引擎目录）+ 引擎检测、关闭窗口行为。
// 设计稿 §14.10 / 补充指南 §14.10：模型目录提供「打开目录」；
// 原独立「llama.cpp」标签（LlamaPanel）已整合为本卡片内的引擎目录行。
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import Card from '@/components/common/Card.vue';
import InfoStrip from '@/components/common/InfoStrip.vue';
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

    <InfoStrip :label="i18n.t('lbl_dir_path')">
      <div class="path-row">
        <input class="path-input" type="text" v-model="modelsDir" />
        <button class="action-btn" @click="onBrowseModelDir">
          <Icon name="folder" :size="12" />
          <span>{{ i18n.t('btn_change_dir') }}</span>
        </button>
        <button class="action-btn" :disabled="!modelsDir" @click="onOpenModelDir" :title="i18n.t('btn_open_dir')">
          <Icon name="folder_open" :size="12" />
          <span>{{ i18n.t('btn_open_dir') }}</span>
        </button>
      </div>
    </InfoStrip>

    <InfoStrip :label="i18n.t('lbl_exe_dir')">
      <div class="path-row">
        <input class="path-input" type="text" v-model="llamaDir" />
        <button class="action-btn" @click="onBrowseExeDir">
          <Icon name="folder" :size="12" />
          <span>{{ i18n.t('btn_change_dir') }}</span>
        </button>
        <ToolTip v-if="exeBadge" :text="exeBadge.tip">
          <span class="exe-status" :class="exeBadge.cls">
            <Icon :name="exeBadge.icon" :size="12" :class="{ spinning: exeBadge.spin }" />
            <span>{{ exeBadge.label }}</span>
          </span>
        </ToolTip>
      </div>
    </InfoStrip>

    <InfoStrip :label="i18n.t('lbl_close_behavior')">
      <select class="settings-select" v-model="closeBehavior">
        <option value="ask">{{ i18n.t('opt_close_ask') }}</option>
        <option value="exit">{{ i18n.t('opt_close_exit') }}</option>
        <option value="tray">{{ i18n.t('opt_close_tray') }}</option>
      </select>
    </InfoStrip>

    <Teleport to="body">
      <div v-if="helpVisible" class="exe-help-panel" :style="helpPanelStyle"
           @mouseenter="showHelp" @mouseleave="hideHelp">
        <div v-for="step in helpSteps" :key="step.num" class="exe-help-step">
          <span class="exe-help-step-num">{{ step.num }}</span>
          <span class="exe-help-step-text">{{ step.text }}</span>
        </div>
        <button class="exe-help-open-btn" @click="onOpenLlamaReleases">
          <Icon name="external" :size="12" />
          <span>{{ i18n.t('btn_open_llama_releases') }}</span>
        </button>
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

.path-input {
  flex: 1 1 200px;
  min-width: 160px;
  max-width: 460px; // 限制最大宽度：避免宽窗口下路径输入框拉满整行，表单行节奏更紧凑
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-mono);
  &:focus { border-color: var(--accent); outline: none; }
}

.settings-select {
  min-width: 160px;
  max-width: 260px; // 下拉内容较短，无需占满整行
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  &:focus { border-color: var(--accent); outline: none; }
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
  &.idle, &.detecting { color: var(--fg-muted); background: var(--bg-hover); }
  &.ok { color: var(--success-text); background: color-mix(in srgb, var(--success) 14%, transparent); }
  &.missing { color: var(--danger-text); background: color-mix(in srgb, var(--danger) 14%, transparent); }
  &.not_found { color: var(--warn-text); background: color-mix(in srgb, var(--warn) 14%, transparent); }
}
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.card-help-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 4px;
  color: var(--fg-muted);
  cursor: help;
  border-radius: var(--radius-pill);
  &:hover { color: var(--accent); background: var(--bg-hover); }
}
</style>

<style lang="scss">
.exe-help-panel {
  z-index: 9999;
  padding: 10px 12px;
  border-radius: var(--radius-row);
  // 实底浮层（STYLE_TODO #41 / §7.5.6）：可读性优先，不用半透明玻璃 + backdrop-filter
  background: var(--bg-card);
  border: 1px solid var(--border);
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
  color: var(--fg-secondary);
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
  background: var(--accent);
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
.exe-help-panel .exe-help-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  margin-top: 8px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-base);
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: var(--bg-hover); border-color: var(--accent); color: var(--accent); }
}
</style>