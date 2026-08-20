// IPC 域：模型管理（扫描/检测/GGUF 元数据/目录监听/移除）。
import type { IpcMain } from 'electron';
import {
  scanModels,
  detectMmproj,
  detectDraftModel,
  readGgufMetadata,
  removeModelFile,
  invalidateScanCache,
  loadSettings,
  deletePresetsForModel,
} from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import { watchModelsDir, notifyModelsChanged } from './models-watcher.js';

export function registerModelsIpc(ipcMain: IpcMain): void {
  // 注意：目录不存在时的"创建目录"确认交互改由渲染进程负责（自定义弹窗），
  // 此处仅透传 options 并把 DIR_NOT_FOUND 错误抛回渲染进程。
  ipcMain.handle(IPC.MODELS_SCAN, (_e, dir: string, options?: { createIfMissing?: boolean }) => {
    return scanModels(dir, options ?? {});
  });
  ipcMain.handle(IPC.MODELS_DETECT_MMPROJ, (_e, modelPath: string) => {
    return detectMmproj(modelPath);
  });
  ipcMain.handle(IPC.MODELS_DETECT_DRAFT, (_e, modelPath: string) => {
    return detectDraftModel(modelPath);
  });
  ipcMain.handle(IPC.MODELS_READ_GGUF_META, async (_e, modelPath: string) => {
    try {
      return { ok: true, data: await readGgufMetadata(modelPath) };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  // 监听模型目录变化：递归监听子目录，文件增删时通知渲染进程
  ipcMain.handle(IPC.MODELS_WATCH, (_e, dir: string) => watchModelsDir(dir));

  // 按模型文件移除模型（仅允许删除 models_dir 内部路径）。
  // 删除前判断目录内容：存在其他量化版本/用户文件 → 仅删选中文件；
  // 目录无其他内容 → 连同 mmproj/mtp/dflash 伴随文件与空目录一并删除。
  // 同时删除关联该模型的预设（model 路径以被删路径开头的预设）
  ipcMain.handle(IPC.MODELS_REMOVE, (_e, modelPath: string) => {
    const settings = loadSettings();
    const result = removeModelFile(modelPath, settings.models_dir);
    if (result.ok) {
      // 删除后使扫描缓存失效并通知刷新，避免列表命中陈旧缓存
      invalidateScanCache();
      notifyModelsChanged();
      // 同步删除关联预设（不阻塞主流程；删除失败静默）：
      // 整目录移除时按目录前缀匹配（覆盖该目录下所有模型/伴随文件引用的预设）；
      // 仅移除单个模型文件时按文件路径匹配（只清理引用该文件的预设）
      try {
        const removedPresets = deletePresetsForModel(settings.models_dir, result.removedDir ?? modelPath);
        if (removedPresets.length > 0) {
          console.log(`[models] removed ${removedPresets.length} preset(s) for deleted model: ${removedPresets.join(', ')}`);
        }
      } catch (e: any) {
        console.warn('[models] failed to clean presets for deleted model:', e?.message ?? e);
      }
    }
    return result;
  });
}
