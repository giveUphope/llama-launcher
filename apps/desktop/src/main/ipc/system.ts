// IPC 域：系统（端口/文件/引擎检测、回收站、文件系统只读列举、剪贴板、外链/打开目录）。
import { clipboard, shell, type IpcMain } from 'electron';
import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { detectTrash, cleanTrash } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import type { TrashItem } from '@llama-launcher/shared';

export function registerSystemIpc(ipcMain: IpcMain): void {
  // 文件系统只读列举：供渲染进程自定义文件浏览器使用（渲染进程无 fs 权限）。
  ipcMain.handle(IPC.FS_LIST_DIR, (_e, path: string) => {
    const target = path && path.trim() ? path : process.cwd();
    // 始终计算父目录,即使 target 不存在 —— 这样用户在路径失效时仍可向上导航
    const parent = dirname(target);
    try {
      const names = readdirSync(target);
      const entries = names
        .map((name) => {
          let st;
          try { st = statSync(join(target, name)); } catch { return null; }
          const isDir = st.isDirectory();
          return { name, isDir, isFile: st.isFile() };
        })
        .filter((x): x is { name: string; isDir: boolean; isFile: boolean } => x !== null)
        .sort((a, b) => {
          // 目录在前、文件在后，同组按名称（不区分大小写）排序
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      return { path: target, parent: parent === target ? null : parent, entries, exists: true };
    } catch {
      // 目录不存在或无权限：返回空列表,但保留 parent 以便向上导航
      return { path: target, parent: parent === target ? null : parent, entries: [], exists: false };
    }
  });

  ipcMain.handle(IPC.FS_MKDIR, (_e, path: string) => {
    try {
      if (!path) return false;
      mkdirSync(path, { recursive: true });
      return true;
    } catch {
      return false;
    }
  });

  // Clipboard
  ipcMain.handle(IPC.CLIPBOARD_WRITE, (_e, text: string) => {
    clipboard.writeText(text);
  });

  // External links
  ipcMain.handle(IPC.OPEN_EXTERNAL, (_e, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // 在系统文件管理器中打开本地目录
  ipcMain.handle(IPC.OPEN_PATH, async (_e, filePath: string) => {
    try {
      if (!filePath) return { ok: false, error: 'Empty path' };
      // shell.openPath 接受文件或目录路径，返回 Promise<error string>(空字符串表示成功)
      const result = await shell.openPath(filePath);
      return result ? { ok: false, error: result } : { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // System - 启动前校验辅助
  // 检查端口是否被占用：尝试创建 TCP server 监听该端口，能绑定则端口空闲
  ipcMain.handle(IPC.SYSTEM_CHECK_PORT, async (_e, port: number) => {
    return new Promise<{ inUse: boolean; pid?: number }>((resolve) => {
      const tester = createServer();
      tester.once('error', () => {
        resolve({ inUse: true });
      });
      tester.once('listening', () => {
        tester.close(() => resolve({ inUse: false }));
      });
      tester.listen(port, '127.0.0.1');
    });
  });

  // 检查文件是否存在（用于校验 server_exe、model 文件）
  ipcMain.handle(IPC.SYSTEM_FILE_EXISTS, (_e, filePath: string) => {
    try {
      return existsSync(filePath);
    } catch {
      return false;
    }
  });

  // 在目录内查找 llama-server 可执行文件（内联检测机制）
  // 查找顺序：目录根 → 一级子目录
  ipcMain.handle(IPC.SYSTEM_FIND_LLAMA_EXE, (_e, dir: string) => {
    if (!dir) return '';
    const exeNames = process.platform === 'win32'
      ? ['llama-server.exe']
      : ['llama-server'];
    try {
      // 1. 目录根
      for (const name of exeNames) {
        const p = join(dir, name);
        if (existsSync(p)) return p;
      }
      // 2. 一级子目录（如 llama-b9878-bin-win-vulkan-x64/llama-server.exe）
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const name of exeNames) {
          const p = join(dir, entry.name, name);
          if (existsSync(p)) return p;
        }
      }
    } catch {
      // 忽略读取错误
    }
    return '';
  });

  // 检测配置目录（~/.llama_launcher/）内的可清理项
  // 强校验：仅返回明确识别的无效/过时文件，settings.json 永不清理
  ipcMain.handle(IPC.SYSTEM_DETECT_TRASH, () => {
    return detectTrash();
  });

  // 执行清理：对每个待清理项重新校验路径安全、白名单、符号链接
  ipcMain.handle(IPC.SYSTEM_CLEAN_TRASH, (_e, items: TrashItem[]) => {
    return cleanTrash(items ?? []);
  });
}
