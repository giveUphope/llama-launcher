import { existsSync, readdirSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Preset, PresetSummary, PresetValues } from '@llama-launcher/shared';
import { APP_VERSION } from '@llama-launcher/shared';
import { PRESETS_DIR } from './paths.js';
import {
  PRESET_VERSION, normalizeValues, extractModelBinding, presetFileName,
  listPresets, readPresetByName, readPresetFileByName, writePresetFile, deletePresetFile,
  parsePreset,
} from './presets-store.js';

/**
 * 预设仓储层：业务对预设的全部读写都走这层。它向上暴露的是**领域操作**
 * （按 id 取/存/改名/删除、按模型清理），向下才落到文件系统——上层（IPC/UI）
 * 不接触目录位置、文件名、JSON 布局中的任何一样。将来换存储介质
 * （数据库/远端）只需换掉本层的实现，IPC 载荷与界面一行不动。
 */
export interface PresetRepository {
  /** 全量预设（按名称排序）；列表展示用 summaries()，需要参数值时用 get(id) */
  list(): Preset[];
  /** 列表视图模型（presets:list 载荷）：轻量摘要，不含 values */
  summaries(): PresetSummary[];
  /** 按稳定主键取完整预设；不存在返回 null */
  get(id: string): Preset | null;
  /** 按展示名查（upsert 覆盖判定/旧版 last_preset 名字兜底用） */
  findByName(name: string): Preset | null;
  /** upsert 保存（语义见 shared PresetSaveInput）；返回落盘后的完整预设 */
  save(input: { name: string; values: PresetValues; id?: string }): Preset;
  /** 只改展示名（文件随之改名，id/created_at/saved_at 均不变）；id 不存在或重名抛错 */
  rename(id: string, name: string): Preset;
  /** 按主键删除；删除了文件返回 true */
  delete(id: string): boolean;
  /** 删除绑定指定模型（路径前缀匹配）的预设，返回被删预设名列表（删模型时同步清理用） */
  deleteForModel(modelPath: string): string[];
}

/** save/rename 的失败语义：找不到目标 id / 新名字已被其他预设占用（IPC 层转译为可读错误） */
export class PresetRepoError extends Error {
  constructor(public code: 'preset-not-found' | 'preset-name-exists', message?: string) {
    super(message ?? code);
    this.name = 'PresetRepoError';
  }
}

function toSummary(p: Preset): PresetSummary {
  return { id: p.id, name: p.name, created_at: p.created_at, saved_at: p.saved_at, model: p.model };
}

/** 路径规范化（分隔符统一 /、去尾分隔符、Windows 小写），供模型前缀匹配 */
function normModelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** UUID 生成收敛到一处（node 20+ globalThis.crypto 随手可用，id 只要求唯一） */
function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}

export function createPresetRepository(dir: string): PresetRepository {
  function getById(id: string): Preset | null {
    if (!id) return null;
    return listPresets(dir).find((p) => p.id === id) ?? null;
  }

  function findByName(name: string): Preset | null {
    if (!name) return null;
    return readPresetByName(dir, name);
  }

  /** 名字占用校验：已存在同名文件且属于另一个 id ⇒ 拒绝（否则会静默吞掉对方的文件） */
  function assertNameFree(name: string, selfId: string | null): void {
    const other = findByName(name);
    if (other && other.id !== selfId) {
      throw new PresetRepoError('preset-name-exists', `preset name already taken: ${name}`);
    }
  }

  return {
    list(): Preset[] {
      return listPresets(dir);
    },

    summaries(): PresetSummary[] {
      return listPresets(dir).map(toSummary);
    },

    get: getById,

    findByName,

    save(input): Preset {
      const name = String(input.name ?? '').trim();
      if (!name) throw new PresetRepoError('preset-not-found', 'preset name is empty');
      const model = extractModelBinding(input.values);
      const values = normalizeValues(input.values);
      const now = new Date().toISOString();

      let target: Preset | null = null;
      if (input.id) {
        target = getById(input.id);
        if (!target) throw new PresetRepoError('preset-not-found', `no preset with id: ${input.id}`);
        if (name !== target.name) assertNameFree(name, target.id);
      } else {
        // 无 id = 按名 upsert：同名已存在则覆盖它（继承 id 与 created_at，即「保存同名即覆盖」）
        target = findByName(name);
      }

      const preset: Preset = {
        preset_version: PRESET_VERSION,
        id: target?.id ?? cryptoRandomId(),
        name,
        created_at: target?.created_at || now,
        saved_at: now,
        app_version: APP_VERSION,
        model,
        values,
      };

      const prevFile = target ? presetFileName(target.name) : null;
      writePresetFile(dir, preset);
      // 更新同时改名：内容已写入新文件名，旧文件成了残影，搬走
      if (prevFile && prevFile !== presetFileName(preset.name)) {
        deletePresetFile(dir, prevFile);
      }
      return preset;
    },

    rename(id: string, name: string): Preset {
      const cleanName = String(name ?? '').trim();
      if (!cleanName) throw new PresetRepoError('preset-not-found', 'preset name is empty');
      const target = getById(id);
      if (!target) throw new PresetRepoError('preset-not-found', `no preset with id: ${id}`);
      if (target.name === cleanName) return target;
      assertNameFree(cleanName, target.id);
      const renamed: Preset = { ...target, name: cleanName };
      writePresetFile(dir, renamed);
      deletePresetFile(dir, presetFileName(target.name));
      return renamed;
    },

    delete(id: string): boolean {
      const target = getById(id);
      if (!target) return false;
      return deletePresetFile(dir, presetFileName(target.name));
    },

    deleteForModel(modelPath: string): string[] {
      if (!modelPath) return [];
      const prefix = normModelPath(modelPath);
      if (!prefix) return [];
      const removed: string[] = [];
      for (const preset of listPresets(dir)) {
        const model = normModelPath(String(preset.model ?? ''));
        if (!model) continue;
        // 预设 model 存模型文件路径；modelPath 可为模型子目录（目录删除，覆盖其下所有引用）或文件路径
        if (model === prefix || model.startsWith(`${prefix}/`)) {
          if (deletePresetFile(dir, presetFileName(preset.name))) {
            removed.push(preset.name);
          }
        }
      }
      return removed;
    },
  };
}

