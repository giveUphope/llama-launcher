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
  set: (v) => params.set(props.p.key, v),
});

const defaultLabel = computed(() => {
  return props.p.default ? i18n.t('default_on') : i18n.t('default_off');
});

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
      <button
        class="switch"
        :class="{ on: model }"
        role="switch"
        :aria-checked="model"
        @click="model = !model"
      >
        <span class="switch-btn"></span>
      </button>
      <span class="default-tag">{{ defaultLabel }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.param-row {
  display: flex;
  align-items: center;
  min-height: 36px;
  width: 100%;
}

// 标签列：允许收缩（避免长标签换行撑高行），溢出用省略号
.label-col {
  flex: 0 1 140px;
  min-width: 80px;
  text-align: right;
  padding-right: 12px;
}

.label-text {
  font-size: var(--fs-lg);
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
  gap: 10px;
  min-width: 0;
}

.switch {
  position: relative;
  width: 38px;
  height: 20px;
  border-radius: var(--radius-pill);
  background: var(--switch-track);
  border: 1px solid var(--border);
  padding: 0;
  transition: background var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);
  flex-shrink: 0;

  &:active {
    transform: scale(0.96);
  }

  &.on {
    background: var(--accent);
    border-color: var(--accent);
  }
}

.switch-btn {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--switch-btn);
  transition: transform var(--dur-fast) var(--ease-jelly);
  box-shadow: var(--shadow-control);
}

.switch.on .switch-btn {
  transform: translateX(18px);
}

.default-tag {
  font-size: var(--fs-base);
  color: var(--fg-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
