import { net } from 'electron';
import type { BenchRequest, BenchResult, BenchMetrics } from '@llama-launcher/shared';

/**
 * 性能测试 HTTP 客户端。
 * 通过 Electron net 模块（Chromium 网络栈）对运行中的 llama-server 发请求，
 * 不受渲染进程 CORS 限制，且复用 Chromium 的 HTTP 实现。
 *
 * 指标来源：
 * - completion 响应 `timings`：本次请求的 prompt/generation tok/s 与 DFlash draft 数（最准确）
 * - `/metrics` 端点（--metrics 启用）：进程终身累计的 tok/s 与 DFlash 接受率（与日志 draft acceptance 同源）
 */

interface BenchHttpOptions {
  host: string;
  port: number;
  apiKey?: string;
  timeoutMs?: number;
}

function baseUrl({ host, port }: { host: string; port: number }): string {
  return `http://${host}:${port}`;
}

/**
 * 统一 fetch 风格请求（对应 DSH fetch-shaped handler 模式）：
 * 超时/网络错误/响应体收集收敛到一处，非 2xx 不抛错（由调用方按语义处理）。
 * @returns 状态码与响应文本
 */
function requestText(
  opts: BenchHttpOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const url = `${baseUrl(opts)}${path}`;
  const timeoutMs = opts.timeoutMs ?? 30000;
  return new Promise((resolve, reject) => {
    const req = net.request({ method, url });
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`));
    }, timeoutMs);

    if (body !== undefined) {
      req.setHeader('Content-Type', 'application/json');
    }
    if (opts.apiKey) {
      req.setHeader('Authorization', `Bearer ${opts.apiKey}`);
    }

    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Network error ${method} ${path}: ${err.message}`));
    });

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/** JSON 请求：状态非 200 或解析失败时抛错（返回解码后的业务对象）。 */
async function requestJson<T>(
  opts: BenchHttpOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { status, text } = await requestText(opts, method, path, body);
  if (status !== 200) {
    throw new Error(`HTTP ${status} from ${method} ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${method} ${path}`);
  }
}

/** GET /metrics：解析 Prometheus 文本，提取 tok/s 与 DFlash 接受率相关指标。 */
export async function fetchMetrics(opts: BenchHttpOptions): Promise<BenchMetrics> {
  const { status, text } = await requestText(
    { ...opts, timeoutMs: opts.timeoutMs ?? 10000 },
    'GET',
    '/metrics',
  );
  if (status !== 200) {
    throw new Error(`HTTP ${status} from GET /metrics: ${text.slice(0, 200)}`);
  }

  // Prometheus 文本：每行 "llamacpp:name value"，注释以 # 开头
  const valueOf = (name: string): number => {
    const re = new RegExp(`^llamacpp:${name}\s+([-+0-9.eE]+)`, 'm');
    const m = text.match(re);
    return m ? Number(m[1]) : 0;
  };

  return {
    promptPerSecond: valueOf('prompt_tokens_seconds'),
    predictedPerSecond: valueOf('predicted_tokens_seconds'),
    draftAccepted: valueOf('spec_decode_num_accepted_tokens_total'),
    draftTotal: valueOf('spec_decode_num_draft_tokens_total'),
    nDecode: valueOf('n_decode_total'),
  };
}

/** POST /v1/chat/completions：发一次非流式生成请求，读取 timings 与 DFlash 数据。 */
export async function runBench(
  opts: BenchHttpOptions,
  req: BenchRequest,
  timeoutMs?: number,
): Promise<BenchResult> {
  const startedAt = Date.now();
  const body = {
    model: 'bench',
    messages: [{ role: 'user', content: req.prompt }],
    max_tokens: req.maxTokens,
    stream: false,
  };
  const res = await requestJson<{
    usage?: { total_tokens?: number };
    timings?: {
      prompt_n?: number;
      prompt_per_second?: number;
      predicted_n?: number;
      predicted_per_second?: number;
      draft_n?: number;
      draft_n_accepted?: number;
    };
  }>({ ...opts, timeoutMs }, 'POST', '/v1/chat/completions', body);

  const t = res.timings ?? {};
  const elapsedMs = Date.now() - startedAt;

  // /metrics 补充 DFlash 接受率（进程终身累计；采样前后差值更准，此处返回当前累计值）
  let metrics: BenchMetrics | null = null;
  try {
    metrics = await fetchMetrics(opts);
  } catch {
    // metrics 未启用或请求失败时不阻塞测试结果
  }

  return {
    promptN: t.prompt_n ?? 0,
    promptPerSecond: t.prompt_per_second ?? 0,
    predictedN: t.predicted_n ?? 0,
    predictedPerSecond: t.predicted_per_second ?? 0,
    draftN: t.draft_n ?? 0,
    draftNAccepted: t.draft_n_accepted ?? 0,
    metricsDraftAccepted: metrics?.draftAccepted ?? 0,
    metricsDraftTotal: metrics?.draftTotal ?? 0,
    metricsPredictedPerSecond: metrics?.predictedPerSecond ?? 0,
    elapsedMs,
    sampledAt: Date.now(),
    concurrency: 1,
  };
}

/** 多并发请求的固定超时：并发请求可能排队（并发数 > 槽位数），单请求时间相应拉长。 */
const CONCURRENT_TIMEOUT_MS = 120000;

/**
 * 多并发场景：concurrency 个请求同时发往 llama-server（每个占用一个槽位，
 * 超出槽位数时排队），聚合为一份 BenchResult：
 * - tok/s 为各成功请求的求和（即多槽聚合吞吐，可与单并发逐流速率直接对比）
 * - 生成/提示 token 数为求和；耗时为本阶段墙钟时长
 * - 部分请求失败时聚合其余成功请求，失败数记录在 failed
 * - 全部失败时抛错（整次测试失败，由调用方处理）
 */
export async function runBenchConcurrent(
  opts: BenchHttpOptions,
  req: BenchRequest,
  concurrency: number,
): Promise<BenchResult> {
  const startedAt = Date.now();
  const settled = await Promise.allSettled(
    Array.from({ length: concurrency }, () => runBench(opts, req, CONCURRENT_TIMEOUT_MS)),
  );
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failed = settled.length - ok.length;
  if (ok.length === 0) {
    const reason = settled[0].status === 'rejected' ? String((settled[0] as PromiseRejectedResult).reason) : 'unknown';
    throw new Error(`All ${concurrency} concurrent requests failed: ${reason}`);
  }

  // 聚合：求和 tok/s（多槽并行时即聚合吞吐），token 数求和；metrics 取最后成功请求的进程累计值
  const last = ok[ok.length - 1];
  return {
    promptN: ok.reduce((a, r) => a + r.promptN, 0),
    promptPerSecond: ok.reduce((a, r) => a + r.promptPerSecond, 0),
    predictedN: ok.reduce((a, r) => a + r.predictedN, 0),
    predictedPerSecond: ok.reduce((a, r) => a + r.predictedPerSecond, 0),
    draftN: ok.reduce((a, r) => a + r.draftN, 0),
    draftNAccepted: ok.reduce((a, r) => a + r.draftNAccepted, 0),
    metricsDraftAccepted: last.metricsDraftAccepted,
    metricsDraftTotal: last.metricsDraftTotal,
    metricsPredictedPerSecond: last.metricsPredictedPerSecond,
    elapsedMs: Date.now() - startedAt,
    sampledAt: Date.now(),
    concurrency,
    failed,
  };
}
