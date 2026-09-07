<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import ToolTip from '@/components/common/ToolTip.vue';

const props = defineProps<{ p: ParamDef }>();
const params = useParamsStore();
const i18n = useI18nStore();

const model = computed<string>({
  get: () => String(params.values[props.p.key] ?? ''),
  set: (value) => params.set(props.p.key, value),
});
const options = computed(() => props.p.options ?? []);
const label = computed(() => i18n.paramLabel(props.p.key));
const tip = computed(() => {
  const help = i18n.paramHelp(props.p.key);
  return help ? `${label.value}\n${help}` : label.value;
});
function optionLabel(option: string, index: number) {
  return props.p.labels?.[index] ?? option;
}
</script>

<template>
  <a-form-item :label="label" class="param-control">
    <template #label>
      <ToolTip :text="tip"><span>{{ label }}</span></ToolTip>
    </template>
    <a-select
      size="small"
      v-model="model"
      :allow-search="Boolean(p.editable)"
      :allow-create="Boolean(p.editable)"
      :placeholder="options.length ? optionLabel(options[0], 0) : '—'"
    >
      <a-option v-for="(option, index) in options" :key="option" :value="option">
        {{ optionLabel(option, index) }}
      </a-option>
    </a-select>
  </a-form-item>
</template>

<style scoped>
</style>
