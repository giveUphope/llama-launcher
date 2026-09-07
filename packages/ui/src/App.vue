<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
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
const router = useRouter();
const route = useRoute();
const TAB_KEYS = ['/models', '/params', '/launch'];

function onBeforeUnload() {
  settings.flushSave();
}

function onKeydown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    if (server.status === 'stopped') void startServer();
  }
  if (e.key === 'Escape' && (server.status === 'running' || server.status === 'starting')) {
    void stopServer();
  }
  if (ctrl && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('app:refresh-models'));
  }
  if (ctrl && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    settings.toggleTheme();
  }
  if (ctrl && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    e.preventDefault();
    void router.push({ path: '/params', query: { tab: 'presets' } });
  }
  if (ctrl && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    void router.push('/launch').then(() => {
      window.dispatchEvent(new CustomEvent('app:copy-command'));
    });
  }
  if (ctrl && /^[1-3]$/.test(e.key)) {
    e.preventDefault();
    void router.push(TAB_KEYS[Number(e.key) - 1]);
  }
}

async function startServer() {
  if (!settings.settings) return;
  await server.start(params.snapshot(), settings.settings);
}

async function stopServer() {
  await server.stop();
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
  window.addEventListener('keydown', onKeydown);
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
  window.removeEventListener('keydown', onKeydown);
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
