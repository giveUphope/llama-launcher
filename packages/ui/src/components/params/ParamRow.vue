<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import SliderParam from './SliderParam.vue';
import IntEntryParam from './IntEntryParam.vue';
import DropdownParam from './DropdownParam.vue';
import CheckboxParam from './CheckboxParam.vue';
import TextParam from './TextParam.vue';
import FileParam from './FileParam.vue';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

const props = defineProps<{
  p: ParamDef;
}>();

const params = useParamsStore();
const i18n = useI18nStore();

const enabled = computed<boolean>({
  get: () => params.isEnabled(props.p.key),
  set: (v) => params.setEnabled(props.p.key, v),
});

const enableTitle = computed(() => i18n.t('lbl_enable_param'));

// ----- 参数修改检测 -----
// 参数值与默认值不同，或参数被勾选启用时，显示内联小橙点
const hasChange = computed(() => {
  return enabled.value || params.values[props.p.key] !== props.p.default;
});

// ----- 依赖关系检测 -----
// 检查该参数的依赖是否满足（逻辑判定，不考虑参数是否启用）
const dependencyMet = computed(() => {
  if (!props.p.dependsOn) return true;
  const dep = props.p.dependsOn;
  const depValue = String(params.values[dep.key] ?? '');
  const depEnabled = params.isEnabled(dep.key);

  // 如果依赖参数未被启用，则依赖不满足
  if (!depEnabled) return false;

  // 检查 notValues（依赖值不应为这些值）
  if (dep.notValues && dep.notValues.includes(depValue)) return false;

  // 检查 values（依赖值应为这些值之一）
  if (dep.values && dep.values.length > 0) {
    return dep.values.includes(depValue);
  }

  return true;
});

// 依赖警告显示条件：
// 仅当用户主动启用本参数且修改了值（非默认），同时依赖未满足时才显示 ⚠
// 避免关联参数未启用时产生连锁报错（未启用的参数不应干扰用户）
const showDepWarning = computed(() => {
  if (!props.p.dependsOn) return false;
  if (dependencyMet.value) return false;
  // 必须同时满足：本参数已启用 + 值非默认值
  if (!enabled.value) return false;
  return params.values[props.p.key] !== props.p.default;
});

const dependencyHint = computed(() => {
  if (!showDepWarning.value) return '';
  const dep = props.p.dependsOn!;
  const depLabel = i18n.paramLabel(dep.key);
  // 依赖期望值展示：空字符串显示为「空」，其余原样拼接
  const fmt = (v: string) => (v === '' ? i18n.t('lbl_dep_empty') : v);
  if (dep.notValues && dep.notValues.length > 0) {
    const valuesText = dep.notValues.map(fmt).join(' / ');
    return i18n.t('msg_dependency_not_values').replace('{0}', depLabel).replace('{1}', valuesText);
  }
  if (dep.values && dep.values.length > 0) {
    const valuesText = dep.values.map(fmt).join(' / ');
    return i18n.t('msg_dependency_values').replace('{0}', depLabel).replace('{1}', valuesText);
  }
  return i18n.t('msg_dependency_enable').replace('{0}', depLabel);
});

// ----- GGUF 内联提示 -----
// 优先显示建议参数值（已格式化），其次显示原始 GGUF 字段值
// 对于 chat_template，原始值可能是很长的 Jinja 模板字符串，需显示为匹配的选项名
const ggufHint = computed<string | null>(() => {
  if (!params.ggufInfo) return null;

  // 优先：如果该参数有对应的建议值，显示建议值（已由 gguf-meta 推导完成）
  const sug = params.ggufSuggestions.find((s) => s.key === props.p.key);
  if (sug) {
    return formatGgufHint(sug.value);
  }

  // 其次：如果有 ggufField，显示原始 GGUF 字段值
  if (!props.p.ggufField) return null;
  const info = params.ggufInfo;
  const field = props.p.ggufField as keyof typeof info;
  const value = info[field];
  if (value === null || value === undefined || value === '') return null;

  // chat_template 原始值是完整 Jinja 模板字符串，过长，显示为"自定义"
  // jinja 参数的 ggufField 也指向 chat_template，同样需要此特殊处理
  if ((props.p.key === 'chat_template' || props.p.key === 'jinja') && typeof value === 'string') {
    return i18n.t('gguf_chat_template_custom');
  }

  return formatGgufHint(value);
});

// 是否有可点击应用的建议值（不依赖 ggufField，仅看是否有建议值）
const hasGgufSuggestion = computed(() => {
  return params.ggufSuggestions.some((s) => s.key === props.p.key);
});

