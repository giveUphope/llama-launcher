// HuggingFace 镜像客户端(通过 hf-mirror.com 访问)
// hf-mirror.com 是 huggingface.co 的 1:1 镜像,API 路径与官方一致
// 所有公开模型 API 均可匿名访问,无需 token

import https from 'node:https';
import type { RequestOptions } from 'node:http';
import type {
  ModelScopeFileListResult,
  ModelScopeFile,
} from '@llama-launcher/shared';
import { categorizeFile, parseQuantization } from '@llama-launcher/shared';
import { formatFileSize } from './modelscope-client.js';
import { isRetryableError, retryDelayMs } from './retry.js';

const DEFAULT_MIRROR_HOST = 'hf-mirror.com';
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * 单次 HTTP GET 的传输抽象。
 *
 * 设计动机:Electron 33 内置的 Node 使用 BoringSSL,其 TLS ClientHello 会被
 * hf-mirror.com(以及部分其他服务端)直接 RST,导致 `node:https` 请求 100% 失败
 * (系统 Node 用 OpenSSL 则正常)。Node 层的 TLS 选项(cipher/curve/version)均无法
 * 绕过,因为是 BoringSSL 的握手指纹被拒。
 *
 * 解决:在 Electron 主进程启动时注入基于 Electron `net` 模块(Chromium 网络栈,
 * TLS 指纹同 Chrome 浏览器,服务端普遍接受)的传输实现。测试/非 Electron 环境
 * 使用默认的 `node:https` 传输。
 */
export interface HfHttpTransport {
  /**
   * 发起单次 GET 请求(不跟随重定向)。
   * @param url 完整 URL
   * @param timeoutMs 超时毫秒
   * @returns status 状态码;body 响应体(UTF-8 文本);location 重定向地址(无则 null)
   */
  get(url: string, timeoutMs?: number): Promise<{ status: number; body: string; location: string | null }>;
}

/** 默认 Node https 传输(测试 / 非 Electron 环境用) */
const nodeHttpsTransport: HfHttpTransport = {
  get(url, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (e) {
        reject(e);
        return;
      }
      const options: RequestOptions = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'llama-launcher/1.0',
          // 显式关闭 keep-alive,避免服务端在连接池中 reset socket 导致 ECONNRESET
          Connection: 'close',
          // 不接受压缩,避免需手动解压 gzip
          'Accept-Encoding': 'identity',
        },
        timeout: timeoutMs,
        // agent: false —— 完全禁用连接池,每次请求独立 TCP+TLS 连接并在结束后销毁
        agent: false,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            location: (res.headers.location as string) ?? null,
          }),
        );
        res.on('error', reject);
      });

      req.on('timeout', () => req.destroy(new Error(`Request timeout (${timeoutMs}ms) for ${url}`)));
      req.on('error', reject);
      req.end();
    });
  },
};

/** 当前注入的传输(默认 Node https) */
let _transport: HfHttpTransport = nodeHttpsTransport;

/**
 * 注入 HTTP 传输。Electron 主进程启动时(app.whenReady 后)调用,注入基于 `net`
 * 模块的实现以绕开 BoringSSL 指纹问题。
 */
export function setHfTransport(t: HfHttpTransport): void {
  _transport = t;
}

/** 当前镜像源 host（可配置，settings.hf_mirror_host 驱动）。 */
let _mirrorHost = DEFAULT_MIRROR_HOST;

/**
 * 设置 HuggingFace 镜像源 host（如自建镜像/内网缓存）。
 * 空字符串或无效值回退默认 hf-mirror.com；自动去除协议前缀与尾部斜杠。
 */
export function setHfMirrorHost(host: string): void {
  _mirrorHost =
    host && host.trim()
      ? host.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
      : DEFAULT_MIRROR_HOST;
}

/** 当前镜像源 host。 */
export function getHfMirrorHost(): string {
  return _mirrorHost;
}

/**
 * 判断 hostname 是否为当前配置的镜像源（含子域）。
 * 供下载传输选择（shouldUseTransport）复用：自定义镜像同样需要 Electron net 传输时在此命中。
 */
export function isHfMirrorHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  const m = _mirrorHost.toLowerCase();
  return h === m || h.endsWith('.' + m);
}

