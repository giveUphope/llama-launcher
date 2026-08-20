import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Preset, PresetValues } from '@llama-launcher/shared';
import { MODEL_KEY } from '@llama-launcher/shared';
import { resolvePresetsDir } from './paths.js';

/** 预设 schema 版本：未来字段变更时递增并在 loadPreset/listPresets 中补迁移。 */
const PRESET_VERSION = 1;

/** 解析预设 JSON（形状校验 + 版本补齐）；解析失败或形状非法返回 null。 */
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
  const values = o.values && typeof o.values === 'object' && !Array.isArray(o.values)
    ? (o.values as PresetValues)
    : {};
  return {
    preset_version: typeof o.preset_version === 'number' ? o.preset_version : PRESET_VERSION,
    name: typeof o.name === 'string' ? o.name : fallbackName,
    saved_at: typeof o.saved_at === 'string' ? o.saved_at : '',
    values,
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

export function savePreset(dir: string, name: string, values: PresetValues): Preset {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const preset: Preset = {
    preset_version: PRESET_VERSION,
    name,
    saved_at: new Date().toISOString(),
    values,
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
 * model 路径以 modelPath 开头（路径前缀匹配，兼容 / 与 \ 分隔符）的预设文件。
 * modelPath 可为模型子目录或模型文件路径（预设 values[MODEL_KEY] 存的是模型文件路径）。
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
        const model = norm(String(preset.values?.[MODEL_KEY] ?? ''));
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
