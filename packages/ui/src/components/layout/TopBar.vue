<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, APP_NAME } from '@llama-launcher/shared';
import type { ModelInfo } from '@llama-launcher/shared';
import Icon from '@/components/common/Icon.vue';
import AppLogo from '@/components/common/AppLogo.vue';
import { useStartServer } from '@/composables/useStartServer';
import { useModelPreset } from '@/composables/useModelPreset';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();
const route = useRoute();
const router = useRouter();

// 统一的启动/重启前置校验与流程（LaunchPage 共用）
const { start: launchStart, restart: launchRestart } = useStartServer();
// 智能预设：模型切换时自动发现该模型已保存的预设并询问应用
const { applyModelPresetIfAny } = useModelPreset();

// 模型列表（TopBar 常驻下拉用）：浅响应式——每次路由切换都会整体替换刷新，
// 避免数百个 ModelInfo 深响应式包装的开销（与模型管理页同模式）。
const models = shallowRef<ModelInfo[]>([]);
const modelDropdownOpen = ref(false);

const isRunning = computed(() => server.status === 'running' || server.status === 'starting');

// 当前选中模型文件名（用于下拉显示）
const currentModelName = computed(() => {
  const p = String(params.values[MODEL_KEY] ?? '');
  if (!p) return '';
  const m = models.value.find((x) => x.path === p);
  return m?.name ?? p.split(/[\\/]/).pop() ?? p;
});

// 模型列表为空时不显示下拉
const hasModels = computed(() => models.value.length > 0);

async function refreshModels() {
  const dir = settings.settings?.models_dir ?? '';
  if (!dir) { models.value = []; return; }
  try {
    const result = await window.api.models.scan(dir);
    // 防御性检查：浏览器预览/mock 环境下 scan 可能返回 null
    models.value = Array.isArray(result) ? result : [];
  } catch {
    models.value = [];
  }
}

// 监听模型目录变化，重新扫描
watch(() => settings.settings?.models_dir ?? '', () => {
  void refreshModels();
});

// 订阅模型列表变更事件（下载完成、文件增删等）
let unsubModelsChanged: (() => void) | null = null;
// 路由切换时也刷新（从下载页返回时确保列表最新）
watch(() => route.path, () => {
  void refreshModels();
});

async function onSelectModel(path: string) {
  modelDropdownOpen.value = false;
  if (!path) {
    // 选择"管理模型…"项
    void router.push('/models');
    return;
  }
  // 统一走 params.applyModel：保留参数值 + 自动检测 mmproj + 加载 GGUF 元数据，
  // 切换模型时自动清空控制台（旧日志属于上一个模型）；
  // 有未固化的临时调整时 applyModel 会先弹确认，用户取消则中止后续预设应用
  const ok = await params.applyModel(path);
  if (!ok) return;
  // 智能预设：该模型存在已保存预设时静默应用（建立预设基线）
  await applyModelPresetIfAny(path);
}

function toggleModelDropdown() {
  modelDropdownOpen.value = !modelDropdownOpen.value;
}

// 点击外部关闭下拉
function onDocClick() {
  modelDropdownOpen.value = false;
}

onMounted(() => {
  void refreshModels();
  void refreshWindowState();
  document.addEventListener('click', onDocClick);
  // 浏览器预览环境(无 Electron preload)下 window.api 未定义,需容错
  try {
    unsubModelsChanged = window.api.models.onChanged(() => {
      void refreshModels();
    });
    unsubMax = window.api.window.onMaximized(() => { isMaximized.value = true; });
    unsubUnmax = window.api.window.onUnmaximized(() => { isMaximized.value = false; });
  } catch {
    // window.api 未定义(浏览器预览环境),忽略事件订阅
  }
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  if (unsubModelsChanged) { unsubModelsChanged(); unsubModelsChanged = null; }
  if (unsubMax) { unsubMax(); unsubMax = null; }
  if (unsubUnmax) { unsubUnmax(); unsubUnmax = null; }
});

// ---- 自定义标题栏窗口控制 ----
const isMaximized = ref(false);
let unsubMax: (() => void) | null = null;
let unsubUnmax: (() => void) | null = null;

async function refreshWindowState() {
  try {
    const s = await window.api.window.getState();
    isMaximized.value = !!s.maximized;
  } catch {
    isMaximized.value = false;
  }
}

function onMinimize() {
  void window.api.window.minimize();
}

function onToggleMaximize() {
  void window.api.window.toggleMaximize();
}

function onClose() {
  void window.api.window.close();
}

