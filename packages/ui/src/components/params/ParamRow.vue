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
  // 依赖源"生效"语义与命令构建器保持一致：
  // checkbox 依赖源按布尔语义判定（默认值为 true 的 cache_prompt 勾选即生效），
  // 其余类型以"值 ≠ 其默认值"判定。否则 cache_reuse 会被误标依赖不满足并禁用，
  // 与命令实际发射相反（详见 stores/params.ts isDependencySatisfied 注释）。
  if (depDef.type === 'checkbox') {
    const b = depValue === true || depValue === 'true' || depValue === 1 || depValue === '1';
    if (!b) return false;
  } else {
    if (depValue === depDef.default) return false;
  }
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
      <!-- GGUF 值提示：a-tag 原生外观（中性=默认标签，可点击建议=color="arcoblue"），
           自定义底/字色/下划线覆盖已移除（与 meta-chip 等非 checkable 标签统一走原生态） -->
      <a-tag
        v-if="ggufHint !== null"
        size="small"
        :color="hasGgufSuggestion ? 'arcoblue' : undefined"
        class="gguf-hint"
        :class="{ applicable: hasGgufSuggestion }"
        :title="hasGgufSuggestion ? i18n.t('msg_click_to_apply') : i18n.t('msg_gguf_model_value')"
        @click="hasGgufSuggestion && applyGgufHint()"
      >{{ ggufHint }}</a-tag>
      <a-tooltip v-if="showDepWarning" :content="dependencyHint">
        <span class="dep-hint">
          <Icon name="alert" :size="12" />
        </span>
      </a-tooltip>
    </div>
    <a-button
      v-if="hasChange"
      class="clear-btn"
      type="text"
      size="mini"
      shape="circle"
      status="warning"
      :title="i18n.t('msg_clear_param')"
      @click="onClear"
    >
      <Icon name="close" :size="12" />
    </a-button>
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
    background: var(--color-fill-3);
    border-color: var(--color-border-2);
  }

  &.dep-unmet {
    border-color: rgb(var(--orange-6));
    background: color-mix(in srgb, rgb(var(--orange-6)) 6%, transparent);
  }

  // 非默认值行：--warn 调整提示橙描边（与右侧还原按钮同色系）。
  // 依赖未满足时由 dep-unmet 呈现（同色描边 + 底色 + 警示图标），不重复挂类；
  // 悬停保持橙色，不回落到通用 hover 灰描边。
  &.changed {
    border-color: rgb(var(--orange-6));

    &:hover {
      border-color: rgb(var(--orange-6));
    }
  }
}

.param-content {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;

  // 行距自持：清零子控件 a-form-item 的默认外距（迁移残留 12/20px 曾把 24px
  // 参数行撑到 54px，悬浮高亮下方出现大片空白）与 wrapper/content 最小高度（32px）
  .param-control {
    margin-bottom: 0;
  }

  :deep(.arco-form-item-wrapper-col),
  :deep(.arco-form-item-content) {
    min-height: 0;
  }

  // Arco 标签列基础 line-height 32px（无 form size 时），压回行内语义行高
  :deep(.arco-form-item-label-col),
  :deep(.arco-form-item-label) {
    line-height: 1.3;
  }
}

.param-control {
  flex: 1;
  min-width: 0;
  :deep(.tooltip-host) {
    max-width: 100%;
  }
}

// GGUF 值提示：a-tag 原生外观，仅保留布局尺寸与 mono 字体（§7.5.1 数值 mono）
.gguf-hint {
  font-family: var(--font-mono);
  flex: 0 1 auto;
  min-width: 44px;
  max-width: 72px;
  text-align: center;

  &.applicable {
    cursor: pointer;
  }
}

.dep-hint {
  color: rgb(var(--orange-6));
  font-size: var(--fs-sm);
  flex-shrink: 0;
  display: inline-flex;
  cursor: help;
}

</style>
