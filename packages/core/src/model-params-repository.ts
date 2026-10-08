import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { basename } from 'node:path';
import type { ModelParams, PresetValues } from '@llama-launcher/shared';
import { MODEL_PARAMS_DIR } from './paths.js';
import {
  listModelParams, readModelParams, writeModelParams, deleteModelParams, normalizeValues,
} from './model-params-store.js';

/**
 * 每模型参数集仓储层：渲染层经 IPC 对每模型参数的全部读写都走这层。
 * 向上是三个领域动作（load/save/clear），向下才落到文件系统——上层不接触
 * 目录、文件名与键派生规则。预设机制（2026-10-08 移除）的存量数据由
 * migratePresetsToModelParams 一次性迁入本层。
 */
export interface ModelParamsRepository {
  /** 读取某模型的已存参数；无存储返回 null（调用方回落出厂默认 + GGUF 建议自动应用） */
  load(modelPath: string): ModelParams | null;
  /** 自动持久化某模型的当前参数（upsert，updated_at 刷新） */
  save(modelPath: string, values: PresetValues): ModelParams;
  /** 清除某模型的已存参数（回出厂默认轨道）；删除了文件返回 true */
  clear(modelPath: string): boolean;
  /** 删除模型时同步清理：存储的 model_path 以该路径（目录或文件）为前缀的参数集，返回被清的模型路径 */
  deleteForModel(modelPath: string): string[];
  /** 全量列出（诊断/测试用） */
  list(): ModelParams[];
}

function normPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function createModelParamsRepository(dir: string): ModelParamsRepository {
  return {
    load(modelPath: string): ModelParams | null {
      const p = String(modelPath ?? '').trim();
      if (!p) return null;
      const exact = readModelParams(dir, p);
      if (exact) return exact;
      // 搬家重识别：精确键未命中时，按「存储的原路径与当前路径同文件名」找回——
      // 用户移动模型目录后参数集不丢（重识别即换键重写，下次直接精确命中）。
      const name = normPath(basename(p));
      if (!name) return null;
      const candidates = listModelParams(dir)
        .filter((m) => normPath(basename(m.model_path)) === name)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const hit = candidates[0];
      if (!hit) return null;
      const adopted: ModelParams = { ...hit, model_path: p };
      writeModelParams(dir, adopted);
      deleteModelParams(dir, hit.model_path);
      return adopted;
    },

    save(modelPath: string, values: PresetValues): ModelParams {
      const p = String(modelPath ?? '').trim();
      if (!p) throw new Error('model path is empty');
      const params: ModelParams = {
        format_version: 1,
        model_path: p,
        updated_at: new Date().toISOString(),
        values: normalizeValues(values as Record<string, unknown>),
      };
      return writeModelParams(dir, params);
    },

    clear(modelPath: string): boolean {
      const p = String(modelPath ?? '').trim();
      if (!p) return false;
      // 同步清掉同名旧键残影（搬家重识别后旧键由 save 时删除兜底；这里再兜一层）
      let removed = deleteModelParams(dir, p);
      const name = normPath(basename(p));
      for (const m of listModelParams(dir)) {
        if (normPath(basename(m.model_path)) === name) {
          removed = deleteModelParams(dir, m.model_path) || removed;
        }
      }
      return removed;
    },

    deleteForModel(modelPath: string): string[] {
      const prefix = normPath(modelPath);
      if (!prefix) return [];
      const removed: string[] = [];
      for (const m of listModelParams(dir)) {
        const stored = normPath(m.model_path);
        if (stored === prefix || stored.startsWith(`${prefix}/`)) {
          if (deleteModelParams(dir, m.model_path)) removed.push(m.model_path);
        }
      }
      return removed;
    },

    list(): ModelParams[] {
      return listModelParams(dir);
    },
  };
}

/** 活目录仓储单例 */
let liveRepository: ModelParamsRepository | null = null;

export function getModelParamsRepository(): ModelParamsRepository {
  if (!liveRepository) liveRepository = createModelParamsRepository(MODEL_PARAMS_DIR);
  return liveRepository;
}

export interface PresetsMigrationResult {
  /** 迁入的模型数（一个模型多条历史预设取 saved_at 最新一条） */
  models: number;
  /** 迁入后删除的预设文件数 */
  imported: number;
  /** 跳过数（无模型绑定的纯参数集 / 解析失败 / 同模型较早的旧版本） */
  skipped: number;
}

/**
 * 存量手存预设 → 每模型参数集的一次性迁移（幂等，应用启动时由 IPC 注册方调用）：
 *  - 读取旧预设目录（`~/.llama_launcher/presets`，v3 结构，绑定模型的路径为顶层 model），
 *    同一模型的多条预设取 `saved_at` 最新的一条作为该模型的参数集写入新存储；
 *  - 迁入成功的预设文件随即删除（数据已完整转移为新格式），目录搬空后一并移除；
 *    无模型绑定的纯参数集与解析失败的损坏文件原地保留——前者没有可归属的模型，
 *    后者交给垃圾清理的 broken_json 流程，绝不静默吞掉用户数据。
 */
export function migratePresetsToModelParams(fromDir: string, toDir: string): PresetsMigrationResult {
  const result: PresetsMigrationResult = { models: 0, imported: 0, skipped: 0 };
  if (!fromDir || !toDir || !existsSync(fromDir)) return result;
  try {
    const files = readdirSync(fromDir).filter((f) => f.endsWith('.json'));
    // 按归一化模型路径分组，组内取 saved_at 最新
    const byModel = new Map<string, { path: string; savedAt: string; values: PresetValues }>();
    for (const f of files) {
      let raw: string;
      try {
        raw = readFileSync(join(fromDir, f), 'utf-8');
      } catch {
        result.skipped++;
        continue;
      }
      let parsed: { model: string; savedAt: string; values: PresetValues } | null = null;
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        const model = typeof data.model === 'string' && data.model ? data.model : null;
        const values = data.values && typeof data.values === 'object' && !Array.isArray(data.values)
          ? (data.values as PresetValues)
          : {};
        if (model) parsed = { model, savedAt: String(data.saved_at ?? ''), values };
      } catch {
        parsed = null;
      }
      if (!parsed) {
        result.skipped++;
        continue;
      }
      const key = normPath(parsed.model);
      const prev = byModel.get(key);
      if (!prev || parsed.savedAt.localeCompare(prev.savedAt) > 0) {
        byModel.set(key, { path: parsed.model, savedAt: parsed.savedAt, values: parsed.values });
      }
    }
    for (const entry of byModel.values()) {
      const params: ModelParams = {
        format_version: 1,
        model_path: entry.path,
        updated_at: entry.savedAt || new Date().toISOString(),
        values: normalizeValues(entry.values as Record<string, unknown>),
      };
      writeModelParams(toDir, params);
      result.models++;
    }
    // 删除迁入成功的源文件（含同模型落选的旧版本——值已并入最新一条）
    for (const f of files) {
      try {
        const raw = readFileSync(join(fromDir, f), 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const model = typeof data.model === 'string' && data.model ? data.model : null;
        if (model) {
          unlinkSync(join(fromDir, f));
          result.imported++;
        }
      } catch {
        // 删除失败/解析失败：原地保留
      }
    }
    try {
      if (readdirSync(fromDir).length === 0) rmdirSync(fromDir);
    } catch {
      // 非空或删除失败都无妨
    }
  } catch {
    // 目录读取失败不阻塞启动
  }
  return result;
}
