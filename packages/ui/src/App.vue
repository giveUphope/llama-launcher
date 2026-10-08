<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { usePresetsStore } from '@/stores/presets';
import { MODEL_KEY } from '@llama-launcher/shared';
import type { Preset } from '@llama-launcher/shared';
import ConfirmModal from '@/components/common/ConfirmModal.vue';
import CloseDialog from '@/components/common/CloseDialog.vue';
import FileBrowserModal from '@/components/common/FileBrowserModal.vue';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const presetsStore = usePresetsStore();
const route = useRoute();

function onBeforeUnload() {
  settings.flushSave();
}

/**
 * 启动预设应用链：last_preset_id（v3 主键）优先；旧版按名的 last_preset 兜底一次——
 * 按名命中后回填 id 并清空旧字段，完成单向迁移，之后名字只用于展示。
 */
async function applyStartupPreset(): Promise<void> {
  const st = settings.settings;
  if (!st) return;
  let preset: Preset | null = null;
  if (st.last_preset_id) {
    try {
      preset = await window.api.presets.load(st.last_preset_id);
    } catch { /* 引用悬空按无预设处理 */ }
  }
  if (!preset && st.last_preset) {
    try {
      const list = await window.api.presets.list();
      const hit = Array.isArray(list) ? list.find((s) => s.name === st.last_preset) : null;
      if (hit) preset = await window.api.presets.load(hit.id);
    } catch { /* 兜底失败按无预设处理 */ }
  }
  if (preset) {
    // model 注回收敛在 params.applyPresetEntity；随后用户上次选中的模型优先生效
    params.applyPresetEntity(preset);
    presetsStore.setActive(preset.id);
    if (st.selected_model) params.set(MODEL_KEY, st.selected_model);
  }
}

onMounted(async () => {
  try {
    if (!settings.settings) await settings.load();
    const st = settings.settings;
    if (st) {
      const sessionValues = st.session_values;
      if (sessionValues && Object.keys(sessionValues).length > 0) {
        await params.restoreSession(sessionValues, st.session_baseline ?? null);
      } else {
        if (st.selected_model) params.set(MODEL_KEY, st.selected_model);
        await applyStartupPreset();
        if (!params.baseline) params.markBaseline('');
      }
    }
    server.subscribe();
    await server.refreshStatus();
  } catch (e) {
    console.error('[App] onMounted failed:', e);
  }
  window.addEventListener('beforeunload', onBeforeUnload);
});

let saveTabTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => route.fullPath, (fullPath) => {
  if (!settings.settings || settings.settings.last_tab === fullPath) return;
  settings.settings.last_tab = fullPath;
  if (saveTabTimer) clearTimeout(saveTabTimer);
  saveTabTimer = setTimeout(() => void settings.save(), 500);
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
  settings.flushSave();
  if (saveTabTimer) clearTimeout(saveTabTimer);
});
</script>

<template>
  <AppLayout />
  <ConfirmModal />
  <CloseDialog />
  <FileBrowserModal />
</template>
