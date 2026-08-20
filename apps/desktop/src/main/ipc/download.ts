// IPC 域：在线下载（URL 解析/搜索/文件列表/任务控制 + 进度事件推送）。
import { BrowserWindow, type IpcMain } from 'electron';
import {
  getDownloadManager,
  loadSettings,
  parseModelUrl,
  searchModels,
  listModelFiles,
  listHfFiles,
} from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { StartDownloadRequest, DownloadSource } from '@llama-launcher/shared';
import { notifyModelsChanged } from './models-watcher.js';

export function registerDownloadIpc(ipcMain: IpcMain): void {
  const downloadManager = getDownloadManager();
  // 初始化最大并发数(从已保存的 settings 读取)
  downloadManager.setMaxConcurrent(loadSettings().download_max_concurrent ?? 3);

  // 下载进度/完成/错误 推送到所有窗口
  downloadManager.on('progress', (payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.DOWNLOAD_PROGRESS, payload);
    }
  });
  downloadManager.on('complete', (payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.DOWNLOAD_COMPLETE, payload);
    }
    // 下载完成后通知模型列表刷新
    notifyModelsChanged();
  });
  downloadManager.on('error', (payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.DOWNLOAD_ERROR, payload);
    }
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
      return { ok: true, data: id };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // 取消下载
  ipcMain.handle(IPC.DOWNLOAD_CANCEL, (_e, id: string) => {
    return { ok: true, data: downloadManager.cancelDownload(id) };
  });

  // 暂停下载
  ipcMain.handle(IPC.DOWNLOAD_PAUSE, (_e, id: string) => {
    return { ok: true, data: downloadManager.pauseDownload(id) };
  });

  // 恢复下载（含失败重试）
  ipcMain.handle(IPC.DOWNLOAD_RESUME, (_e, id: string) => {
    return { ok: true, data: downloadManager.resumeDownload(id) };
  });
}
