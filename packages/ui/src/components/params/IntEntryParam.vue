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
  set: (v) => params.set(props.p.key, v),
});

const showAutoHint = computed(() => {
  const lo = props.p.min ?? Number.NEGATIVE_INFINITY;
  const hi = props.p.max ?? Number.POSITIVE_INFINITY;
  return lo <= -1 && hi >= -1;
});

const min = computed(() => props.p.min);
const max = computed(() => props.p.max);

const textValue = computed(() => String(model.value));

function commit(n: number) {
  const lo = min.value;
  const hi = max.value;
  let v = n;
  // 仅校验阈值，不强制步进
  if (lo !== undefined && v < lo) v = lo;
  if (hi !== undefined && v > hi) v = hi;
  v = Math.round(v);
  model.value = v;
}

function onTextInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.value === '') return;
  // 仅校验整数格式，不提交到 model（避免中途打断输入）
  if (!/^-?\d*$/.test(el.value)) {
    el.value = textValue.value;
  }
}

function applyTextValue(el: HTMLInputElement) {
  const raw = el.value.trim();
  if (raw === '') return;
  if (!/^-?\d+$/.test(raw)) {
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

function onTextBlur(e: FocusEvent) {
  applyTextValue(e.target as HTMLInputElement);
}

function onTextEnter(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement;
  applyTextValue(el);
  el.blur();
}

const label = computed(() => i18n.paramLabel(props.p.key));
</script>

<template>
  <div class="param-row">
    <div class="label-col">
      <ToolTip :text="label">
        <span class="label-text">{{ label }}</span>
      </ToolTip>
    </div>
    <div class="ctrl-col">
      <input
        class="num-input"
        type="text"
        :value="textValue"
        @input="onTextInput"
        @blur="onTextBlur"
        @keydown.enter="onTextEnter"
      />
      <span v-if="showAutoHint" class="hint">{{ i18n.t('auto') }}</span>
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

.num-input {
  width: 100px;
  // 可收缩：同 SliderParam——防拥挤列宽下溢出压到 GGUF 提示角标/还原按钮
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

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}

.hint {
  font-size: var(--fs-base);
  color: var(--fg-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
