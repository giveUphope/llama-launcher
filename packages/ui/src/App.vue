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
    // 设置已在 main.ts 挂载前加载（含 last_tab 页签恢复，见该处启动序列说明）；
    // 此处仅在异常兜底路径（挂载前加载超时/失败）补一次加载。
    if (!settings.settings) await settings.load();
    // 双轨参数逻辑启动链（会话优先）：
    // ① 有会话（session_values）→ 恢复上次会话参数与基线（临时轨道，重启可续）
    // ② 无会话 → selected_model + last_preset 预设应用链（预设完整轨道）
    const st = settings.settings;
    if (st) {
      const sessionValues = st.session_values;
      if (sessionValues && Object.keys(sessionValues).length > 0) {
        await params.restoreSession(
          sessionValues,
          st.session_baseline ?? null,
        );
      } else {
        if (st.selected_model) {
          params.set(MODEL_KEY, st.selected_model);
        }
        if (st.last_preset) {
          try {
            const preset = await window.api.presets.load(st.last_preset);
            if (preset) {
              // v2 结构：model 存于顶层元数据字段，应用前注回 values 供 applyPreset 识别
              params.applyPreset(
                preset.model ? { ...preset.values, [MODEL_KEY]: preset.model } : preset.values,
                preset.name,
              );
              // 预设可能不含模型（或含旧路径）：回写持久化的模型路径（经 set 派生别名）
              if (st.selected_model) {
                params.set(MODEL_KEY, st.selected_model);
              }
            }
          } catch {
            // 预设可能已被删除，忽略错误
          }
        }
        // 无会话启动：以当前值建立隐式会话基线（临时参数轨道）。否则启动期
        // 自动派生的 model/alias 会相对出厂默认被误判为"已修改"（重启即见脏标记）。
        if (!params.baseline) {
          params.markBaseline('');
        }
      }
    }

    server.subscribe();
    await server.refreshStatus();
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
