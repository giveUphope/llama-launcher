// IPC 域：预设。
// 存储位置与 id 迁移在注册时执行一次（幂等）：旧版 <models_dir>/presets → 活目录
// CONFIG_DIR/presets，v1/v2 文件补 id 升级 v3。之后全部读写走 PresetRepository 单例，
// 载荷面向领域（id/摘要/upsert），不暴露目录与文件布局。
import type { IpcMain } from 'electron';
import {
  loadSettings, getPresetRepository, migratePresetStore,
  legacyModelsPresetsDir, PRESETS_DIR, PresetRepoError,
} from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { PresetSaveInput } from '@llama-launcher/shared';

let migrated = false;

function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  try {
    const settings = loadSettings();
    const result = migratePresetStore(legacyModelsPresetsDir(settings.models_dir), PRESETS_DIR);
    if (result.moved > 0 || result.upgraded > 0) {
      console.log(
        `[presets] migrated: moved=${result.moved} upgraded=${result.upgraded} skipped=${result.skipped}`,
      );
    }
  } catch (e) {
    console.warn('[presets] preset store migration failed:', e instanceof Error ? e.message : String(e));
  }
}

export function registerPresetsIpc(ipcMain: IpcMain): void {
  ensureMigrated();
  const repo = getPresetRepository();

  ipcMain.handle(IPC.PRESETS_LIST, () => repo.summaries());
  ipcMain.handle(IPC.PRESETS_SAVE, (_e, input: PresetSaveInput) => repo.save(input ?? { name: '', values: {} }));
  ipcMain.handle(IPC.PRESETS_LOAD, (_e, id: string) => repo.get(id));
  ipcMain.handle(IPC.PRESETS_DELETE, (_e, id: string) => repo.delete(id));
  ipcMain.handle(IPC.PRESETS_RENAME, (_e, id: string, name: string) => {
    try {
      return repo.rename(id, name);
    } catch (e) {
      // 业务失败（目标不存在/重名）转译为可读错误文本，渲染层按失败 toast
      if (e instanceof PresetRepoError) throw new Error(e.code);
      throw e;
    }
  });
}
