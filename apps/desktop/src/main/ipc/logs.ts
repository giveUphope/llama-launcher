// IPC 域：应用日志（读取/清空应用日志缓冲；实时推送由 app-log.ts 直接广播）。
import type { IpcMain } from 'electron';
import { IPC } from '@llama-launcher/shared';
import { getAppLogs, clearAppLogs } from '../app-log.js';

export function registerLogsIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.LOGS_LIST, () => getAppLogs());
  ipcMain.handle(IPC.LOGS_CLEAR, () => {
    clearAppLogs();
    return true;
  });
}