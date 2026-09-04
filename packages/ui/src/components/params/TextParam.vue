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
  set: (v) => params.set(props.p.key, v),
});

const label = computed(() => i18n.paramLabel(props.p.key));

// 悬停提示 = 标签 + 帮助描述（paramHelp 为空时仅标签），与其余参数控件一致
const tip = computed(() => {
  const h = i18n.paramHelp(props.p.key);
  return h ? `${label.value}\n${h}` : label.value;
});

const error = computed<string>(() => {
  const v = model.value;
  const key = props.p.key;
  if (key === 'host' && v) {
    const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
    const isHostname = /^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(v);
    if (!isIp && !isHostname) return i18n.t('err_invalid_host');
  }
  if (key === 'port') {
    const n = Number(v);
    if (v === '' || Number.isNaN(n) || n < 1 || n > 65535) return i18n.t('err_invalid_port');
  }
  return '';
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
      <input class="text-input" :class="{ invalid: error }" type="text" v-model="model" />
      <span v-if="error" class="error-text">{{ error }}</span>
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
  max-width: 360px;
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

  &.invalid {
    border-color: var(--danger-text);
  }
}

.error-text {
  font-size: var(--fs-base);
  color: var(--danger-text);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