/** 活目录仓储单例：进程内全部业务走这一个实例 */
let liveRepository: PresetRepository | null = null;

export function getPresetRepository(): PresetRepository {
  if (!liveRepository) liveRepository = createPresetRepository(PRESETS_DIR);
  return liveRepository;
}

export interface PresetMigrationResult {
  /** 从旧位置搬入的预设数 */
  moved: number;
  /** 目标目录内原位升级到 v3 的旧格式文件数 */
  upgraded: number;
  /** 迁移中被跳过的源文件数（同名目标已存在，目标优先） */
  skipped: number;
}

/**
 * 预设存储位置迁移（一次性、幂等，应用启动时由 IPC 注册方调用）：
 *  1. fromDir（旧版 <models_dir>/presets）下的每个预设搬入 toDir（活目录）——
 *     搬运即升级：解析为 v3 内存形状（补 id）后写入目标，再删除源文件；
 *     目标已有同名文件时跳过（目标优先，绝不覆盖已有数据）。
 *  2. toDir 内已是旧格式（v1/v2，无 id）的文件原位升级盖章——id 由此获得落盘稳定性，
 *     last_preset_id 的引用跨重启不再漂移。
 * 损坏文件（解析失败）原地保留不动，交给垃圾清理的 broken_json 流程。
 */
export function migratePresetStore(fromDir: string, toDir: string): PresetMigrationResult {
  const result: PresetMigrationResult = { moved: 0, upgraded: 0, skipped: 0 };
  if (!toDir || !fromDir || fromDir === toDir) return result;

  // ---- 1. 旧位置搬入（解析升级后写入目标 + 删源） ----
  if (existsSync(fromDir)) {
    try {
      const files = readdirSync(fromDir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        if (existsSync(join(toDir, f))) {
          result.skipped++;
          continue;
        }
        const parsed = readPresetFileByName(fromDir, f);
        if (!parsed) continue; // 损坏文件不搬运
        writePresetFile(toDir, parsed);
        try { unlinkSync(join(fromDir, f)); } catch { /* 删源失败仅影响搬运完整性，数据已在目标 */ }
        result.moved++;
      }
      // 源目录搬空则顺手移除，避免模型目录里留下一个空 presets 壳
      try {
        if (readdirSync(fromDir).length === 0) rmdirSync(fromDir);
      } catch { /* 非空或删除失败都无妨 */ }
    } catch {
      // 目录读取失败：目标目录内的升级照常进行
    }
  }

  // ---- 2. 目标目录内旧格式原位升级 ----
  if (!existsSync(toDir)) return result;
  try {
    const files = readdirSync(toDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      let raw: string;
      try {
        raw = readFileSync(join(toDir, f), 'utf-8');
      } catch {
        continue;
      }
      const parsed = parsePreset(raw, f.replace(/\.json$/, ''));
      if (!parsed || !parsed.needsUpgrade) continue;
      writePresetFile(toDir, parsed.preset);
      result.upgraded++;
    }
  } catch {
    // 升级扫描失败不阻塞启动
  }
  return result;
}
