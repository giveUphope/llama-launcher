// IPC 域：在线下载（URL 解析/搜索/文件列表/任务控制 + 进度事件推送）。
import { app, BrowserWindow, type IpcMain } from 'electron';
import {
  getDownloadManager,
  loadSettings,
  parseModelUrl,
  searchModels,
  listModelFiles,
  listHfFiles,
} from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type {
  StartDownloadRequest,
  DownloadSource,
  DownloadProgressPayload,
  DownloadCompletePayload,
  DownloadErrorPayload,
} from '@llama-launcher/shared';
import { logApp } from '../app-log.js';
import { notifyModelsChanged } from './models-watcher.js';

/**
 * 推送目标窗口缓存：避免每 500ms 的进度 tick 重建一次 BrowserWindow.getAllWindows()。
 * registerDownloadIpc 在所有窗口创建之前被调用（见 main/index.ts 的 whenReady 顺序），
 * 故 created/closed 事件足以维护列表；仍先按 getAllWindows() 兜底一次，防顺序被调整。
 */
const targets: BrowserWindow[] = [];

function addTarget(win: BrowserWindow): void {
  if (targets.includes(win)) return;
  targets.push(win);
  win.on('closed', () => {
    const i = targets.indexOf(win);
    if (i >= 0) targets.splice(i, 1);
  });
  // 从托盘/最小化恢复时补发隐藏期间攒下的最后一帧进度
  win.on('show', flushPendingProgress);
  win.on('restore', flushPendingProgress);
  win.on('focus', flushPendingProgress);
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of targets) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

/** 是否至少有一个可见（未隐藏、未最小化）的推送目标。 */
function anyTargetVisible(): boolean {
  for (const win of targets) {
    if (win.isDestroyed()) continue;
    if (win.isVisible() && !win.isMinimized()) return true;
  }
  return false;
}

/** 隐藏期间只保留最新一帧进度，重新可见时补发（内部状态由管理器自己的 tick 维护，不受影响）。 */
let pendingProgress: DownloadProgressPayload | null = null;

function pushProgress(payload: DownloadProgressPayload): void {
  // 窗口最小化/藏于托盘时不推：主窗口 backgroundThrottling:false，500ms tick 在后台
  // 仍会持续产生 2~10 次/秒无人查看的 IPC 序列化与跨进程投递。
  if (!anyTargetVisible()) {
    pendingProgress = payload;
    return;
  }
  pendingProgress = null;
  broadcast(IPC.DOWNLOAD_PROGRESS, payload);
}

function flushPendingProgress(): void {
  const payload = pendingProgress;
  if (!payload || !anyTargetVisible()) return;
  pendingProgress = null;
  broadcast(IPC.DOWNLOAD_PROGRESS, payload);
}

export function registerDownloadIpc(ipcMain: IpcMain): void {
  const downloadManager = getDownloadManager();
  // 初始化最大并发数(从已保存的 settings 读取)
  downloadManager.setMaxConcurrent(loadSettings().download_max_concurrent ?? 3);

  for (const win of BrowserWindow.getAllWindows()) addTarget(win);
  app.on('browser-window-created', (_e, win) => addTarget(win));

  // 下载进度推送到可见窗口（隐藏时按上面所述挂起）；完成/错误低频且驱动 UI 终态，照常广播
  downloadManager.on('progress', (payload: DownloadProgressPayload) => pushProgress(payload));
  downloadManager.on('complete', (payload: DownloadCompletePayload) => {
    // 终态后不得再补发旧的 downloading 帧（会把已完成的任务显示回下载中）
    if (pendingProgress?.id === payload.id) pendingProgress = null;
    broadcast(IPC.DOWNLOAD_COMPLETE, payload);
    logApp('success', `Download completed: ${payload.fileName}`);
    // 下载完成后通知模型列表刷新
    notifyModelsChanged();
  });
  downloadManager.on('error', (payload: DownloadErrorPayload) => {
    if (pendingProgress?.id === payload.id) pendingProgress = null;
    broadcast(IPC.DOWNLOAD_ERROR, payload);
    logApp('error', `Download error: ${payload.error}`);
  });

  // 解析模型 URL
  ipcMain.handle(IPC.DOWNLOAD_PARSE_URL, (_e, url: string) => {
    try {
      return { ok: true, data: parseModelUrl(url) };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // 搜索 ModelScope 模型
  ipcMain.handle(IPC.DOWNLOAD_SEARCH, async (_e, author: string, modelName: string) => {
    try {
      const result = await searchModels(author, modelName);
      return { ok: true, data: result };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // 列出模型仓库文件(根据 source 分发到 ModelScope 或 HF Mirror)
  ipcMain.handle(IPC.DOWNLOAD_LIST_FILES, async (_e, namespace: string, name: string, source?: DownloadSource) => {
    try {
      const result = source === 'huggingface'
        ? await listHfFiles(namespace, name)
        : await listModelFiles(namespace, name);
      return { ok: true, data: result };
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      console.error(`[download:listFiles] source=${source}, ns=${namespace}, name=${name}: ${errMsg}`);
      return { ok: false, error: errMsg };
    }
  });

  // 启动下载
  ipcMain.handle(IPC.DOWNLOAD_START, async (_e, req: StartDownloadRequest) => {
    try {
      const id = await downloadManager.startDownload(req);
      logApp('info', `Download started: ${req.filePath}`);
      return { ok: true, data: id };
    } catch (err: any) {
      logApp('error', `Download start failed: ${req.filePath} — ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // 取消下载
  ipcMain.handle(IPC.DOWNLOAD_CANCEL, (_e, id: string) => {
    const ok = downloadManager.cancelDownload(id);
    logApp(ok ? 'warn' : 'error', ok ? `Download cancelled: ${id}` : `Cancel download failed: ${id}`);
    return { ok: true, data: ok };
  });

  // 暂停下载
  ipcMain.handle(IPC.DOWNLOAD_PAUSE, (_e, id: string) => {
    const ok = downloadManager.pauseDownload(id);
    logApp(ok ? 'info' : 'warn', ok ? `Download paused: ${id}` : `Pause download failed: ${id}`);
    return { ok: true, data: ok };
  });

  // 恢复下载（含失败重试）
  ipcMain.handle(IPC.DOWNLOAD_RESUME, (_e, id: string) => {
    const ok = downloadManager.resumeDownload(id);
    logApp(ok ? 'info' : 'error', ok ? `Download resumed: ${id}` : `Resume download failed: ${id}`);
    return { ok: true, data: ok };
  });
}
