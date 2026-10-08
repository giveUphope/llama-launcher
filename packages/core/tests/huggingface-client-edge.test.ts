import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setHfMirrorHost,
  setHfTransport,
  listHfFiles,
  type HfHttpTransport,
} from '../src/huggingface-client.js';

/** 传输桩：记录每次请求的 URL，按入队响应依次回放。 */
interface Enqueued {
  status: number;
  body: string;
  location?: string | null;
  reject?: Error;
}

function makeTransport(responses: Enqueued[]) {
  const urls: string[] = [];
  const transport: HfHttpTransport = {
    get: async (url) => {
      urls.push(url);
      const next = responses.shift();
      if (!next) throw new Error('Unexpected transport.get');
      if (next.reject) throw next.reject;
      return { status: next.status, body: next.body, location: next.location ?? null };
    },
  };
  return { transport, urls };
}

const TREE_BODY = JSON.stringify([
  { path: 'Qwen3-0.6B-Q4_K_M.gguf', size: 1536, type: 'file', lfs: { oid: 'sha256:' + 'ab'.repeat(32) } },
]);

afterEach(() => {
  setHfMirrorHost(''); // 复位镜像源并顺带清空列表缓存，避免跨用例污染
  vi.useRealTimers();
});

describe('huggingface-client - listHfFiles 缓存与传输注入（huggingface-client.test.ts 未覆盖的分支）', () => {
  it('TTL 缓存：同仓库第二次拉取不打网络；forceRefresh 绕过缓存', async () => {
    const first = makeTransport([{ status: 200, body: TREE_BODY }]);
    setHfTransport(first.transport);
    await listHfFiles('org', 'model');
    await listHfFiles('org', 'model');
    expect(first.urls).toHaveLength(1); // TTL 内命中缓存

    const second = makeTransport([{ status: 200, body: TREE_BODY }]);
    setHfTransport(second.transport);
    await listHfFiles('org', 'model', { forceRefresh: true });
    expect(second.urls).toHaveLength(1); // 强制刷新必须真的发请求
  });

  it('换镜像源即清缓存：切源后的第一次拉取必须重新请求新源', async () => {
    const a = makeTransport([{ status: 200, body: TREE_BODY }]);
    setHfTransport(a.transport);
    await listHfFiles('org', 'model');
    expect(a.urls[0]).toContain('hf-mirror.com');

    setHfMirrorHost('mirror.example.com');
    const b = makeTransport([{ status: 200, body: TREE_BODY }]);
    setHfTransport(b.transport);
    await listHfFiles('org', 'model');
    // 缓存键含镜像源 host 且切源时显式清空：两条守卫任缺其一，这里都会命中旧源缓存
    expect(b.urls).toHaveLength(1);
    expect(b.urls[0]).toContain('mirror.example.com');
  });

  it('失败结果不入缓存：整体失败后的下一次拉取必须重新发请求', async () => {
    // 首发非可重试错误（HTTP 404，直接抛）；若失败也被写进缓存，第二次就会拿到空结果
    const t = makeTransport([
      { status: 404, body: 'not found' },
      { status: 200, body: TREE_BODY },
    ]);
    setHfTransport(t.transport);
    await expect(listHfFiles('org', 'model')).rejects.toThrow(/HTTP 404/);
    const r = await listHfFiles('org', 'model');
    expect(t.urls).toHaveLength(2);
    expect(r.files).toHaveLength(1);
  });

  it('301 重定向：跟随到同域新路径后解析最终响应', async () => {
    const t = makeTransport([
      { status: 301, body: '', location: '/api/models/org/model/tree/main?recursive=true' },
      { status: 200, body: TREE_BODY },
    ]);
    setHfTransport(t.transport);
    const r = await listHfFiles('org', 'model');
    expect(t.urls).toHaveLength(2);
    expect(t.urls[1]).toBe('https://hf-mirror.com/api/models/org/model/tree/main?recursive=true');
    expect(r.files).toHaveLength(1);
    expect(r.files[0].isGguf).toBe(true);
  });

  it('重试耗尽：错误信息标注尝试次数与当前镜像源（区分「瞬时失败」与「重试仍失败」）', async () => {
    vi.useFakeTimers();
    let calls = 0;
    setHfTransport({
      get: async () => {
        calls++;
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      },
    });
    const pending = listHfFiles('org', 'model');
    const assertion = expect(pending).rejects.toThrow(/failed after 4 attempts.*hf-mirror\.com/);
    // 3 次退避合计 ~7s+（1s/2s/4s 指数 + 抖动），假时钟一次推过
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(calls).toBe(4); // MAX_RETRIES=3 → 首发加 3 次重试
  });

  it('响应体是 HTML（CDN 拦截页）→ 明确报错，不把拦截页当 JSON 吞掉', async () => {
    const t = makeTransport([{ status: 200, body: '<html>Just a moment...</html>' }]);
    setHfTransport(t.transport);
    await expect(listHfFiles('org', 'model')).rejects.toThrow(/Expected JSON but got HTML/);
  });

  it('响应是非数组 JSON（错误对象/字符串）→ 空文件列表而非抛错', async () => {
    const t = makeTransport([{ status: 200, body: JSON.stringify({ error: 'rate limited' }) }]);
    setHfTransport(t.transport);
    const r = await listHfFiles('org', 'model');
    expect(r).toEqual({ files: [], namespace: 'org', name: 'model' });
  });
});
