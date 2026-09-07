<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import ToolTip from '@/components/common/ToolTip.vue';

const props = defineProps<{ p: ParamDef }>();
const params = useParamsStore();
const i18n = useI18nStore();

const model = computed<boolean>({
  get: () => Boolean(params.values[props.p.key]),
  set: (value) => params.set(props.p.key, value),
});
const label = computed(() => i18n.paramLabel(props.p.key));
const tip = computed(() => {
  const help = i18n.paramHelp(props.p.key);
  return help ? `${label.value}\n${help}` : label.value;
});
</script>

<template>
  <a-form-item :label="label" class="param-control">
    <template #label>
      <ToolTip :text="tip"><span>{{ label }}</span></ToolTip>
    </template>
    <a-space>
      <a-switch v-model="model" type="round" />
      <a-typography-text type="secondary">
        {{ p.default ? i18n.t('default_on') : i18n.t('default_off') }}
      </a-typography-text>
    </a-space>
  </a-form-item>
</template>

<style scoped>
</style>
