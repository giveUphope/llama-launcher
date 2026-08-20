// HuggingFace 镜像请求的 Electron net 传输实现。
//
// 背景:Electron 33 内置 Node 使用 BoringSSL,其 TLS ClientHello 会被 hf-mirror.com
// 直接 RST(系统 Node 用 OpenSSL 则正常),导致 packages/core 里基于 node:https 的
// 默认传输在 Electron 主进程内 100% 失败(ECONNRESET,重试无效)。
//
// 解决:用 Electron 的 net 模块(Chromium 网络栈,TLS 指纹同 Chrome 浏览器)发起请求,
// 服务端普遍接受。此模块在 app.whenReady 后注入到 huggingface-client。

import { net } from 'electron';
import { setHfTransport, type HfHttpTransport } from '@llama-launcher/core';

/** 读取可能为 string | string[] 的响应头 */
function headerValue(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** 创建基于 Electron net 的 HF 传输并注入 huggingface-client */
export function installHfTransport(): void {
  const transport: HfHttpTransport = {
    get(url, timeoutMs = 20000) {
      return new Promise((resolve, reject) => {
        // redirect: 'follow' —— 自动跟随重定向(Electron net 的 'manual' 模式不会返回 3xx
        // 响应而是抛 "Redirect was cancelled",故用 'follow' 让 Chromium 自动跟随)。
        // huggingface-client 的 request() 仍保留 3xx 兜底逻辑,但自动跟随后不会触发。
        const req = net.request({ url, method: 'GET', redirect: 'follow' });
        req.setHeader('Accept', 'application/json');
        req.setHeader('User-Agent', 'llama-launcher/1.0');

        const chunks: Buffer[] = [];
        req.on('response', (res) => {
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
              location: headerValue(res.headers.location as string | string[] | undefined),
            }),
          );
          res.on('error', (e: Error) => reject(e));
        });

        const timer = setTimeout(() => {
          try {
            req.abort();
          } catch {
            // abort 可能已关闭,忽略
          }
          reject(new Error(`Request timeout (${timeoutMs}ms) for ${url}`));
        }, timeoutMs);
        req.on('close', () => clearTimeout(timer));
        req.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });

        req.end();
      });
    },
  };

  setHfTransport(transport);
}
