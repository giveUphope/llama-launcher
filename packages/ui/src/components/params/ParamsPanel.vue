<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { PARAMS, PARAM_GROUPS } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import CollapsibleSection from '@/components/common/CollapsibleSection.vue';
import ParamRow from '@/components/params/ParamRow.vue';
import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { confirm } from '@/composables/useConfirm';
import { useAutoPresetName } from '@/composables/useAutoPresetName';

// 组件 name：供 ParamsPage 的 <KeepAlive> 缓存（切换 tab 时保留参数面板状态）
defineOptions({ name: 'ParamsPanel' });

const props = defineProps<{ group: string }>();

const params = useParamsStore();
const settings = useSettingsStore();
const i18n = useI18nStore();
const autoPresetName = useAutoPresetName();

const groupLabelKey = computed(() => {
  const g = PARAM_GROUPS.find((x) => x.key === props.group);
  return g?.labelKey ?? 'param_basic';
});

// 按 subcategory 分组参数（与旧 Basic/Advanced/ServerParamsPage 一致，所有子分组默认展开）
const subcategories = computed(() => {
  const groups: { key: string; params: typeof PARAMS }[] = [];
  const groupParams = PARAMS.filter((p) => p.group === props.group);
  const seen = new Set<string>();
  for (const p of groupParams) {
    const sub = p.subcategory ?? 'default';
    if (!seen.has(sub)) {
      seen.add(sub);
      groups.push({
        key: sub,
        params: groupParams.filter((x) => (x.subcategory ?? 'default') === sub),
      });
    }
  }
  return groups;
});

async function onReset() {
  const ok = await confirm({
    title: i18n.t('msg_confirm_reset_title'),
    message: i18n.t('msg_confirm_reset_group'),
    variant: 'warning',
  });
  if (ok) params.resetGroup(props.group);
}

// 快捷保存预设：以自动生成名直接保存（免去切换到预设标签）
const presetSaved = ref(false);
let savedTimer: number | null = null;
async function onQuickSavePreset() {
  const name = autoPresetName.value.trim();
  if (!name) return;
  const list = await window.api.presets.list();
  const exists = Array.isArray(list) && list.some((p) => p.name === name);
  if (exists) {
    const ok = await confirm({
      title: i18n.t('msg_confirm_overwrite_title'),
      message: i18n.t('msg_confirm_overwrite').replace('{0}', name),
      variant: 'warning',
    });
    if (!ok) return;
  }
  await window.api.presets.save(name, params.snapshot());
  if (settings.settings) {
    settings.settings.last_preset = name;
    void settings.save();
  }
  presetSaved.value = true;
  if (savedTimer != null) window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    presetSaved.value = false;
  }, 1600);
}

onUnmounted(() => {
  if (savedTimer != null) {
    window.clearTimeout(savedTimer);
    savedTimer = null;
  }
});
</script>

<template>
  <Card :title-key="groupLabelKey">
    <template #actions>
      <button class="head-btn" @click="onQuickSavePreset" :disabled="!autoPresetName.trim()">
        {{ i18n.t('save_preset') }}
        <span v-if="presetSaved" class="saved-flag">{{ i18n.t('preset_saved') }}</span>
      </button>
      <button class="head-btn" @click="onReset">{{ i18n.t('reset_default') }}</button>
    </template>
    <div class="param-grid hue-cycle">
      <CollapsibleSection
        v-for="sub in subcategories"
        :key="sub.key"
        :subcategory-key="sub.key"
        :default-expanded="true"
      >
        <ParamRow v-for="p in sub.params" :key="p.key" :p="p" />
      </CollapsibleSection>
    </div>
  </Card>
</template>

<style scoped lang="scss">
.param-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.head-btn {
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-secondary);
  font-size: var(--fs-base);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--fg-primary);
    border-color: var(--accent);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.saved-flag {
  color: var(--success);
  font-weight: 600;
  margin-left: 4px;
}
</style>
