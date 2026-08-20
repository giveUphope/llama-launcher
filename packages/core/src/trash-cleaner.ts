import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { CONFIG_DIR, SETTINGS_FILE, PRESETS_DIR } from './paths.js';
import type { TrashItem, TrashKind, DetectResult, CleanResult } from '@llama-launcher/shared';

/**
 * 配置目录清理模块（~/.llama_launcher/）
 *
 * 设计原则：强校验、白名单、严格路径隔离
 *  - 所有待清理路径必须严格位于 CONFIG_DIR 内，且不是符号链接
 *  - settings.json 永不清理（核心配置）
 *  - 仅清理明确识别为无效/过时的内容
 *  - 不清理未识别的文件（保守策略）
 */

// 重新导出类型，方便外部使用
export type { TrashItem, TrashKind, DetectResult, CleanResult };

/** 永不清理的白名单文件名（运行时动态解析绝对路径） */
const WHITELIST_FILENAMES = ['settings.json'];

/** 检查路径是否在白名单中（运行时动态解析，支持路径 mock） */
function isWhitelisted(absPath: string): boolean {
  return WHITELIST_FILENAMES.some(name => absPath === join(CONFIG_DIR, name) || absPath === SETTINGS_FILE);
}

/** 允许清理的临时文件扩展名（小写，含点） */
const TEMP_EXTENSIONS = new Set(['.tmp', '.bak', '.old', '.log', '.tmp2']);

/** 允许清理的 JSON 扩展名（用于损坏检测） */
const JSON_EXTENSIONS = new Set(['.json']);

/**
 * 路径安全校验：确保目标路径严格位于 CONFIG_DIR 内，且不是符号链接。
 * 防止清理操作逃逸到其他目录。
 */
function isSafeInsideConfigDir(absPath: string): boolean {
  const rel = relative(CONFIG_DIR, absPath);
  // 相对路径为空表示 CONFIG_DIR 自身，不允许
  if (!rel) return false;
  // 以 .. 开头表示在 CONFIG_DIR 之外
  if (rel.startsWith('..')) return false;
  // 绝对路径（跨盘符时 relative 返回绝对路径）
  if (sep === '/' && rel.startsWith('/')) return false;
  if (sep === '\\' && /^[a-zA-Z]:[\\/]/.test(rel)) return false;
  return true;
}

/**
 * 符号链接检测：符号链接可能指向任意路径，一律拒绝清理。
 */
function isSymbolicLink(absPath: string): boolean {
  try {
    return lstatSync(absPath).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 递归计算目录大小 */
function calcDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink()) continue; // 跳过符号链接
        if (entry.isDirectory()) {
          total += calcDirSize(childPath);
        } else if (entry.isFile()) {
          total += statSync(childPath).size;
        }
      } catch {
        // 跳过无法访问的项
      }
    }
  } catch {
    // 忽略读取错误
  }
  return total;
}

/** 检测 JSON 文件是否损坏（无法解析） */
function isBrokenJson(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
}

/**
 * 检测 CONFIG_DIR 内可清理的无效/过时文件。
 *
 * 识别规则（强校验）：
 *  1. presets/ 目录：旧预设目录，已迁移到 modelsDir/presets，标记为 stale_presets_dir
 *  2. *.tmp/*.bak/*.old/*.log：临时/备份/日志文件，标记为 temp_file
 *  3. 非 settings.json 的 *.json：若 JSON 解析失败，标记为 broken_json
 *
 * 白名单（永不清理）：
 *  - settings.json（核心配置）
 *  - CONFIG_DIR 自身
 */
export function detectTrash(): DetectResult {
  const items: TrashItem[] = [];
  let totalSize = 0;

  if (!existsSync(CONFIG_DIR)) {
    return { items, totalSize };
  }

  // 1. 检测旧 presets 目录（已迁移到 modelsDir/presets）
  if (existsSync(PRESETS_DIR) && !isSymbolicLink(PRESETS_DIR)) {
    try {
      const st = statSync(PRESETS_DIR);
      if (st.isDirectory()) {
        const size = calcDirSize(PRESETS_DIR);
        items.push({
          relPath: relative(CONFIG_DIR, PRESETS_DIR),
          absPath: PRESETS_DIR,
          kind: 'stale_presets_dir',
          size,
        });
        totalSize += size;
      }
    } catch {
      // 忽略 stat 错误
    }
  }

  // 2. 扫描 CONFIG_DIR 根目录下的文件
  try {
    const entries = readdirSync(CONFIG_DIR, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = join(CONFIG_DIR, entry.name);

      // 跳过符号链接（安全策略）
      if (entry.isSymbolicLink()) continue;
      // 跳过目录（presets 已单独处理）
      if (entry.isDirectory()) continue;
      if (!entry.isFile()) continue;

      // 白名单跳过
      if (isWhitelisted(absPath)) continue;

      // 路径安全校验（理论上学 CONFIG_DIR 子项都安全，双重保险）
      if (!isSafeInsideConfigDir(absPath)) continue;

      const ext = extname(entry.name).toLowerCase();
      try {
        const size = statSync(absPath).size;

        if (TEMP_EXTENSIONS.has(ext)) {
          // 临时/备份/日志文件
          items.push({
            relPath: entry.name,
            absPath,
            kind: 'temp_file',
            size,
          });
          totalSize += size;
        } else if (JSON_EXTENSIONS.has(ext)) {
          // 非 settings.json 的 JSON 文件：检测是否损坏
          if (isBrokenJson(absPath)) {
            items.push({
              relPath: entry.name,
              absPath,
              kind: 'broken_json',
              size,
            });
            totalSize += size;
          }
        }
        // 其他扩展名文件：不识别，不清理（保守策略）
      } catch {
        // stat 失败跳过
      }
    }
  } catch {
    // 忽略读取错误
  }

  return { items, totalSize };
}

/**
 * 执行清理：删除指定的清理项。
 *
 * 安全策略：
 *  - 对每个待清理项重新校验路径安全（防止调用方伪造路径）
 *  - 重新检测符号链接（防止清理期间被替换为符号链接）
 *  - 重新校验是否在白名单内（防止调用方伪造 settings.json）
 */
export function cleanTrash(items: TrashItem[]): CleanResult {
  let cleaned = 0;
  let failed = 0;
  let totalSize = 0;

  for (const item of items) {
    // 1. 路径安全校验：必须严格位于 CONFIG_DIR 内
    if (!isSafeInsideConfigDir(item.absPath)) {
      failed++;
      continue;
    }
    // 2. 白名单校验：settings.json 永不清理
    if (isWhitelisted(item.absPath)) {
      failed++;
      continue;
    }
    // 3. 符号链接检测：防止清理期间被替换
    if (isSymbolicLink(item.absPath)) {
      failed++;
      continue;
    }
    // 4. 存在性校验
    if (!existsSync(item.absPath)) {
      // 已不存在，视为已清理
      continue;
    }

    try {
      const st = lstatSync(item.absPath);
      if (st.isDirectory()) {
        // 目录：递归删除（仅对 presets 目录生效）
        const sizeBefore = calcDirSize(item.absPath);
        rmSync(item.absPath, { recursive: true, force: true });
        cleaned++;
        totalSize += sizeBefore;
      } else if (st.isFile()) {
        const sizeBefore = st.size;
        rmSync(item.absPath, { force: true });
        cleaned++;
        totalSize += sizeBefore;
      } else {
        // 其他类型（FIFO、设备等）不清理
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { cleaned, failed, totalSize };
}

/** 格式化字节大小为人类可读字符串 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
