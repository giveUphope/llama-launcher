import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { StartDownloadRequest } from '@llama-launcher/shared';

vi.mock('node:https', () => {
  // vitest 4：vi.fn() 不再可构造（new https.Agent() 会抛 "is not a constructor"），
  // 直接提供可构造的类作为 Agent mock。
  class MockAgent {
    destroy() {}
  }
  return {
    default: {
      Agent: MockAgent,
      request: vi.fn(),
    },
    Agent: MockAgent,
    request: vi.fn(),
  };
});

import https from 'node:https';
import { DownloadManager } from '../src/download-manager.js';

class MockResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[]>;
  private _paused = false;

  constructor(statusCode: number, headers: Record<string, string | string[]>) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }

  pause() {
    this._paused = true;
  }

  resume() {
    this._paused = false;
  }

  isPaused() {
    return this._paused;
  }
}

class MockRequest extends EventEmitter {
  destroyed = false;

  end() {
    // no-op, response is triggered by the mock driver
  }

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
        if (def.body && def.body.length > 0) {
          res.emit('data', def.body);
        }
        if (!def.hang) {
          res.emit('end');
        }
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

function makeRequest(modelId: string, filePath: string, fileName: string, fileSize: number): StartDownloadRequest {
  const [namespace, ...nameParts] = modelId.split('/');
  return {
    modelId,
    namespace,
    name: nameParts.join('/'),
    filePath,
    fileName,
    fileSize,
    modelsDir: tmpDir,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-dl-'));
  currentResolver = undefined;
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('DownloadManager', () => {
  it('segments large files and downloads them in parallel', async () => {
    // 200MB:目标段大小 100MB → 2 段,worker 数 = computeSegmentCount(200MB) = 2
    // worker 完成一段后取下一段,验证多段并行下载
    const largeSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(largeSize);
    for (let i = 0; i < largeSize; i++) content[i] = i % 256;

    const requests: Array<{ range: string }> = [];
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) {
        return { statusCode: 500, headers: {} };
      }

      requests.push({ range: options.headers['Range'] });

      // Probe request
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: {
            'Content-Range': `bytes 0-0/${largeSize}`,
            'Accept-Ranges': 'bytes',
          },
          body: Buffer.alloc(1),
        };
      }

      const end = range.end ?? largeSize - 1;
      return {
        statusCode: 206,
        headers: {
          'Content-Range': `bytes ${range.start}-${end}/${largeSize}`,
          'Accept-Ranges': 'bytes',
        },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', largeSize);
    const id = await manager.startDownload(req);

    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    // Should have 1 probe + 2 segment requests(200MB / 100MB target = 2 段)
    expect(requests.length).toBe(3);
    const segmentRequests = requests.filter((r) => r.range !== 'bytes=0-0');
    expect(segmentRequests.length).toBe(2);

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.existsSync(localPath)).toBe(true);
    expect(fs.statSync(localPath).size).toBe(largeSize);
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);
    expect(fs.existsSync(`${localPath}.llama_dl.jsonl`)).toBe(false);
    // 完成后 part 临时文件已改名到最终 .gguf
    expect(fs.existsSync(`${localPath}.part`)).toBe(false);

    manager.dispose();
  });