function onTitleBarDblClick(e?: MouseEvent) {
  // 仅当双击发生在拖拽区域（非右侧交互控件）时才切换最大化，
  // 避免双击"启动/停止"等按钮误触发最大化。
  if (e && (e.target as HTMLElement)?.closest('.right')) return;
  onToggleMaximize();
}

async function onStart() {
  await launchStart();
}

async function onStop() {
  await server.stop();
}

async function onRestart() {
  await launchRestart();
}

async function onOpenWeb() {
  // 内嵌 Web UI：跳转 /webui 内嵌页（路由存在但侧边栏不显示，入口仅此处）
  void router.push('/webui');
}
</script>

<template>
  <header class="topbar" @dblclick="onTitleBarDblClick">
    <div class="left">
      <!-- 应用图标（与打包/任务栏图标一致，统一 AppLogo 组件） -->
      <AppLogo :size="20" />
      <!-- 应用名 -->
      <span class="app-name">{{ APP_NAME }}</span>
    </div>
    <div class="right">
      <!-- 模型选择常驻下拉 -->
      <div v-if="hasModels" class="model-picker" @click.stop>
        <button class="model-btn" @click="toggleModelDropdown" :title="currentModelName">
          <Icon name="models" :size="14" />
          <span class="model-name">{{ currentModelName || i18n.t('lbl_select_model') }}</span>
          <Icon name="chevron_down" :size="12" />
        </button>
        <div v-if="modelDropdownOpen" class="model-dropdown">
          <button class="dropdown-item manage" @click="onSelectModel('')">
            {{ i18n.t('lbl_manage_models') }}...
          </button>
          <div class="dropdown-divider"></div>
          <button
            v-for="m in models"
            :key="m.path"
            class="dropdown-item"
            :class="{ active: m.path === params.values.model }"
            @click="onSelectModel(m.path)"
            :title="m.path"
          >
            <span class="dropdown-name">{{ m.name }}</span>
            <span class="dropdown-size">{{ m.size_str }}</span>
          </button>
        </div>
      </div>
      <button
        class="btn btn-start"
        :disabled="isRunning"
        :title="i18n.t('start')"
        @click="onStart"
      >
        <Icon name="play" :size="14" />
        <span class="btn-text">{{ i18n.t('start') }}</span>
      </button>
      <button
        class="btn btn-stop"
        :disabled="!isRunning"
        :title="i18n.t('stop')"
        @click="onStop"
      >
        <Icon name="stop" :size="14" />
        <span class="btn-text">{{ i18n.t('stop') }}</span>
      </button>
      <button
        class="btn btn-restart"
        :disabled="!isRunning"
        :title="i18n.t('restart')"
        @click="onRestart"
      >
        <Icon name="refresh" :size="14" />
        <span class="btn-text">{{ i18n.t('restart') }}</span>
      </button>
      <button
        class="btn btn-web"
        :disabled="!isRunning"
        :title="i18n.t('open_web')"
        @click="onOpenWeb"
      >
        <Icon name="external" :size="14" />
        <span class="btn-text">{{ i18n.t('open_web') }}</span>
      </button>

      <!-- 自定义窗口控制（替代原生标题栏按钮） -->
      <div class="window-controls">
        <button class="win-btn" :title="i18n.t('win_minimize')" @click="onMinimize" aria-label="minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
        <button class="win-btn" :title="isMaximized ? i18n.t('win_restore') : i18n.t('win_maximize')" @click="onToggleMaximize" aria-label="toggle maximize">
          <!-- 最大化：单个圆角方框 -->
          <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
          <!-- 还原：双层重叠窗口（后窗轮廓 + 前窗顶/右边，与最小化/关闭同风格） -->
          <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /><path d="M4.5 4.5h5.5v5.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button class="win-btn win-close" :title="i18n.t('win_close')" @click="onClose" aria-label="close">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /><line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.topbar {
  height: var(--topbar-h);
  flex: 0 0 var(--topbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--glass-bg);
  border-bottom: 1px solid var(--glass-border);
  // 自定义标题栏：标题栏本身作为拖拽区域
  -webkit-app-region: drag;
  // 拖拽时禁止选中文本，避免拖动变成文本选择
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

.left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 100%;
}

