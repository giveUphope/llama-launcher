// HF 镜像下载的 Electron net 传输实现。
//
// 背景:与 hf-transport.ts 相同 —— Electron 33 内置 Node 使用 BoringSSL,其 TLS
// ClientHello 会被 hf-mirror.com 直接 RST(系统 Node 用 OpenSSL 则正常),导致
// packages/core 里基于 node:https 的默认下载传输在 Electron 主进程内 100% 失败
// (probe 与段下载均 ECONNRESET,重试无效)。
//
// 解决:用 Electron 的 net 模块(Chromium 网络栈,TLS 指纹同 Chrome 浏览器)发起请求,
// 服务端普遍接受。与 hf-transport 的区别:下载需要流式响应(文件可达 20GB+),故返回
// Readable 而非完整 body 字符串;另提供 cancel() 以便 pause/cancel 时中止底层请求。
//
// 此模块在 app.whenReady 后注入到 download-manager。

import { net } from 'electron';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { setDownloadTransport, type DownloadTransport } from '@llama-launcher/core';

/** 创建基于 Electron net 的下载传输并注入 download-manager */
export function installDownloadTransport(): void {
  const transport: DownloadTransport = {
    request(url, headers, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        // redirect: 'follow' —— 自动跟随重定向(hf-mirror.com 的 /resolve/ URL 会 302 到 CDN)。
        // 注意:Electron net 的 'manual' 模式不会返回 3xx 响应,而是抛 "Redirect was cancelled",
        // 故必须用 'follow' 让 Chromium 自动跟随。Range 头在重定向后保留(已验证)。
        // finalUrl 无法从响应获取(res.url 不存在),段请求会从原始 URL 重新跟随,开销可忽略。
        const req = net.request({ url, method: 'GET', redirect: 'follow' });
        for (const [k, v] of Object.entries(headers)) {
          req.setHeader(k, v);
        }

        const timer = setTimeout(() => {
          try {
            req.abort();
          } catch {
            // abort 可能已关闭,忽略
          }
          reject(new Error(`Request timeout (${timeoutMs}ms) for ${url}`));
        }, timeoutMs);

        req.on('response', (res) => {
          clearTimeout(timer);
          resolve({
            statusCode: res.statusCode ?? 0,
            // Electron net 已将 header 名小写,直接转为 IncomingHttpHeaders
            headers: res.headers as unknown as IncomingHttpHeaders,
            // Electron.IncomingMessage 运行时继承 Node Readable,但 TS 类型定义未完整对齐,
            // 用 as unknown as Readable 桥接(attachSegmentWriter 仅用 on/resume/pause,均可用)
            body: res as unknown as Readable,
            cancel: () => {
              try {
                req.abort();
              } catch {
                // 忽略:请求可能已结束
              }
            },
          });
        });

        req.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });

        req.on('close', () => clearTimeout(timer));

        req.end();
      });
    },
  };

  setDownloadTransport(transport);
}
