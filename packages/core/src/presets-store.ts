import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Preset, PresetValues } from '@llama-launcher/shared';
import { MODEL_KEY, PARAMS } from '@llama-launcher/shared';

/**
 * 预设文件层：只负责「一个目录里的一组 JSON 文件」的读写与格式迁移，不知道目录在哪
 * （dir 一律由调用方传入）、也不知道业务规则（覆盖/改名/按模型清理在 preset-repository）。
 *
 * 预设 schema 版本：v3 = 新增稳定 id 主键（本版）。历史沿革——
 * v2 = model 从 values 分离为顶层字段、补 created_at/app_version；
 * v1 = model 混在 values、无 created_at/app_version、无 id。
 * 读取任意旧版本自动迁移为 v3 内存形状；落盘升级由调用方（迁移流程/显式保存）负责。
 */
export const PRESET_VERSION = 3;

/** PARAMS 定义顺序索引：values 序列化时的排序依据（未知键排最后、保持原相对顺序） */
const VALUE_KEY_ORDER = new Map<string, number>(PARAMS.map((p, i) => [p.key, i]));

/** 归一化参数值：剔除顶层化/已废弃的键（model、legacy _enabled），按定义顺序稳定排序 */
export function normalizeValues(raw: Record<string, unknown>): PresetValues {
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

/** 从 UI snapshot 提取模型绑定：MODEL_KEY → 顶层 model（空/非串 = null = 纯参数集） */
export function extractModelBinding(values: PresetValues): string | null {
  const modelRaw = values[MODEL_KEY];
  return typeof modelRaw === 'string' && modelRaw ? modelRaw : null;
}

/** 预设名 → 安全文件名（非法字符替换为下划线）。文件名只是 name 的落盘形态，不是主键。 */
export function presetFileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
}

/**
 * 预设文件形状（zod）：逐字段容错回退（非法字段不拒文件），values 仅校验「是普通对象」，
 * 值类型信任文件（与旧手写解析一致）；name 空串回退 fallbackName；id 缺失/非法回退空串。
 */
const presetFileSchema = z.object({
  id: z.string().catch(''),
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

export interface ParsedPreset {
  preset: Preset;
  /** 文件缺 id 或版本 < 3（读时已回填内存形状；true = 落盘仍是旧格式，需要重写升级） */
  needsUpgrade: boolean;
}

/**
 * 解析预设 JSON（形状校验 + 版本迁移到 v3 内存形状）；解析失败或形状非法返回 null。
 * v1 兼容：values[MODEL_KEY] 提升为顶层 model（若同时有顶层 model 则顶层优先）；
 * created_at 缺失时以 saved_at 回填；legacy `_enabled` 残留键剔除；
 * id 缺失时回填新 UUID（needsUpgrade = true，由调用方决定何时写回）。
 */
export function parsePreset(raw: string, fallbackName: string): ParsedPreset | null {
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
  const needsUpgrade = !o.id;
  return {
    needsUpgrade,
    preset: {
      preset_version: PRESET_VERSION,
      id: o.id || randomUUID(),
      name: o.name || fallbackName,
      created_at: o.created_at || o.saved_at,
      saved_at: o.saved_at,
      app_version: o.app_version,
      model,
      values: normalizeValues(rawValues),
    },
  };
}

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
    // 目录可被切换（如测试的临时目录轮换）：只保留少量目录的缓存，超量整体作废防残留累积
    if (parseCache.size >= MAX_CACHED_PRESET_DIRS) parseCache.clear();
    dirCache = new Map();
    parseCache.set(dir, dirCache);
  }
  if (key === null) dirCache.delete(file);
  else dirCache.set(file, { key, raw, preset: preset ? clonePreset(preset) : null });
}

/** 清掉本目录中已不存在的文件条目（删除/改名后不留残值）。 */
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
  const parsed = parsePreset(raw, fallbackName);
  const preset = parsed?.preset ?? null;
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

/** 按文件名读取（垃圾清理器判定孤儿/损坏预设用）；文件不存在或解析失败返回 null。 */
export function readPresetFileByName(dir: string, fileName: string): Preset | null {
  if (!dir || !fileName.endsWith('.json')) return null;
  return readPresetFile(dir, fileName, fileName.replace(/\.json$/, ''));
}

/** 按展示名读取（安全文件名映射）；不存在返回 null。 */
export function readPresetByName(dir: string, name: string): Preset | null {
  if (!dir || !existsSync(dir)) return null;
  return readPresetFile(dir, presetFileName(name), name);
}

/**
 * 原子写预设文件：先写 .tmp 再 rename，避免崩溃/断电留下半个预设文件。
 * preset 以内存形状（v3）为准整体落盘；成功后刷新记忆化（下次 list/load 直接命中）。
 */
export function writePresetFile(dir: string, preset: Preset): Preset {
  if (!ensureDir(dir)) {
    throw new Error(`Cannot create presets directory: ${dir}`);
  }
  const file = presetFileName(preset.name);
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
  setCacheEntry(dir, file, fingerprint(finalPath), text, preset);
  return preset;
}

/** 按文件名删除；目标不存在或删除失败返回 false。 */
export function deletePresetFile(dir: string, fileName: string): boolean {
  if (!dir || !existsSync(dir)) return false;
  try {
    unlinkSync(join(dir, fileName));
    parseCache.get(dir)?.delete(fileName);
    return true;
  } catch { return false; }
}
