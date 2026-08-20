import { readdir, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve, sep } from 'node:path';
import type { ModelInfo } from '@llama-launcher/shared';

export interface ScanModelsOptions {
  createIfMissing?: boolean;
}

/**
 * 多模态投影器文件名关键词（小写匹配）。
 * scanModels 会跳过文件名包含这些关键词的 .gguf/.bin 文件，避免把 mmproj 当作模型展示。
 * detectMmproj 反向使用同一组关键词来定位 mmproj 文件。
 */
const MMPROJ_KEYWORDS = ['mmproj', 'projector', 'multimodal'];
const MMPROJ_EXTS = ['.gguf', '.bin'];

/**
 * 草稿模型文件名关键词（小写匹配）。
 * scanModels 会跳过文件名包含这些关键词的 .gguf 文件，避免把草稿模型当作主模型展示。
 * detectDraftModel 反向使用同一组关键词来定位草稿模型文件。
 * 'dflash' 是 DeepSeek 官方草稿模型的命名约定（如 dflash-1.5b.gguf）。
 */
const DRAFT_KEYWORDS = ['dflash', 'draft'];

/**
 * 扫描结果缓存：按 "dir:mtimeMs" 为键，避免切页/刷新时对大型模型目录重复全量 stat。
 * 主要失效源是 MODELS_WATCH（fs.watch 递归监听）回调里的 invalidateScanCache()；
 * mtime 键是次级新鲜度守卫（直接增删文件时目录 mtime 会变化）。
 */
interface ScanCacheEntry {
  key: string;
  result: ModelInfo[];
}
const scanCache = new Map<string, ScanCacheEntry>();
const SCAN_CACHE_MAX = 8;

/**
 * 清除模型扫描缓存。MODELS_WATCH 监听到 .gguf 增删时调用（ipc-handlers），
 * 保证缓存结果不陈旧；也可在手动「刷新」时调用。
 */
export function invalidateScanCache(): void {
  scanCache.clear();
}

function isMmprojFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MMPROJ_KEYWORDS.some((kw) => lower.includes(kw)) && MMPROJ_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * 判断文件是否为草稿模型（dflash/draft 命名的 .gguf 文件）。
 * 与 isMmprojFile 同理：草稿模型是辅助文件，不应作为主模型出现在列表中。
 */
function isDraftFile(name: string): boolean {
  const lower = name.toLowerCase();
  return DRAFT_KEYWORDS.some((kw) => lower.includes(kw)) && lower.endsWith('.gguf');
}

function dirNotFound(dir: string): Error {
  const err = new Error(`Directory does not exist: ${dir}`);
  (err as Error & { code?: string; dir?: string }).code = 'DIR_NOT_FOUND';
  (err as Error & { code?: string; dir?: string }).dir = dir;
  return err;
}

/**
 * 检测目录中的伴随文件标签（mmproj / dflash / draft）。
 * 供模型列表标识：模型目录下存在 mmproj 投影器 → 'mmproj'；
 * 存在 dflash 命名的草稿模型 → 'dflash'；其余 draft 草稿 → 'draft'。
 */
function detectCompanionTags(entries: string[]): string[] {
  const tags: string[] = [];
  if (entries.some(isMmprojFile)) tags.push('mmproj');
  if (entries.some((n) => isDraftFile(n) && n.toLowerCase().includes('dflash'))) {
    tags.push('dflash');
  } else if (entries.some(isDraftFile)) {
    tags.push('draft');
  }
  return tags;
}

