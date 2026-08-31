// 下载任务事件日志（JSONL 事实源 + 投影重建）。
// 对应 DSH 的 append-only 会话日志理念：每个状态变更 append 一行，永不覆盖；
// 崩溃/重启后重放日志即可精确重建段进度，不存在周期快照窗口。
// 旧版 `.llama_dl.json` 周期快照由 migrateLegacyMeta 一次性转换为事件日志。

import { appendFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DownloadSource, DownloadErrorType } from '@llama-launcher/shared';

/** 事件日志文件后缀（JSONL）。 */
export const DOWNLOAD_LOG_SUFFIX = '.llama_dl.jsonl';
/** 旧版周期快照文件后缀（迁移源；配置清理按此识别下载残留）。 */
export const LEGACY_META_SUFFIX = '.llama_dl.json';

/** start 事件中的段布局（不含进度，进度由后续 segment 事件累积）。 */
export interface DownloadLogSegmentStart {
  start: number;
  end: number;
}

/**
 * 下载事件（append-only 一行）。
 * - start：任务开始（含段布局，重放时以最后一次 start 为准重建基线）
 * - segment：段进度更新（段完成/暂停/失败时记录当前已下载字节）
 * - done：终态标记（completed/canceled/error/paused，仅供诊断；重放时进度只看 segment 事件）
 */
export type DownloadLogEvent =
  | {
      type: 'start';
      ts: number;
      url: string;
      totalSize: number;
      source: DownloadSource;
      createdAt: number;
      segments: DownloadLogSegmentStart[];
    }
  | { type: 'segment'; ts: number; index: number; downloaded: number }
  | {
      type: 'done';
      ts: number;
      status: 'completed' | 'canceled' | 'error' | 'paused';
      error?: string;
      errorType?: DownloadErrorType;
    };

/** 重放结果（投影）：段进度 + 终态。 */
export interface DownloadLogReplay {
  url: string;
  totalSize: number;
  source: DownloadSource;
  createdAt: number;
  segments: { start: number; end: number; downloaded: number }[];
  /** 最近一次 done 事件的终态；无 done 事件为 'incomplete' */
  status: 'incomplete' | 'completed' | 'canceled' | 'error' | 'paused';
  error?: string;
  errorType?: DownloadErrorType;
}

export function downloadLogPath(localPath: string): string {
  return `${localPath}${DOWNLOAD_LOG_SUFFIX}`;
}

/** 追加一行事件。写入失败静默（日志丢失只影响续传精度，不影响下载正确性）。 */
export function appendDownloadEvent(localPath: string, event: DownloadLogEvent): void {
  try {
    const p = downloadLogPath(localPath);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(event) + '\n', 'utf-8');
  } catch {
    /* 忽略：事件日志是尽力而为的持久化 */
  }
}

const SEGMENT_MAX = 1024;

function validSegmentStart(s: unknown): s is DownloadLogSegmentStart {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.start === 'number' &&
    typeof o.end === 'number' &&
    Number.isFinite(o.start) &&
    Number.isFinite(o.end) &&
    o.start >= 0 &&
    o.end >= o.start
  );
}

function parseEvent(line: string): DownloadLogEvent | undefined {
  let e: unknown;
  try {
    e = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!e || typeof e !== 'object') return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.type !== 'string') return undefined;
  if (o.type === 'start') {
    const url = o.url;
    const totalSize = o.totalSize;
    const source = o.source;
    const createdAt = o.createdAt;
    const segments = o.segments;
    if (
      typeof url !== 'string' ||
      typeof totalSize !== 'number' ||
      (source !== 'modelscope' && source !== 'huggingface') ||
      typeof createdAt !== 'number' ||
      !Array.isArray(segments) ||
      segments.length === 0 ||
      segments.length > SEGMENT_MAX ||
      !segments.every(validSegmentStart)
    ) {
      return undefined;
    }
    return {
      type: 'start',
      ts: typeof o.ts === 'number' ? o.ts : 0,
      url,
      totalSize,
      source,
      createdAt,
      segments: segments as DownloadLogSegmentStart[],
    };
  }
  if (o.type === 'segment') {
    const index = o.index;
    const downloaded = o.downloaded;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= SEGMENT_MAX) {
      return undefined;
    }
    if (typeof downloaded !== 'number' || !Number.isFinite(downloaded) || downloaded < 0) {
      return undefined;
    }
    return { type: 'segment', ts: typeof o.ts === 'number' ? o.ts : 0, index, downloaded };
  }
  if (o.type === 'done') {
    const status = o.status;
    if (
      status !== 'completed' &&
      status !== 'canceled' &&
      status !== 'error' &&
      status !== 'paused'
    ) {
      return undefined;
    }
    const error = o.error;
    const errorType = o.errorType;
    return {
      type: 'done',
      ts: typeof o.ts === 'number' ? o.ts : 0,
      status,
      error: typeof error === 'string' ? error : undefined,
      errorType: typeof errorType === 'string' ? (errorType as DownloadErrorType) : undefined,
    };
  }
  return undefined;
}

