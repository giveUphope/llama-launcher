// 模型目录文件监听（单例）：供 models / download 两个 IPC 域共用。
import { watch, type FSWatcher } from 'node:fs';
import { BrowserWindow } from 'electron';
import { invalidateScanCache } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';

let modelsWatcher: FSWatcher | null = null;
// 防抖计时器：fs.watch 可能短时间内触发多次
let modelsChangedTimer: NodeJS.Timeout | null = null;

/** 通知所有窗口模型列表已变化（500ms 防抖）。 */
export function notifyModelsChanged(): void {
  if (modelsChangedTimer) clearTimeout(modelsChangedTimer);
  modelsChangedTimer = setTimeout(() => {
    modelsChangedTimer = null;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.MODELS_CHANGED);
    }
  }, 500);
}

/**
 * 启动/切换模型目录监听：递归监听子目录，.gguf 增删时使扫描缓存失效并通知渲染进程。
 * @returns { ok: true } 或 { ok: false, error }
 */
export function watchModelsDir(dir: string): { ok: boolean; error?: string } {
  // 关闭旧的 watcher
  if (modelsWatcher) {
    try { modelsWatcher.close(); } catch { /* 忽略关闭错误 */ }
    modelsWatcher = null;
  }
  if (!dir) return { ok: true };
  try {
    // recursive: true 在 Windows/macOS 支持递归监听子目录
    modelsWatcher = watch(dir, { recursive: true }, (_eventType, _filename) => {
      // 仅 .gguf 文件变化才通知（_filename 可能只含相对路径片段）
      if (_filename && !_filename.toLowerCase().endsWith('.gguf')) return;
      // 扫描结果缓存同步失效，避免 UI 重新扫描时命中陈旧缓存
      invalidateScanCache();
      notifyModelsChanged();
    });
    modelsWatcher.on('error', () => {
      // 监听错误（如目录被删除）时静默关闭
      if (modelsWatcher) { try { modelsWatcher.close(); } catch { /* */ } modelsWatcher = null; }
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
