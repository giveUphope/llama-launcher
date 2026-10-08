import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';

// 与 modelscope-client.test.ts 同形的 node:https mock（vitest 4 下 Agent 需可构造，双导出）。
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
import { searchModels, listModelFiles, buildDownloadUrl, buildModelPageUrl } from '../src/modelscope-client.js';

class MockResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[]>;
  constructor(statusCode: number, headers: Record<string, string | string[]>) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

class MockRequest extends EventEmitter {
  destroyed = false;
  write(_chunk: Buffer | string) {}
  end() {}
  destroy(_err?: Error): this {
    this.destroyed = true;
    return this;
  }
}

interface Def {
  statusCode: number;
  headers?: Record<string, string | string[]>;
  body?: string;
  error?: Error;
}

let queue: Def[] = [];
let calls = 0;
const seenPaths: string[] = [];

(https.request as any).mockImplementation(
  (_options: { hostname: string; path: string; method: string }, callback: (res: IncomingMessage) => void) => {
    const req = new MockRequest();
    const def = queue.shift();
    if (!def) throw new Error('Unexpected https.request');
    seenPaths.push(_options.path);
    calls++;
    setImmediate(() => {
      if (def.error) {
        req.emit('error', def.error);
        return;
      }
      const res = new MockResponse(def.statusCode, def.headers ?? {});
      callback(res as unknown as IncomingMessage);
      setImmediate(() => {
        if (def.body) res.emit('data', Buffer.from(def.body, 'utf8'));
        res.emit('end');
      });
    });
    return req;
  },
);

const OK_HEADERS = { 'content-type': 'application/json' };

beforeEach(() => {
  queue = [];
  calls = 0;
  seenPaths.length = 0;
});

describe('modelscope-client - 响应形状与重定向（modelscope-client.test.ts 未覆盖的分支）', () => {
  it('3xx + location：跟随重定向后用新路径重发并解析结果', async () => {
    const payload = JSON.stringify({
      Success: true,
      Data: { Model: { Models: [{ Path: 'Qwen', Name: 'Qwen3-0.6B' }], TotalCount: 1 } },
    });
    queue.push({ statusCode: 302, headers: { location: '/api/v1/dolphin/models?moved=1' } });
    queue.push({ statusCode: 200, headers: OK_HEADERS, body: payload });

    const r = await searchModels('Qwen', 'Qwen3');
    expect(calls).toBe(2);
    // 第二次请求走的是重定向目标的路径与查询串
    expect(seenPaths[1]).toBe('/api/v1/dolphin/models?moved=1');
    expect(r.models).toHaveLength(1);
    expect(r.totalCount).toBe(1);
  });

  it('响应体不是 JSON → 明确报错（坏 HTML/空串不静默解析成 undefined）', async () => {
    queue.push({ statusCode: 200, headers: OK_HEADERS, body: '<html>blocked</html>' });
    await expect(searchModels('a', 'b')).rejects.toThrow(/Failed to parse JSON response/);
    expect(calls).toBe(1); // 解析失败不重试
  });

  it('Success=false 的业务失败 → 空结果而不抛错（列表页显示为空而非红屏）', async () => {
    queue.push({ statusCode: 200, headers: OK_HEADERS, body: JSON.stringify({ Success: false }) });
    const r = await searchModels('a', 'b');
    expect(r).toEqual({ models: [], totalCount: 0 });
  });

  it('listModelFiles 过滤非 blob 条目；缺省字段回退（无 Name 用 path 尾段、无 Size 记 0）', async () => {
    queue.push({
      statusCode: 200,
      headers: OK_HEADERS,
      body: JSON.stringify({
        Success: true,
        Data: {
          Files: [
            { Type: 'tree', Path: 'subdir' }, // 目录：必须被滤掉
            { Type: 'blob', Path: 'split/Qwen3.gguf' }, // 无 Name / 无 Size
          ],
        },
      }),
    });
    const r = await listModelFiles('Qwen', 'Qwen3-0.6B');
    expect(r.files).toHaveLength(1);
    const f = r.files[0];
    expect(f.name).toBe('Qwen3.gguf'); // path 尾段回退
    expect(f.size).toBe(0);
    expect(f.sizeStr).toBe('0 B');
    expect(f.isGguf).toBe(true);
  });

  it('URL 构造对特殊字符（命名空间/文件路径）做 encodeURIComponent', () => {
    const url = buildDownloadUrl('Qwen Team', 'Qwen3', 'sub dir/a file.gguf');
    expect(url).toContain('https://www.modelscope.cn/api/v1/models/Qwen%20Team/Qwen3/repo?');
    expect(url).toContain('FilePath=sub%20dir%2Fa%20file.gguf');

    const page = buildModelPageUrl('a b', 'c/d');
    expect(page).toBe('https://www.modelscope.cn/models/a%20b/c%2Fd');
  });
});
