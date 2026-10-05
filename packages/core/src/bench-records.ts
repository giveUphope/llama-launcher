/**
 * 体检结果（llama-bench）的跨重启持久化。
 *
 * 出了什么事：体检一次要占着显卡跑 1–3 分钟，但结果此前只存在主进程的一个内存 Map 里，
 * 关掉应用就没了——重新打开后模型列表上的速度徽章一片空白，用户只能再测一遍。
 * 这里把终态（done / error）按模型路径落一份到 ~/.llama_launcher/bench-records.json，
 * 主进程启动时回灌那份内存缓存，界面沿用既有的 system:benchLlamaStatus 取回，
 * 不为此新开 IPC 通道（那条通道的本义就是「激活时补状态」）。
 *
 * 为什么写在配置目录而不是模型目录：模型目录可能被换盘 / 设为只读 / 是网络盘，
 * 而这份数据是「本应用测出来的」，跟着应用走更符合它的归属，也不会往用户目录里丢杂物。
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { BENCH_RECORDS_FILE } from './paths.js';
import type { LlamaBenchJobState, LlamaBenchSummary } from '@llama-launcher/shared';

/** 落盘的记录条数上限：超出按 testedAt 丢最旧的，避免常年累积撑大配置目录 */
export const BENCH_RECORDS_MAX = 300;

function validSummary(s: unknown): s is LlamaBenchSummary {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.modelPath === 'string' &&
    (typeof o.ppTokS === 'number' || o.ppTokS === null) &&
    (typeof o.tgTokS === 'number' || o.tgTokS === null) &&
    (typeof o.ngl === 'number' || o.ngl === null) &&
    (typeof o.backend === 'string' || o.backend === null) &&
    (typeof o.modelType === 'string' || o.modelType === null) &&
    typeof o.testedAt === 'string'
  );
}

/** 只认终态记录：running 落盘没有意义（重启后那个进程早没了），缺 summary 的 done 是坏数据 */
function validRecord(r: unknown): r is LlamaBenchJobState {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (typeof o.modelPath !== 'string' || !o.modelPath) return false;
  if (o.state === 'error') return true;
  if (o.state === 'done') return validSummary(o.summary);
  return false;
}

function testedAtOf(rec: LlamaBenchJobState): number {
  const raw = rec.summary?.testedAt;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** 按模型路径去重（后写入的覆盖先写入的）并按上限截断，保留最近的。 */
function prune(records: LlamaBenchJobState[]): LlamaBenchJobState[] {
  const byPath = new Map<string, LlamaBenchJobState>();
  for (const r of records) {
    if (!validRecord(r)) continue;
    byPath.set(r.modelPath, r);
  }
  const sorted = [...byPath.values()].sort((a, b) => testedAtOf(a) - testedAtOf(b));
  return sorted.slice(Math.max(0, sorted.length - BENCH_RECORDS_MAX));
}

/**
 * 读取落盘记录。文件缺失 / 非数组 / 半截 JSON 一律返回空数组——
 * 记录是锦上添花，坏数据不得让主进程起不来。
 * `filePath` 仅为单测可注入（默认写用户配置目录，测试不该碰真目录）。
 */
export function loadBenchRecords(filePath: string = BENCH_RECORDS_FILE): LlamaBenchJobState[] {
  let text: string;
  try {
    if (!existsSync(filePath)) return [];
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return prune(parsed.filter(validRecord));
}

/**
 * 全量写入（原子：先写 .tmp 再 rename，避免写一半被读到成损坏 JSON——
 * 配置目录清理器把损坏的 JSON 当残留，会提示用户删掉它）。
 * 写失败静默：丢了只是重启后要重测一次，不影响本次体检结果的正确展示。
 * `filePath` 同 loadBenchRecords，仅为单测可注入。
 */
export function saveBenchRecords(records: LlamaBenchJobState[], filePath: string = BENCH_RECORDS_FILE): void {
  try {
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(prune(records), null, 2), 'utf-8');
    renameSync(tmp, filePath);
  } catch {
    /* 忽略：体检记录是尽力而为的持久化 */
  }
}
