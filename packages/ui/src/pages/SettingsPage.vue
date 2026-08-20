<script setup lang="ts">
// 应用设置页：引擎目录/模型目录/镜像源/下载并发/主题/语言 的统一入口。
// 原先这些设置分散在 ModelsPage（引擎/镜像/模型目录卡片）与 DownloadCard（并发选择器），
// 现收敛到本页；TopBar 保留主题/语言快捷切换（快速通道，本页为完整面板）。
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import type { ThemeMode, Language, FxMode, CloseBehavior } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { pickDir } from '@/composables/useFilePicker';

const settings = useSettingsStore();
const i18n = useI18nStore();

// 模型目录
const modelsDir = computed<string>({
  get: () => settings.settings?.models_dir ?? '',
  set: (v) => {
    if (settings.settings) {
      settings.settings.models_dir = v;
      void settings.save();
    }
  },
});

// llama 引擎目录（用户选择包含 llama-server 的目录）
const llamaDir = computed<string>({
  get: () => settings.settings?.llama_dir ?? '',
  set: (v) => {
    if (settings.settings) {
      settings.settings.llama_dir = v;
      void settings.save();
    }
  },
});

// HuggingFace 镜像源 host（空 = 默认 hf-mirror.com；受限网络可指向自建镜像/内网缓存）
const hfMirrorHost = computed<string>({
  get: () => settings.settings?.hf_mirror_host ?? '',
  set: (v) => {
    if (settings.settings) {
      settings.settings.hf_mirror_host = v;
      void settings.save();
    }
  },
});

// 最大并发下载数(1-5)
const maxConcurrent = computed<number>({
  get: () => settings.settings?.download_max_concurrent ?? 3,
  set: (v) => {
    if (!settings.settings) return;
    const n = Math.min(5, Math.max(1, Math.floor(Number(v) || 3)));
    settings.settings.download_max_concurrent = n;
    void settings.save();
  },
});
const concurrentOptions = [1, 2, 3, 4, 5];

// 主题 / 语言（完整面板；TopBar 仍保留快捷切换）
const themeMode = computed<ThemeMode>({
  get: () => settings.themeMode,
  set: (v) => {
    settings.themeMode = v;
    settings.applyTheme();
    void settings.save();
  },
});
const language = computed<Language>({
  get: () => settings.language,
  set: (v) => {
    settings.language = v;
    void settings.save();
  },
});
// 视觉效果（毛玻璃/果冻/彩虹点缀）；off = 纯实底性能模式（回退开关）
const fxMode = computed<FxMode>({
  get: () => settings.fxMode,
  set: (v) => {
    settings.setFx(v);
  },
});
// 关闭窗口时的退出行为（ask 询问 / exit 直接退出 / tray 最小化到托盘）
const closeBehavior = computed<CloseBehavior>({
  get: () => settings.settings?.close_behavior ?? 'ask',
  set: (v) => {
    if (!settings.settings) return;
    settings.settings.close_behavior = v;
    void settings.save();
  },
});

// 引擎检测状态机：驱动引擎卡片的状态提示
// idle(未配置目录) → detecting(检测中) → ok / missing / not_found
type ExeStatus = 'idle' | 'detecting' | 'ok' | 'missing' | 'not_found';
const exeStatus = ref<ExeStatus>('idle');
/** 检测到的引擎二进制完整路径（ok 态 tooltip 展示，便于确认实际使用哪个文件） */
const detectedExePath = ref('');

// 从 llama_dir 检测 llama-server.exe 并校验文件存在性，一次完成（避免多次异步跳变）
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
    // 防御性检查：浏览器预览/mock 环境下 findLlamaExe 可能返回 null
    path = typeof result === 'string' ? result : '';
    if (path) {
      let exists = false;
      try {
        exists = !!(await window.api.system.fileExists(path));
      } catch {
        exists = false;
      }
      exeStatus.value = exists ? 'ok' : 'missing';
    } else {
      exeStatus.value = 'not_found';
    }
  } catch {
    path = '';
    exeStatus.value = 'not_found';
  }
  detectedExePath.value = path;
  // 同步到 server_exe（启动时使用）；未检测到时清空，避免残留失效路径
  if (settings.settings && path !== settings.settings.server_exe) {
    settings.settings.server_exe = path;
    void settings.save();
  }
}