/** 异步递归遍历：目录级错误静默跳过（与旧同步实现一致），文件级并行 stat 加速。 */
async function walkAsync(dir: string): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    // 本目录伴随文件标签（同一目录下所有模型共享）
    const tags = detectCompanionTags(entries);
    await Promise.all(
      entries.map(async (name) => {
        const full = join(d, name);
        let st;
        try {
          st = await stat(full);
        } catch {
          return;
        }
        if (st.isDirectory()) {
          await walk(full);
        } else if (st.isFile() && name.toLowerCase().endsWith('.gguf')) {
          // 跳过多模态投影器文件和草稿模型文件，它们是辅助文件，不应作为主模型出现在列表中
          if (isMmprojFile(name) || isDraftFile(name)) return;
          out.push({
            name,
            path: full,
            size: st.size,
            size_str: formatSize(st.size),
            modified: new Date(st.mtimeMs).toISOString(),
            tags,
          });
        }
      }),
    );
  };
  await walk(dir);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function scanModels(dir: string, opts: ScanModelsOptions = {}): Promise<ModelInfo[]> {
  if (!dir) throw dirNotFound(dir);
  if (!existsSync(dir)) {
    if (opts.createIfMissing) {
      mkdirSync(dir, { recursive: true });
    } else {
      throw dirNotFound(dir);
    }
  }
  try {
    const st = await stat(dir);
    const key = `${dir}:${st.mtimeMs}`;
    const hit = scanCache.get(key);
    if (hit) return hit.result;

    const result = await walkAsync(dir);
    // LRU 简化版：超过上限时删除最早插入的条目
    if (scanCache.size >= SCAN_CACHE_MAX) {
      const firstKey = scanCache.keys().next().value;
      if (firstKey) scanCache.delete(firstKey);
    }
    scanCache.set(key, { key, result });
    return result;
  } catch {
    // stat 失败（如目录被并发删除）——回退为直接扫描
    return walkAsync(dir);
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * 在模型文件同目录下自动检测多模态投影器（mmproj）文件。
 * 查找文件名包含 mmproj / projector / multimodal 的 .gguf / .bin 文件。
 * 返回找到的第一个匹配文件的完整路径，未找到返回空字符串。
 */
export function detectMmproj(modelPath: string): string {
  if (!modelPath) return '';
  const dir = dirname(modelPath);
  if (!existsSync(dir)) return '';

  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return ''; }

  const candidates = entries.filter((name) => {
    const lower = name.toLowerCase();
    const hasKeyword = MMPROJ_KEYWORDS.some((kw) => lower.includes(kw));
    const hasExt = MMPROJ_EXTS.some((ext) => lower.endsWith(ext));
    // 排除模型文件自身
    const fullPath = join(dir, name);
    return hasKeyword && hasExt && fullPath !== modelPath;
  });

  if (candidates.length === 0) return '';
  // 优先选择包含 "mmproj" 的文件名
  const mmprojFirst = candidates.find((n) => n.toLowerCase().includes('mmproj'));
  const chosen = mmprojFirst ?? candidates[0];
  return join(dir, chosen);
}

/**
 * 在模型文件同目录下自动检测草稿模型（dflash/draft）文件。
 * 仅匹配 .gguf（不含 .bin）；排除 mmproj 文件（即使文件名含 draft 关键词，
 * 多模态投影器也可能以 draft 命名）；排除模型文件自身。
 * 返回找到的第一个匹配文件的完整路径，未找到返回空字符串。
 */
export function detectDraftModel(modelPath: string): string {
  if (!modelPath) return '';
  const dir = dirname(modelPath);
  if (!existsSync(dir)) return '';

  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return ''; }

  const candidates = entries.filter((name) => {
    const lower = name.toLowerCase();
    if (!lower.endsWith('.gguf')) return false;
    if (!DRAFT_KEYWORDS.some((kw) => lower.includes(kw))) return false;
    // 排除 mmproj 文件（可能包含 draft 关键词）
    if (isMmprojFile(name)) return false;
    // 排除模型文件自身
    const fullPath = join(dir, name);
    return fullPath !== modelPath;
  });

  if (candidates.length === 0) return '';
  // 优先选择包含 "dflash" 的文件名
  const dflashFirst = candidates.find((n) => n.toLowerCase().includes('dflash'));
  const chosen = dflashFirst ?? candidates[0];
  return join(dir, chosen);
}

/**
 * 判断文件是否为模型相关伴随文件（删除模型时一并移除的 GGUF）：
 * 多模态投影器（mmproj/projector/multimodal，.gguf/.bin）、
 * 草稿模型（dflash/draft，.gguf）、MTP 草稿（mtp，.gguf）。
 * 与 isMmprojFile/isDraftFile 同源关键词，删除逻辑复用同一套识别规则。
 */
function isCompanionFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (isMmprojFile(name)) return true;
  if (lower.endsWith('.gguf')) {
    return DRAFT_KEYWORDS.some((kw) => lower.includes(kw)) || lower.includes('mtp');
  }
  return false;
}

/**
 * 按模型文件移除模型。
 * 删除前检查模型文件所在目录：
 * - 目录下存在其他内容（其他量化版本、用户创建的非 gguf 文件、子目录等）→ 仅移除选中的模型文件，
 *   保留其他量化版本与目录下其他内容；
 * - 目录下不存在其他内容 → 移除模型文件及其相关伴随 GGUF（多模态 mmproj、mtp、dflash/草稿），
 *   目录清空后连同空目录一并移除。
 * 安全约束：仅允许删除 modelsDir 内部的路径；拒绝删除 modelsDir 本身。
 * @param modelPath 被删模型文件完整路径
 * @param modelsDir 用户配置的模型根目录
 * @returns { ok: true, removedDir? } 或 { ok: false, error }；
 *          removedDir 仅在"整目录移除"分支返回（目录内已无其他内容且空目录已删除）
 */
export function removeModelFile(
  modelPath: string,
  modelsDir: string,
): { ok: boolean; error?: string; removedDir?: string } {
  if (!modelPath || !modelsDir) return { ok: false, error: 'Empty path' };
  const resolved = resolve(modelPath);
  const base = resolve(modelsDir);
  if (!resolved.startsWith(base + sep)) {
    return { ok: false, error: 'Path is outside the models directory' };
  }
  const dir = dirname(resolved);
  if (!existsSync(resolved)) {
    return { ok: false, error: 'Model file does not exist' };
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }

  const modelName = basename(resolved);
  const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
  const files = entries.filter((d) => d.isFile()).map((d) => d.name);
  // 模型相关伴随文件：仅统计文件（同名子目录不参与）
  const companions = files.filter((n) => n !== modelName && isCompanionFile(n));
  // 目录下其他内容：除被删模型与其伴随文件外的所有条目（子目录、其他量化版本、非 gguf 文件等）
  const otherEntries = [...dirs, ...files.filter((n) => n !== modelName && !companions.includes(n))];

  try {
    if (otherEntries.length > 0) {
      // 目录下还有其他内容 → 仅移除选中的量化版本，保留其他量化版本与目录下其他内容
      rmSync(resolved, { force: true });
      return { ok: true };
    }
    // 目录下无其他内容 → 移除模型文件 + 全部伴随 GGUF（mmproj/mtp/dflash 等）
    rmSync(resolved, { force: true });
    for (const c of companions) {
      rmSync(join(dir, c), { force: true });
    }
    // 目录已清空且不是模型根目录本身时，移除空目录（与旧"按子目录移除"行为一致）
    if (dir !== base && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: true, removedDir: dir };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
