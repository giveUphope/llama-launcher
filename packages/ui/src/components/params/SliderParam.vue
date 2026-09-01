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
  set: (v) => params.set(props.p.key, v),
});

const min = computed(() => props.p.min ?? 0);
const max = computed(() => props.p.max ?? 100);
// 滑块仍需 step 控制拖动粒度；输入框不再强制步进
const step = computed(() => props.p.step ?? (isFloat.value ? 0.01 : 1));

const textValue = computed<string>({
  get: () => (isFloat.value ? model.value.toFixed(2) : String(model.value)),
  set: (s) => {
    const n = Number(s);
    if (Number.isNaN(n)) return;
    commit(n);
  },
});

function commit(n: number) {
  const lo = min.value;
  const hi = max.value;
  let v = n;
  // 仅校验阈值，不再强制步进对齐
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  if (isFloat.value) {
    // 小数保留 2 位
    v = Math.round(v * 100) / 100;
  } else {
    v = Math.round(v);
  }
  model.value = v;
}

function applyTextValue(el: HTMLInputElement) {
  // 校验输入：小数最多 2 位，整数仅数字
  const raw = el.value.trim();
  // 清空视为放弃编辑：恢复为已提交值显示，避免显示空白与 model 脱节
  if (raw === '') {
    el.value = textValue.value;
    return;
  }
  // 小数格式校验：可选负号 + 整数部分 + 可选（. + 1~2 位小数）
  const pattern = isFloat.value ? /^-?\d+(\.\d{0,2})?$/ : /^-?\d+$/;
  if (!pattern.test(raw)) {
    el.value = textValue.value;
    return;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) {
    el.value = textValue.value;
    return;
  }
  commit(n);
  el.value = textValue.value;
}

function onTextInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.value === '') return;
  // 输入过程中仅做格式校验，不提交到 model（避免中途被覆盖打断输入）
  const pattern = isFloat.value ? /^-?\d*\.?\d{0,2}$/ : /^-?\d*$/;
  if (!pattern.test(el.value)) {
    // 格式非法时恢复为已提交值
    el.value = textValue.value;
  }
}

function onTextBlur(e: FocusEvent) {
  applyTextValue(e.target as HTMLInputElement);
}

function onTextEnter(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement;
  applyTextValue(el);
  el.blur();
}

const label = computed(() => i18n.paramLabel(props.p.key));

// 悬停提示 = 标签 + 帮助描述（paramHelp 为空时仅标签），与其余参数控件一致
const tip = computed(() => {
  const h = i18n.paramHelp(props.p.key);
  return h ? `${label.value}\n${h}` : label.value;
});
</script>

<template>
  <div class="param-row">
    <div class="label-col">
      <ToolTip :text="tip">
        <span class="label-text">{{ label }}</span>
      </ToolTip>
    </div>
    <div class="ctrl-col">
      <input
        class="slider"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        v-model.number="model"
      />
      <input
        class="num-input"
        type="text"
        :value="textValue"
        @input="onTextInput"
        @blur="onTextBlur"
        @keydown.enter="onTextEnter"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.param-row {
  display: flex;
  align-items: center;
  min-height: 24px;
  width: 100%;
}

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

.slider {
  flex: 1;
  min-width: 60px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--switch-track);
  border-radius: 2px;
  outline: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg-card);
  }
}

.num-input {
  width: 100px;
  // 可收缩（拥挤列宽下先压缩输入框，再压滑块）：原 flex:0 0 100px 不收缩，
  // 行内容超列宽时数值框溢出 param-control、压在 GGUF 提示角标/还原按钮下面
  flex: 0 1 100px;
  min-width: 56px;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  text-align: right;

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}
</style>
