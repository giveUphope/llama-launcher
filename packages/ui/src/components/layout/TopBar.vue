<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, APP_NAME } from '@llama-launcher/shared';
import type { ModelInfo } from '@llama-launcher/shared';
import Icon from '@/components/common/Icon.vue';
import AppLogo from '@/components/common/AppLogo.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useStartServer } from '@/composables/useStartServer';
import { useModelPreset } from '@/composables/useModelPreset';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();
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
// 不再按 route.path 刷新：TopBar 是全局铬，原先每次导航都触发一次整树递归扫描 IPC
// （主进程 walk 整个 models_dir + 每个 GGUF 读元数据），与模型页自身的扫描重复。
// 文件真实变化由 onChanged 广播覆盖，目录变更由上面的 models_dir watch 覆盖。

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
      <!-- 模型按钮常驻（不再 v-if="hasModels"）：原先冷启动模型目录扫描返回那一瞬，整簇
           按钮（启动/停止/重启/打开网页）会被这个凭空插入的 flex item 顶开左移（STYLE_TODO #81 档 1）。
           无模型时按钮仍在、置 disabled 并显示「请选择模型」占位文案，宽度由 .model-name 的
           min-width 锁死，切换模型不再横向重排；下拉内容里的「管理模型…」在禁用态点不到，
           导航侧栏本就有 Models 入口，不构成能力缺失。 -->
      <a-dropdown
        trigger="click"
        :disabled="!hasModels"
        :popup-visible="modelDropdownOpen"
        @popup-visible-change="(v: boolean) => (modelDropdownOpen = v)"
      >
        <ToolTip :text="currentModelName || i18n.t('lbl_select_model')">
          <a-button class="tb-model" :disabled="!hasModels">
            <template #icon><Icon name="models" :size="14" /></template>
            <span class="model-name">{{ currentModelName || i18n.t('lbl_select_model') }}</span>
            <template #suffix><Icon name="chevron_down" :size="12" /></template>
          </a-button>
        </ToolTip>
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
      <ToolTip :text="i18n.t('start')">
        <a-button type="primary" :disabled="isRunning" @click="onStart">
          <template #icon><Icon name="play" :size="14" /></template>
          {{ i18n.t('start') }}
        </a-button>
      </ToolTip>
      <ToolTip :text="i18n.t('stop')">
        <a-button class="tb-stop" type="outline" status="danger" :disabled="!isRunning" @click="onStop">
          <template #icon><Icon name="stop" :size="14" /></template>
          {{ i18n.t('stop') }}
        </a-button>
      </ToolTip>
      <ToolTip :text="i18n.t('restart')">
        <a-button class="tb-restart" type="outline" status="warning" :disabled="!isRunning" @click="onRestart">
          <template #icon><Icon name="refresh" :size="14" /></template>
          {{ i18n.t('restart') }}
        </a-button>
      </ToolTip>
      <ToolTip :text="i18n.t('open_web')">
        <a-button class="tb-openweb" type="text" :disabled="!server.canOpenWeb" @click="onOpenWeb">
          <template #icon><Icon name="external" :size="14" /></template>
          {{ i18n.t('open_web') }}
        </a-button>
      </ToolTip>

      <!-- 窗口控制：a-button 基座（type=text）+ Arco 图标 + 窗口铬专属覆盖；点击走
           Electron 窗口协议，贴边热区为无边框窗口必需（Arco 无窗口控制组件） -->
      <div class="window-controls">
        <ToolTip :text="i18n.t('win_minimize')">
          <a-button class="win-btn" type="text" @click="onMinimize" :aria-label="i18n.t('win_minimize')">
            <Icon name="minimize" :size="12" />
          </a-button>
        </ToolTip>
        <ToolTip :text="isMaximized ? i18n.t('win_restore') : i18n.t('win_maximize')">
          <a-button class="win-btn" type="text" @click="onToggleMaximize" :aria-label="isMaximized ? i18n.t('win_restore') : i18n.t('win_maximize')">
            <Icon :name="isMaximized ? 'restore' : 'maximize'" :size="12" />
          </a-button>
        </ToolTip>
        <ToolTip :text="i18n.t('win_close')">
          <a-button class="win-btn win-close" type="text" @click="onClose" :aria-label="i18n.t('win_close')">
            <Icon name="close" :size="12" />
          </a-button>
        </ToolTip>
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
  background: var(--color-bg-2);
  border-bottom: 1px solid var(--color-border-2);
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

// 服务操作按钮（启动/停止/重启/打开 Web UI）不写任何配色：type + status 让 Arco 自己取
// danger-6 / warning-6 / primary-6，hover 走 -5、active 走 -7、禁用走 light-3，全部由库算。
// 浅色下这些档就是 Arco 官方值（red-6 / orange-6）——达标靠改库的取值会连带重绘所有读这几档
// 的组件，已按「观感与库一致优先」回退，不达标的那几处登记在 §7.5.2 的豁免清单里。
// 反过来也不要覆写按钮的 color 声明：覆写会冻结 hover/active 的文字色（实测描边变深、
// 文字不变，两个方向分叉）。

// 窗口控制按钮簇：a-button type=text 基座 + 窗口铬覆盖（46×52 贴边热区、
// 无边框窗口角落用小圆角、关闭钮红色 hover）；尺寸/配色覆盖压过 Arco 默认
.window-controls {
  display: flex;
  align-items: stretch;
  height: var(--topbar-h);
  margin-right: -12px; // 抵消 topbar 右侧 padding，使按钮贴合窗口右缘
}

.win-btn {
  width: 46px;
  height: 100%;
  padding: 0;
  color: var(--color-text-2);
  border-radius: var(--radius-control);
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth);

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

/* 名称区宽度锁死：min = max = 180px（STYLE_TODO #81 档 1）。
   原先只有 max-width，短模型名时按钮按文字收缩，每次切换模型整簇按钮横向重排。
   取 180 而不是「实测最长模型名」：① 180 是既有上限、也是历史上长名已实际达到的宽度，
   当下限后按钮宽恒定，两个方向都不再跳；② 模型名由用户目录决定，无法枚举上限。
   超出部分仍走省略号（overflow/ellipsis/nowrap 保留），完整名看 tooltip。 */
.model-name {
  min-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  display: inline-block;
  max-width: 180px;
}

// 下拉内容：普通项名称/尺寸两列；选中项 accent 淡色底 + accent 文字；管理项斜体+分割线。
// 面板固定宽 360px（原被最长模型名撑到 ~378px）：管理项/模型项同宽，长模型名省略、尺寸右对齐
.dd-manage,
.dd-item {
  width: 360px;
  box-sizing: border-box;
}
.dd-item {
  :deep(.arco-dropdown-option-content) {
    display: flex;
    align-items: center;
    gap: 8px; // 名称与尺寸间距（a-doption 内容包裹层非 flex，需显式声明）
    width: 100%;
    min-width: 0;
  }
}
.dd-manage {
  color: var(--color-text-2);
  font-style: italic;
}
.dd-divider {
  margin: 4px 0;
}
.dd-item.active {
  background: color-mix(in srgb, rgb(var(--primary-6)) 14%, transparent);
  color: var(--fg-accent);
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
  color: var(--fg-hint);
  font-size: var(--fs-sm);
  flex-shrink: 0;
}
</style>