import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { StartDownloadRequest } from '@llama-launcher/shared';

// 与 download-manager.test.ts 同形的 node:https mock。
vi.mock('node:https', () => {
  class MockAgent {
    destroy() {}
  }
  return {
    default: { Agent: MockAgent, request: vi.fn() },
    Agent: MockAgent,
    request: vi.fn(),
  };
});

import https from 'node:https';
import { DownloadManager, setDownloadTransport } from '../src/download-manager.js';
import { downloadLogPath } from '../src/download-log.js';

class MockResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[]>;
  constructor(statusCode: number, headers: Record<string, string | string[]>) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
  pause() {}
  resume() {}
  isPaused() {
    return false;
  }
}

class MockRequest extends EventEmitter {
  destroyed = false;
  end() {}
  destroy(_err?: Error): this {
    this.destroyed = true;
    return this;
  }
}

interface MockResponseDef {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body?: Buffer;
  error?: Error;
  hang?: boolean;
}

type ResponseResolver = (options: {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
}) => MockResponseDef;

let currentResolver: ResponseResolver | undefined;

(https.request as any).mockImplementation(
  (options: { hostname: string; path: string; method: string; headers: Record<string, string> }, callback: (res: IncomingMessage) => void) => {
    const req = new MockRequest();
    if (!currentResolver) {
      throw new Error(`Unexpected https.request to ${options.hostname}${options.path}`);
    }
    const def = currentResolver(options);
    setImmediate(() => {
      if (def.error) {
        req.emit('error', def.error);
        return;
      }
      const res = new MockResponse(def.statusCode, def.headers);
      callback(res as unknown as IncomingMessage);
      setImmediate(() => {
        if (def.body && def.body.length > 0) res.emit('data', def.body);
        if (!def.hang) res.emit('end');
      });
    });
    return req as unknown as ClientRequest;
  },
);

