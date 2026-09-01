import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';

// ModelScope 走 node:https 直连（无注入传输），测试 mock https.request：
// 对齐 download-manager.test 的 mock 形状（vitest 4 下 Agent 需可构造，default 与具名双导出）。
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
import { searchModels, listModelFiles, formatFileSize } from '../src/modelscope-client.js';

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

(https.request as any).mockImplementation(
  (_options: { hostname: string; path: string; method: string }, callback: (res: IncomingMessage) => void) => {
    const req = new MockRequest();
    const def = queue.shift();
    if (!def) throw new Error('Unexpected https.request');
    calls++;
    if (def.error) {
      setImmediate(() => req.emit('error', def.error));
      return req;
    }
    setImmediate(() => {
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
const ecReset = (() => {
  const e: any = new Error('socket hang up');
  e.code = 'ECONNRESET';
  return e;
})();

beforeEach(() => {
  queue = [];
  calls = 0;
});

describe('modelscope-client', () => {
  it('searchModels 成功解析并映射搜索结果', async () => {
    queue.push({
      statusCode: 200,
      headers: OK_HEADERS,
      body: JSON.stringify({
        Success: true,
        Data: { Model: { Models: [{ Path: 'Qwen', Name: 'Qwen3-0.6B', ChineseName: '通义', Downloads: 42, License: 'Apache-2.0' }] } },
      }),
    });
    const r = await searchModels('Qwen', 'Qwen3');
    expect(r.models).toHaveLength(1);
    expect(r.models[0].id).toBe('Qwen/Qwen3-0.6B');
    expect(r.models[0].chineseName).toBe('通义');
    expect(r.models[0].downloads).toBe(42);
    expect(calls).toBe(1);
  });

  it('listModelFiles 正确分类/量化/GGUF 判定与 sizeStr', async () => {
    queue.push({
      statusCode: 200,
      headers: OK_HEADERS,
      body: JSON.stringify({
        Success: true,
        Data: { Files: [{ Type: 'blob', Path: 'm/Qwen3-0.6B-Q4_K_M.gguf', Name: 'Qwen3-0.6B-Q4_K_M.gguf', Size: 1536, IsLFS: true }] },
      }),
    });
    const r = await listModelFiles('Qwen', 'Qwen3-0.6B');
    expect(r.files).toHaveLength(1);
    const f = r.files[0];
    expect(f.isGguf).toBe(true);
    expect(f.category).toBe('gguf');
    expect(f.isLfs).toBe(true);
    expect(f.sizeStr).toBe('1.5 KB');
    expect(f.quantization?.label).toBe('Q4_K_M');
  });

  it('瞬时网络错误（ECONNRESET）触发指数退避重试并最终成功', async () => {
    queue.push({ statusCode: 0, error: ecReset });
    queue.push({
      statusCode: 200,
      headers: OK_HEADERS,
      body: JSON.stringify({ Success: true, Data: { Model: { Models: [{ Path: 'a', Name: 'b' }] } } }),
    });
    const r = await searchModels('a', 'b');
    expect(calls).toBe(2); // 第 1 次失败 → 重试成功
    expect(r.totalCount).toBeGreaterThanOrEqual(0);
  });

  it('非可重试错误（HTTP 404）不重试直接抛出', async () => {
    queue.push({ statusCode: 404, headers: OK_HEADERS, body: 'not found' });
    await expect(listModelFiles('a', 'b')).rejects.toThrow('HTTP 404');
    expect(calls).toBe(1);
  });

  it('重试耗尽后抛出最后一次错误', async () => {
    queue.push({ statusCode: 0, error: ecReset });
    queue.push({ statusCode: 0, error: ecReset });
    queue.push({ statusCode: 0, error: ecReset });
    await expect(searchModels('a', 'b')).rejects.toThrow();
    expect(calls).toBe(3); // MAX_ATTEMPTS = 3
  });

  it('formatFileSize 为 shared formatBytes 的别名（1 位小数语义）', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024 * 1024 * 1024 + 1024 * 1024 * 128)).toBe('1.13 GB');
  });
});