  it('falls back to single connection when server does not support Range', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;

    let requestCount = 0;
    currentResolver = (options) => {
      requestCount++;
      const range = parseRange(options.headers['Range']);
      if (range && range.start === 0 && range.end === 0) {
        // Probe returns 200, no range support
        return { statusCode: 200, headers: { 'Content-Length': String(totalSize) }, body: Buffer.alloc(0) };
      }
      // Single connection download
      return { statusCode: 200, headers: { 'Content-Length': String(totalSize) }, body: content };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    expect(requestCount).toBe(2); // probe + single download
    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);

    manager.dispose();
  });

  it('resumes download from saved metadata', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;

    // Pre-create partial file: first 50 MB already downloaded
    const partialSize = 50 * 1024 * 1024;
    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content.subarray(0, partialSize));

    // Create metadata with one fully downloaded segment and one pending
    const meta = {
      version: 1,
      url: 'https://www.modelscope.cn/api/v1/models/test/model/repo?Revision=master&FilePath=model.gguf',
      totalSize,
      segments: [
        { start: 0, end: partialSize - 1, downloaded: partialSize },
        { start: partialSize, end: totalSize - 1, downloaded: 0 },
      ],
    };
    fs.writeFileSync(`${localPath}.llama_dl.json`, JSON.stringify(meta));

    const requests: Array<{ range: string }> = [];
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      requests.push({ range: options.headers['Range'] });

      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }

      const end = range.end ?? totalSize - 1;
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    // Should only request the incomplete segment(s), not the fully downloaded one
    const segmentRequests = requests.filter((r) => r.range !== 'bytes=0-0');
    expect(segmentRequests.length).toBe(1);
    expect(segmentRequests[0].range).toBe(`bytes=${partialSize}-${totalSize - 1}`);

    expect(fs.readFileSync(localPath).equals(content)).toBe(true);
    // 旧版 .llama_dl.json 快照已被迁移为 .jsonl 事件日志,完成后日志也被清理
    expect(fs.existsSync(`${localPath}.llama_dl.json`)).toBe(false);
    expect(fs.existsSync(`${localPath}.llama_dl.jsonl`)).toBe(false);

    manager.dispose();
  });

  it('retries segment on network error and eventually succeeds', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;

    let failures = 0;
    const requests: Array<{ range: string; failed: boolean }> = [];
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };

      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }

      const end = range.end ?? totalSize - 1;
      const failed = failures < 2;
      if (failed) failures++;

      requests.push({ range: options.headers['Range'], failed });

      if (failed) {
        return {
          statusCode: 500,
          headers: {},
        };
      }

      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);

    manager.dispose();
  });

  it('retries segment on request error and eventually succeeds', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;

    let failures = 0;
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };

      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }

      const end = range.end ?? totalSize - 1;
      const failed = failures < 1;
      if (failed) failures++;

      if (failed) {
        const err = new Error('read ECONNRESET') as Error & { code: string };
        err.code = 'ECONNRESET';
        return {
          statusCode: 200, // not used when error is set
          headers: {},
          error: err,
        };
      }

      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);

    manager.dispose();
  });

  it('deletes partial file and metadata on cancel', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }

      // Slow download: never emit end so we can cancel
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-.../${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, range.start + 1024),
        hang: true,
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    // Wait for download to start
    await new Promise((resolve) => manager.once('progress', resolve));

    // 跟踪 complete 事件:取消后不应触发(回归保护:曾因 worker 队列优雅退出
    // 后 executeDownload 仍走完成逻辑,覆盖 canceled 状态并误发 complete)
    let completeFired = false;
    manager.on('complete', () => { completeFired = true; });

    manager.cancelDownload(id);

    // 等待足够时间让段请求的重试延迟(~1s)到期、worker 优雅退出、
    // executeDownload 的 post-await 路径执行完毕
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 任务状态应保持 canceled,不应被覆盖为 completed
    expect(manager.getTask(id)?.status).toBe('canceled');
    expect(completeFired).toBe(false);

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    // 取消后 part 临时文件与事件日志均被删除;未完成的 .gguf 自始至终未出现在目标路径
    expect(fs.existsSync(localPath)).toBe(false);
    expect(fs.existsSync(`${localPath}.part`)).toBe(false);
    expect(fs.existsSync(`${localPath}.llama_dl.jsonl`)).toBe(false);

    manager.dispose();
  });

  it('pauseAll preserves partial file and metadata', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-.../${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, range.start + 1024),
        hang: true,
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    // Wait for progress
    await new Promise((resolve) => manager.once('progress', resolve));

    manager.pauseAll();

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    // 暂停时部分数据在 .part 临时文件中；最终的 .gguf 不应出现（模型管理不会检出未完整文件）
    expect(fs.existsSync(`${localPath}.part`)).toBe(true);
    expect(fs.existsSync(localPath)).toBe(false);
    // 暂停后事件日志存在(段进度逐事件落盘,崩溃可重放续传)
    expect(fs.existsSync(`${localPath}.llama_dl.jsonl`)).toBe(true);

    const task = manager.getTask(id);
    expect(task?.status).toBe('paused');

    manager.dispose();
  });

  it('pauseDownload stops active task and preserves metadata', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-.../${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, range.start + 1024),
        hang: true,
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    // Wait for progress (download is active)
    await new Promise((resolve) => manager.once('progress', resolve));

    // Pause individual task
    expect(manager.pauseDownload(id)).toBe(true);

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    // 暂停时部分数据在 .part 临时文件中；最终的 .gguf 不应出现（模型管理不会检出未完整文件）
    expect(fs.existsSync(`${localPath}.part`)).toBe(true);
    expect(fs.existsSync(localPath)).toBe(false);
    expect(fs.existsSync(`${localPath}.llama_dl.jsonl`)).toBe(true);

    const task = manager.getTask(id);
    expect(task?.status).toBe('paused');
    expect(task?.speed).toBe(0);

    // 暂停后再暂停应返回 false（非 downloading/queued 状态）
    expect(manager.pauseDownload(id)).toBe(false);

    manager.dispose();
  });

  it('pauseDownload on non-existent task returns false', () => {
    const manager = new DownloadManager();
    expect(manager.pauseDownload('non-existent-id')).toBe(false);
    manager.dispose();
  });

  it('resumeDownload restarts a paused task to completion', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;

    // 控制是否 hang：暂停前 hang（阻塞下载），恢复后允许完成
    let hanging = true;
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      const end = range.end ?? totalSize - 1;
      if (hanging) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: content.subarray(range.start, range.start + 1024),
          hang: true,
        };
      }
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    // Wait for progress
    await new Promise((resolve) => manager.once('progress', resolve));

    // Pause
    expect(manager.pauseDownload(id)).toBe(true);
    expect(manager.getTask(id)?.status).toBe('paused');

    // Resume - allow downloads to complete
    hanging = false;
    expect(manager.resumeDownload(id)).toBe(true);
    // resumeDownload 将状态设为 queued 后立即调用 tryStartNext，同步切换到 downloading
    expect(manager.getTask(id)?.status).toBe('downloading');

    // Wait for completion
    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    const task = manager.getTask(id);
    expect(task?.status).toBe('completed');

    manager.dispose();
  });

  it('resumeDownload on non-paused task returns false', async () => {
    const totalSize = 200 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-.../${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, range.start + 1024),
        hang: true,
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    await new Promise((resolve) => manager.once('progress', resolve));

    // 正在下载时恢复应失败
    expect(manager.resumeDownload(id)).toBe(false);

    // 显式取消以避免 dispose 时悬挂请求产生未处理错误
    manager.cancelDownload(id);
    manager.dispose();
  });

  it('resumeDownload retries a failed task', async () => {
    // 使用小文件（< 100MB 阈值）触发单段下载，避免多段并发的重试延迟累积
    const totalSize = 50 * 1024 * 1024;
    const content = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i++) content[i] = i % 256;

    // 控制是否失败：首次失败（404 不可重试，立即失败），恢复后成功
    let failing = true;
    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 404, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      if (failing) {
        // 404 不在可重试状态码列表中，段会立即失败
        return { statusCode: 404, headers: {} };
      }
      const end = range.end ?? totalSize - 1;
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    // Wait for failure
    await new Promise((resolve) => manager.once('error', resolve));
    expect(manager.getTask(id)?.status).toBe('error');

    // Resume (retry) - now succeed
    failing = false;
    expect(manager.resumeDownload(id)).toBe(true);

    const completePromise = new Promise<unknown>((resolve) => manager.once('complete', resolve));
    await completePromise;

    expect(manager.getTask(id)?.status).toBe('completed');

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);

    manager.dispose();
  });

  it('computes and reports sha256 checksum on completion', async () => {
    const content = Buffer.from('llama-launcher checksum verification payload');
    const totalSize = content.length;

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      const end = range.end ?? totalSize - 1;
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req = makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize);
    const id = await manager.startDownload(req);

    const complete = await new Promise<any>((resolve) => manager.once('complete', resolve));
    expect(complete.checksum).toBe(createHash('sha256').update(content).digest('hex'));

    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    expect(fs.readFileSync(localPath).equals(content)).toBe(true);
    manager.dispose();
  });

  it('fails with checksum_mismatch when expectedChecksum differs', async () => {
    const content = Buffer.from('payload that must fail verification');
    const totalSize = content.length;

    currentResolver = (options) => {
      const range = parseRange(options.headers['Range']);
      if (!range) return { statusCode: 500, headers: {} };
      if (range.start === 0 && range.end === 0) {
        return {
          statusCode: 206,
          headers: { 'Content-Range': `bytes 0-0/${totalSize}`, 'Accept-Ranges': 'bytes' },
          body: Buffer.alloc(1),
        };
      }
      const end = range.end ?? totalSize - 1;
      return {
        statusCode: 206,
        headers: { 'Content-Range': `bytes ${range.start}-${end}/${totalSize}`, 'Accept-Ranges': 'bytes' },
        body: content.subarray(range.start, end + 1),
      };
    };

    const manager = new DownloadManager();
    const req: StartDownloadRequest = {
      ...makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize),
      expectedChecksum: '0'.repeat(64),
    };
    const id = await manager.startDownload(req);

    const error = await new Promise<any>((resolve) => manager.once('error', resolve));
    expect(error.errorType).toBe('checksum_mismatch');
    expect(manager.getTask(id)?.status).toBe('error');

    manager.dispose();
  });

  it('existing complete file with wrong content fails checksum verification (early-complete path)', async () => {
    // 文件已存在且大小达标,但内容与期望校验和不符:应标记 error 而非静默完成
    const content = Buffer.from('payload that must fail verification');
    const totalSize = content.length;
    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, Buffer.alloc(totalSize, 0xab));

    const manager = new DownloadManager();
    const req: StartDownloadRequest = {
      ...makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize),
      expectedChecksum: createHash('sha256').update(content).digest('hex'),
    };
    // 早完成路径同步触发 error,须先挂监听再调用
    const errorPromise = new Promise<any>((resolve) => manager.once('error', resolve));
    const id = await manager.startDownload(req);

    const error = await errorPromise;
    expect(error.errorType).toBe('checksum_mismatch');
    expect(manager.getTask(id)?.status).toBe('error');
    // 损坏文件保留(由用户删除后重新下载),事件日志不产生
    expect(fs.existsSync(localPath)).toBe(true);

    manager.dispose();
  });

  it('existing complete file with matching checksum completes instantly with checksum reported', async () => {
    const content = Buffer.from('already-downloaded-correct-content');
    const totalSize = content.length;
    const localPath = path.join(tmpDir, 'test', 'model', 'model.gguf');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content);

    const manager = new DownloadManager();
    const req: StartDownloadRequest = {
      ...makeRequest('test/model', 'model.gguf', 'model.gguf', totalSize),
      expectedChecksum: createHash('sha256').update(content).digest('hex'),
    };
    const completePromise = new Promise<any>((resolve) => manager.once('complete', resolve));
    const id = await manager.startDownload(req);

    const complete = await completePromise;
    expect(manager.getTask(id)?.status).toBe('completed');
    expect(complete.checksum).toBe(createHash('sha256').update(content).digest('hex'));

    manager.dispose();
  });
});
