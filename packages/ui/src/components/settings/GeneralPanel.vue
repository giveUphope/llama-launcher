<script setup lang="ts">
// 阶段三：设置页「常规」分组 —— 模型目录、llama 后端（引擎目录）+ 引擎检测、关闭窗口行为。
// 设计稿 §14.10 / 补充指南 §14.10：模型目录提供「打开目录」；
// 原独立「llama.cpp」标签（LlamaPanel）已整合为本卡片内的引擎目录行。
import type { IconName } from '@/components/common/icon-map';
import { computed, ref, watch, nextTick, getCurrentInstance, onActivated, onDeactivated, onUnmounted } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { vInnerAriaLabel } from '@/directives/innerAriaLabel';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
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

const exeBadge = computed<{ icon: IconName; color: 'gray' | 'arcoblue' | 'green' | 'red'; tip: string; label: string; loading?: boolean } | null>(() => {
  switch (exeStatus.value) {
    case 'idle':
      return { icon: 'info', color: 'gray', tip: i18n.t('msg_no_exe_hint'), label: i18n.t('lbl_exe_state_idle') };
    case 'detecting':
      // loading 态由 a-tag 的官方 loading prop 渲染转圈，图标留空
      return { icon: 'refresh', color: 'arcoblue', tip: i18n.t('msg_exe_detecting'), label: i18n.t('lbl_exe_state_detecting'), loading: true };
    case 'ok':
      return {
        icon: 'file_check', color: 'green',
        tip: detectedExePath.value
          ? i18n.t('lbl_exe_detected_path', [detectedExePath.value])
          : i18n.t('lbl_exe_state_ready'),
        label: i18n.t('lbl_exe_state_ready'),
      };
    case 'missing':
      return { icon: 'alert', color: 'red', tip: i18n.t('msg_exe_file_missing'), label: i18n.t('lbl_exe_state_missing') };
    default:
      return { icon: 'alert', color: 'red', tip: i18n.t('msg_exe_not_found'), label: i18n.t('lbl_exe_state_not_found') };
  }
});

async function onBrowseExeDir() {
  const dir = await pickDir({ title: i18n.t('msg_select_exe_dir'), defaultPath: llamaDir.value || undefined });
  if (dir) llamaDir.value = dir;
}

async function onOpenLlamaReleases() {
  try { await window.api.openExternal(LLAMA_CPP_RELEASES_URL); } catch { /* 静默 */ }
}

// 悬浮帮助面板（引擎获取指引）：定位、视口避让、滚动跟随、hover 延迟与 teleport 全部交给
// a-trigger（a-popover 的底层原语）。库里没有的只有两件事，所以只有这两处留在这里手写：
// Esc 关闭（trigger.js 没有 escToClose 属性）与键盘打开时把焦点移进浮层（它不管理焦点）。
const helpVisible = ref(false);
// 触发器是 a-button：模板 ref 拿到的是组件实例，归还焦点要的是它的根 <button>
const helpIconRef = ref<{ $el?: HTMLElement } | null>(null);
const helpPanelRef = ref<HTMLElement | null>(null);
const helpPanelId = `exe-help-panel-${getCurrentInstance()?.uid ?? 0}`;

const helpSteps = computed(() =>
  i18n.t('msg_exe_help_steps').split('\n').map((text, i) => ({ num: i + 1, text })),
);

function getHelpIconEl(): HTMLElement | null {
  return helpIconRef.value?.$el ?? null;
}

