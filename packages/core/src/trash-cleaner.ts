import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, extname, basename } from 'node:path';
import { CONFIG_DIR, SETTINGS_FILE, PRESETS_DIR, resolvePresetsDir } from './paths.js';
import { DOWNLOAD_LOG_SUFFIX, LEGACY_META_SUFFIX } from './download-log.js';
import { loadPreset } from './presets-store.js';
import type { TrashItem, TrashKind, TrashRoot, DetectResult, CleanResult } from '@llama-launcher/shared';

/**
 * 应用生成文件清理模块。
 *
 * 覆盖应用写入的全部落盘位置（生成清单与扫描规则一一对应）：
 *  - 配置目录 CONFIG_DIR（~/.llama_launcher/）：
 *      settings.json（白名单永不清理）、settings.json.bak/.tmp（损坏备份/原子写残留）、
 *      presets/（旧版预设目录，已迁移到 modelsDir/presets）、stats.jsonl（旧版下载统计，已停用）
 *  - 模型目录 modelsDir（下载与预设的落盘地）：
 *      *.part（下载临时文件）、*.llama_dl.jsonl / *.llama_dl.json（续传日志/旧版快照）、
 *      presets/*.tmp / presets/*.bak（预设原子写/备份残留）、presets/*.json（有效数据；
 *      仅当绑定模型已不存在时作为孤儿预设列出）
 *
 * 设计原则：强校验、白名单、严格路径隔离
 *  - 所有待清理路径必须严格位于其声明根目录（CONFIG_DIR 或 modelsDir）内，且不是符号链接
 *  - settings.json 与有效预设永不清理；未识别的文件不列入清理（保守策略）
 *  - 进行中/已暂停的下载任务占用的路径（partPath/localPath/续传日志）自动保护，
 *    由调用方传入 protectedPaths（DownloadManager.getProtectedPaths()）
 *  - cleanTrash 对每个传入项按其声明 kind 重新校验（防渲染层伪造路径/类型）
 */

// 重新导出类型，方便外部使用
export type { TrashItem, TrashKind, TrashRoot, DetectResult, CleanResult };

/** 扫描/清理选项：模型目录与受保护路径集合（活动下载任务占用） */
export interface TrashScanOptions {
  modelsDir?: string;
  /** resolve 后的绝对路径集合（.part/localPath/续传日志），清理必须避开 */
  protectedPaths?: Set<string>;
}

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

/** 下载残留后缀（.part 临时文件 / 续传事件日志 / 旧版周期快照） */
const DOWNLOAD_RESIDUE_SUFFIXES = ['.part', DOWNLOAD_LOG_SUFFIX, LEGACY_META_SUFFIX];

/** 旧版下载统计文件名（已停用，仅可能来自历史版本） */
const LEGACY_STATS_FILENAME = 'stats.jsonl';

/** 模型目录递归扫描深度上限（namespace/name/file 通常 ≤3，留冗余） */
const MODELS_SCAN_MAX_DEPTH = 8;

/** 路径安全校验：absPath 严格位于 rootDir 内（不含 rootDir 自身；跨盘符/越界/绝对相对混用均拒绝） */
function isInsideDir(rootDir: string, absPath: string): boolean {
  if (!rootDir) return false;
  const rel = relative(rootDir, absPath);
  if (!rel) return false;
  if (rel.startsWith('..')) return false;
  if (sep === '/' && rel.startsWith('/')) return false;
  if (sep === '\\' && /^[a-zA-Z]:[\\/]/.test(rel)) return false;
  return true;
}

/** 按清理项声明的根取校验目录 */
function rootDirOf(root: TrashRoot, modelsDir: string): string {
  return root === 'config' ? CONFIG_DIR : modelsDir;
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

function fileSize(absPath: string): number {
  try {
    return statSync(absPath).size;
  } catch {
    return 0;
  }
}

/** 文件名是否以下载残留后缀结尾（大小写不敏感） */
function isDownloadResidueName(name: string): boolean {
  const lower = name.toLowerCase();
  return DOWNLOAD_RESIDUE_SUFFIXES.some((s) => lower.endsWith(s));
}

/**
 * 递归遍历目录下的文件（跳过符号链接文件/目录；目录回调可决定跳过子树）。
 * dirs 回调返回 false 时不进入该子目录。
 */
function walkFiles(
  dir: string,
  depth: number,
  onFile: (absPath: string, name: string) => void,
  onDir?: (absPath: string, name: string) => boolean,
): void {
  if (depth <= 0) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (onDir && !onDir(absPath, entry.name)) continue;
      walkFiles(absPath, depth - 1, onFile, onDir);
    } else if (entry.isFile()) {
      onFile(absPath, entry.name);
    }
  }
}

/**
 * 扫描模型目录内应用生成的残留：
 *  - 下载残留：.part / .llama_dl.jsonl / .llama_dl.json（活动/暂停任务占用者跳过）
 *  - presets/ 子目录：原子写 .tmp/.bak 残留；*.json 中绑定模型已不存在的孤儿预设；
 *    解析失败的损坏预设
 */
