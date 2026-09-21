// IPC 域：设置。
import type { IpcMain } from 'electron';
import { loadSettings, saveSettings, getDownloadManager } from '@llama-launcher/core';
import { IPC, setLang, DOWNLOAD_CONCURRENCY_DEFAULT } from '@llama-launcher/shared';
import type { AppSettings } from '@llama-launcher/shared';

export function registerSettingsIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.SETTINGS_LOAD, () => loadSettings());
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: AppSettings) => {
    saveSettings(s);
    // 主进程侧文案（探测错误等经 tr 生成的串）跟随设置语言：不在此同步则只有重启后生效
    if (s?.language) setLang(s.language);
    // 同步最大并发下载数到 DownloadManager
    getDownloadManager().setMaxConcurrent(s?.download_max_concurrent ?? DOWNLOAD_CONCURRENCY_DEFAULT);
    return true;
  });
}