// 焦点归还：只有当焦点确实在浮层里（键盘打开过，又在浮层里按 Esc 或点浮层外）才收回触发器。
// 纯 hover 开关时焦点从未进过浮层，这时抢焦点是错的。
function returnHelpFocus() {
  if (helpPanelRef.value && helpPanelRef.value.contains(document.activeElement)) getHelpIconEl()?.focus();
}
// a-trigger 的可见性回调（受控模式）：hover 进出与点击外部关闭都走这里
function onHelpVisibleChange(visible: boolean) {
  helpVisible.value = visible;
  if (!visible) returnHelpFocus();
}
// 键盘入口：Enter/Space 由原生 button 自带的 click 承接（不另写 keydown，写了会与 click
// 叠加成「开→立刻关」）。打开后把焦点移进浮层——它唯一的动作是里面的按钮，不移入就 Tab 不进去。
function onHelpActivate() {
  const next = !helpVisible.value;
  helpVisible.value = next;
  if (next) void nextTick(() => helpPanelRef.value?.focus());
  else returnHelpFocus();
}
function onHelpGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onHelpVisibleChange(false);
}
// Esc 监听随浮层开关配对：只在浮层真的打开期间驻留
watch(helpVisible, (visible) => {
  if (visible) document.addEventListener('keydown', onHelpGlobalKeydown);
  else document.removeEventListener('keydown', onHelpGlobalKeydown);
});
onDeactivated(() => {
  // 浮层挂在 body 上，不随 keep-alive 页面一起隐藏：切走页面时必须就地关掉
  helpVisible.value = false;
  // /props 复检的可见计数随面板退场（展示在哪就在哪看，后台页不计数就不敲端口）
  releasePropsWatch?.();
  releasePropsWatch = null;
});
onUnmounted(() => {
  if (detectTimer) { clearTimeout(detectTimer); detectTimer = null; }
  document.removeEventListener('keydown', onHelpGlobalKeydown);
});

// ---- 关闭窗口行为 ----
const closeBehavior = computed<CloseBehavior>({
  get: () => settings.settings?.close_behavior ?? 'ask',
  set: (v) => { if (settings.settings) { settings.settings.close_behavior = v; void settings.save(); } },
});

// ---- 引擎提示（2026-10-07 自服务页命令预览卡迁入，用户决定：提示归设置页引擎行）----
// 四类消息：参数与运行中服务不一致 / /props 回读不一致 / env 覆写 / 引擎构建旧于基线。
// 「只在有事要说时出声」口径不变——一致或未回读一行不出（2026-10-06 用户标注）。
// 形态（2026-10-08 按用户复核二次修正）：行内追加在引擎目录行尾部（path-row 末位，
// 窄窗口经 flex-wrap 折行仍贴着本行），可见文案用短句键（hint_*_s），现有长句键降为
// hover title——独占一行的长句被批注「过长、不在行后」，行内形态只有文案够短才成立。
// 可忽略（按条）：点「忽略」把当前行里每条消息的长句全文存进 settings.engine_hint_dismissed，
// 被忽略的条目保持安静、新出现的消息照常显示——不按整行忽略，因为「N 项不同」的计数
// 随参数编辑逐次变化，整行指纹会被每次编辑绕过（实测教训）。写入裁剪到最近 50 条。
// 回读自动刷新的可见计数也挂在这里：展示在哪就在哪看。挂接是「本面板真的可见」计数的
// 进入 / 退出（keep-alive 下 onUnmounted 不执行，必须配对 onActivated/onDeactivated，
// §7.1 铁律①）；store 侧节拍只在 running 时排表、结论连续不变就 ×2^n 退避到封顶，
// 与概览页外部实例探测同一套形状。
const server = useServerStore();
const params = useParamsStore();

const staleCount = computed(() => {
  if (server.status !== 'running' && server.status !== 'starting') return 0;
  return params.countDiffers(server.runningValues);
});
const propsMismatch = computed(() => server.propsCheck?.mismatched ?? []);
const mismatchList = computed(() => propsMismatch.value.map((m) => `${m.flag}: ${m.sent} ≠ ${m.actual}`).join(', '));
const baselineDrift = computed(() => server.propsCheck?.baselineDrift ?? null);
// env 变量与不一致项同时出现才构成归因——只有 env 变量不甩锅给环境（还可能是引擎漂移或基线填错）
const envBlame = computed(() => server.envOverrides.length > 0 && propsMismatch.value.length > 0);

