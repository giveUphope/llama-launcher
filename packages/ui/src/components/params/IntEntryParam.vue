<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import ToolTip from '@/components/common/ToolTip.vue';

const props = defineProps<{ p: ParamDef }>();
const params = useParamsStore();
const i18n = useI18nStore();
const model = computed<number>({
  get: () => Number(params.values[props.p.key] ?? 0),
  set: (value) => params.set(props.p.key, Math.round(value)),
});
const label = computed(() => i18n.paramLabel(props.p.key));
const showAutoHint = computed(() => (props.p.min ?? Infinity) <= -1 && (props.p.max ?? -Infinity) >= -1);
const tip = computed(() => {
  const help = i18n.paramHelp(props.p.key);
  return help ? `${label.value}\n${help}` : label.value;
});
</script>

<template>
  <a-form-item :label="label" class="param-control">
    <template #label><ToolTip :text="tip"><span>{{ label }}</span></ToolTip></template>
    <a-space>
      <a-input-number v-model="model" size="small" :min="p.min" :max="p.max" :precision="0" />
      <a-typography-text v-if="showAutoHint" type="secondary" class="auto-hint">{{ i18n.t('auto') }}</a-typography-text>
    </a-space>
  </a-form-item>
</template>

<style scoped>
/* 「-1 = 自动」提示保持单行：默认 white-space normal 会在空格处折行（历史：随机种子等行
   提示竖排挤成多行） */
.auto-hint {
  white-space: nowrap;
}

/* 数字框撑满控件列（与输入框/下拉同右边缘）：a-space 默认按内容宽排布，
   曾是固定 100px，导致同列控件宽 100 vs 400 两种、右边缘参差 */
.param-control {
  width: 100%;
}
:deep(.arco-space) {
  width: 100%;
}
:deep(.arco-space-item) {
  min-width: 0;
}
:deep(.arco-space-item:first-child) {
  flex: 1;
}
:deep(.arco-input-number) {
  width: 100%;
}
</style>
