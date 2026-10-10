<script setup lang="ts">
// 阶段四：命令预览卡（从原 LaunchPage 迁入 ServicePage）。
// 双文本框，职责清晰：
//  - 【内置参数命令】：只读展示，由参数表实时自动生成（previewCommand，不含扩展参数）。
//    不可编辑——要改内置参数请去参数设置页控件；本框永远与 store 同步，无需「还原」。
//  - 【扩展参数】：唯一可编辑区，绑定 settings.custom_args（持久化），原样追加到实际
//    启动命令末尾（buildCommand customArgs）。
// 复制命令 = 内置命令 + 扩展参数合并。
// 卡片下方的常驻状态行（参数不一致 / /props 回读 / env 覆写 / 基线漂移）已于 2026-10-07
// 按用户决定迁出：现落在应用设置「常规」卡引擎目录行下方，作为可忽略提示（GeneralPanel）。
import { computed, onUnmounted, ref, watch } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { useAppLogStore } from '@/stores/appLog';
import { formatCommand, formatCommandLines, readCommandErrorCode, tokenizeArgs } from '@llama-launcher/shared';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();
const appLog = useAppLogStore();

// 内置参数命令（只读展示，随参数实时自动生成）。IPC 回传 **argv 数组**（发射唯一实现的
// 产物），两种展示形态都从它格式化——预览框 = formatCommandLines（一行一个参数），
// 复制 = formatCommand（单行，跨 shell 可直接执行）。
const commandArgv = ref<string[]>([]);
/**
 * 失败码 → 界面文案键。两个码复用设置页引擎行既有的那两句（同一件事在两个界面说法必须一致），
 * unknown 走新键。
 *
 * 为什么把键放进映射表（字段名以 Key 结尾）而不是在 switch 里直接 return 一个键名串：
 * `verify-i18n-usage.cjs` 只认两种引用形态——t 调用里的字面量、以及以 Key 结尾的字段所赋的字面量。
 * 裸 return 属于盲区：将来删掉那个键，门禁和界面都不会红，只会让界面把原始键名渲染出来。
 * （本段刻意不写这两种形态的示例串——门禁连注释里的示例都当真实引用去查键，一写就自造悬空引用。）
 */
const PREVIEW_HINT_KEYS = {
  notConfiguredKey: 'msg_no_exe_hint',
  missingKey: 'msg_exe_file_missing',
  unknownKey: 'msg_cmd_preview_failed',
} as const;

/**
 * 预览失败类型：`exe_not_configured` / `exe_missing` 是**首次使用的正常态**（还没配引擎目录），
 * 必须翻成「哪儿没配 + 去哪儿配」；其余归 unknown，界面只说一句失败，后端英文原文进应用日志。
 * 绝不把 `err.message` 插进界面文案——那是「中文句子里塞一句英文标识符」的成因。
 */
const previewFailure = ref<'exe_not_configured' | 'exe_missing' | 'unknown' | null>(null);

const previewHintKey = computed(() => {
  switch (previewFailure.value) {
    case 'exe_not_configured': return PREVIEW_HINT_KEYS.notConfiguredKey;
    case 'exe_missing': return PREVIEW_HINT_KEYS.missingKey;
    case 'unknown': return PREVIEW_HINT_KEYS.unknownKey;
    default: return '';
  }
});

// 预览框：一行一个参数（业界惯例——llama.cpp 官方 README / Dockerfile / apt 均以
// 行尾续行符拆参数提升可读性；本框是只读查看器，不加续行符，逐行即等价 argv）
const commandPreview = computed(() => formatCommandLines(commandArgv.value));

async function updatePreview() {
  if (!settings.settings) {
    commandArgv.value = [];
    previewFailure.value = null;
    return;
  }
  try {
    commandArgv.value = await server.previewCommand(params.snapshot(), settings.settings);
    previewFailure.value = null;
  } catch (err: any) {
    commandArgv.value = [];
    const code = readCommandErrorCode(err);
    previewFailure.value = code ?? 'unknown';
    // 只有说不清原因的那一态才留原文进日志：两个已知码的界面文案已经指到配置入口
    if (!code) appLog.push({ kind: 'error', data: `[preview] ${err?.message ?? String(err)}\n`, ts: Date.now() });
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

// 复制/展示用完整命令 = 内置 argv + 扩展参数词法切分后合并，**复制的是单行形态**
// （跨 shell 可直接执行；预览框的一行一个参数是查看形态，二者同源等价）
const fullCommand = computed(() => {
  if (previewFailure.value || commandArgv.value.length === 0) return '';
  const extra = tokenizeArgs(extraArgs.value.trim());
  return formatCommand([...commandArgv.value, ...extra]);
});

async function onCopyCmd() {
  if (!fullCommand.value) return;
  await window.api.clipboard.write(fullCommand.value);
}

onUnmounted(() => {
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
          :auto-size="{ minRows: 4, maxRows: 20 }"
          :textarea-attrs="{ readonly: true, spellcheck: false }"
        />
        <!-- 失败原因按需展示（a-alert 是全站告警范式）：只出「哪儿没配 / 去哪儿配」，
             后端英文原文不进界面（unknown 那一态的原文落进应用日志） -->
        <a-alert v-if="previewHintKey" class="cmd-alert" type="warning" show-icon>
          {{ i18n.t(previewHintKey) }}
        </a-alert>
      </div>

      <!-- 扩展参数：唯一可编辑区，持久化，追加到实际启动命令末尾 -->
      <div class="cmd-section">
        <span class="cmd-section-label">{{ i18n.t('lbl_cmd_extra') }}</span>
        <a-textarea
          class="cmd-preview cmd-extra"
          v-model="extraArgs"
          :placeholder="i18n.t('cmd_extra_placeholder')"
          :auto-size="{ minRows: 3, maxRows: 8 }"
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

/* 三行示例占位完整可见（#121）：auto-size 的 3 行行内高度（3×18=54px）不足以
   容纳 3×19.5 行高 + 16px 内距 + 2px 边框 ≈ 76.5px，示例第三行被裁——
   min-height 恒定胜过 auto-size 的行内 height；有内容时行内高度照常长大、不再受限 */
.cmd-extra :deep(.arco-textarea) {
  min-height: calc(4.5em + 18px);
}

.cmd-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--fg-hint);
}

// 预览失败告警（按需出现，全站 a-alert 范式）：不覆写 Arco 的字号与配色——
// .sec-hint / .oom-alert / .parse-status 都没覆写，单独压低一处就是新的风格偏离（§7.5）。
// `cmd-alert` 类名保留：它是单测定位这条告警的唯一钩子（CommandPreviewCard.test.ts 找 .cmd-alert）</style>
