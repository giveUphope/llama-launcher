<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import ToolTip from '@/components/common/ToolTip.vue';

const props = defineProps<{ p: ParamDef }>();
const params = useParamsStore();
const i18n = useI18nStore();
const isFloat = computed(() => props.p.type === 'float_slider');
const model = computed<number>({
  get: () => Number(params.values[props.p.key] ?? 0),
  set: (value) => params.set(props.p.key, isFloat.value ? Math.round(value * 100) / 100 : Math.round(value)),
});
const label = computed(() => i18n.paramLabel(props.p.key));
const min = computed(() => props.p.min ?? 0);
const max = computed(() => props.p.max ?? 100);
const step = computed(() => props.p.step ?? (isFloat.value ? 0.01 : 1));
const tip = computed(() => {
  const help = i18n.paramHelp(props.p.key);
  return help ? `${label.value}\n${help}` : label.value;
});
</script>

<template>
  <a-form-item :label="label" class="param-control">
    <template #label><ToolTip :text="tip"><span>{{ label }}</span></ToolTip></template>
    <a-space class="slider-control">
      <a-slider v-model="model" :min="min" :max="max" :step="step" show-ticks />
      <a-input-number v-model="model" size="small" :min="min" :max="max" :step="step" :precision="isFloat ? 2 : 0" />
    </a-space>
  </a-form-item>
</template>

<style scoped>
.slider-control { display: flex; width: 100%; }
.slider-control :deep(.arco-slider) { flex: 1; min-width: 160px; }
</style>
