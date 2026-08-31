// 应用日志缓冲：记录应用自身生命周期/操作（服务启停、下载事件、错误等），
// 区别于服务控制台（后端 llama-server 输出，由 launcher-bridge 维护）。
// 环形缓冲 + 实时推送到渲染进程（logs:onlog），供「日志」页展示。
import { BrowserWindow } from 'electron';
import { IPC } from '@llama-launcher/shared';
import type { AppLogEntry, AppLogKind } from '@llama-launcher/shared';

const MAX_APP_LOGS = 2000;

const buffer: AppLogEntry[] = [];

/** 记录一条应用日志并推送到所有窗口。 */
export function logApp(kind: AppLogKind, message: string): void {
  const entry: AppLogEntry = { kind, data: message, ts: Date.now() };
  buffer.push(entry);
  if (buffer.length > MAX_APP_LOGS) {
    buffer.splice(0, buffer.length - MAX_APP_LOGS);
  }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.LOGS_ONLOG, entry);
    }
  } catch {
    // 窗口已销毁等场景静默忽略，缓冲仍保留
  }
}

export function getAppLogs(): AppLogEntry[] {
  return buffer;
}

export function clearAppLogs(): void {
  buffer.length = 0;
}