/**
 * 发起 HTTPS GET 请求,返回 JSON 解析结果。
 * 内置重定向跟随(最多 MAX_REDIRECTS 次,始终保持在镜像域)与非 JSON 响应检测。
 * @param path 请求路径(含 query string)
 * @param redirectCount 内部递归用的重定向计数
 */
async function request(path: string, redirectCount = 0): Promise<any> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${path}`);
  }

  const url = `https://${getHfMirrorHost()}${path}`;
  const { status, body, location } = await _transport.get(url);

  // 跟随重定向(始终发往当前镜像 host,保持镜像)
  if (status >= 300 && status < 400 && location) {
    const redirectUrl = new URL(location, url);
    return request(redirectUrl.pathname + redirectUrl.search, redirectCount + 1);
  }

  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} for ${url}`);
  }

  // 检测非 JSON 响应(如 Cloudflare 拦截页返回 HTML)
  const trimmed = body.trimStart();
  if (trimmed.startsWith('<')) {
    throw new Error(
      `Expected JSON but got HTML from ${url} (possibly rate-limited or blocked by CDN)`,
    );
  }
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${url}: ${(err as Error).message}`);
  }
}

/** 带重试的请求封装:瞬时网络错误时指数退避重试(MAX_RETRIES 次,退避逻辑见 retry.ts) */
async function requestWithRetry(path: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await request(path);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        await sleep(retryDelayMs(attempt, RETRY_BASE_DELAY_MS));
        continue;
      }
      // 重试耗尽:在错误信息中标注尝试次数,便于区分"瞬时失败"与"重试仍失败"
      if (isRetryableError(err)) {
        const e = err as Error;
        throw new Error(
          `${e.message} (failed after ${MAX_RETRIES + 1} attempts, ${getHfMirrorHost()} 可能临时不可达)`,
        );
      }
      throw err;
    }
  }
  throw lastErr;
}

/** 延迟工具 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 从 HF LFS oid（如 "sha256:abcd..."）提取 hex；非 sha256 或无则 null。 */
function extractSha256(oid: unknown): string | null {
  if (typeof oid !== 'string') return null;
  const m = oid.match(/^sha256:([0-9a-fA-F]{64})$/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * 获取 HuggingFace 模型仓库的文件列表(通过 hf-mirror.com 镜像)
 * 使用 /api/models/{ns}/{name}/tree/main?recursive=true 接口,返回含文件大小
 * @param namespace 命名空间/作者
 * @param name 模型名
 */
export async function listHfFiles(
  namespace: string,
  name: string,
): Promise<ModelScopeFileListResult> {
  const path = `/api/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tree/main?recursive=true`;
  const resp = await requestWithRetry(path);

  // HF tree API 返回数组:[{ path, size, type, lfs? }]
  if (!Array.isArray(resp)) {
    return { files: [], namespace, name };
  }

  const files: ModelScopeFile[] = resp
    .filter((f: any) => f.type === 'file' || f.type === 'blob')
    .map((f: any) => {
      const filePath: string = f.path ?? f.name ?? '';
      const fileName: string = f.name ?? filePath.split('/').pop() ?? '';
      return {
        name: fileName,
        path: filePath,
        size: f.size ?? 0,
        type: 'blob' as const,
        isLfs: !!(f.lfs || f.isLfs),
        // HF LFS 文件的 oid 即 sha256（形如 "sha256:<hex>"），用作下载完整性校验
        sha256: extractSha256(f.lfs?.oid),
        isGguf: filePath.toLowerCase().endsWith('.gguf'),
        category: categorizeFile(filePath),
        sizeStr: formatFileSize(f.size ?? 0),
        quantization: parseQuantization(fileName),
      };
    });

  return { files, namespace, name };
}

/**
 * 构造 HuggingFace 镜像文件下载 URL
 * 使用 resolve/main/{filePath} 格式,hf-mirror.com 会自动代理至 CDN
 * @param namespace 命名空间
 * @param name 模型名
 * @param filePath 文件在仓库中的路径
 */
export function buildHfDownloadUrl(namespace: string, name: string, filePath: string): string {
  return `https://${getHfMirrorHost()}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/resolve/main/${encodeURIComponent(filePath)}`;
}

/**
 * 构造 HF Mirror 模型页面 URL(用于浏览器跳转)
 */
export function buildHfModelPageUrl(namespace: string, name: string): string {
  return `https://${getHfMirrorHost()}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}