interface EngineHintPart {
  /** 行内短句（hint_*_s）：提示条上直接可见的文字 */
  short: string;
  /** 长句（cmd_*，原命令预览卡文案）：hover title 承载完整解释 */
  long: string;
  warn: boolean;
}
const engineHintParts = computed<EngineHintPart[]>(() => {
  const parts: EngineHintPart[] = [];
  const envList = server.envOverrides.join(', ');
  if (staleCount.value) {
    parts.push({
      warn: true,
      short: i18n.t('hint_stale_running_s', [String(staleCount.value)]),
      long: i18n.t('cmd_stale_running', [String(staleCount.value)]),
    });
  }
  if (propsMismatch.value.length) {
    parts.push(
      envBlame.value
        ? {
            warn: true,
            short: i18n.t('hint_props_mismatch_env_s', [
              String(propsMismatch.value.length),
              mismatchList.value,
              envList,
            ]),
            long: i18n.t('cmd_props_mismatch_env', [
              String(propsMismatch.value.length),
              mismatchList.value,
              envList,
            ]),
          }
        : {
            warn: true,
            short: i18n.t('hint_props_mismatch_s', [String(propsMismatch.value.length), mismatchList.value]),
            long: i18n.t('cmd_props_mismatch', [String(propsMismatch.value.length), mismatchList.value]),
          },
    );
  }
  // env 覆写单独说明：不一致那句已经带上同一批变量时不再重复列一遍
  if (server.envOverrides.length && !envBlame.value) {
    parts.push({
      warn: true,
      short: i18n.t('hint_env_overrides_s', [envList]),
      long: i18n.t('cmd_env_overrides', [envList]),
    });
  }
  const drift = baselineDrift.value;
  if (drift) {
    parts.push({
      warn: true,
      short: i18n.t('hint_baseline_drift_s', [drift.engineBuild, drift.baselineBuild]),
      long: i18n.t('cmd_baseline_drift', [drift.engineBuild, drift.baselineBuild]),
    });
  }
  return parts;
});
const dismissedHints = computed(() => new Set(settings.settings?.engine_hint_dismissed ?? []));
// 被忽略的条目不进渲染行：剩下的才是这条提示此刻要说的话
const visibleHintParts = computed(() => engineHintParts.value.filter((p) => !dismissedHints.value.has(p.long)));
const engineHintText = computed(() => visibleHintParts.value.map((p) => p.short).join(' · '));
const engineHintTitle = computed(() => visibleHintParts.value.map((p) => p.long).join(' · '));
const engineHintWarn = computed(() => visibleHintParts.value[0]?.warn ?? false);
const engineHintVisible = computed(() => visibleHintParts.value.length > 0);

const HINT_DISMISS_CAP = 50;
function onDismissEngineHint() {
  if (!settings.settings || !visibleHintParts.value.length) return;
  const next = new Set(dismissedHints.value);
  for (const p of visibleHintParts.value) next.add(p.long);
  const list = [...next];
  settings.settings.engine_hint_dismissed = list.slice(-HINT_DISMISS_CAP);
  void settings.save();
}

// /props 复检的可见性挂接：本面板是结论的展示点之一（另一个是概览状态卡）
let releasePropsWatch: (() => void) | null = null;
onActivated(() => {
  releasePropsWatch?.();
  releasePropsWatch = server.enterPropsWatch();
});
</script>

