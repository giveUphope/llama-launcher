<script setup lang="ts">
// 阶段四：命令预览卡（从原 LaunchPage 迁入 ServicePage）。
// 双文本框，职责清晰：
//  - 【内置参数命令】：只读展示，由参数表实时自动生成（previewCommand，不含扩展参数）。
//    不可编辑——要改内置参数请去参数设置页控件；本框永远与 store 同步，无需「还原」。
//  - 【扩展参数】：唯一可编辑区，绑定 settings.custom_args（持久化），原样追加到实际
//    启动命令末尾（buildCommand customArgs）。
// 复制命令 = 内置命令 + 扩展参数合并。
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue';
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

// 内置参数命令（只读展示，随参数实时自动生成）
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
    commandPreview.value = i18n.t('msg_cmd_preview_error', [err?.message ?? String(err)]);
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

// 预览可信度提示：预览 = 下次启动会用的命令；服务在跑时它用的是启动那一刻的参数。
// 不说出来，用户会把屏幕上这串当成"正在跑的"（本次参数默认值误报就是这么被误读的）。
const staleCount = computed(() => {
  if (server.status !== 'running' && server.status !== 'starting') return 0;
  return params.countDiffers(server.runningValues);
});

// 回读对账派生：不一致与「引擎版本 ≠ 参数基线版本」是两件事，分开说；
// env 覆写正是不一致的常见成因，两者同时存在时合成一条因果句而不是并列两句。
const propsMismatch = computed(() => server.propsCheck?.mismatched ?? []);
const mismatchList = computed(() => propsMismatch.value.map((m) => `${m.flag}: ${m.sent} ≠ ${m.actual}`).join(', '));
const baselineDrift = computed(() => server.propsCheck?.baselineDrift ?? null);
// 核对结论展示在本卡（服务页），自动刷新的节拍也在这里挂：展示在哪就在哪看。
// 挂接是「本页真的可见」计数的进入/退出（keep-alive 下 onUnmounted 不执行，必须配对
// onActivated/onDeactivated，§7.1 铁律①）——后台页不计数就不敲端口。
// store 侧的节拍只在 running 时排表、结论连续不变就 ×2^n 退避到封顶，
// 与概览页外部实例探测同一套形状；引擎参数只可能被外部改写，本机没有事件源，
// 所以「可见 + 自适应退避」取代了此前「必须有人点一下」的纯按需。
let releasePropsWatch: (() => void) | null = null;
onActivated(() => {
  releasePropsWatch?.();
  releasePropsWatch = server.enterPropsWatch();
});
onDeactivated(() => {
  releasePropsWatch?.();
  releasePropsWatch = null;
});

// 界面列出的 env 变量与不一致项同时出现时，才把两者说成有因果——只有 env 变量不构成归因，
// 只有不一致也不该甩锅给环境（还可能是引擎版本漂移或我们基线填错）。
const envBlame = computed(() => server.envOverrides.length > 0 && propsMismatch.value.length > 0);

// ---- 常驻状态行（STYLE_TODO #81 档 2：五行合一，槽恒在、只换文案）----
// 原先这五条提示各自 v-if，插在预览框与「扩展参数」区之间：任何一条出现就把整卡顶高一档，
// 两条分支文案长短不同还会再变行数——用户拖一下滑块就看到下方卡片上下跳。
// 现在只留一条固定高度的状态行：内容按优先级并列成一句（超出两档的部分省略，完整文案走 title），
// 「保持安静」的口径不变——一致或未回读绝不写成「全部参数都核对过」，未核对时只说明可做什么。
interface StatusPart {
  text: string;
  warn: boolean;
}
const statusParts = computed<StatusPart[]>(() => {
  const parts: StatusPart[] = [];
  const envList = server.envOverrides.join(', ');
  if (staleCount.value) {
    parts.push({ warn: true, text: i18n.t('cmd_stale_running', [String(staleCount.value)]) });
  }
  if (propsMismatch.value.length) {
    parts.push(
      envBlame.value
        ? {
            warn: true,
            text: i18n.t('cmd_props_mismatch_env', [
              String(propsMismatch.value.length),
              mismatchList.value,
              envList,
            ]),
          }
        : {
            warn: true,
            text: i18n.t('cmd_props_mismatch', [String(propsMismatch.value.length), mismatchList.value]),
          },
    );
  }
  // env 覆写单独说明：不一致那句已经带上同一批变量时不再重复列一遍
  if (server.envOverrides.length && !envBlame.value) {
    parts.push({ warn: true, text: i18n.t('cmd_env_overrides', [envList]) });
  }
  const drift = baselineDrift.value;
  if (drift) {
    parts.push({ warn: true, text: i18n.t('cmd_baseline_drift', [drift.engineBuild, drift.baselineBuild]) });
  }
  return parts;
});
// 只在**有事要说**时出声：核对通过、还没轮到回读、服务没跑——这些都是「无需提示」的常态，
// 一行字都不出（用户 2026-10-06 标注：智能处理完成后不必提示，也不该催人点按钮）。
// 槽位仍由 .cmd-status 的 min-height 常驻，空文案不改变卡片高度（STYLE_TODO #81 的预留纪律）。
const statusText = computed(() => statusParts.value.map((p) => p.text).join(' · '));
// 配色/图标跟随最高优先级那条（首条）：混排时不并列两种颜色，避免一行里出现两个语义色。
const statusWarn = computed(() => statusParts.value[0]?.warn ?? false);

async function onCopyCmd() {
  if (!fullCommand.value) return;
  await window.api.clipboard.write(fullCommand.value);
}

onUnmounted(() => {
  if (previewTimer) clearTimeout(previewTimer);
  // keep-alive 外的真实卸载（路由配置变更 / 测试挂载）也要退掉可见计数
  releasePropsWatch?.();
  releasePropsWatch = null;
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
        <!-- 常驻状态行槽：min-height 预留两档行高（中文态一行、英文长句两行都装得下），
             文案再怎么换都不撑高；不一致明细再长也只占两档，完整内容走 title（§7.1 铁律③：
             预留用静态 CSS，不做「测量再回填」）。 -->
        <div class="cmd-status">
          <Icon class="cmd-status-icon" :name="statusWarn ? 'alert' : 'info'" :size="11" />
          <span class="cmd-status-text" :class="{ 'cmd-status-text--warn': statusWarn }" :title="statusText">
            {{ statusText }}
          </span>
        </div>
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

// 常驻状态行槽（原五条 v-if 提示行的替代物）：槽恒在，只换文案。
// 高度 = 两档 --fs-sm 行高（12px × 1.5 = 18px/档），中英两态都不会超出。
.cmd-status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-height: 36px;
}

.cmd-status-icon {
  flex: 0 0 auto;
  margin-top: 3px; // 与 18px 行框的首行文字基线对齐（18 - 11 图标高）/ 2 ≈ 3px
}

// 两档封顶：超出部分省略，完整文案由 title 承载（不加滚动、不做测量）
.cmd-status-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--color-text-3);
}

// 警示语义：橙（与 ParamRow 的超限提示同一 token，不自造色值）
.cmd-status-text--warn {
  color: rgb(var(--orange-6));
}
</style>
