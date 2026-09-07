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
const label = computed(() => i18n.paramLabel(props.p.key));
const tip = computed(() => {
  const help = i18n.paramHelp(props.p.key);
  return help ? `${label.value}\n${help}` : label.value;
});
const error = computed<string>(() => {
  const value = model.value;
  if (props.p.key === 'host' && value) {
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
    const isHostname = /^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(value);
    if (!isIp && !isHostname) return i18n.t('err_invalid_host');
  }
  if (props.p.key === 'port') {
    const port = Number(value);
    if (value === '' || Number.isNaN(port) || port < 1 || port > 65535) return i18n.t('err_invalid_port');
  }
  return '';
});
</script>

<template>
  <a-form-item :label="label" :validate-status="error ? 'error' : undefined" :help="error" class="param-control">
    <template #label><ToolTip :text="tip"><span>{{ label }}</span></ToolTip></template>
    <a-input v-model="model" allow-clear />
  </a-form-item>
</template>

<style scoped>
.param-control { margin-bottom: 12px; }
</style>
