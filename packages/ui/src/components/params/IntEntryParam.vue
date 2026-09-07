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
      <a-input-number v-model="model" :min="p.min" :max="p.max" :precision="0" />
      <a-typography-text v-if="showAutoHint" type="secondary">{{ i18n.t('auto') }}</a-typography-text>
    </a-space>
  </a-form-item>
</template>

<style scoped>
.param-control { margin-bottom: 12px; }
</style>
