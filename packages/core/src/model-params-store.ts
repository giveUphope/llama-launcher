import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { basename } from 'node:path';
import { z } from 'zod';
import type { ModelParams, PresetValues } from '@llama-launcher/shared';
import { PARAMS } from '@llama-launcher/shared';

/**
 * 每模型参数集文件层：一个目录（`~/.llama_launcher/model-params/`）里每个模型一个 JSON。
 * 只负责「按存储键读写一个 ModelParams」与格式容错，不知道键怎么从模型路径派生以外的
 * 任何业务规则（载回/建议自动应用在 params store，迁移在 model-params-repository）。
 *
 * 键 = `<清洗后的模型文件名>-<规范化路径 sha1 前 8 位>`：文件名可读，路径改动（换盘/移动
 * 目录）即新键——旧键由仓储层的 basename 重识别兜底找回（见 model-params-repository）。
 */

/** PARAMS 定义顺序索引：values 序列化时的排序依据（未知键排最后、保持原相对顺序） */
const VALUE_KEY_ORDER = new Map<string, number>(PARAMS.map((p, i) => [p.key, i]));

const MODEL_KEY = 'model';

/** 归一化参数值：剔除模型键/legacy 残留，按定义顺序稳定排序（重复保存不产生 diff 噪音） */
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

/** 模型路径 → 存储键：清洗后的文件名 + 规范化全路径短哈希（跨平台分隔符/大小写归一） */
export function modelParamsKey(modelPath: string): string {
  const p = String(modelPath ?? '').trim();
  const name = (basename(p) || 'model').replace(/[\\/:*?"<>|]/g, '_');
  const norm = p.replace(/\\/g, '/').toLowerCase();
  const hash = createHash('sha1').update(norm).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

/** 文件名（键 + .json） */
export function modelParamsFileName(modelPath: string): string {
  return `${modelParamsKey(modelPath)}.json`;
}

/**
 * 文件形状（zod）：逐字段容错回退（非法字段不拒文件），values 仅校验「是普通对象」。
 */
const modelParamsFileSchema = z.object({
  format_version: z.number().catch(1),
  model_path: z.string().catch(''),
  updated_at: z.string().catch(''),
  values: z.preprocess(
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    z.record(z.string(), z.unknown()),
  ),
});

/** 解析 ModelParams JSON；损坏/形状非法返回 null。 */
export function parseModelParams(raw: string): ModelParams | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = modelParamsFileSchema.safeParse(data);
  if (!parsed.success) return null;
  const o = parsed.data;
  return {
    format_version: 1,
    model_path: o.model_path,
    updated_at: o.updated_at,
    values: normalizeValues(o.values as Record<string, unknown>),
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

// ---------------- 解析记忆化（与 presets 同型：mtime+size 指纹 + 原始字节双比对） ----------------

const parseCache = new Map<string, { key: string; raw: string; params: ModelParams | null }>();

function cacheSlot(dir: string, file: string): string {
  return `${dir}\u0000${file}`;
}

function fingerprint(filePath: string): string | null {
  try {
    const st = statSync(filePath, { bigint: true });
    return `${st.mtimeNs}:${st.size}`;
  } catch {
    return null;
  }
}

function cloneParams(p: ModelParams): ModelParams {
  return { ...p, values: { ...p.values } };
}

function readParamsFile(dir: string, file: string): ModelParams | null {
  const path = join(dir, file);
  const slot = cacheSlot(dir, file);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    parseCache.delete(slot);
    return null;
  }
  const key = fingerprint(path);
  if (key !== null) {
    const hit = parseCache.get(slot);
    if (hit && hit.key === key && hit.raw === raw) {
      return hit.params ? cloneParams(hit.params) : null;
    }
  }
  const params = parseModelParams(raw);
  if (key !== null) parseCache.set(slot, { key, raw, params: params ? cloneParams(params) : null });
  return params;
}

/** 全量列出（调试/未来管理界面用）；损坏文件静默跳过 */
export function listModelParams(dir: string): ModelParams[] {
  if (!dir || !existsSync(dir)) return [];
  const out: ModelParams[] = [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const parsed = readParamsFile(dir, f);
      if (parsed) out.push(parsed);
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => a.model_path.localeCompare(b.model_path));
}

/** 按模型路径读取；不存在/损坏返回 null */
export function readModelParams(dir: string, modelPath: string): ModelParams | null {
  if (!dir || !existsSync(dir)) return null;
  return readParamsFile(dir, modelParamsFileName(modelPath));
}

/**
 * 原子写：先写 .tmp 再 rename；成功后刷新记忆化（下次读取直接命中）。
 */
export function writeModelParams(dir: string, params: ModelParams): ModelParams {
  if (!ensureDir(dir)) {
    throw new Error(`Cannot create model-params directory: ${dir}`);
  }
  const file = modelParamsFileName(params.model_path);
  const finalPath = join(dir, file);
  const tmpPath = `${finalPath}.tmp`;
  const text = JSON.stringify(params, null, 2);
  writeFileSync(tmpPath, text, 'utf-8');
  try {
    renameSync(tmpPath, finalPath);
  } catch (e) {
    try { unlinkSync(tmpPath); } catch { /* 清理失败则忽略 */ }
    throw e;
  }
  const fp = fingerprint(finalPath);
  if (fp !== null) parseCache.set(cacheSlot(dir, file), { key: fp, raw: text, params: cloneParams(params) });
  return params;
}

/** 按模型路径删除；删除了文件返回 true */
export function deleteModelParams(dir: string, modelPath: string): boolean {
  if (!dir || !existsSync(dir)) return false;
  try {
    unlinkSync(join(dir, modelParamsFileName(modelPath)));
    parseCache.delete(cacheSlot(dir, modelParamsFileName(modelPath)));
    return true;
  } catch {
    return false;
  }
}
