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
      <a-input-number v-model="model" size="small" hide-button :min="min" :max="max" :step="step" :precision="isFloat ? 2 : 0" />
    </a-space>
  </a-form-item>
</template>

<style scoped>
.slider-control { display: flex; width: 100%; min-width: 0; }
/* a-space 子项包裹在 .arco-space-item（其自身为 flex 容器）：
   - 滑块项 flex:1 弹性拉伸（min-width: 0），slider 填满该项
   - 数字项固定 88px（hide-button 后无步进按钮；flex 下不给定宽会回退 input 默认
     size 宽 ~139px 撑爆，把滑块挤成 0；88px 内容区可显示 262144 6 位值）
   历史：旧 .arco-slider min-width: 160px 卡死，wrapper 不足时 input-number 溢出与右侧 gguf-hint 重叠 */
.slider-control :deep(.arco-space-item) { min-width: 0; }
.slider-control :deep(.arco-space-item:first-child) { flex: 1; }
.slider-control :deep(.arco-slider) { width: 100%; }
.slider-control :deep(.arco-space-item:last-child) { flex: 0 0 88px; }
.slider-control :deep(.arco-input-number) { width: 100%; }
</style>
