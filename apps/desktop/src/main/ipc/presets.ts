// IPC 域：预设。
import type { IpcMain } from 'electron';
import { loadSettings, listPresets, loadPreset, savePreset, deletePreset, resolvePresetsDir } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { PresetValues } from '@llama-launcher/shared';

// 从当前设置中解析预设目录（模型目录下的 presets 子目录）
function getPresetsDir(): string {
  const settings = loadSettings();
  return resolvePresetsDir(settings.models_dir);
}

export function registerPresetsIpc(ipcMain: IpcMain): void {
  // 预设文件保存在模型目录下的 presets 子目录
  ipcMain.handle(IPC.PRESETS_LIST, () => listPresets(getPresetsDir()));
  ipcMain.handle(IPC.PRESETS_SAVE, (_e, name: string, values: PresetValues) => savePreset(getPresetsDir(), name, values));
  ipcMain.handle(IPC.PRESETS_LOAD, (_e, name: string) => loadPreset(getPresetsDir(), name));
  ipcMain.handle(IPC.PRESETS_DELETE, (_e, name: string) => deletePreset(getPresetsDir(), name));
}
