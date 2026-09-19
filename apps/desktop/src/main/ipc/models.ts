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
  // 此处对 DIR_NOT_FOUND 仅降噪记录一次，并以可辨识结果 {ok:false, code:'DIR_NOT_FOUND'}
  // 返回渲染进程（不抛错，避免多个调用点反复刷 Electron handler error 与 dev 控制台）。
  const missingDirWarned = new Set<string>();
  ipcMain.handle(IPC.MODELS_SCAN, async (_e, dir: string, options?: { createIfMissing?: boolean }) => {
    try {
      return await scanModels(dir, options ?? {});
    } catch (err: any) {
      if (err?.code === 'DIR_NOT_FOUND') {
        if (!missingDirWarned.has(dir)) {
          missingDirWarned.add(dir);
          console.warn(`[models] 模型目录不存在（仅提示一次，渲染进程引导创建）：${dir}`);
        }
        return { ok: false, code: 'DIR_NOT_FOUND', dir };
      }
      throw err;
    }
  });
  ipcMain.handle(IPC.MODELS_DETECT_MMPROJ, (_e, modelPath: string) => {
    return detectMmproj(modelPath);
  });
  ipcMain.handle(IPC.MODELS_DETECT_DRAFT, (_e, modelPath: string) => {
    return detectDraftModel(modelPath);
  });
  ipcMain.handle(IPC.MODELS_READ_GGUF_META, async (_e, modelPath: string) => {
    try {
      const info = await readGgufMetadata(modelPath);
      // IPC 载荷裁剪：info.metadata 是完整 KV 映射（数十~数百键，含 tokenizer 特殊 token
      // 数组），info.chat_template 原文可达 50–200 KB，两者每次选择模型都要被结构化克隆
      // 进渲染进程，而界面只用派生字段 + chat_template 的「有无」（ModelMetaCard 显示 ✓）。
      // 派生计算（suggestions 等）都在 core 内部完成，裁剪不影响任何消费方。
      const { metadata, chat_template, ...infoRest } = info.info;
      void metadata;
      return {
        ok: true,
        data: {
          ...info,
          info: {
            ...infoRest,
            chat_template: chat_template ? chat_template.slice(0, 200) : chat_template,
          },
        },
      };
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
