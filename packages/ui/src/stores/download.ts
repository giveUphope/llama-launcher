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
  // 进度静默门控（G3）：面板失活（停在别的页签）时跳过高频进度应用——隐藏的任务行
  // 不再随每次进度推送重渲染；终态事件（complete/error/取消移除）照常应用保证状态正确，
  // 恢复激活后 ≤120ms（core 采样节拍）内下一个进度帧即自愈字节计数
  let progressMuted = false;

  /** 面板可见性门控：模型库页签 deactivated 时置 true、onActivated 置 false */
  function setProgressMuted(muted: boolean) {
    progressMuted = muted;
  }

  /** 确保 IPC 监听已注册（仅一次） */
  function ensureSubscribed() {
    if (subscribed) return;
    subscribed = true;

    try {
      window.api.download.onProgress((payload: DownloadProgressPayload) => {
        const task = tasks.value.find((t) => t.id === payload.id);
        if (!task) return;
        // 取消的任务从任务列表中移除（不占用列表位置）——列表卫生不受静默门控影响
        if (payload.status === 'canceled') {
          const idx = tasks.value.indexOf(task);
          if (idx >= 0) tasks.value.splice(idx, 1);
          return;
        }
        // 静默期跳过高频字段应用（字节/速度/状态）；终态由 complete/error 事件驱动
        if (progressMuted) return;
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

  /** 启动结果采纳（B1）：去重命中（快照 id 已在列表）则移除本地占位行、保留既有行
   *  （它已随事件演进）；否则把占位行整体替换为后端快照（真实 id 与状态——
   *  此前只换 id 不同步状态，被清除列表的 paused 任务重新添加后渲染成「永远排队中」） */
  function applyStartResult(placeholderId: string, backend: DownloadTask) {
    const idx = tasks.value.findIndex((t) => t.id === placeholderId);
    if (idx < 0) return;
    const dupIdx = tasks.value.findIndex((t) => t.id === backend.id);
    if (dupIdx >= 0 && dupIdx !== idx) tasks.value.splice(idx, 1);
    else tasks.value[idx] = backend;
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

  /** 恢复下载（含失败重试）：后端拒绝（任务不存在/状态不允许）时保持现状——
   *  此前无条件把行置 queued，被拒的任务会停在「永远排队中」 */
  async function resumeTask(id: string) {
    let resumed = false;
    try {
      const resp = await window.api.download.resume(id);
      resumed = resp?.ok === true && resp.data === true;
    } catch {
      // 忽略
    }
    if (!resumed) return;
    const task = tasks.value.find((t) => t.id === id);
    if (task) {
      task.status = 'queued';
      task.error = '';
    }
  }

  /** 清除已结束（completed/canceled/error）的任务；paused 保留——core 侧任务仍可恢复，
   *  从列表清掉会制造不可达的孤儿任务（重新添加同一文件 → 去重命中 → 「永远排队中」僵尸行） */
  function clearFinished() {
    tasks.value = tasks.value.filter(
      (t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'paused',
    );
  }

  /** 获取活动任务数 */
  function activeCount(): number {
    return tasks.value.filter((t) => t.status === 'downloading' || t.status === 'queued').length;
  }

  return {
    tasks,
    addTask,
    applyStartResult,
    cancelTask,
    pauseTask,
    resumeTask,
    clearFinished,
    activeCount,
    ensureSubscribed,
    setProgressMuted,
  };
});