.app-name {
  font-size: var(--fs-appname);  // 应用名专用字号，介于 lg(14) 和 xl(18) 之间
  font-weight: 700;
  color: var(--fg-primary);
  white-space: nowrap;
  // 极窄窗口时应用名省略号让位（此前被模型按钮直接裁切出半个字）
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.3px;
  // 标题文本可拖动窗口，但不可被选中（否则拖动会变成文本选择）
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

.right {
  display: flex;
  align-items: center;
  gap: 8px;
  // 交互控件不可拖拽（否则点击/输入会触发窗口拖动）
  -webkit-app-region: no-drag;
}

// 自定义窗口控制按钮簇（双击标题栏区域外的独立控制区）
.window-controls {
  display: flex;
  align-items: stretch;
  height: var(--topbar-h);
  margin-right: -12px; // 抵消 topbar 右侧 padding，使按钮贴合窗口右缘
}

.win-btn {
  width: 46px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--fg-secondary);
  cursor: pointer;
  border-radius: var(--radius-control);
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    color: var(--fg-primary);
  }

  // 按压反馈 = 背景/边框色变化（文本按钮不再整体缩放，避免文字挤压拉伸）
}

.win-close:hover {
  background: var(--danger);
  color: #fff;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-md);
  color: var(--fg-primary);
  background: var(--bg-input);
  border: 1px solid var(--border);
  cursor: pointer;
  // 窄窗口下按钮文字禁止换行（此前"启动/停止/重启"被压成两行、与相邻控件重叠挤压）；
  // 空间不足时由可收缩的模型按钮先让位
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:active:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.btn-start {
  // 主 CTA：主题化高对比按钮（深色=白底黑字 / 浅色=黑底白字，--primary-* token）
  background: var(--primary-bg);
  border-color: var(--primary-bg);
  color: var(--primary-fg);
  font-weight: 600;

  &:hover:not(:disabled) {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
  }

  &:active:not(:disabled) {
    background: var(--primary-pressed);
  }
}

.btn-stop {
  color: var(--danger);
  border-color: var(--danger);

  &:hover:not(:disabled) {
    background: var(--danger);
    color: #fff;
  }
}

.btn-restart {
  color: var(--warn);
  border-color: var(--warn);

  &:hover:not(:disabled) {
    background: var(--warn);
    color: #1a1a1a; // warn 黄底 → 深色文字（§7.5.1：warn 底 → #1a1a1a）
  }
}

.btn-web {
  color: var(--accent);
  border-color: var(--accent);

  &:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }
}

/* 模型选择常驻下拉 */
.model-picker {
  position: relative;
  display: flex;
  align-items: center;
  // 空间不足时模型按钮先收缩（名称已有省略号），保护右侧操作按钮不换行
  min-width: 0;
}

.model-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-base);
  cursor: pointer;
  max-width: 220px;
  min-width: 0;
  flex-shrink: 1;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }
}

.model-name {
  // 同 dropdown-name：允许在 220px 按钮内收缩省略（否则长名撑出按钮描边外）
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.model-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  min-width: 320px;
  max-width: 480px;
  max-height: 360px;
  overflow-y: auto;
  // 浮层菜单可读性优先：实底表面。不用玻璃半透明 + backdrop-filter——
  // ① 半透明底会让面板下方的页面/控制台内容透出，削弱文字对比度（"被遮罩影响"）；
  // ② backdrop-filter 使面板进入独立合成层，层内文字失去亚像素抗锯齿、观感发虚。
  // 边框/阴影保持浮层语义（STYLE_TODO #41 / §7.5.6）。
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  box-shadow: var(--shadow-dropdown);
  z-index: 100;
  padding: 4px;
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  color: var(--fg-primary);
  font-size: var(--fs-base);
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-pill);
  transition: background var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    // 选中行：accent 淡色底 + accent 文字。原 --bg-active（深色主题 #26308F 暗蓝底）
    // 叠 accent 蓝字对比度不足（同 STYLE_TODO #13「文字被吞」）；color-mix 淡底双主题均可读。
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  &.manage {
    color: var(--fg-secondary);
    font-style: italic;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
    // 统一圆角（原为上圆角+下方角 pill/0/0，会导致 :focus-visible 焦点环上半圆弧、下半平直，
    // 与下方分割线叠加后"下半部分风格不统一"）。改为统一 control 圆角，焦点环各边一致，
    // 同时用较小的圆角区别于普通下拉项的全胶囊形态，仍靠斜体/次级色/分割线维持头部语义。
    border-radius: var(--radius-control);
  }
}

.dropdown-name {
  // flex 子项默认 min-width:auto 不收缩：长模型名会撑破面板被 overflow 裁切（尺寸列被推出面板），
  // min-width:0 + flex:1 让省略号生效、名称列在面板内截断
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.dropdown-size {
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  flex-shrink: 0;
}

.dropdown-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