function scanModelsDir(
  modelsDir: string,
  protectedPaths: Set<string>,
  items: TrashItem[],
): void {
  const presetsDir = resolvePresetsDir(modelsDir);
  const add = (absPath: string, root: TrashRoot, kind: TrashKind, size: number) => {
    items.push({
      relPath: relative(rootDirOf(root, modelsDir), absPath),
      absPath,
      root,
      kind,
      size,
    });
  };

  // 下载残留：全目录递归（模型文件本体不匹配残留后缀，天然不会误伤）
  walkFiles(
    modelsDir,
    MODELS_SCAN_MAX_DEPTH,
    (absPath, name) => {
      if (!isDownloadResidueName(name)) return;
      if (protectedPaths.has(resolve(absPath))) return;
      add(absPath, 'models', 'download_orphan', fileSize(absPath));
    },
    (absPath) => {
      // 配置目录嵌在模型目录内时不进入（避免与 config 扫描重复）；presets 单独走下方逻辑
      if (absPath === CONFIG_DIR) return false;
      if (absPath === presetsDir) return false;
      return true;
    },
  );

  // presets/ 子目录：残留临时文件 + 孤儿/损坏预设
  if (!existsSync(presetsDir) || isSymbolicLink(presetsDir)) return;
  let entries;
  try {
    entries = readdirSync(presetsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const absPath = join(presetsDir, entry.name);
    const ext = extname(entry.name).toLowerCase();
    if (entry.name.toLowerCase().endsWith('.json.tmp')) {
      // extname('x.json.tmp')='.tmp'；原子写残留
      add(absPath, 'models', 'temp_file', fileSize(absPath));
    } else if (ext === '.tmp' || ext === '.bak') {
      add(absPath, 'models', 'temp_file', fileSize(absPath));
    } else if (ext === '.json') {
      const name = entry.name.replace(/\.json$/i, '');
      const parsed = loadPreset(presetsDir, name);
      if (!parsed) {
        // 解析失败：损坏预设（形状非法/JSON 坏）
        if (isBrokenJson(absPath)) add(absPath, 'models', 'broken_json', fileSize(absPath));
        continue;
      }
      if (parsed.model && !existsSync(parsed.model)) {
        add(absPath, 'models', 'orphan_preset', fileSize(absPath));
      }
      // 有效预设 / 纯参数集（model=null）：不清理
    }
    // 其他扩展名：不识别，不清理（保守策略）
  }
}

/**
 * 检测应用生成文件中的可清理项（配置目录 + 模型目录）。
 *
 * 识别规则（强校验）：
 *  1. CONFIG_DIR/presets：旧预设目录（已迁移到 modelsDir/presets）→ stale_presets_dir
 *  2. CONFIG_DIR 根 *.tmp/*.bak/*.old/*.log → temp_file；stats.jsonl → legacy_stats
 *  3. CONFIG_DIR 根非 settings.json 的 *.json：解析失败 → broken_json
 *  4. modelsDir 内下载残留（未被活动任务占用）→ download_orphan
 *  5. modelsDir/presets 内 *.tmp/*.bak → temp_file；*.json 按内容分类：
 *     损坏 → broken_json；绑定模型已删除 → orphan_preset；有效/纯参数集 → 保留
 *
 * 白名单（永不清理）：settings.json、有效预设、CONFIG_DIR/modelsDir 自身、未识别文件
 */
export function detectTrash(opts: TrashScanOptions = {}): DetectResult {
  const items: TrashItem[] = [];
  const modelsDir = String(opts.modelsDir ?? '').trim();
  const protectedPaths = opts.protectedPaths ?? new Set<string>();

  // ---- 1. 配置目录（~/.llama_launcher/）----
  if (existsSync(CONFIG_DIR)) {
    // 1a. 旧 presets 目录（已迁移到 modelsDir/presets）
    if (existsSync(PRESETS_DIR) && !isSymbolicLink(PRESETS_DIR)) {
      try {
        const st = statSync(PRESETS_DIR);
        if (st.isDirectory()) {
          const size = calcDirSize(PRESETS_DIR);
          items.push({
            relPath: relative(CONFIG_DIR, PRESETS_DIR),
            absPath: PRESETS_DIR,
            root: 'config',
            kind: 'stale_presets_dir',
            size,
          });
        }
      } catch {
        // 忽略 stat 错误
      }
    }

    // 1b. 根目录文件
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

        // 路径安全校验（理论上 CONFIG_DIR 子项都安全，双重保险）
        if (!isInsideDir(CONFIG_DIR, absPath)) continue;

        const ext = extname(entry.name).toLowerCase();
        const size = fileSize(absPath);

        if (entry.name.toLowerCase() === LEGACY_STATS_FILENAME) {
          // 旧版下载统计（已停用；仅可能来自历史版本）
          items.push({ relPath: entry.name, absPath, root: 'config', kind: 'legacy_stats', size });
        } else if (TEMP_EXTENSIONS.has(ext)) {
          // 临时/备份/日志文件
          items.push({ relPath: entry.name, absPath, root: 'config', kind: 'temp_file', size });
        } else if (JSON_EXTENSIONS.has(ext)) {
          // 非 settings.json 的 JSON 文件：检测是否损坏
          if (isBrokenJson(absPath)) {
            items.push({ relPath: entry.name, absPath, root: 'config', kind: 'broken_json', size });
          }
        }
        // 其他扩展名文件：不识别，不清理（保守策略）
      }
    } catch {
      // 忽略读取错误
    }
  }

  // ---- 2. 模型目录（下载残留/预设目录；modelsDir 嵌在 CONFIG_DIR 内时跳过避免重复）----
  if (modelsDir && existsSync(modelsDir) && !isInsideDir(CONFIG_DIR, modelsDir) && modelsDir !== CONFIG_DIR) {
    scanModelsDir(modelsDir, protectedPaths, items);
  }

  const totalSize = items.reduce((sum, it) => sum + it.size, 0);
  // 稳定排序：根 → 类型 → 相对路径
  items.sort(
    (a, b) =>
      a.root.localeCompare(b.root) ||
      a.kind.localeCompare(b.kind) ||
      a.relPath.localeCompare(b.relPath),
  );
  return { items, totalSize };
}

