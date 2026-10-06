<script setup lang="ts">
// 阶段三：设置页「常规」分组 —— 模型目录、llama 后端（引擎目录）+ 引擎检测、关闭窗口行为。
// 设计稿 §14.10 / 补充指南 §14.10：模型目录提供「打开目录」；
// 原独立「llama.cpp」标签（LlamaPanel）已整合为本卡片内的引擎目录行。
import { computed, ref, watch, nextTick, getCurrentInstance, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { vInnerAriaLabel } from '@/directives/innerAriaLabel';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { pickDir } from '@/composables/useFilePicker';
import { LLAMA_CPP_RELEASES_URL } from '@llama-launcher/shared';
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
  try { await window.api.openExternal(LLAMA_CPP_RELEASES_URL); } catch { /* 静默 */ }
}

// 悬浮帮助面板（引擎获取指引）
const helpVisible = ref(false);
// 触发器已改为 a-button：模板 ref 拿到的是组件实例，浮层定位要的是它的根 <button>
const helpIconRef = ref<{ $el?: HTMLElement } | null>(null);
const helpPanelRef = ref<HTMLElement | null>(null);
const helpPanelId = `exe-help-panel-${getCurrentInstance()?.uid ?? 0}`;
const helpPanelStyle = ref<Record<string, string>>({});
let helpShowTimer: ReturnType<typeof setTimeout> | null = null;
let helpHideTimer: ReturnType<typeof setTimeout> | null = null;

const helpSteps = computed(() =>
  i18n.t('msg_exe_help_steps').split('\n').map((text, i) => ({ num: i + 1, text })),
);

function getHelpIconEl(): HTMLElement | null {
  return helpIconRef.value?.$el ?? null;
}

