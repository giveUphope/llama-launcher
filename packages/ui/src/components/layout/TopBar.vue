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
// Arco Dropdown 受控显隐（trigger=click 由 a-dropdown 自行处理外部点击关闭）
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

onMounted(() => {
  void refreshModels();
  void refreshWindowState();
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
  // 内嵌 Web UI：跳转 /webui 内嵌页（侧栏一级项，实际渲染由布局层 WebUiFrame 承担）
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
      <!-- 模型选择常驻下拉（Arco Dropdown） -->
      <a-dropdown
        v-if="hasModels"
        trigger="click"
        :popup-visible="modelDropdownOpen"
        @popup-visible-change="(v: boolean) => (modelDropdownOpen = v)"
      >
        <a-button class="tb-model" :disabled="false" :title="currentModelName">
          <template #icon><Icon name="models" :size="14" /></template>
          <span class="model-name">{{ currentModelName || i18n.t('lbl_select_model') }}</span>
          <template #suffix><Icon name="chevron_down" :size="12" /></template>
        </a-button>
        <template #content>
          <a-doption class="dd-manage" @click="onSelectModel('')">{{ i18n.t('lbl_manage_models') }}…</a-doption>
          <a-divider class="dd-divider" />
          <a-doption
            v-for="m in models"
            :key="m.path"
            class="dd-item"
            :class="{ active: m.path === params.values.model }"
            @click="onSelectModel(m.path)"
          >
            <span class="dropdown-name">{{ m.name }}</span>
            <span class="dropdown-size">{{ m.size_str }}</span>
          </a-doption>
        </template>
      </a-dropdown>

      <!-- 服务操作（Arco Button 语义：primary 启动 / danger 停止 / warning 重启 / text 打开网页） -->
      <a-button type="primary" :disabled="isRunning" :title="i18n.t('start')" @click="onStart">
        <template #icon><Icon name="play" :size="14" /></template>
        {{ i18n.t('start') }}
      </a-button>
      <a-button type="outline" status="danger" :disabled="!isRunning" :title="i18n.t('stop')" @click="onStop">
        <template #icon><Icon name="stop" :size="14" /></template>
        {{ i18n.t('stop') }}
      </a-button>
      <a-button type="outline" status="warning" :disabled="!isRunning" :title="i18n.t('restart')" @click="onRestart">
        <template #icon><Icon name="refresh" :size="14" /></template>
        {{ i18n.t('restart') }}
      </a-button>
      <a-button type="text" :disabled="!isRunning" :title="i18n.t('open_web')" @click="onOpenWeb">
        <template #icon><Icon name="external" :size="14" /></template>
        {{ i18n.t('open_web') }}
      </a-button>

      <!-- 自定义窗口控制（替代原生标题栏按钮；Electron 拖拽/窗口协议需保留定制） -->
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
  color: var(--color-text-1);
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
  color: var(--color-text-2);
  cursor: pointer;
  border-radius: var(--radius-control);
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--color-fill-3);
    color: var(--color-text-1);
  }
}

.win-close:hover {
  background: rgb(var(--danger-6));
  color: #fff;
}

// 模型按钮：名称允许 220px 内收缩省略
.tb-model {
  :deep(.arco-btn-content) {
    min-width: 0;
  }
}

.model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  display: inline-block;
  max-width: 180px;
}

// 下拉内容：普通项名称/尺寸两列；选中项 accent 淡色底 + accent 文字；管理项斜体+分割线
.dd-manage {
  color: var(--color-text-2);
  font-style: italic;
}
.dd-divider {
  margin: 4px 0;
}
.dd-item.active {
  background: color-mix(in srgb, rgb(var(--primary-6)) 14%, transparent);
  color: rgb(var(--primary-6));
}
.dropdown-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
.dropdown-size {
  color: var(--color-text-3);
  font-size: var(--fs-sm);
  flex-shrink: 0;
}
</style>