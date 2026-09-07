<script setup lang="ts">
import { computed } from 'vue';
import type { ParamDef } from '@llama-launcher/shared';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { pickDir, pickFile, saveFile } from '@/composables/useFilePicker';
import ToolTip from '@/components/common/ToolTip.vue';

const props = defineProps<{ p: ParamDef }>();
const params = useParamsStore();
const i18n = useI18nStore();
const model = computed<string>({
  get: () => String(params.values[props.p.key] ?? ''),
  set: (value) => params.set(props.p.key, value),
});
const isDir = computed(() => props.p.type === 'dir');
const isSaveAs = computed(() => Boolean(props.p.save_as));
const label = computed(() => i18n.paramLabel(props.p.key));
const tip = computed(() => {
  const help = i18n.paramHelp(props.p.key);
  return help ? `${label.value}\n${help}` : label.value;
});

async function onBrowse() {
  if (isDir.value) {
    const value = await pickDir({ title: i18n.t('msg_select_dir'), defaultPath: model.value || undefined });
    if (value) model.value = value;
  } else if (isSaveAs.value) {
    const value = await saveFile({ title: i18n.t('msg_select_model_file'), filters: props.p.filetypes, defaultPath: model.value || undefined });
    if (value) model.value = value;
  } else {
    const value = await pickFile({ title: i18n.t('msg_select_model_file'), filters: props.p.filetypes, defaultPath: model.value || undefined });
    if (value) model.value = value;
  }
}
</script>

<template>
  <a-form-item :label="label" class="param-control">
    <template #label><ToolTip :text="tip"><span>{{ label }}</span></ToolTip></template>
    <a-input-group compact>
      <a-input v-model="model" size="small" />
      <a-button type="primary" size="small" @click="onBrowse">{{ i18n.t('browse') }}</a-button>
    </a-input-group>
  </a-form-item>
</template>

<style scoped>
</style>
