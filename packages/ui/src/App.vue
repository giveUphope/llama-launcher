<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { MODEL_KEY } from '@llama-launcher/shared';
import ConfirmModal from '@/components/common/ConfirmModal.vue';
import CloseDialog from '@/components/common/CloseDialog.vue';
import FileBrowserModal from '@/components/common/FileBrowserModal.vue';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const route = useRoute();

function onBeforeUnload() {
  settings.flushSave();
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
        if (st.last_preset) {
          try {
            const preset = await window.api.presets.load(st.last_preset);
            if (preset) {
              params.applyPreset(preset.model ? { ...preset.values, [MODEL_KEY]: preset.model } : preset.values, preset.name);
              if (st.selected_model) params.set(MODEL_KEY, st.selected_model);
            }
          } catch {}
        }
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
