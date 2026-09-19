import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Preset, PresetValues } from '@llama-launcher/shared';
import { MODEL_KEY, PARAMS, APP_VERSION } from '@llama-launcher/shared';
import { resolvePresetsDir } from './paths.js';

/** 预设 schema 版本：v2 = model 从 values 分离为顶层字段、补 created_at/app_version、
 *  values 仅含参数键并按定义顺序序列化。读取 v1 自动迁移；未来变更在此递增并补迁移。 */
const PRESET_VERSION = 2;

/** PARAMS 定义顺序索引：values 序列化时的排序依据（未知键排最后、保持原相对顺序） */
const VALUE_KEY_ORDER = new Map<string, number>(PARAMS.map((p, i) => [p.key, i]));

/** 归一化参数值：剔除顶层化/已废弃的键（model、legacy _enabled），按定义顺序稳定排序 */
function normalizeValues(raw: Record<string, unknown>): PresetValues {
  const keys = Object.keys(raw).filter((k) => k !== MODEL_KEY && k !== '_enabled');
  // Array.sort 稳定（ES2019+）：未知键比较为 0，保持原相对顺序
  keys.sort(
    (a, b) =>
      (VALUE_KEY_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (VALUE_KEY_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
  const out: PresetValues = {};
  for (const k of keys) out[k] = raw[k] as string | number | boolean;
  return out;
}

/**
 * 预设文件形状（zod）：逐字段容错回退（非法字段不拒文件），values 仅校验「是普通对象」，
 * 值类型信任文件（与旧手写解析一致）；name 空串回退 fallbackName。
 */
const presetFileSchema = z.object({
  name: z.string().catch(''),
  model: z.string().catch(''),
  saved_at: z.string().catch(''),
  created_at: z.string().catch(''),
  app_version: z.string().catch(''),
  values: z.preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    z.record(z.string(), z.unknown()),
  ),
});

/**
 * 解析预设 JSON（形状校验 + 版本迁移到 v2 内存形状）；解析失败或形状非法返回 null。
 * v1 兼容：values[MODEL_KEY] 提升为顶层 model（若同时有顶层 model 则顶层优先）；
 * created_at 缺失时以 saved_at 回填；legacy `_enabled` 残留键剔除。
 * 返回的内存形状统一为 v2（旧文件在下次显式保存时才改写落盘）。
 */
function parsePreset(raw: string, fallbackName: string): Preset | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = presetFileSchema.safeParse(data);
  if (!parsed.success) return null;
  const o = parsed.data;
  const rawValues = o.values as Record<string, unknown>;
  let model: string | null = null;
  if (o.model) model = o.model;
  else {
    const legacy = rawValues[MODEL_KEY];
    if (typeof legacy === 'string' && legacy) model = legacy;
  }
  return {
    preset_version: PRESET_VERSION,
    name: o.name || fallbackName,
    created_at: o.created_at || o.saved_at,
    saved_at: o.saved_at,
    app_version: o.app_version,
    model,
    values: normalizeValues(rawValues),
  };
}

/**
 * 预设文件存储：保存到模型目录下的 presets 子目录，与模型文件同目录管理。
 * dir 参数由调用方（IPC handler）从 settings.models_dir 解析传入。
 * dir 为空时各函数返回空值/空数组，不执行文件操作。
 */
function ensureDir(dir: string): boolean {
  if (!dir) return false;
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------- 解析记忆化 ----------------

/** 预设解析缓存保留的目录数上限（见 setCacheEntry） */
const MAX_CACHED_PRESET_DIRS = 8;

/**
 * 目录 → 文件名 → 解析结果（preset=null 表示损坏文件，同样缓存以免每次 list 都重解析）。
 *
 * 键含文件指纹（mtime+size），但**指纹不单独作为命中依据**：NTFS 时间戳是延迟刷新的，
 * 实测同一毫秒内两次等长改写有九成以上报出完全相同的 mtimeNs/ctimeNs，只比指纹会在外部
 * 快速改写预设文件后返回旧数据。故命中还须比对建立缓存时读到的原始字节（字节一致 ⇒
 * 解析结果一致）。省下的正是每个未变更文件的 JSON.parse + zod 校验 + values 重排序。
 */
const parseCache = new Map<string, Map<string, { key: string; raw: string; preset: Preset | null }>>();

/** 文件身份指纹（mtime+size）；不可 stat 返回 null（该文件不进缓存）。 */
function fingerprint(filePath: string): string | null {
  try {
    const st = statSync(filePath, { bigint: true });
    return `${st.mtimeNs}:${st.size}`;
  } catch {
    return null;
  }
}

/** 缓存对象按只读共享：进出缓存都取副本，防调用方就地改写污染缓存。 */
function clonePreset(preset: Preset): Preset {
  return { ...preset, values: { ...preset.values } };
}

function setCacheEntry(dir: string, file: string, key: string | null, raw: string, preset: Preset | null): void {
  let dirCache = parseCache.get(dir);
  if (!dirCache) {
    // 模型目录可被切换（每次切换换一个 dir 键）：只保留少量目录的缓存，超量整体作废防残留累积
    if (parseCache.size >= MAX_CACHED_PRESET_DIRS) parseCache.clear();
    dirCache = new Map();
    parseCache.set(dir, dirCache);
  }
  if (key === null) dirCache.delete(file);
  else dirCache.set(file, { key, raw, preset: preset ? clonePreset(preset) : null });
}

/** 清掉本目录中已不存在的文件条目（删除/改名/换模型目录后不留残值）。 */
function sweepDirCache(dir: string, presentFiles: string[]): void {
  const dirCache = parseCache.get(dir);
  if (!dirCache) return;
  const present = new Set(presentFiles);
  for (const file of dirCache.keys()) if (!present.has(file)) dirCache.delete(file);
  if (dirCache.size === 0) parseCache.delete(dir);
}

/**
 * 读并解析单个预设文件，内容未变更时直接复用缓存的解析结果。
 * 读失败与解析失败都返回 null（损坏文件不污染列表）。
 */
function readPresetFile(dir: string, file: string, fallbackName: string): Preset | null {
  const path = join(dir, file);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    parseCache.get(dir)?.delete(file);
    return null;
  }
  const key = fingerprint(path);
  if (key !== null) {
    const hit = parseCache.get(dir)?.get(file);
    if (hit && hit.key === key && hit.raw === raw) {
      return hit.preset ? clonePreset(hit.preset) : null;
    }
  }
  const preset = parsePreset(raw, fallbackName);
  setCacheEntry(dir, file, key, raw, preset);
  return preset;
}

export function listPresets(dir: string): Preset[] {
  if (!dir || !existsSync(dir)) return [];
  const presets: Preset[] = [];
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const preset = readPresetFile(dir, f, f.replace(/\.json$/, ''));
      if (preset) presets.push(preset);
    }
    sweepDirCache(dir, files);
  } catch {
    return [];
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function loadPreset(dir: string, name: string): Preset | null {
  if (!dir || !existsSync(dir)) return null;
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  return readPresetFile(dir, `${safe}.json`, safe);
}

/**
 * 保存预设（v2 结构）。values 参数来自 UI snapshot（可含 model 与 legacy 残留键）：
 * model 提取为顶层元数据字段并从 values 剔除，`_enabled` 残留一并清除，
 * 剩余参数键按 PARAMS 定义顺序稳定序列化（重复保存不产生 diff 噪音）。
 * 覆盖同名预设时保留原 created_at；app_version 记录写入方应用版本。
 */
export function savePreset(dir: string, name: string, values: PresetValues): Preset {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const file = `${safe}.json`;
  const modelRaw = values[MODEL_KEY];
  const model = typeof modelRaw === 'string' && modelRaw ? modelRaw : null;
  const now = new Date().toISOString();
  // created_at 继承：旧文件存在且带创建时间则沿用（v1 文件由 parsePreset 以 saved_at 回填）
  let createdAt = now;
  const prev = dir ? readPresetFile(dir, file, safe) : null;
  if (prev?.created_at) createdAt = prev.created_at;
  const preset: Preset = {
    preset_version: PRESET_VERSION,
    name,
    created_at: createdAt,
    saved_at: now,
    app_version: APP_VERSION,
    model,
    values: normalizeValues(values),
  };
  if (!ensureDir(dir)) {
    throw new Error(`Cannot create presets directory: ${dir}`);
  }
  // 原子写：先写 .tmp 再 rename，避免崩溃/断电留下半个预设文件
  const finalPath = join(dir, file);
  const tmpPath = `${finalPath}.tmp`;
  const text = JSON.stringify(preset, null, 2);
  writeFileSync(tmpPath, text, 'utf-8');
  try {
    renameSync(tmpPath, finalPath);
  } catch (e) {
    try { unlinkSync(tmpPath); } catch { /* 清理失败则忽略 */ }
    throw e;
  }
  // 刷新记忆化：内容与指纹都是刚写下的，下次 list/load 直接命中、不再解析
  setCacheEntry(dir, file, fingerprint(finalPath), text, preset);
  return preset;
}

export function deletePreset(dir: string, name: string): boolean {
  if (!dir || !existsSync(dir)) return false;
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  try {
    unlinkSync(join(dir, `${safe}.json`));
    parseCache.get(dir)?.delete(`${safe}.json`);
    return true;
  } catch { return false; }
}

/**
 * 删除与指定模型关联的预设：扫描模型目录下的 presets 子目录，删除其中
 * 顶层 model 以 modelPath 开头（路径前缀匹配，兼容 / 与 \ 分隔符；v1 旧文件的
 * values[MODEL_KEY] 已由 parsePreset 迁移到顶层）的预设文件。
 * modelPath 可为模型子目录或模型文件路径（预设 model 字段存的是模型文件路径）。
 * 返回被删除的预设名列表。
 */
export function deletePresetsForModel(modelsDir: string, modelPath: string): string[] {
  const dir = resolvePresetsDir(modelsDir);
  if (!dir || !modelPath || !existsSync(dir)) return [];
  // 规范化：统一分隔符为 / 并去掉尾部多余分隔符，保证前缀匹配跨平台一致
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = norm(modelPath);
  if (!prefix) return [];
  const removed: string[] = [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const preset = readPresetFile(dir, f, f.replace(/\.json$/, ''));
        if (!preset) continue;
        const model = norm(String(preset.model ?? ''));
        if (!model) continue;
        if (model === prefix || model.startsWith(prefix + '/')) {
          unlinkSync(join(dir, f));
          parseCache.get(dir)?.delete(f);
          removed.push(preset.name);
        }
      } catch {
        // 单个预设解析/删除失败跳过，不影响其余
      }
    }
    sweepDirCache(dir, files);
  } catch {
    // 目录读取失败时返回已删除部分
  }
  return removed;
}