/**
 * 重放事件日志，重建段进度与终态（投影）。
 * 以最后一次合法 start 事件为基线，其后 segment 事件累积进度（append-only 单调，
 * 取每段最后记录值）；done 事件记录终态。
 * 日志缺失、无合法 start、或段进度非法时返回 undefined（调用方按「无续传点」处理）。
 */
export function replayDownloadLog(localPath: string): DownloadLogReplay | undefined {
  const p = downloadLogPath(localPath);
  if (!existsSync(p)) return undefined;
  let text: string;
  try {
    text = readFileSync(p, 'utf-8');
  } catch {
    return undefined;
  }

  let replay: DownloadLogReplay | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const ev = parseEvent(line);
    if (!ev) continue;
    if (ev.type === 'start') {
      replay = {
        url: ev.url,
        totalSize: ev.totalSize,
        source: ev.source,
        createdAt: ev.createdAt,
        segments: ev.segments.map((s) => ({ start: s.start, end: s.end, downloaded: 0 })),
        status: 'incomplete',
      };
      continue;
    }
    if (!replay) continue;
    if (ev.type === 'segment') {
      const seg = replay.segments[ev.index];
      if (!seg) continue;
      // 进度必须落在段范围内，否则该行视为损坏跳过（不破坏其余段）
      if (seg.start + ev.downloaded > seg.end + 1) continue;
      if (ev.downloaded >= seg.downloaded) {
        seg.downloaded = ev.downloaded;
      }
      continue;
    }
    if (ev.type === 'done') {
      replay.status = ev.status;
      replay.error = ev.error;
      replay.errorType = ev.errorType;
    }
  }
  return replay;
}

/** 删除事件日志（完成/取消时清理，与旧版 deleteMeta 同语义）。 */
export function deleteDownloadLog(localPath: string): void {
  try {
    const p = downloadLogPath(localPath);
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* 忽略删除失败 */
  }
}

/**
 * 把旧版 `.llama_dl.json` 周期快照转换为事件日志（一次性迁移）。
 * v1/v2 快照均支持；段字段校验失败或文件无法解析时静默（下次下载从头开始）。
 * 转换成功后删除旧文件；日志已存在（.jsonl）时不做迁移，避免覆盖新格式。
 */
export function migrateLegacyMeta(localPath: string): void {
  const legacy = `${localPath}${LEGACY_META_SUFFIX}`;
  if (!existsSync(legacy)) return;
  if (existsSync(downloadLogPath(localPath))) {
    // 新日志已存在，旧快照属于更早的失败残留，直接清理
    try { unlinkSync(legacy); } catch { /* 忽略 */ }
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(legacy, 'utf-8')) as Record<string, unknown>;
    let url: unknown;
    let totalSize: unknown;
    let source: unknown;
    let createdAt: unknown;
    let segments: unknown;
    if (raw && typeof raw === 'object' && typeof raw.version === 'number') {
      if (raw.version === 2) {
        url = raw.url; totalSize = raw.totalSize; source = raw.source; createdAt = raw.createdAt; segments = raw.segments;
      } else if (raw.version === 1) {
        // v1 无 source/createdAt，补默认值（与旧 migrateMeta 一致）
        url = raw.url; totalSize = raw.totalSize; source = 'modelscope'; createdAt = 0; segments = raw.segments;
      }
    }
    if (
      typeof url !== 'string' ||
      typeof totalSize !== 'number' ||
      (source !== 'modelscope' && source !== 'huggingface') ||
      typeof createdAt !== 'number' ||
      !Array.isArray(segments) ||
      segments.length === 0
    ) {
      return;
    }
    const segs: { start: number; end: number; downloaded: number }[] = [];
    for (const s of segments) {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (
        typeof o.start !== 'number' ||
        typeof o.end !== 'number' ||
        typeof o.downloaded !== 'number' ||
        o.start < 0 ||
        o.downloaded < 0 ||
        o.start + o.downloaded > o.end + 1
      ) {
        return;
      }
      segs.push({ start: o.start, end: o.end, downloaded: o.downloaded });
    }
    appendDownloadEvent(localPath, {
      type: 'start',
      ts: Date.now(),
      url,
      totalSize,
      source,
      createdAt,
      segments: segs.map((s) => ({ start: s.start, end: s.end })),
    });
    segs.forEach((s, index) => {
      appendDownloadEvent(localPath, { type: 'segment', ts: Date.now(), index, downloaded: s.downloaded });
    });
    unlinkSync(legacy);
  } catch {
    /* 旧快照无法解析：忽略，下次下载从头开始 */
  }
}
