// IPC 域：窗口控制。
import { BrowserWindow, type IpcMain } from 'electron';
import { IPC, type CloseDialogResult } from '@llama-launcher/shared';
import { handleCloseDialogResult } from '../app-exit.js';

export function registerWindowIpc(ipcMain: IpcMain): void {
  // 自定义标题栏窗口控制（替代原生 min/max/close）
  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.close();
  });

  // 关闭窗口应用内弹窗的回复（渲染进程 CloseDialog.vue → 主进程 app-exit.ts）
  ipcMain.on(IPC.WINDOW_CLOSE_DIALOG_RESULT, (_e, result: CloseDialogResult) => {
    handleCloseDialogResult(result);
  });

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });

  ipcMain.handle(IPC.WINDOW_TOGGLE_MAXIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IPC.WINDOW_STATE, () => {
    const win = BrowserWindow.getFocusedWindow();
    return { maximized: win ? win.isMaximized() : false };
  });
}