function updateHelpPanelPosition() {
  const el = getHelpIconEl();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = 320;
  const left = Math.min(rect.right, window.innerWidth - width - 8);
  helpPanelStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(8, left)}px`,
    width: `${width}px`,
  };
}
function clearHelpTimers() {
  if (helpShowTimer) { clearTimeout(helpShowTimer); helpShowTimer = null; }
  if (helpHideTimer) { clearTimeout(helpHideTimer); helpHideTimer = null; }
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
// 键盘入口：hover 的定时器行为原样保留，键盘走「立即开/立即关」——按键不该等 300ms 悬停延迟。
// 打开后把焦点移进浮层，浮层是 Teleport 到 body 的独立片段，不移入就 Tab 不进去它唯一的动作按钮。
function openHelpByKeyboard() {
  clearHelpTimers();
  updateHelpPanelPosition();
  helpVisible.value = true;
  void nextTick(() => helpPanelRef.value?.focus());
}
function closeHelpByKeyboard() {
  clearHelpTimers();
  const focusInsidePanel = !!helpPanelRef.value && helpPanelRef.value.contains(document.activeElement);
  helpVisible.value = false;
  if (focusInsidePanel || document.activeElement === document.body) getHelpIconEl()?.focus();
}
function onHelpActivate() {
  if (helpVisible.value) closeHelpByKeyboard();
  else openHelpByKeyboard();
}
function onHelpGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeHelpByKeyboard();
}
// Esc 监听随浮层开关配对：只在浮层真的打开期间驻留
watch(helpVisible, (visible) => {
  if (visible) document.addEventListener('keydown', onHelpGlobalKeydown);
  else document.removeEventListener('keydown', onHelpGlobalKeydown);
});
function onHelpReposition() {
  if (helpVisible.value) updateHelpPanelPosition();
}
// 帮助浮层跟随重定位：本组件在 keep-alive 的「应用设置」页内，onUnmounted 永不触发——
// 监听必须配对 activate/deactivate，否则访问过一次设置页后，非 passive 的捕获期 scroll
// 监听会终身驻留并在每次滚动（含两个控制台的自动滚动）上回调。
function startHelpTracking() {
  window.addEventListener('resize', onHelpReposition);
  window.addEventListener('scroll', onHelpReposition, { capture: true, passive: true });
}
function stopHelpTracking() {
  window.removeEventListener('resize', onHelpReposition);
  window.removeEventListener('scroll', onHelpReposition, { capture: true });
}
onMounted(() => {
  startHelpTracking();
});
onActivated(() => {
  startHelpTracking();
});
onDeactivated(() => {
  stopHelpTracking();
  // 浮层 Teleport 到 body，不随 keep-alive 页面一起隐藏：切走页面时必须就地关掉
  clearHelpTimers();
  helpVisible.value = false;
});
onUnmounted(() => {
  if (detectTimer) { clearTimeout(detectTimer); detectTimer = null; }
  clearHelpTimers();
  document.removeEventListener('keydown', onHelpGlobalKeydown);
  stopHelpTracking();
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
      <!-- a-button 基座（type=text size=mini）+ class 覆盖保留原 .card-help-icon 视觉；
           原生 button 的 Enter/Space 已由 @click 承接，无需另写 keydown 分支（写了反而与
           浏览器自带的 click 叠加成「开→立刻关」） -->
      <a-button
        ref="helpIconRef"
        class="card-help-icon"
        type="text"
        size="mini"
        :aria-label="i18n.t('a11y_exe_help_toggle')"
        :aria-expanded="helpVisible ? 'true' : 'false'"
        aria-haspopup="true"
        :aria-controls="helpVisible ? helpPanelId : undefined"
        @mouseenter="showHelp"
        @mouseleave="hideHelp"
        @click="onHelpActivate"
      >
        <Icon name="info" :size="13" />
      </a-button>
    </template>

    <a-form :model="{}" layout="horizontal" label-align="right"
            :label-col-style="{ flex: '0 0 145px', minWidth: '0', marginRight: '8px', paddingRight: '0' }"
            :wrapper-col-style="{ flex: '1 1 0', minWidth: '0' }">
      <a-form-item :label="i18n.t('lbl_dir_path')">
        <div class="path-row">
          <a-input v-model="modelsDir" class="path-input" size="small" :input-attrs="{ 'aria-label': i18n.t('lbl_dir_path') }" />
          <a-button size="small" @click="onBrowseModelDir">
            <template #icon><Icon name="folder" :size="12" /></template>
            {{ i18n.t('btn_change_dir') }}
          </a-button>
          <ToolTip :text="i18n.t('btn_open_dir')">
            <a-button size="small" :disabled="!modelsDir" @click="onOpenModelDir">
              <template #icon><Icon name="folder_open" :size="12" /></template>
              {{ i18n.t('btn_open_dir') }}
            </a-button>
          </ToolTip>
        </div>
      </a-form-item>

      <a-form-item :label="i18n.t('lbl_exe_dir')">
        <div class="path-row">
          <a-input v-model="llamaDir" class="path-input" size="small" :input-attrs="{ 'aria-label': i18n.t('lbl_exe_dir') }" />
          <a-button size="small" @click="onBrowseExeDir">
            <template #icon><Icon name="folder" :size="12" /></template>
            {{ i18n.t('btn_change_dir') }}
          </a-button>
          <!-- 引擎状态胶囊走常驻定宽槽：槽宽按双语最宽状态文案预留，检测结论落地时
               行内固有宽度不再变化，.path-row 的 flex-wrap 也不会因此把整行折成两行 -->
          <span class="exe-status-slot">
            <ToolTip v-if="exeBadge" :text="exeBadge.tip">
              <span class="exe-status" :class="exeBadge.cls">
                <Icon :name="exeBadge.spin ? 'loading' : exeBadge.icon" :size="12" />
                <span class="exe-status-text">{{ exeBadge.label }}</span>
              </span>
            </ToolTip>
          </span>
        </div>
      </a-form-item>

      <a-form-item :label="i18n.t('lbl_close_behavior')" v-inner-aria-label="i18n.t('lbl_close_behavior')">
        <a-select class="fc-select" v-model="closeBehavior" :style="{ width: '160px' }"
                  :aria-label="i18n.t('lbl_close_behavior')">
          <a-option value="ask">{{ i18n.t('opt_close_ask') }}</a-option>
          <a-option value="exit">{{ i18n.t('opt_close_exit') }}</a-option>
          <a-option value="tray">{{ i18n.t('opt_close_tray') }}</a-option>
        </a-select>
      </a-form-item>
    </a-form>

    <Teleport to="body">
      <div v-if="helpVisible" :id="helpPanelId" ref="helpPanelRef" tabindex="-1" class="exe-help-panel"
           :style="helpPanelStyle" @mouseenter="showHelp" @mouseleave="hideHelp">
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

// 胶囊定宽槽：156px 覆盖英文最宽态「Engine file missing」+ 图标 + 内距（中文态留白但几何恒定）
.exe-status-slot {
  display: inline-flex;
  align-items: center;
  flex: 0 0 156px;
  min-width: 0;
}

.exe-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  max-width: 100%;
  min-width: 0;
  padding: 0 10px;

  // 万一某语言译文超出预留宽：就地省略，绝不撑破槽（槽宽恒定是本修法的前提）
  .exe-status-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  &.idle, &.detecting { color: var(--fg-hint); background: var(--color-fill-3); }
  &.ok { color: rgb(var(--success-6)); background: color-mix(in srgb, rgb(var(--success-6)) 14%, transparent); }
  &.missing { color: var(--fg-danger-text); background: color-mix(in srgb, rgb(var(--danger-6)) 14%, transparent); }
  &.not_found { color: var(--fg-warning-text); background: color-mix(in srgb, rgb(var(--orange-6)) 14%, transparent); }
}
/* 检测中图标走 Arco IconLoading 自带旋转动画（不再自定义 spin） */

.card-help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  // a-button 基座下仍按原自绘 span 的几何出图：21×21、4px 内距、pill 圆角、hover 变色
  // （Arco 按钮自带 1px 透明边框，不去掉会比原 21px 宽出 2px）
  height: 21px;
  min-width: 21px;
  padding: 4px;
  border: none;
  color: var(--color-text-3);
  cursor: help;
  border-radius: var(--radius-pill);
  &:hover { color: var(--fg-accent); background: var(--color-fill-3); }
}
</style>

<style lang="scss">
.exe-help-panel {
  z-index: var(--z-overlay);
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