function parseRange(range?: string): { start: number; end: number | undefined } | undefined {
  if (!range) return undefined;
  const m = range.match(/bytes=(\d+)-(\d*)/);
  if (!m) return undefined;
  return { start: parseInt(m[1], 10), end: m[2] ? parseInt(m[2], 10) : undefined };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-dl-edge-'));
  currentResolver = undefined;
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeRequest(modelId: string, fileName: string, fileSize: number, extra: Partial<StartDownloadRequest> = {}): StartDownloadRequest {
  const [namespace, ...nameParts] = modelId.split('/');
  return {
    modelId,
    namespace,
    name: nameParts.join('/'),
    filePath: fileName,
    fileName,
    fileSize,
    modelsDir: tmpDir,
    ...extra,
  };
}

/** 等 probe + 段请求两层 setImmediate 落地，任务才真正停在 downloading。 */
async function settle() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('DownloadManager - 重定向与协议守卫（download-manager.test.ts 未覆盖的分支）', () => {
  it('probe 302 → 206、段请求 302 → 206：重定向链两侧都跟随，内容完整落盘', async () => {
    const totalSize = 50 * 1024 * 1024; // < 100MB → 单段
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;
    const redirectTarget = 'https://www.modelscope.cn/api/v1/models/test/model/repo?Revision=master&FilePath=model.gguf';
    // 同一 Range 第一次回 302，第二次（重定向后的重发）回 206
    const redirected = new Set<string>();

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      const key = options.headers['Range'];
      const end = range.end ?? totalSize - 1;
      if (!redirected.has(key)) {
        redirected.add(key);
        return { statusCode: 302, headers: { location: redirectTarget } };
      }
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}` },
        body: range.start === 0 && range.end === 0 ? Buffer.alloc(1) : content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', totalSize);
    await manager.startDownload(req);
    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);
    manager.dispose();
  });

  it('probe 重定向环（连续 302）→ Too many redirects，任务按 redirect_loop 归类失败', async () => {
    currentResolver = () => ({
      statusCode: 302,
      headers: { location: 'https://www.modelscope.cn/api/v1/models/test/model/repo?loop=1' },
    });

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 50 * 1024 * 1024);
    const id = (await manager.startDownload(req)).id;
    const error = await new Promise<any>((resolve) => manager.once('error', resolve));

    expect(error.errorType).toBe('redirect_loop');
    expect(manager.getTask(id)?.status).toBe('error');
    manager.dispose();
  });

  it('段收到的字节超出 Range 声明 → 立即失败并归类 segment_overflow（不写坏相邻段）', async () => {
    const totalSize = 1024;
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}` },
          body: Buffer.alloc(1),
        };
      }
      // 服务器无视 Range 上限，回 2000 字节（超出段声明）
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes 0-${totalSize - 1}/${totalSize}` },
        body: Buffer.alloc(2000, 0xab),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', totalSize);
    const id = (await manager.startDownload(req)).id;
    const error = await new Promise<any>((resolve) => manager.once('error', resolve));

    expect(error.errorType).toBe('segment_overflow');
    expect(manager.getTask(id)?.error).toContain('more data than expected');
    // 损坏的 .part 不许改名成最终 .gguf
    expect(fs.existsSync(path.join(tmpDir, 'test', 'model', 'model.gguf'))).toBe(false);
    manager.dispose();
  });
});

describe('DownloadManager - 任务表维护（getProtectedPaths / clearFinished）', () => {
  function hangResolver(totalSize: number): void {
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}` },
          body: Buffer.alloc(1),
        };
      }
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes 0-${totalSize - 1}/${totalSize}` },
        body: Buffer.alloc(1024),
        hang: true,
      };
    };
  }

  it('getProtectedPaths：downloading 任务保护最终文件/.part/续传日志三件；取消后退出保护名单', async () => {
    const totalSize = 50 * 1024 * 1024;
    hangResolver(totalSize);

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', totalSize);
    const id = (await manager.startDownload(req)).id;
    await settle();
    expect(manager.getTask(id)?.status).toBe('downloading');

    const task = manager.getTask(id)!;
    const protectedPaths = manager.getProtectedPaths();
    expect(protectedPaths.has(path.resolve(task.localPath))).toBe(true);
    expect(protectedPaths.has(path.resolve(task.partPath))).toBe(true);
    expect(protectedPaths.has(path.resolve(downloadLogPath(task.localPath)))).toBe(true);

    manager.cancelDownload(id);
    expect(manager.getTask(id)!.status).toBe('canceled');
    expect(manager.getProtectedPaths().size).toBe(0);
    manager.dispose();
  });

  it('clearFinished：completed/canceled/error 任务被清出任务表，downloading 的保留', async () => {
    const tiny = 64;
    // 挂起的任务保持在飞；小文件直接完成；404 直接失败
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${options.path.includes('hang') ? 50 * 1024 * 1024 : tiny}` },
          body: Buffer.alloc(1),
        };
      }
      if (options.path.includes('hang')) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': 'bytes 0-.../52428800' },
          body: Buffer.alloc(1024),
          hang: true,
        };
      }
      if (options.path.includes('fail')) return { statusCode: 404, headers: {} };
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes 0-${tiny - 1}/${tiny}` },
        body: Buffer.alloc(tiny, 0x5a),
      };
    };

    const manager = new DownloadManager();
    const hanging = await manager.startDownload(makeRequest('test/hang', 'hang.gguf', 50 * 1024 * 1024));
    const tinyDone = await manager.startDownload(makeRequest('test/tiny', 'tiny.gguf', tiny));
    const failed = await manager.startDownload(makeRequest('test/fail', 'fail.gguf', tiny));

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await Promise.all([
      new Promise((r) => manager.once('complete', r)),
      new Promise((r) => manager.once('error', r)),
    ]);
    expect(manager.getTask(tinyDone.id)?.status).toBe('completed');
    expect(manager.getTask(failed.id)?.status).toBe('error');

    const remaining = manager.clearFinished();
    expect(remaining.map((t) => t.id)).toEqual([hanging.id]);
    expect(manager.getTask(tinyDone.id)).toBeUndefined();
    expect(manager.getTask(failed.id)).toBeUndefined();
    expect(manager.getTask(hanging.id)?.status).toBe('downloading');
    manager.dispose();
  });
});

describe('DownloadManager - 注入传输（hf-mirror 源走 DownloadTransport，node:https 零调用）', () => {
  it('huggingface 来源任务：探测与段下载都走注入传输，内容完整落盘', async () => {
    const content = Buffer.from('hf-transport-injection-payload');
    const seenUrls: string[] = [];
    const seenRanges: string[] = [];
    setDownloadTransport({
      request: async (url, headers) => {
        seenUrls.push(url);
        seenRanges.push(String(headers['Range']));
        const range = parseRange(String(headers['Range']));
        const isProbe = range?.start === 0 && range?.end === 0;
        return {
          statusCode: 206,
          headers: {
            'Content-Range': `bytes ${range?.start ?? 0}-${isProbe ? 0 : content.length - 1}/${content.length}`,
          },
          body: Readable.from([isProbe ? Buffer.alloc(1) : content]),
          cancel: () => {},
        };
      },
    });
    // 证明零 https 调用：任何 node:https 请求都会在这里炸出来
    currentResolver = () => {
      throw new Error('node:https must not be used for hf-mirror source');
    };

    const manager = new DownloadManager();
    const req = makeRequest('org/model', 'model.gguf', content.length, { source: 'huggingface' });
    const complete = await new Promise<any>((resolve) => {
      manager.once('complete', resolve);
      void manager.startDownload(req);
    });

    // 探测 1 次 + 段请求 1 次；URL 必须指向默认镜像站
    expect(seenUrls).toHaveLength(2);
    expect(seenUrls[0]).toContain('https://hf-mirror.com/org/model/resolve/main/model.gguf');
    expect(seenRanges[0]).toBe('bytes=0-0');
    expect(seenRanges[1]).toBe(`bytes=0-${content.length - 1}`);
    // 无期望校验和且文件远小于信息性哈希上限 → 完成载荷补算信息性 SHA-256
    expect(complete.checksum).toBe(createHash('sha256').update(content).digest('hex'));

    const localPath = path.join(tmpDir, 'org', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);
    manager.dispose();
  });
});

describe('DownloadManager - 未知大小下载（T01：负 end 曾致空 .part 秒「完成」）', () => {
  it('探测无 content-length/content-range：单条无界段 bytes=0-，200 全文件回退落盘', async () => {
    const content = Buffer.from('unknown-size-payload-0123456789');
    const seenRanges: string[] = [];
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      seenRanges.push(options.headers['Range']);
      if (range.start === 0 && range.end === 0) {
        // 探测:200 且无 content-length → totalSize=-1、supportsRange=false
        return { statusCode: 200, headers: {} };
      }
      // 无界段请求;start=0 允许服务器回退 200(全文件段语义)
      return { statusCode: 200, headers: {}, body: content };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 0);
    await manager.startDownload(req);
    await new Promise<unknown>((resolve) => manager.once('complete', resolve));

    expect(seenRanges, '无界段请求必须是开放终点').toContain('bytes=0-');
    expect(fs.readFileSync(path.join(tmpDir, 'test', 'model', 'model.gguf')).equals(content)).toBe(true);
    manager.dispose();
  });

  it('Range 可用但总大小未知（Content-Range: bytes 0-0/*）：中断续传走 -1 哨兵，从断点继续', async () => {
    const first = Buffer.alloc(16, 0x41);
    const rest = Buffer.alloc(16, 0x42);
    const seenRanges: string[] = [];
    let segmentRound = 0;
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      seenRanges.push(options.headers['Range']);
      if (range.start === 0 && range.end === 0) {
        // 探测:206 但总数为 * → totalSize=-1、supportsRange=true
        return { statusCode: 206, headers: { 'Content-Range': 'bytes 0-0/*' }, body: Buffer.alloc(1) };
      }
      segmentRound++;
      if (segmentRound === 1) {
        // 首轮段请求:回 16 字节后挂起(模拟传输中断)
        return { statusCode: 206, headers: { 'Content-Range': `bytes 0-${first.length - 1}/*` }, body: first, hang: true };
      }
      // 续传段请求:从断点继续到服务器关流
      return { statusCode: 206, headers: { 'Content-Range': `bytes ${range.start}-${range.start + rest.length - 1}/*` }, body: rest };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 0);
    const id = (await manager.startDownload(req)).id;
    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    // 等首批字节真实落盘(写流异步 open),再暂停:logCurrentProgress 记录断点
    await vi.waitFor(() => expect(fs.statSync(localPath + '.part').size).toBe(first.length));
    manager.pauseDownload(id);
    // start 事件的段布局里 Infinity 以 -1 哨兵落盘(JSON 无法承载 Infinity)
    expect(fs.readFileSync(downloadLogPath(localPath), 'utf-8')).toContain('"end":-1');

    manager.resumeDownload(id);
    await new Promise<unknown>((resolve) => manager.once('complete', resolve));

    // 续传段从断点继续(无界),两段内容拼接后与全量一致
    expect(seenRanges).toContain('bytes=0-');
    expect(seenRanges).toContain(`bytes=${first.length}-`);
    expect(fs.readFileSync(localPath).equals(Buffer.concat([first, rest]))).toBe(true);
    manager.dispose();
  });
});
