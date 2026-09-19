import { readdir, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, rmSync, type Dirent, type Stats } from 'node:fs';
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
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
 * 扫描结果缓存：按扫描根目录缓存，命中前用"目录时间戳指纹"校验新鲜度——
 * 只对扫描期间访问过的目录各做一次 stat（数十次），而不是对全部文件重新 stat。
 * 增删/改名条目会刷新其所在目录的 mtime，因此子目录内的变化也能被察觉
 * （旧实现只看顶层目录 mtime，任何子目录改动都会导致整树重扫）。
 * 主要失效源是 MODELS_WATCH（fs.watch 递归监听）回调里的 invalidateScanCache(变化路径)。
 */
interface DirStamp {
  path: string;
  mtimeMs: number;
  ctimeMs: number;
}
interface ScanCacheEntry {
  stamps: DirStamp[];
  result: ModelInfo[];
}
const scanCache = new Map<string, ScanCacheEntry>();
const SCAN_CACHE_MAX = 8;
/** 指纹收录的目录数上限：校验成本与目录数成正比，超大目录树只校验前 N 个目录 */
const STAMP_MAX = 200;

/** target 位于 root 内部（或就是 root） */
function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 清除模型扫描缓存。不带参数＝全量清除（手动「刷新」等强一致场景）；
 * 传入变化路径的绝对路径时只失效覆盖该路径的条目，避免单个 .gguf 变动清空全部缓存。
 * 非绝对路径（如 fs.watch 只给出文件名片段）无法可靠归属，保守按全量清除处理。
 */
export function invalidateScanCache(changedPath?: string): void {
  if (!changedPath || !isAbsolute(changedPath)) {
    scanCache.clear();
    return;
  }
  const target = changedPath;
  for (const dir of scanCache.keys()) {
    const root = resolve(dir);
    if (isWithin(root, target) || isWithin(target, root)) scanCache.delete(dir);
  }
}

/** 目录指纹是否仍然新鲜（目录存在且 mtime/ctime 未变；ctime 兼作"同毫秒重建目录"的身份校验） */
async function stampsFresh(stamps: DirStamp[]): Promise<boolean> {
  const checks = await Promise.all(
    stamps.map(async (s) => {
      try {
        const st = await stat(s.path);
        return st.mtimeMs === s.mtimeMs && st.ctimeMs === s.ctimeMs;
      } catch {
        return false;
      }
    }),
  );
  return checks.every((ok) => ok);
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

/**
 * 异步递归遍历：目录级错误静默跳过（与旧同步实现一致），文件级并行 stat 加速。
 * 目录类型由 Dirent 判定（旧实现对每个条目 stat，大型目录下这是扫描的主要成本），
 * 仅返回给结果的 .gguf 文件与类型未知的条目（符号链接）才补一次 stat 取 size/mtime。
 * 同时收集各目录的时间戳指纹（先 stat 后 readdir，保证记录到的 mtime 不晚于列表内容）。
 */
async function walkAsync(dir: string): Promise<{ models: ModelInfo[]; stamps: DirStamp[] }> {
  const out: ModelInfo[] = [];
  const stamps: DirStamp[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries: Dirent[];
    try {
      const ds = await stat(d);
      if (stamps.length < STAMP_MAX) {
        stamps.push({ path: d, mtimeMs: ds.mtimeMs, ctimeMs: ds.ctimeMs });
      }
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    // 本目录伴随文件标签（同一目录下所有模型共享）
    const tags = detectCompanionTags(entries.map((e) => e.name));
    await Promise.all(
      entries.map(async (entry) => {
        const name = entry.name;
        const full = join(d, name);
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        let st: Stats | undefined;
        if (!isDir && !isFile) {
          // 符号链接/类型未知：跟随链接判定（与旧实现的 stat 语义一致）
          try {
            st = await stat(full);
          } catch {
            return;
          }
          isDir = st.isDirectory();
          isFile = st.isFile();
        }
        if (isDir) {
          await walk(full);
          return;
        }
        // 跳过多模态投影器文件和草稿模型文件，它们是辅助文件，不应作为主模型出现在列表中
        if (!isFile || !name.toLowerCase().endsWith('.gguf') || isMmprojFile(name) || isDraftFile(name)) return;
        if (!st) {
          try {
            st = await stat(full);
          } catch {
            return;
          }
        }
        out.push({
          name,
          path: full,
          size: st.size,
          size_str: formatSize(st.size),
          modified: new Date(st.mtimeMs).toISOString(),
          tags,
        });
      }),
    );
  };
  await walk(dir);
  return { models: out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), stamps };
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
  const hit = scanCache.get(dir);
  if (hit) {
    if (await stampsFresh(hit.stamps)) return hit.result;
    scanCache.delete(dir);
  }
  const { models, stamps } = await walkAsync(dir);
  // 未采到任何目录指纹（根目录 stat 失败）时无从判断新鲜度，不写缓存
  if (stamps.length === 0) return models;
  // LRU 简化版：超过上限时删除最早插入的条目
  if (!scanCache.has(dir) && scanCache.size >= SCAN_CACHE_MAX) {
    const firstKey = scanCache.keys().next().value;
    if (firstKey) scanCache.delete(firstKey);
  }
  scanCache.set(dir, { stamps, result: models });
  return models;
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
 * @param dirEntries 调用方已读到的同目录文件名列表（批量场景复用以避免重复 readdir）
 * @returns 找到的第一个匹配文件的完整路径，未找到返回空字符串。
 */
export function detectMmproj(modelPath: string, dirEntries?: string[]): string {
  if (!modelPath) return '';
  const dir = dirname(modelPath);

  let entries: string[] = dirEntries ?? [];
  if (!dirEntries) {
    if (!existsSync(dir)) return '';
    try { entries = readdirSync(dir); } catch { return ''; }
  }

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