// llama_dir 变化时自动检测（400ms 防抖：输入路径时避免每次击键触发
// findLlamaExe + fileExists 两次 IPC 与同步保存，造成卡顿）
let detectTimer: ReturnType<typeof setTimeout> | null = null;
watch(llamaDir, () => {
  if (detectTimer) clearTimeout(detectTimer);
  detectTimer = setTimeout(() => {
    detectTimer = null;
    void detectExe();
  }, 400);
}, { immediate: true });

// 悬浮面板跟随窗口滚动/缩放重定位
onMounted(() => {
  window.addEventListener('resize', onHelpReposition);
  window.addEventListener('scroll', onHelpReposition, true);
});

// 卸载时清理挂起的检测计时器（keep-alive 期间不触发，真实卸载时避免残留引用）
onUnmounted(() => {
  if (detectTimer) {
    clearTimeout(detectTimer);
    detectTimer = null;
  }
  if (helpShowTimer) clearTimeout(helpShowTimer);
  if (helpHideTimer) clearTimeout(helpHideTimer);
  window.removeEventListener('resize', onHelpReposition);
  window.removeEventListener('scroll', onHelpReposition, true);
});

// 检测状态 → 状态徽章（图标 + 短文案，淡底配色与全局徽章风格一致；hover 显示详细提示）
const exeBadge = computed<{ icon: string; cls: string; tip: string; label: string; spin?: boolean } | null>(() => {
  switch (exeStatus.value) {
    case 'idle':
      return { icon: 'info', cls: 'idle', tip: i18n.t('msg_no_exe_hint'), label: i18n.t('lbl_exe_state_idle') };
    case 'detecting':
      return { icon: 'refresh', cls: 'detecting', tip: i18n.t('msg_exe_detecting'), label: i18n.t('lbl_exe_state_detecting'), spin: true };
    case 'ok':
      return {
        icon: 'file_check',
        cls: 'ok',
        // tooltip 展示实际检测到的二进制完整路径（比通用「检测到」更有信息量）
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

// 选择 llama-server 所在目录
async function onBrowseExeDir() {
  const dir = await pickDir({
    title: i18n.t('msg_select_exe_dir'),
    defaultPath: llamaDir.value || undefined,
  });
  if (dir) llamaDir.value = dir;
}

// ----- 引擎获取引导悬浮面板 -----
// 标题行 help 图标悬浮时，在图标右下角显示按步骤的引导（Teleport 到 body + fixed 定位，
// 避免被卡片 header 的 overflow: hidden 裁切）。步骤文案用 \n 分隔，UI 按行渲染序号。
const helpVisible = ref(false);
const helpIconRef = ref<HTMLElement | null>(null);
const helpPanelStyle = ref<Record<string, string>>({});
let helpShowTimer: ReturnType<typeof setTimeout> | null = null;
let helpHideTimer: ReturnType<typeof setTimeout> | null = null;

const helpSteps = computed(() =>
  i18n
    .t('msg_exe_help_steps')
    .split('\n')
    .map((text, i) => ({ num: i + 1, text })),
);

function updateHelpPanelPosition() {
  if (!helpIconRef.value) return;
  const rect = helpIconRef.value.getBoundingClientRect();
  // 面板左上角定位在图标右下角（下方 4px、右缘对齐），并钳制在视口内
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
  if (helpHideTimer) {
    clearTimeout(helpHideTimer);
    helpHideTimer = null;
  }
  if (helpShowTimer) return;
  helpShowTimer = setTimeout(() => {
    helpShowTimer = null;
    updateHelpPanelPosition();
    helpVisible.value = true;
  }, 300);
}

function hideHelp() {
  if (helpShowTimer) {
    clearTimeout(helpShowTimer);
    helpShowTimer = null;
  }
  // 延迟关闭：允许鼠标从图标移动到面板
  if (helpHideTimer) clearTimeout(helpHideTimer);
  helpHideTimer = setTimeout(() => {
    helpHideTimer = null;
    helpVisible.value = false;
  }, 150);
}

function onHelpReposition() {
  if (helpVisible.value) updateHelpPanelPosition();
}

// 打开 llama.cpp 官方发布页（面板底部跳转按钮），跳转后收起面板
async function onOpenLlamaReleases() {
  hideHelp();
  try {
    await window.api.openExternal('https://github.com/ggml-org/llama.cpp/releases');
  } catch {
    // 忽略打开失败
  }
}

// 选择模型目录
async function onBrowseModelDir() {
  const dir = await pickDir({ title: i18n.t('msg_select_dir'), defaultPath: modelsDir.value || undefined });
  if (dir) modelsDir.value = dir;
}
</script>

<template>
  <div class="page">
    <div class="content">
      <p class="settings-hint">{{ i18n.t('lbl_settings_hint') }}</p>

      <!-- llama.cpp 引擎：引擎目录 + 内联检测 + 下载引导 -->
      <Card title-key="card_llama_dir">
        <!-- 标题文字右侧帮助图标：悬浮在图标右下角显示按步骤的引擎获取引导 -->
        <template #title-extra>
          <span
            ref="helpIconRef"
            class="card-help-icon"
            @mouseenter="showHelp"
            @mouseleave="hideHelp"
          >
            <Icon name="info" :size="13" />
          </span>
        </template>
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_exe_dir') }}</label>
          <div class="form-controls">
            <input class="path-input" type="text" v-model="llamaDir" />
            <button class="action-btn" @click="onBrowseExeDir">
              <Icon name="folder" :size="12" />
              <span>{{ i18n.t('btn_change_dir') }}</span>
            </button>
            <!-- 引擎检测状态徽章（图标 + 短文案；hover 显示详细提示） -->
            <ToolTip v-if="exeBadge" :text="exeBadge.tip">
              <span class="exe-status" :class="exeBadge.cls">
                <Icon :name="exeBadge.icon" :size="12" :class="{ spinning: exeBadge.spin }" />
                <span>{{ exeBadge.label }}</span>
              </span>
            </ToolTip>
          </div>
        </div>
      </Card>

      <!-- 引擎获取引导悬浮面板：Teleport 到 body，fixed 定位在图标右下角，不被卡片 header 裁切 -->
      <Teleport to="body">
        <div
          v-if="helpVisible"
          class="exe-help-panel"
          :style="helpPanelStyle"
          @mouseenter="showHelp"
          @mouseleave="hideHelp"
        >
        <div v-for="step in helpSteps" :key="step.num" class="exe-help-step">
          <span class="exe-help-step-num">{{ step.num }}</span>
          <span class="exe-help-step-text">{{ step.text }}</span>
        </div>
        <!-- 发布页跳转按钮：应用 action-btn 风格，点击打开 llama.cpp releases -->
        <button class="exe-help-open-btn" @click="onOpenLlamaReleases">
          <Icon name="external" :size="12" />
          <span>{{ i18n.t('btn_open_llama_releases') }}</span>
        </button>
      </div>
    </Teleport>

      <!-- 模型目录 -->
      <Card title-key="card_model_dir">
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_dir_path') }}</label>
          <div class="form-controls">
            <input class="path-input" type="text" v-model="modelsDir" />
            <button class="action-btn" @click="onBrowseModelDir">
              <Icon name="folder" :size="12" />
              <span>{{ i18n.t('btn_change_dir') }}</span>
            </button>
          </div>
        </div>
      </Card>

      <!-- 网络 -->
      <Card title-key="card_settings_network">
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_hf_mirror') }}</label>
          <div class="form-controls">
            <input
              class="path-input"
              type="text"
              v-model="hfMirrorHost"
              :placeholder="i18n.t('lbl_hf_mirror_placeholder')"
            />
          </div>
        </div>
      </Card>

      <!-- 下载 -->
      <Card title-key="card_settings_download">
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_max_concurrent') }}</label>
          <div class="form-controls">
            <select class="settings-select" v-model.number="maxConcurrent">
              <option v-for="n in concurrentOptions" :key="n" :value="n">{{ n }}</option>
            </select>
            <span class="field-hint">{{ i18n.t('lbl_max_concurrent_hint') }}</span>
          </div>
        </div>
      </Card>

      <!-- 外观与语言：两个设置项行共享同一标签列，行间距固定 -->
      <Card title-key="card_settings_appearance">
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_theme_mode') }}</label>
          <div class="form-controls">
            <select class="settings-select" v-model="themeMode">
              <option value="dark">{{ i18n.t('opt_theme_dark') }}</option>
              <option value="light">{{ i18n.t('opt_theme_light') }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_language') }}</label>
          <div class="form-controls">
            <select class="settings-select" v-model="language">
              <option value="zh">{{ i18n.t('opt_lang_zh') }}</option>
              <option value="en">{{ i18n.t('opt_lang_en') }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_fx_mode') }}</label>
          <div class="form-controls">
            <select class="settings-select" v-model="fxMode">
              <option value="glass">{{ i18n.t('opt_fx_glass') }}</option>
              <option value="off">{{ i18n.t('opt_fx_off') }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="field-label">{{ i18n.t('lbl_close_behavior') }}</label>
          <div class="form-controls">
            <select class="settings-select" v-model="closeBehavior">
              <option value="ask">{{ i18n.t('opt_close_ask') }}</option>
              <option value="exit">{{ i18n.t('opt_close_exit') }}</option>
              <option value="tray">{{ i18n.t('opt_close_tray') }}</option>
            </select>
          </div>
        </div>
      </Card>
    </div>
  </div>
</template>

<style scoped lang="scss">
.page {
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0; /* 防止长路径/长标签撑破卡片;不设固定 max-width,卡片宽度随窗口/内容区伸缩 */
}

.settings-hint {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

/* 表单行：固定标签列 + 可收缩控件区。
   外观与语言卡片内的多行通过 .form-row + .form-row 获得固定行间距，
   避免两行容器紧贴（容器冲突）。 */
.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;

  & + .form-row {
    margin-top: 12px;
  }
}

.field-label {
  flex: 0 0 140px;
  white-space: nowrap;
  font-size: var(--fs-lg);
  color: var(--fg-secondary);
}

/* 控件区：flex:1 占满剩余宽度；窄窗口时内部（输入/按钮/徽标/提示）换行，
   标签列保持原位不跳动。 */
.form-controls {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.field-hint {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

/* 卡片标题行帮助图标：紧靠标题文字右侧（Card #title-extra slot，flex 内联），
   悬浮在图标右下角显示按步骤的引擎获取引导面板；
   hover 圆角衬底 + accent 变色，与页面可交互图标（icon-btn 系）反馈一致 */
.card-help-icon {
  display: inline-flex;
  align-items: center;
  margin-left: 4px; /* 与标题文字保持小间距，避免重叠 */
  padding: 2px;
  color: var(--fg-muted);
  cursor: help;
  border-radius: var(--radius-pill);
  transition: color var(--dur-fast) var(--ease-jelly), background var(--dur-fast) var(--ease-jelly);

  &:hover {
    color: var(--accent);
    background: var(--bg-hover);
  }
}

.path-input {
  /* 随卡片宽度伸缩:fill 行内剩余宽度(按钮保持贴近右侧),不设 max-width 封顶,
     避免宽窗口下组件左侧聚拢、卡片右侧大片空白 */
  flex: 1 1 220px;
  min-width: 160px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-mono);

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}

.settings-select {
  min-width: 140px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}

/* 引擎检测状态徽章：图标 + 短文案，淡底配色对齐全局徽章风格（如 quant/source-badge） */
.exe-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;

  &.idle,
  &.detecting {
    color: var(--fg-muted);
    background: var(--bg-hover);
  }

  &.ok {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }

  &.missing {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }

  &.not_found {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
}

/* 检测中：refresh 图标旋转 */
.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--btn-h);
  padding: 0 14px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-md);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
</style>

<!-- 引擎获取引导面板样式：Teleport 到 body 后需用非 scoped 样式才能生效 -->
<style lang="scss">
.exe-help-panel {
  z-index: 9999;
  padding: 10px 12px;
  border-radius: var(--radius-row);
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-dropdown);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  animation: exe-help-panel-in var(--dur-fast) var(--ease-jelly);
}

@keyframes exe-help-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 步骤行：序号 + 文本，每步独占一行 */
.exe-help-panel .exe-help-step {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--fg-secondary);

  & + .exe-help-step {
    margin-top: 4px;
  }
}

.exe-help-panel .exe-help-step-num {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
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

/* 面板底部发布页跳转按钮：与应用 action-btn 视觉一致（Teleport 到 body 需全局样式） */
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

  &:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--accent);
  }

  &:active {
    transform: scale(0.96);
  }
}
</style>