<template>
  <Card title-key="nav_settings_general">
    <template #title-extra>
      <!-- 悬浮帮助面板：定位、视口避让、点击外部关闭、hover 停留、表面样式（底/边/阴影/
           箭头/入场动画）全部由 a-popover 承载（官方组件，内部就是 a-trigger）。
           库没有给的只有两件事，仍由本组件手写：Esc 关闭（trigger 无 escToClose 属性）
           与键盘打开时把焦点移进浮层（它不管理焦点）。hover 延迟取 Arco 默认 100ms，
           不再自定 300/150ms 的定时器。 -->
      <a-popover
        :popup-visible="helpVisible"
        trigger="hover"
        position="bottom"
        :content-style="{ width: '320px' }"
        content-class="exe-help-pop"
        @popup-visible-change="onHelpVisibleChange"
      >
        <template #content>
          <div :id="helpPanelId" ref="helpPanelRef" tabindex="-1" class="exe-help-panel">
            <div v-for="step in helpSteps" :key="step.num" class="exe-help-step">
              <span class="exe-help-step-num">{{ step.num }}</span>
              <span class="exe-help-step-text">{{ step.text }}</span>
            </div>
            <a-button size="small" class="exe-help-open-btn" @click="onOpenLlamaReleases">
              <template #icon><Icon name="external" :size="12" /></template>
              {{ i18n.t('btn_open_llama_releases') }}
            </a-button>
          </div>
        </template>
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
          @click="onHelpActivate"
        >
          <Icon name="info" :size="13" />
        </a-button>
      </a-popover>
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
              <template #icon><Icon name="folder" :size="12" /></template>
              {{ i18n.t('btn_open_dir') }}
            </a-button>
          </ToolTip>
        </div>
      </a-form-item>

      <a-form-item :label="i18n.t('lbl_exe_dir')">
        <div class="path-row engine-path-row">
          <a-input v-model="llamaDir" class="path-input" size="small" :input-attrs="{ 'aria-label': i18n.t('lbl_exe_dir') }" />
          <a-button size="small" @click="onBrowseExeDir">
            <template #icon><Icon name="folder" :size="12" /></template>
            {{ i18n.t('btn_change_dir') }}
          </a-button>
            <!-- 引擎状态胶囊：a-tag 官方预设色（2026-10-08 按用户要求对齐 Arco 官方最佳实践，
                 自绘 chip 是官方 Tag 的平行实现）。常驻定宽槽保留：槽宽按双语最宽状态文案预留，
                 检测结论落地时行内固有宽度不变；nowrap 防文案折行 -->
            <span class="exe-status-slot">
              <ToolTip v-if="exeBadge" :text="exeBadge.tip">
                <a-tag class="exe-tag" :color="exeBadge.color" size="small" nowrap :loading="exeBadge.loading === true">
                  <template #icon>
                    <Icon v-if="!exeBadge.loading" :name="exeBadge.icon" :size="12" />
                  </template>
                  {{ exeBadge.label }}
                </a-tag>
              </ToolTip>
            </span>

          <!-- 引擎提示（2026-10-07 自服务页命令预览卡迁入）：参数不一致 / /props 回读 /
               env 覆写 / 基线漂移，有事才出声。形态三轮收敛（2026-10-08 用户再次要求对齐
               官方档）：行内追加在引擎目录行尾，本体 = a-tag closable（官方关闭钮内建
               role="button" + aria-label，官方 orange/gray 预设色对），短句直接可见、
               完整长句走 ToolTip；点官方关闭钮按条持久化，新出现的消息照常显示 -->
          <a-tag
            v-if="engineHintVisible"
            class="engine-hint-tag"
            :color="engineHintWarn ? 'orange' : 'gray'"
            size="small"
            closable
            nowrap
            @close="onDismissEngineHint"
          >
            <template #icon><Icon :name="engineHintWarn ? 'alert' : 'info'" :size="12" /></template>
            <ToolTip :text="engineHintTitle">
              <span class="engine-hint-text">{{ engineHintText }}</span>
            </ToolTip>
          </a-tag>
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

// 胶囊定宽槽：156px 覆盖英文最宽态「Engine file missing」+ 图标 + 内距（中文态留白但几何恒定）。
// 槽内是 a-tag 官方预设色（2026-10-08 对齐官方组件，自绘 chip 的配色/圆角/字重全部删除），
// Tag 自带尺寸与配色，此处不写任何 Arco 节点样式（风格审计第 20 条零登记面）
.exe-status-slot {
  display: inline-flex;
  align-items: center;
  flex: 0 0 156px;
  min-width: 0;
}
/* 检测中图标走 a-tag 的官方 loading prop（Arco IconLoading 自带旋转动画） */

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
// 浮层本体只留排印：底、边、阴影、圆角、箭头与入场动画都由 a-popover 提供（官方表面），
// 层级也交回 Arco 的 popup 计数器——原这里的 z-index / box-shadow / animation 三条已删。
.exe-help-panel {
  outline: none; // tabindex="-1" 只为可编程聚焦，浮层不需要自己的焦点环（焦点环在触发器上）
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

/* 引擎目录行：输入框不参与 grow（保持 200 基准宽，与模型目录行同宽节奏），
   行尾剩余空间全部让给引擎提示 */
.engine-path-row .path-input {
  flex-grow: 0;
}

/* 引擎提示：a-tag closable 官方组件（2026-10-08 三轮对齐的定稿——官方关闭钮内建
   role="button" + aria-label="Close"，配色走官方 orange/gray 预设对，同 StatusTag 先例；
   此前自绘的行布局 / 角色色 / 忽略钮全部删除）。tag 在引擎目录行尾弹性收缩：
   min-width 0，超宽时内部 ToolTip host（自带 min-width 0）带动内层 span 省略号，
   完整长句走 ToolTip */
.engine-hint-tag {
  flex: 0 1 auto;
  min-width: 0;
}

/* Arco Tag 把默认插槽包进 .arco-tag-text（flex 项、无 min-width: 0，min-content 撑住
   不收缩）——放开收缩转 flex，接通「ToolTip host → 内层 span」的省略链 */
.engine-hint-tag :deep(.arco-tag-text) {
  min-width: 0;
  flex: 1;
  display: flex;
}

.engine-hint-text {
  display: block;
  min-width: 0;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>