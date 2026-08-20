import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  DownloadTask,
  DownloadProgressPayload,
  DownloadCompletePayload,
  DownloadErrorPayload,
} from '@llama-launcher/shared';

export const useDownloadStore = defineStore('download', () => {
  const tasks = ref<DownloadTask[]>([]);
  let subscribed = false;

  /** 确保 IPC 监听已注册（仅一次） */
  function ensureSubscribed() {
    if (subscribed) return;
    subscribed = true;

    try {
      window.api.download.onProgress((payload: DownloadProgressPayload) => {
        const task = tasks.value.find((t) => t.id === payload.id);
        if (!task) return;
        // 取消的任务从任务列表中移除（不占用列表位置）
        if (payload.status === 'canceled') {
          const idx = tasks.value.indexOf(task);
          if (idx >= 0) tasks.value.splice(idx, 1);
          return;
        }
        task.downloadedSize = payload.downloadedSize;
        task.totalSize = payload.totalSize;
        task.speed = payload.speed;
        task.status = payload.status;
      });

      window.api.download.onComplete((payload: DownloadCompletePayload) => {
        const task = tasks.value.find((t) => t.id === payload.id);
        if (task) {
          task.status = 'completed';
          task.completedAt = Date.now();
          task.downloadedSize = task.totalSize;
          task.speed = 0;
        }
      });

      window.api.download.onError((payload: DownloadErrorPayload) => {
        const task = tasks.value.find((t) => t.id === payload.id);
        if (task) {
          task.status = 'error';
          task.error = payload.error;
          task.errorType = payload.errorType ?? null;
          task.speed = 0;
        }
      });
    } catch {
      // 浏览器预览环境(无 Electron preload)下 window.api.download 未定义,忽略事件订阅
    }
  }

  /** 添加任务到列表（UI 侧预添加，后续由 IPC 事件更新状态） */
  function addTask(task: DownloadTask) {
    tasks.value.push(task);
    ensureSubscribed();
  }

  /** 取消下载 */
  async function cancelTask(id: string) {
    // 立即从列表中移除（同步），避免取消后仍占用列表位置；
    // 后端文件清理与 onProgress 事件作为兜底
    const idx = tasks.value.findIndex((t) => t.id === id);
    if (idx >= 0) {
      tasks.value.splice(idx, 1);
    }
    try {
      await window.api.download.cancel(id);
    } catch {
      // 忽略后端取消失败（任务已从 UI 移除，后端残留靠下次重下载清理）
    }
  }

  /** 暂停下载 */
  async function pauseTask(id: string) {
    try {
      await window.api.download.pause(id);
    } catch {
      // 忽略
    }
  }

  /** 恢复下载（含失败重试） */
  async function resumeTask(id: string) {
    try {
      await window.api.download.resume(id);
    } catch {
      // 忽略
    }
    const task = tasks.value.find((t) => t.id === id);
    if (task) {
      task.status = 'queued';
      task.error = '';
    }
  }

  /** 清除已完成/已取消/已失败的任务 */
  function clearFinished() {
    tasks.value = tasks.value.filter(
      (t) => t.status === 'downloading' || t.status === 'queued',
    );
  }

  /** 获取活动任务数 */
  function activeCount(): number {
    return tasks.value.filter((t) => t.status === 'downloading' || t.status === 'queued').length;
  }

  return {
    tasks,
    addTask,
    cancelTask,
    pauseTask,
    resumeTask,
    clearFinished,
    activeCount,
    ensureSubscribed,
  };
});
