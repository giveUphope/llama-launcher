// IPC 域：设置。
import type { IpcMain } from 'electron';
import { loadSettings, saveSettings, getDownloadManager } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { AppSettings } from '@llama-launcher/shared';

export function registerSettingsIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.SETTINGS_LOAD, () => loadSettings());
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: AppSettings) => {
    saveSettings(s);
    // 同步最大并发下载数到 DownloadManager
    getDownloadManager().setMaxConcurrent(s?.download_max_concurrent ?? 3);
    return true;
  });
}
