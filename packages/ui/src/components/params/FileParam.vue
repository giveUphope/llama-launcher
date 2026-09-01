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
  set: (v) => params.set(props.p.key, v),
});

const isDir = computed(() => props.p.type === 'dir');
const isSaveAs = computed(() => !!props.p.save_as);

const label = computed(() => i18n.paramLabel(props.p.key));

// 悬停提示 = 标签 + 帮助描述（paramHelp 为空时仅标签），与其余参数控件一致
const tip = computed(() => {
  const h = i18n.paramHelp(props.p.key);
  return h ? `${label.value}\n${h}` : label.value;
});

async function onBrowse() {
  if (isDir.value) {
    const dir = await pickDir({ title: i18n.t('msg_select_dir'), defaultPath: model.value || undefined });
    if (dir) model.value = dir;
    return;
  }
  if (isSaveAs.value) {
    const f = await saveFile({ title: i18n.t('msg_select_model_file'), filters: props.p.filetypes, defaultPath: model.value || undefined });
    if (f) model.value = f;
    return;
  }
  const f = await pickFile({ title: i18n.t('msg_select_model_file'), filters: props.p.filetypes, defaultPath: model.value || undefined });
  if (f) model.value = f;
}
</script>

<template>
  <div class="param-row">
    <div class="label-col">
      <ToolTip :text="tip">
        <span class="label-text">{{ label }}</span>
      </ToolTip>
    </div>
    <div class="ctrl-col">
      <input class="text-input" type="text" v-model="model" />
      <button class="browse-btn" @click="onBrowse">{{ i18n.t('browse') }}</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.param-row {
  display: flex;
  align-items: center;
  min-height: 24px;
  width: 100%;
  gap: 4px;
}

// 标签列：允许收缩（避免长标签换行撑高行），溢出用省略号
.label-col {
  flex: 0 1 110px;
  min-width: 64px;
  text-align: right;
  padding-right: 8px;
}

.label-text {
  font-size: var(--fs-base);
  color: var(--fg-secondary);
  cursor: help;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  max-width: 100%;
  vertical-align: middle;
}

.ctrl-col {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.text-input {
  height: 28px;
  flex: 1;
  min-width: 0;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}

.browse-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  flex-shrink: 0;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth),
    box-shadow var(--dur-fast) var(--ease-smooth), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
  }


}
</style>
