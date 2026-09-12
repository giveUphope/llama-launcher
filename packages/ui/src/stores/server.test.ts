import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PORT_BUSY_RE, useServerStore } from './server';

// —— window.api 桩：捕获 onOutput/onStatus 回调，getStatus 返回可控的主进程状态 ——
type StatusCb = (s: any) => void;
type OutputCb = (e: any) => void;
let statusCb: StatusCb = () => {};
let outputCb: OutputCb = () => {};
let mainStatus: any = { status: 'stopped', pid: null, host: '127.0.0.1', port: 8080, url: '', values: {} };

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  server: {
    onOutput: (cb: OutputCb) => { outputCb = cb; },
    onStatus: (cb: StatusCb) => { statusCb = cb; },
    getStatus: () => Promise.resolve(mainStatus),
    start: () => Promise.resolve({ ok: true }),
    stop: () => Promise.resolve({ ok: true }),
    restart: () => Promise.resolve({ ok: true }),
    previewCommand: () => Promise.resolve({ ok: true, data: '' }),
  },
};

vi.mock('@/stores/i18n', () => ({
  useI18nStore: () => ({ t: (k: string) => k }),
}));

/** 模拟主进程推送的一行服务输出 */
function out(data: string) {
  outputCb({ kind: 'stderr', data, ts: Date.now() });
}

beforeEach(() => {
  setActivePinia(createPinia());
  statusCb = () => {};
  outputCb = () => {};
  mainStatus = { status: 'stopped', pid: null, host: '127.0.0.1', port: 8080, url: '', values: {} };
});

describe('PORT_BUSY_RE（端口占用原始输出识别）', () => {
  it('命中断口占用关键文本（跨 llama.cpp 版本）', () => {
    const busyLines = [
      'bind() failed: Address already in use (OS Error: 10048)',
      'http: bind: address already in use',
      'error bind: address already in use',
      'EADDRINUSE: address already in use',
      "socket error: Cannot assign requested address",
      'bind() failed with errno 98 Address already in use',
      '[llama server] failed to bind port 8080: address already in use',
    ];
    for (const line of busyLines) {
      expect(PORT_BUSY_RE.test(line), `应命中: ${line}`).toBe(true);
    }
  });

  it('不误伤正常启动/其他错误输出', () => {
    const normalLines = [
      'llama_server: listening on http://127.0.0.1:8080',
      'server is listening on port 8080',
      'HTTP server listening',
      'failed to allocate GPU buffer',
      'error while loading model: mmap failed',
    ];
    for (const line of normalLines) {
      expect(PORT_BUSY_RE.test(line), `不应命中: ${line}`).toBe(false);
    }
  });
});

describe('effectiveStatus 失败判定只看本轮运行输出', () => {
  it('上一轮端口冲突失败残留不把本轮 starting/running 误判为 failed/crashed', () => {
    const server = useServerStore();
    server.subscribe();
    // 上一轮：starting → bind 失败 → 进程退出
    statusCb('starting');
    out('bind() failed: Address already in use (OS Error: 10048)\n');
    statusCb('stopped');
    expect(server.effectiveStatus).toBe('failed');
    // 端口冲突处理完成后再次启动：进入 starting 即重置判定边界，旧失败行不再生效
    statusCb('starting');
    expect(server.effectiveStatus).toBe('starting');
    out('llama_server: listening on http://127.0.0.1:8080\n');
    statusCb('running');
    expect(server.effectiveStatus).toBe('running');
  });

  it('本轮内的失败仍会被识别（不放过真失败）', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb('starting');
    out('error while loading model: mmap failed\n');
    expect(server.effectiveStatus).toBe('failed');
    statusCb('running');
    expect(server.effectiveStatus).toBe('crashed');
  });

  it('清空控制台后边界归零，后续新一轮失败仍可判定', () => {
    const server = useServerStore();
    server.subscribe();
    statusCb('starting');
    out('bind() failed\n');
    statusCb('stopped');
    server.clearOutputs();
    expect(server.effectiveStatus).toBe('stopped');
    statusCb('starting');
    out('fatal: model not found\n');
    expect(server.effectiveStatus).toBe('failed');
  });
});
