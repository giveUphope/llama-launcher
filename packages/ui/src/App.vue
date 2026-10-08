<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
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
      // 启动即恢复上次模型：applyModel 内部载入该模型的已存参数集（无则回落
      // 出厂默认 + GGUF 建议自动应用）——参数跟模型走，无需任何会话/预设恢复链
      if (st.selected_model) {
        await params.applyModel(st.selected_model);
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
