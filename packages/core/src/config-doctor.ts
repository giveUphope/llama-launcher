/**
 * 配置诊疗（config doctor）：应用启动时对自家配置文件做一次「诊断 + 修复 + 版本随迁」。
 *
 * 出了什么事：settings-store 的 zod 归一化只在**内存里**容错——磁盘上的文件在版本升级后
 * 仍留着旧版式（已删除参数的残留值、未知字段、旧版本号），直到下一次恰好触发保存才被
 * 顺手改掉；模型参数文件里被移除参数的值则永远躺在盘上。用户看不到哪些被修了、修成什么。
 *
 * 本模块把这件事变成应用自带的诊疗：启动时逐文件检查（settings.json + model-params/*.json），
 * 修复能安全修复的（损坏 → 备份 .bak 后重置为默认；旧版本 → 迁移写回；未知/残留字段 → 剥离），
 * 并返回结构化报告（只含 issue 种类与计数，不含文案——渲染走主进程 tr() 进应用日志）。
 *
 * 纪律：修复是幂等的——规范化后的内容与磁盘逐字节一致时**绝不写**（不搅动 mtime 与缓存）。
 */
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PARAMS } from '@llama-launcher/shared';
import { MODEL_PARAMS_DIR, SETTINGS_FILE } from './paths.js';
import { healSettingsFile } from './settings-store.js';
import { parseModelParams } from './model-params-store.js';

export type ConfigIssueKind =
  | 'corrupt' // JSON 解析失败（原文件已备份 .bak；settings 侧重置为默认，model-params 侧移出活集）
  | 'invalid_shape' // 顶层不是对象（同上处置）
  | 'version_migrated' // settings_version 旧于当前，已迁移到当前版式
  | 'unknown_keys' // settings 里 schema 之外的未知键（历史版本残留），已剥离
  | 'invalid_fields' // 字段值非法回退默认 / 缺失补默认，已写回
  | 'unknown_params'; // model-params.values 里含已从参数表移除的键，已清理

export interface ConfigIssue {
  kind: ConfigIssueKind;
  /** 计数类问题（invalid_fields / unknown_keys / unknown_params）的条数 */
  count?: number;
  /** unknown_keys 的具体键列表（键名本身无需翻译，直接展示） */
  keys?: string[];
}

export interface ConfigFileReport {
  file: string;
  issues: ConfigIssue[];
  /** 是否写回了修复内容（含损坏备份后重置/移出活集） */
  healed: boolean;
}

export interface ConfigDoctorReport {
  settings: ConfigFileReport | null;
  modelParams: ConfigFileReport[];
}

/** 原子写：tmp → rename（与 settings-store 同一保证，崩溃/断电不留半个 JSON） */
function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 清理失败则忽略 */
    }
    throw e;
  }
}

/** 损坏文件备份：重命名为 <file>.bak（同名覆盖，保留最新损坏副本，可手工恢复） */
function backupCorrupt(filePath: string): void {
  try {
    const bak = `${filePath}.bak`;
    try {
      unlinkSync(bak);
    } catch {
      /* 无旧备份 */
    }
    renameSync(filePath, bak);
  } catch {
    /* 备份失败不阻塞重置 */
  }
}

/**
 * 诊疗单个模型参数文件：
 * - JSON 损坏 / 形状非法 → 备份 .bak 并移出活集（该模型回落出厂默认，原内容可手工恢复）；
 * - 合法文件 → 剥离 `values` 里已从参数表移除的键（版本随迁），变化则原子写回。
 */
export function healModelParamsFile(filePath: string): ConfigFileReport {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    // 读不了（权限/竞态删除）：不动它，也不算修复
    return { file: filePath, issues: [{ kind: 'corrupt' }], healed: false };
  }
  try {
    JSON.parse(raw); // 先过一遍语法门；形状校验交给 parseModelParams
  } catch {
    backupCorrupt(filePath);
    return { file: filePath, issues: [{ kind: 'corrupt' }], healed: true };
  }
  const params = parseModelParams(raw);
  if (!params) {
    backupCorrupt(filePath);
    return { file: filePath, issues: [{ kind: 'invalid_shape' }], healed: true };
  }
  const issues: ConfigIssue[] = [];
  const known = new Set(PARAMS.map((p) => p.key));
  const staleKeys = Object.keys(params.values).filter((k) => !known.has(k));
  if (staleKeys.length) {
    issues.push({ kind: 'unknown_params', count: staleKeys.length, keys: staleKeys });
    for (const k of staleKeys) delete params.values[k];
  }
  const content = JSON.stringify(params, null, 2);
  if (content !== raw) {
    writeFileAtomic(filePath, content);
    return { file: filePath, issues, healed: true };
  }
  // 无残留也需要报「格式随迁」之外的事实：内容与规范形一致，无需修复
  return { file: filePath, issues, healed: false };
}

/**
 * 启动诊疗入口：settings.json + model-params/*.json 逐文件诊断并修复。
 * 路径可注入（单测用临时目录）；返回结构化报告，文案由调用方经 tr() 渲染。
 */
export function runConfigDoctor(opts: { settingsFile?: string; modelParamsDir?: string } = {}): ConfigDoctorReport {
  const settingsFile = opts.settingsFile ?? SETTINGS_FILE;
  const modelParamsDir = opts.modelParamsDir ?? MODEL_PARAMS_DIR;
  const settings = existsSync(settingsFile) ? healSettingsFile(settingsFile) : null;
  const modelParams: ConfigFileReport[] = [];
  try {
    if (existsSync(modelParamsDir)) {
      const files = readdirSync(modelParamsDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
      for (const f of files) modelParams.push(healModelParamsFile(path.join(modelParamsDir, f)));
    }
  } catch {
    /* 目录不可读：跳过 model-params 侧，settings 侧结论照常返回 */
  }
  return { settings, modelParams };
}
