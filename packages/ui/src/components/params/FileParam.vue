<script setup lang="ts">
import { computed } from 'vue';
import { MODEL_KEY, type ParamDef } from '@llama-launcher/shared';
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

/**
 * 选择对话框的起点（用户标注：不要从 C:\ 起）。按使用链路取两档：
 *  ① 本参数已有值 ⇒ 从它的位置打开（选错了好改）；
 *  ② 空值 ⇒ 回退到**主模型权重文件所在目录**——mmproj / 草稿模型这两个"伴随文件"几乎总与
 *     主模型同目录，而它们的取值本来就跟着当前模型走（「切换模型后智能处理」同一条链路）。
 * 两档都没有（没选模型）才交给系统默认。
 */
const startPath = computed<string | undefined>(() => {
  const own = model.value.trim();
  if (own) return own;
  const main = String(params.values[MODEL_KEY] ?? '').trim();
  if (!main) return undefined;
  const cut = Math.max(main.lastIndexOf('/'), main.lastIndexOf('\\'));
  return cut > 0 ? main.slice(0, cut) : undefined;
});

async function onBrowse() {
  if (isDir.value) {
    const value = await pickDir({ title: i18n.t('msg_select_dir'), defaultPath: startPath.value });
    if (value) model.value = value;
  } else if (isSaveAs.value) {
    const value = await saveFile({ title: i18n.t('msg_select_model_file'), filters: props.p.filetypes, defaultPath: startPath.value });
    if (value) model.value = value;
  } else {
    const value = await pickFile({ title: i18n.t('msg_select_model_file'), filters: props.p.filetypes, defaultPath: startPath.value });
    if (value) model.value = value;
  }
}
</script>

<template>
  <a-form-item :label="label" class="param-control">
    <template #label><ToolTip :text="tip"><span>{{ label }}</span></ToolTip></template>
    <a-input-group compact>
      <!-- 输入框名 = 参数标签（须走 input-attrs 才落到真 input）；浏览按钮名也带上参数标签，否则各文件行的「浏览」按钮读屏同名难区分 -->
      <a-input v-model="model" size="small" :input-attrs="{ 'aria-label': label }" />
      <a-button type="primary" size="small" :aria-label="`${label} ${i18n.t('browse')}`" @click="onBrowse">{{ i18n.t('browse') }}</a-button>
    </a-input-group>
  </a-form-item>
</template>

<style scoped>
</style>
