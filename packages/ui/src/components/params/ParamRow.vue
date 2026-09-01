<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { PARAMS } from '@llama-launcher/shared';
import SliderParam from './SliderParam.vue';
import IntEntryParam from './IntEntryParam.vue';
import DropdownParam from './DropdownParam.vue';
import CheckboxParam from './CheckboxParam.vue';
import TextParam from './TextParam.vue';
import FileParam from './FileParam.vue';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import Icon from '@/components/common/Icon.vue';

const props = defineProps<{
  p: ParamDef;
}>();

const params = useParamsStore();
const i18n = useI18nStore();

const value = computed(() => params.values[props.p.key]);

const hasChange = computed(() => value.value !== props.p.default);

const dependencyMet = computed(() => {
  if (!props.p.dependsOn) return true;
  const dep = props.p.dependsOn;
  const depDef = PARAMS.find((x) => x.key === dep.key);
  if (!depDef) return false;
  const depValue = params.values[dep.key] ?? '';
  if (depValue === depDef.default) return false;
  if (dep.notValues && dep.notValues.includes(String(depValue))) return false;
  if (dep.values && dep.values.length > 0 && !dep.values.includes(String(depValue))) return false;
  return true;
});

const showDepWarning = computed(() => {
  if (!props.p.dependsOn) return false;
  if (dependencyMet.value) return false;
  return value.value !== props.p.default;
});

const dependencyHint = computed(() => {
  if (!showDepWarning.value) return '';
  const dep = props.p.dependsOn!;
  const depLabel = i18n.paramLabel(dep.key);
  const fmt = (v: string) => (v === '' ? i18n.t('lbl_dep_empty') : v);
  if (dep.notValues && dep.notValues.length > 0) {
    return i18n.t('msg_dependency_not_values').replace('{0}', depLabel).replace('{1}', dep.notValues.map(fmt).join(' / '));
  }
  if (dep.values && dep.values.length > 0) {
    return i18n.t('msg_dependency_values').replace('{0}', depLabel).replace('{1}', dep.values.map(fmt).join(' / '));
  }
  return i18n.t('msg_dependency_enable').replace('{0}', depLabel);
});

const ggufHint = computed<string | null>(() => {
  if (!params.ggufInfo) return null;
  const sug = params.ggufSuggestions.find((s) => s.key === props.p.key);
  if (sug) return formatGgufHint(sug.value);
  if (!props.p.ggufField) return null;
  const info = params.ggufInfo;
  const field = props.p.ggufField as keyof typeof info;
  const val = info[field];
  if (val === null || val === undefined || val === '') return null;
  if ((props.p.key === 'chat_template' || props.p.key === 'jinja') && typeof val === 'string') {
    return i18n.t('gguf_chat_template_custom');
  }
  return formatGgufHint(val);
});

const hasGgufSuggestion = computed(() => params.ggufSuggestions.some((s) => s.key === props.p.key));

function formatGgufHint(v: unknown): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

function applyGgufHint() {
  if (!hasGgufSuggestion.value) return;
  const sug = params.ggufSuggestions.find((s) => s.key === props.p.key);
  if (sug) params.set(sug.key, sug.value);
}

function onClear() {
  params.resetParam(props.p.key);
}
</script>

<template>
  <div class="param-row-wrapper" :class="{ 'dep-unmet': showDepWarning, 'changed': hasChange && !showDepWarning }">
    <div class="param-content">
      <div class="param-control">
        <SliderParam v-if="p.type === 'int_slider' || p.type === 'float_slider'" :p="p" />
        <IntEntryParam v-else-if="p.type === 'int_entry'" :p="p" />
        <DropdownParam v-else-if="p.type === 'dropdown'" :p="p" />
        <CheckboxParam v-else-if="p.type === 'checkbox'" :p="p" />
        <FileParam v-else-if="p.type === 'file' || p.type === 'dir'" :p="p" />
        <TextParam v-else :p="p" />
      </div>
      <span
        class="gguf-hint"
        :class="{ applicable: hasGgufSuggestion, empty: ggufHint === null }"
        :title="hasGgufSuggestion ? i18n.t('msg_click_to_apply') : (ggufHint !== null ? i18n.t('msg_gguf_model_value') : '')"
        @click="hasGgufSuggestion && applyGgufHint()"
      >
        <template v-if="ggufHint !== null">{{ ggufHint }}</template>
      </span>
      <span v-if="showDepWarning" class="dep-hint" :title="dependencyHint">
        <Icon name="alert" :size="12" />
      </span>
    </div>
    <button
      v-if="hasChange"
      class="clear-btn"
      :title="i18n.t('msg_clear_param')"
      @click="onClear"
    >
      <Icon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.param-row-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  border: 1px solid transparent;
  background: transparent;
  transition: background var(--dur-fast) var(--ease-smooth),
              border-color var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border);
  }

  &.dep-unmet {
    border-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 6%, transparent);
  }

  // 非默认值行：--warn 调整提示橙描边（与右侧还原按钮同色系）。
  // 依赖未满足时由 dep-unmet 呈现（同色描边 + 底色 + 警示图标），不重复挂类；
  // 悬停保持橙色，不回落到通用 hover 灰描边。
  &.changed {
    border-color: var(--warn);

    &:hover {
      border-color: var(--warn);
    }
  }
}

.param-content {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.param-control {
  flex: 1;
  min-width: 0;
  :deep(.tooltip-host) {
    max-width: 100%;
  }
}

.gguf-hint {
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  color: var(--fg-muted);
  background: var(--bg-hover);
  padding: 0 5px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 44px;
  max-width: 72px;
  text-align: center;

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
    &:hover { text-decoration: underline; }
  }
}

.dep-hint {
  color: var(--warn);
  font-size: var(--fs-sm);
  flex-shrink: 0;
  cursor: help;
}

// 参数还原按钮：20px 胶囊幽灵图标按钮（统一小图标可供性语言）。
// 默认弱化（半透明、随行悬停渐显），悬停软 warn 色调（非实心黄底，
// 密集参数页中逐行实心圆点视觉突兀）；键盘聚焦时保持可见。
.clear-btn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  opacity: 0.55;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-smooth), background var(--dur-fast) var(--ease-smooth),
    opacity var(--dur-fast) var(--ease-smooth);

  &:hover {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    opacity: 1;
  }

  &:focus-visible {
    opacity: 1;
  }

}

// 行悬停时还原按钮完全显形（密集页降噪；键盘焦点路径已单独保可见）
.param-row-wrapper:hover .clear-btn {
  opacity: 1;
}

</style>
