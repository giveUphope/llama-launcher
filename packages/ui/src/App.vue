<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY } from '@llama-launcher/shared';
import ConfirmModal from '@/components/common/ConfirmModal.vue';
import CloseDialog from '@/components/common/CloseDialog.vue';
import FileBrowserModal from '@/components/common/FileBrowserModal.vue';

const settings = useSettingsStore();
const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();
const router = useRouter();
const route = useRoute();

// 页签快捷键映射：Ctrl+1~3 对应主要页签（参数设置合并后为单页）
const TAB_KEYS = ['/models', '/params', '/launch'];

// 关窗前 flush 挂起的设置保存（防抖窗口内变更不丢失）
function onBeforeUnload() {
  settings.flushSave();
}

function onKeydown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;

  // Ctrl+L 启动服务器
  if (ctrl && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    if (server.status === 'stopped') {
      void startServer();
    }
  }
  // Esc 停止服务器
  if (e.key === 'Escape') {
    if (server.status === 'running' || server.status === 'starting') {
      void stopServer();
    }
  }
  // Ctrl+R 刷新模型列表（仅在模型页生效，通过事件触发）
  if (ctrl && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('app:refresh-models'));
  }
  // Ctrl+D 切换深色/浅色主题
  if (ctrl && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    settings.toggleTheme();
  }
  // Ctrl+S 保存当前参数为预设（跳转到参数设置的预设标签）
  if (ctrl && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    // 仅在非输入框聚焦时拦截，避免与浏览器保存冲突
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    e.preventDefault();
    void router.push({ path: '/params', query: { tab: 'presets' } });
  }
  // Ctrl+Shift+C 复制命令行
  if (ctrl && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    void router.push('/launch').then(() => {
      window.dispatchEvent(new CustomEvent('app:copy-command'));
    });
  }
  // Ctrl+1~3 快速切换主要页签
  if (ctrl && e.key >= '1' && e.key <= '3') {
    e.preventDefault();
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < TAB_KEYS.length) {
      void router.push(TAB_KEYS[idx]);
    }
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
    await settings.load();
    // 将持久化的模型路径同步到参数运行时状态
    if (settings.settings?.selected_model) {
      params.values[MODEL_KEY] = settings.settings.selected_model;
    }
    // 以下初始化彼此独立，并发执行以缩短启动耗时：
    // - 恢复上次使用的预设（不阻塞其余初始化）
    // - 订阅服务器状态事件
    // - 拉取当前服务器运行状态
    // - 恢复上次查看的页签
    const restorePreset = (async () => {
      if (!settings.settings?.last_preset) return;
      try {
        const preset = await window.api.presets.load(settings.settings.last_preset);
        if (preset) {
          params.applyPreset(preset.values);
          // 恢复预设后重新设置模型路径（预设可能不包含模型，或包含的是旧路径）
          if (settings.settings.selected_model) {
            params.values[MODEL_KEY] = settings.settings.selected_model;
          }
        }
      } catch {
        // 预设可能已被删除，忽略错误
      }
    })();

    server.subscribe();
    const refresh = server.refreshStatus();
    // 恢复上次查看的页签（存 fullPath，保留参数页 active 标签）
    const restoreTab = (settings.settings?.last_tab && settings.settings.last_tab !== '/')
      ? router.push(settings.settings.last_tab)
      : Promise.resolve();

    await Promise.all([restorePreset, refresh, restoreTab]);
  } catch (e) {
    console.error('[App] onMounted failed:', e);
  }
  window.addEventListener('keydown', onKeydown);
  // 关窗前立即持久化挂起的设置保存（beforeunload 中 flush 防抖队列）
  window.addEventListener('beforeunload', onBeforeUnload);
});

// 路由变化时持久化当前页签路径（存 fullPath，保留参数页 active 标签；防抖避免频繁写入）
let saveTabTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => route.fullPath, (fullPath) => {
  if (!settings.settings) return;
  if (settings.settings.last_tab === fullPath) return;
  settings.settings.last_tab = fullPath;
  if (saveTabTimer) clearTimeout(saveTabTimer);
  saveTabTimer = setTimeout(() => {
    void settings.save();
  }, 500);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  // 卸载/关窗前 flush 挂起的防抖保存，避免窗口关闭丢失最后一次变更
  window.removeEventListener('beforeunload', onBeforeUnload);
  settings.flushSave();
  if (saveTabTimer) {
    clearTimeout(saveTabTimer);
    saveTabTimer = null;
  }
});
</script>

<template>
  <!-- 单玻璃层：全应用唯一 backdrop-filter（见 styles/surface.scss），模糊装饰背景斑块 -->
  <div class="glass-layer" aria-hidden="true"></div>
  <!-- z-index 1 包装层：使应用内容绘制在玻璃层之上（不被其模糊），透明表面透出模糊斑块 -->
  <div class="app-fx">
    <AppLayout />
    <ConfirmModal />
    <CloseDialog />
    <FileBrowserModal />
  </div>
</template>

<style scoped>
.app-fx {
  position: relative;
  z-index: 1;
  height: 100%;
}
</style>
