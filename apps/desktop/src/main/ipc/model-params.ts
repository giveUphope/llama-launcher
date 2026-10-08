// IPC 域：每模型参数集（参数跟模型走，自动持久化/自动载回）。
// 注册时执行两段一次性迁移（幂等）：旧版 <models_dir>/presets 与集中式
// ~/.llama_launcher/presets 的存量预设 → 每模型参数集（同模型取 saved_at 最新）。
// 全部读写走 ModelParamsRepository 单例，载荷面向模型路径与参数值，
// 不暴露目录、键派生与文件布局。
import type { IpcMain } from 'electron';
import {
  loadSettings, getModelParamsRepository, migratePresetsToModelParams,
  legacyModelsPresetsDir, LEGACY_PRESETS_DIR, MODEL_PARAMS_DIR,
} from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { PresetValues } from '@llama-launcher/shared';

let migrated = false;

function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  try {
    const fromModelsDir = legacyModelsPresetsDir(loadSettings().models_dir);
    // 两个历史位置都迁：模型目录版（更早）先并入集中目录版的位置没有意义——
    // 直接都指向活目录，同名模型后写者覆盖先写者（写前无冲突，模型即键）
    const r1 = migratePresetsToModelParams(fromModelsDir, MODEL_PARAMS_DIR);
    const r2 = migratePresetsToModelParams(LEGACY_PRESETS_DIR, MODEL_PARAMS_DIR);
    if (r1.models + r2.models > 0) {
      console.log(
        `[model-params] presets migrated: models=${r1.models + r2.models} ` +
        `files=${r1.imported + r2.imported} skipped=${r1.skipped + r2.skipped}`,
      );
    }
  } catch (e) {
    console.warn('[model-params] preset migration failed:', e instanceof Error ? e.message : String(e));
  }
}

export function registerModelParamsIpc(ipcMain: IpcMain): void {
  ensureMigrated();
  const repo = getModelParamsRepository();

  ipcMain.handle(IPC.MODELPARAMS_LOAD, (_e, modelPath: string) => repo.load(modelPath));
  ipcMain.handle(IPC.MODELPARAMS_SAVE, (_e, modelPath: string, values: PresetValues) =>
    repo.save(modelPath ?? '', values ?? {}));
  ipcMain.handle(IPC.MODELPARAMS_CLEAR, (_e, modelPath: string) => repo.clear(modelPath));
}
