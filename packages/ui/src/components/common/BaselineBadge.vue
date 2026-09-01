<script setup lang="ts">
// 参数基线徽章（双轨参数逻辑的状态灯）：
// - 显示当前基线：预设：X / 自定义参数集 / 临时参数 / 默认参数
// - 相对基线有未固化修改时追加「已修改」并转 warn 色
// - showRestore：附带「恢复基线」按钮（回基线快照，≠ 重置默认）
import { computed } from 'vue';
import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';

const props = withDefaults(defineProps<{ showRestore?: boolean }>(), { showRestore: false });

const params = useParamsStore();
const i18n = useI18nStore();

const label = computed(() => {
  // 会话存在性决定基轨：无会话 = 出厂默认；有会话无预设基线 = 临时参数
  const settings = useSettingsStore();
  const hasSession = !!settings.settings?.session_values;
  const b = params.baseline;
  let base: string;
  if (!hasSession) base = i18n.t('baseline_default');
  else if (b) base = b.preset_name ? i18n.t('baseline_preset').replace('{0}', b.preset_name) : i18n.t('baseline_custom');
  else base = i18n.t('baseline_temp');
  return params.hasChanges ? `${base} · ${i18n.t('baseline_dirty')}` : base;
});
const dirty = computed(() => params.hasChanges);
</script>

<template>
  <span class="baseline-wrap">
    <span class="baseline-badge" :data-status="dirty ? 'warn' : 'ok'" :title="i18n.t('lbl_baseline')">
      {{ label }}
    </span>
    <button
      v-if="props.showRestore"
      class="action-btn"
      :disabled="!dirty || !params.baseline"
      :title="i18n.t('msg_restore_baseline')"
      @click="params.restoreBaseline()"
    >
      <span>{{ i18n.t('msg_restore_baseline') }}</span>
    </button>
  </span>
</template>

<style scoped lang="scss">
.baseline-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.baseline-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--bg-input);
  font-size: var(--fs-sm);
  color: var(--fg-secondary);
  white-space: nowrap;

  &[data-status='warn'] {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
}
</style>