/**
 * 清理项的"再校验"：按声明 kind 复核路径与内容特征，防渲染层伪造。
 * 返回 true = 仍可清理；false = 状态已变化（跳过）或校验失败。
 */
function revalidateItem(item: TrashItem, modelsDir: string, protectedPaths: Set<string>): boolean {
  const rootDir = rootDirOf(item.root, modelsDir);
  if (!isInsideDir(rootDir, item.absPath)) return false;
  if (isWhitelisted(item.absPath)) return false;

  const name = basename(item.absPath);
  const ext = extname(name).toLowerCase();
  switch (item.kind) {
    case 'stale_presets_dir':
      return item.root === 'config' && item.absPath === PRESETS_DIR;
    case 'legacy_stats':
      return item.root === 'config' && name.toLowerCase() === LEGACY_STATS_FILENAME;
    case 'temp_file': {
      if (item.root === 'config') return TEMP_EXTENSIONS.has(ext);
      // models 根：仅允许 presets 目录内的原子写/备份残留
      return item.absPath.startsWith(resolvePresetsDir(modelsDir) + sep) && (ext === '.tmp' || ext === '.bak');
    }
    case 'broken_json': {
      if (ext !== '.json') return false;
      if (item.root === 'config') return isBrokenJson(item.absPath);
      return item.absPath.startsWith(resolvePresetsDir(modelsDir) + sep) && isBrokenJson(item.absPath);
    }
    case 'download_orphan': {
      if (item.root !== 'models') return false;
      if (!isDownloadResidueName(name)) return false;
      // 清理时刻重查保护集：扫描后新启动/暂停的任务不被误删
      return !protectedPaths.has(resolve(item.absPath));
    }
    case 'orphan_preset': {
      if (item.root !== 'models') return false;
      if (ext !== '.json') return false;
      if (!item.absPath.startsWith(resolvePresetsDir(modelsDir) + sep)) return false;
      // 清理时刻重读：模型文件重新出现（换盘/改路径）则放弃删除
      const parsed = loadPreset(resolvePresetsDir(modelsDir), name.replace(/\.json$/i, ''));
      return !!parsed && !!parsed.model && !existsSync(parsed.model);
    }
    default:
      return false;
  }
}

/**
 * 执行清理：删除指定的清理项。
 *
 * 安全策略：
 *  - 对每个待清理项重新校验根目录归属（config → CONFIG_DIR，models → modelsDir）
 *  - 按声明 kind 复核路径与内容特征（防伪造）；孤儿预设/下载残留清理时刻重查
 *    （模型文件重新出现、任务重新占用 → 放弃该项）
 *  - 重新检测符号链接（防止清理期间被替换）
 *  - settings.json 与有效预设永不清理
 */
export function cleanTrash(items: TrashItem[], opts: TrashScanOptions = {}): CleanResult {
  let cleaned = 0;
  let failed = 0;
  let totalSize = 0;
  const modelsDir = String(opts.modelsDir ?? '').trim();
  const protectedPaths = opts.protectedPaths ?? new Set<string>();

  for (const item of items) {
    // 1. kind 级再校验（含根归属、白名单、内容特征、保护集、孤儿复核）
    if (!revalidateItem(item, modelsDir, protectedPaths)) {
      failed++;
      continue;
    }
    // 2. 符号链接检测：防止清理期间被替换
    if (isSymbolicLink(item.absPath)) {
      failed++;
      continue;
    }
    // 3. 存在性校验
    if (!existsSync(item.absPath)) {
      // 已不存在，视为已清理
      continue;
    }

    try {
      const st = lstatSync(item.absPath);
      if (st.isDirectory()) {
        // 目录：递归删除（仅 stale_presets_dir 一种目录形态）
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
