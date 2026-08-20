import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendDownloadEvent,
  deleteDownloadLog,
  downloadLogPath,
  migrateLegacyMeta,
  replayDownloadLog,
} from '../src/download-log.js';

let tmpDir: string;
let localPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-log-'));
  localPath = path.join(tmpDir, 'model.gguf');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const URL = 'https://www.modelscope.cn/api/v1/models/test/model/repo?Revision=master&FilePath=model.gguf';

function startEvent() {
  appendDownloadEvent(localPath, {
    type: 'start',
    ts: 1,
    url: URL,
    totalSize: 1000,
    source: 'modelscope',
    createdAt: 100,
    segments: [
      { start: 0, end: 499 },
      { start: 500, end: 999 },
    ],
  });
}

describe('download-log (JSONL 事实源)', () => {
  it('无日志文件时重放返回 undefined', () => {
    expect(replayDownloadLog(localPath)).toBeUndefined();
  });

  it('start + segment 事件重放重建段进度（取每段最后记录值）', () => {
    startEvent();
    appendDownloadEvent(localPath, { type: 'segment', ts: 2, index: 0, downloaded: 300 });
    appendDownloadEvent(localPath, { type: 'segment', ts: 3, index: 1, downloaded: 500 });
    appendDownloadEvent(localPath, { type: 'segment', ts: 4, index: 0, downloaded: 500 });

    const replay = replayDownloadLog(localPath);
    expect(replay).toBeDefined();
    expect(replay!.url).toBe(URL);
    expect(replay!.totalSize).toBe(1000);
    expect(replay!.source).toBe('modelscope');
    expect(replay!.createdAt).toBe(100);
    expect(replay!.status).toBe('incomplete');
    expect(replay!.segments).toEqual([
      { start: 0, end: 499, downloaded: 500 },
      { start: 500, end: 999, downloaded: 500 },
    ]);
  });

  it('done 事件记录终态；进度仍按 segment 事件累积', () => {
    startEvent();
    appendDownloadEvent(localPath, { type: 'segment', ts: 2, index: 0, downloaded: 500 });
    appendDownloadEvent(localPath, { type: 'done', ts: 3, status: 'error', error: 'boom', errorType: 'network' });

    const replay = replayDownloadLog(localPath);
    expect(replay!.status).toBe('error');
    expect(replay!.error).toBe('boom');
    expect(replay!.errorType).toBe('network');
    expect(replay!.segments[0].downloaded).toBe(500);
  });

  it('损坏行与越界段进度跳过，不影响其余重放', () => {
    startEvent();
    fs.appendFileSync(downloadLogPath(localPath), 'not-json\n');
    appendDownloadEvent(localPath, { type: 'segment', ts: 2, index: 0, downloaded: 99999 }); // 越界
    appendDownloadEvent(localPath, { type: 'segment', ts: 3, index: 7, downloaded: 10 }); // 下标越界
    appendDownloadEvent(localPath, { type: 'segment', ts: 4, index: 1, downloaded: 400 });
    fs.appendFileSync(downloadLogPath(localPath), '{"type":"segment","ts":5,"index":0,"downloaded":200}\n');

    const replay = replayDownloadLog(localPath);
    expect(replay!.segments).toEqual([
      { start: 0, end: 499, downloaded: 200 },
      { start: 500, end: 999, downloaded: 400 },
    ]);
  });

  it('无 start 事件（只有 segment）时重放返回 undefined', () => {
    appendDownloadEvent(localPath, { type: 'segment', ts: 1, index: 0, downloaded: 10 });
    expect(replayDownloadLog(localPath)).toBeUndefined();
  });

  it('最后一次 start 事件为基线（新纪元覆盖旧进度）', () => {
    startEvent();
    appendDownloadEvent(localPath, { type: 'segment', ts: 2, index: 0, downloaded: 500 });
    appendDownloadEvent(localPath, {
      type: 'start',
      ts: 3,
      url: URL,
      totalSize: 1000,
      source: 'modelscope',
      createdAt: 200,
      segments: [{ start: 0, end: 999 }],
    });
    appendDownloadEvent(localPath, { type: 'segment', ts: 4, index: 0, downloaded: 123 });

    const replay = replayDownloadLog(localPath);
    expect(replay!.createdAt).toBe(200);
    expect(replay!.segments).toEqual([{ start: 0, end: 999, downloaded: 123 }]);
  });

  it('migrateLegacyMeta 把 v1 快照转换为事件日志并删除旧文件', () => {
    const legacy = `${localPath}.llama_dl.json`;
    fs.writeFileSync(
      legacy,
      JSON.stringify({
        version: 1,
        url: URL,
        totalSize: 1000,
        segments: [
          { start: 0, end: 499, downloaded: 100 },
          { start: 500, end: 999, downloaded: 0 },
        ],
      }),
    );

    migrateLegacyMeta(localPath);

    expect(fs.existsSync(legacy)).toBe(false);
    const replay = replayDownloadLog(localPath);
    expect(replay).toBeDefined();
    expect(replay!.source).toBe('modelscope'); // v1 补默认 source
    expect(replay!.createdAt).toBe(0); // v1 补默认 createdAt
    expect(replay!.segments).toEqual([
      { start: 0, end: 499, downloaded: 100 },
      { start: 500, end: 999, downloaded: 0 },
    ]);
  });

  it('migrateLegacyMeta 对 v2 快照保留 source/createdAt', () => {
    const legacy = `${localPath}.llama_dl.json`;
    fs.writeFileSync(
      legacy,
      JSON.stringify({
        version: 2,
        url: URL,
        totalSize: 1000,
        segments: [{ start: 0, end: 999, downloaded: 250 }],
        source: 'huggingface',
        createdAt: 42,
      }),
    );

    migrateLegacyMeta(localPath);

    const replay = replayDownloadLog(localPath);
    expect(replay!.source).toBe('huggingface');
    expect(replay!.createdAt).toBe(42);
    expect(replay!.segments[0].downloaded).toBe(250);
  });

  it('日志已存在时不重复迁移（旧快照直接清理）', () => {
    startEvent();
    appendDownloadEvent(localPath, { type: 'segment', ts: 2, index: 0, downloaded: 100 });
    const legacy = `${localPath}.llama_dl.json`;
    fs.writeFileSync(legacy, JSON.stringify({ version: 2, url: URL, totalSize: 1000, segments: [{ start: 0, end: 999, downloaded: 500 }] }));

    migrateLegacyMeta(localPath);

    expect(fs.existsSync(legacy)).toBe(false);
    // 进度保持事件日志中的值（100），未被旧快照覆盖
    expect(replayDownloadLog(localPath)!.segments[0].downloaded).toBe(100);
  });

  it('损坏的旧快照被忽略（不抛错、不生成日志）', () => {
    fs.writeFileSync(`${localPath}.llama_dl.json`, '{broken json');
    expect(() => migrateLegacyMeta(localPath)).not.toThrow();
    expect(replayDownloadLog(localPath)).toBeUndefined();
  });

  it('deleteDownloadLog 删除日志文件', () => {
    startEvent();
    expect(fs.existsSync(downloadLogPath(localPath))).toBe(true);
    deleteDownloadLog(localPath);
    expect(fs.existsSync(downloadLogPath(localPath))).toBe(false);
  });
});
