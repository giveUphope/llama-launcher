import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  // values 必须是普通对象（PresetValues），否则回退空对象
  const rawValues = o.values && typeof o.values === 'object' && !Array.isArray(o.values)
    ? (o.values as Record<string, unknown>)
    : {};
  let model: string | null = null;
  if (typeof o.model === 'string' && o.model) model = o.model;
  else {
    const legacy = rawValues[MODEL_KEY];
    if (typeof legacy === 'string' && legacy) model = legacy;
  }
  const savedAt = typeof o.saved_at === 'string' ? o.saved_at : '';
  return {
    preset_version: PRESET_VERSION,
    name: typeof o.name === 'string' ? o.name : fallbackName,
    created_at: typeof o.created_at === 'string' && o.created_at ? o.created_at : savedAt,
    saved_at: savedAt,
    app_version: typeof o.app_version === 'string' ? o.app_version : '',
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

export function listPresets(dir: string): Preset[] {
  if (!dir || !existsSync(dir)) return [];
  const presets: Preset[] = [];
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const preset = parsePreset(readFileSync(join(dir, f), 'utf-8'), f.replace(/\.json$/, ''));
        if (preset) presets.push(preset);
      } catch { /* skip */ }
    }
  } catch {
    return [];
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function loadPreset(dir: string, name: string): Preset | null {
  if (!dir || !existsSync(dir)) return null;
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const path = join(dir, `${safe}.json`);
  try {
    return parsePreset(readFileSync(path, 'utf-8'), safe);
  } catch { return null; }
}

/**
 * 保存预设（v2 结构）。values 参数来自 UI snapshot（可含 model 与 legacy 残留键）：
 * model 提取为顶层元数据字段并从 values 剔除，`_enabled` 残留一并清除，
 * 剩余参数键按 PARAMS 定义顺序稳定序列化（重复保存不产生 diff 噪音）。
 * 覆盖同名预设时保留原 created_at；app_version 记录写入方应用版本。
 */
export function savePreset(dir: string, name: string, values: PresetValues): Preset {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const modelRaw = values[MODEL_KEY];
  const model = typeof modelRaw === 'string' && modelRaw ? modelRaw : null;
  const now = new Date().toISOString();
  // created_at 继承：旧文件存在且带创建时间则沿用（v1 文件由 parsePreset 以 saved_at 回填）
  let createdAt = now;
  const prevPath = join(dir, `${safe}.json`);
  try {
    if (existsSync(prevPath)) {
      const prev = parsePreset(readFileSync(prevPath, 'utf-8'), safe);
      if (prev && prev.created_at) createdAt = prev.created_at;
    }
  } catch {
    // 旧文件读取/解析失败按新预设处理
  }
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
  const finalPath = join(dir, `${safe}.json`);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(preset, null, 2), 'utf-8');
  try {
    renameSync(tmpPath, finalPath);
  } catch (e) {
    try { unlinkSync(tmpPath); } catch { /* 清理失败则忽略 */ }
    throw e;
  }
  return preset;
}

export function deletePreset(dir: string, name: string): boolean {
  if (!dir || !existsSync(dir)) return false;
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  try {
    unlinkSync(join(dir, `${safe}.json`));
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
        const preset = parsePreset(readFileSync(join(dir, f), 'utf-8'), f.replace(/\.json$/, ''));
        if (!preset) continue;
        const model = norm(String(preset.model ?? ''));
        if (!model) continue;
        if (model === prefix || model.startsWith(prefix + '/')) {
          unlinkSync(join(dir, f));
          removed.push(preset.name);
        }
      } catch {
        // 单个预设解析/删除失败跳过，不影响其余
      }
    }
  } catch {
    // 目录读取失败时返回已删除部分
  }
  return removed;
}
