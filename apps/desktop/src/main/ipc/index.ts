// IPC 注册表：按功能域声明式注册处理器。
// 注册表化重构：各功能域在独立模块中声明 register*Ipc，此处汇总装配；
// 未来插件可向 ipcRegistrars 数组追加自己的 registrar（插件通道动态生成）。
import { ipcMain } from 'electron';
import type { IpcMain } from 'electron';
import { registerSettingsIpc } from './settings.js';
import { registerModelsIpc } from './models.js';
import { registerPresetsIpc } from './presets.js';
import { registerServerIpc } from './server.js';
import { registerSystemIpc } from './system.js';
import { registerWindowIpc } from './window.js';
import { registerDownloadIpc } from './download.js';
import { registerLogsIpc } from './logs.js';

type IpcRegistrar = (ipcMain: IpcMain) => void;

const ipcRegistrars: IpcRegistrar[] = [
  registerSettingsIpc,
  registerModelsIpc,
  registerPresetsIpc,
  registerServerIpc,
  registerSystemIpc,
  registerWindowIpc,
  registerDownloadIpc,
  registerLogsIpc,
];

/** 注册全部 IPC 处理器（按功能域依次装配）。 */
export function registerIpcHandlers(): void {
  for (const register of ipcRegistrars) {
    register(ipcMain);
  }
}