// 格式化 GGUF 提示值
function formatGgufHint(v: unknown): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

// 点击 GGUF 提示时，一键应用建议值
function applyGgufHint() {
  if (!hasGgufSuggestion.value) return;
  const sug = params.ggufSuggestions.find((s) => s.key === props.p.key);
  if (sug) {
    params.set(sug.key, sug.value);
    params.setEnabled(sug.key, true);
  }
}
</script>

<template>
  <div class="param-row-wrapper" :class="{ disabled: !enabled, 'dep-unmet': showDepWarning }">
    <!-- 内联小橙点：参数修改即显示 -->
    <span v-if="hasChange" class="param-dot" :title="i18n.t('msg_param_modified')"></span>
    <!-- 无修改时预留占位，保持对齐 -->
    <span v-else class="param-dot-placeholder"></span>

    <input
      class="enable-checkbox"
      type="checkbox"
      v-model="enabled"
      :title="enableTitle"
    />
    <div class="param-content">
      <div class="param-control">
        <SliderParam v-if="p.type === 'int_slider' || p.type === 'float_slider'" :p="p" />
        <IntEntryParam v-else-if="p.type === 'int_entry'" :p="p" />
        <DropdownParam v-else-if="p.type === 'dropdown'" :p="p" />
        <CheckboxParam v-else-if="p.type === 'checkbox'" :p="p" />
        <FileParam v-else-if="p.type === 'file' || p.type === 'dir'" :p="p" />
        <TextParam v-else :p="p" />
      </div>
      <!-- GGUF 内联提示：所有参数行统一渲染占位，确保宽度一致 -->
      <span
        class="gguf-hint"
        :class="{ applicable: hasGgufSuggestion, empty: ggufHint === null }"
        :title="hasGgufSuggestion ? i18n.t('msg_click_to_apply') : (ggufHint !== null ? i18n.t('msg_gguf_model_value') : '')"
        @click="hasGgufSuggestion && applyGgufHint()"
      >
        <template v-if="ggufHint !== null">{{ ggufHint }}</template>
      </span>
      <!-- 依赖警告：仅在本参数已启用+值非默认+依赖未满足时显示 -->
      <span v-if="showDepWarning" class="dep-hint" :title="dependencyHint">
        ⚠
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.param-row-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  width: 100%;
  // 视觉分隔：边框 + 内边距让边框与内部组件有空间间隔
  // box-sizing: border-box 确保 padding 不撑破两列网格的列宽
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  border: 1px solid var(--border);
  transition: border-color var(--dur-fast) var(--ease-jelly), box-shadow var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);

  // hover 时增强边框高亮，明确指示操作目标
  &:hover {
    border-color: var(--accent);
  }

  &.disabled {
    opacity: 0.45;
  }

  // 依赖不满足时：降低不透明度但保持可操作（用户仍可手动启用）
  &.dep-unmet {
    opacity: 0.6;
  }
}

// 内联小橙点：参数修改时显示
.param-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--warn);
  flex-shrink: 0;
}

// 无修改时的占位，保持参数行对齐
.param-dot-placeholder {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
}

.enable-checkbox {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--accent);
}

.param-content {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.param-control {
  flex: 1;
  min-width: 0;

  // 约束 ToolTip 宿主宽度，使长标签在 label-text 上正确显示省略号。
  // 注意：不能给 host 设 overflow: hidden——ToolTip 的悬浮内容是该宿主的
  // 绝对定位子元素（向上弹出），会被 overflow: hidden 完全裁切导致悬浮不可见。
  :deep(.tooltip-host) {
    max-width: 100%;
  }
}

// GGUF 内联提示标签：内容自适应宽度，容器紧张时可收缩
// flex: 0 1 auto = 不增长、可收缩、基准宽度=内容宽度
// min-width 保证最小可读宽度，max-width 防止过长值撑开行
.gguf-hint {
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  color: var(--fg-muted);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 50px;
  max-width: 90px;
  text-align: center;

  // 无值时不占空间（不预留背景，避免空白块影响布局）
  &.empty {
    background: none;
    min-width: 0;
    width: 0;
    padding: 0;
    max-width: 0;
  }

  &.applicable {
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline dotted;

    &:hover {
      text-decoration: underline;
    }
  }
}

// 依赖不满足时的警告图标
.dep-hint {
  color: var(--warn);
  font-size: var(--fs-base);
  flex-shrink: 0;
  cursor: help;
}
</style>
