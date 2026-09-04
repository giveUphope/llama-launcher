// IPC 域：服务（启动/停止/重启/状态/预览）。
import type { IpcMain } from 'electron';
import { launcherBridge } from '../launcher-bridge.js';
import { logApp } from '../app-log.js';
import { previewCommand } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { AppSettings, PresetValues } from '@llama-launcher/shared';

export function registerServerIpc(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.SERVER_START, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      launcherBridge.start(values, settings);
      logApp('info', `Service start requested (model: ${String(values.model ?? '') || 'none'})`);
      return { ok: true };
    } catch (err: any) {
      logApp('error', `Service start failed: ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_STOP, () => {
    try {
      launcherBridge.stop();
      logApp('info', 'Service stop requested');
      return { ok: true };
    } catch (err: any) {
      logApp('error', `Service stop failed: ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_RESTART, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      launcherBridge.restart(values, settings);
      logApp('info', 'Service restart requested');
      return { ok: true };
    } catch (err: any) {
      logApp('error', `Service restart failed: ${err?.message ?? String(err)}`);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(IPC.SERVER_STATUS, () => launcherBridge.getStatus());
  ipcMain.handle(IPC.SERVER_PREVIEW, (_e, values: PresetValues, settings: AppSettings) => {
    try {
      // 内置参数命令预览：不含扩展参数（扩展参数在 UI 独立文本框，复制时合并）
      return { ok: true, data: previewCommand({ values, settings, includeCustomArgs: false }) };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}
