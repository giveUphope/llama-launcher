import { describe, it, expect } from 'vitest';
import { isRetryableError, retryDelayMs } from '../src/retry.js';

describe('retry (统一可重试判定/退避)', () => {
  it('网络错误 code 可重试(ECONNRESET/ETIMEDOUT/ENOTFOUND 等)', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
      const err = Object.assign(new Error('x'), { code });
      expect(isRetryableError(err), code).toBe(true);
    }
  });

  it('可重试 HTTP 状态码可重试;4xx 不可重试', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableError(Object.assign(new Error('x'), { statusCode: status })), String(status)).toBe(true);
    }
    expect(isRetryableError(Object.assign(new Error('x'), { statusCode: 404 }))).toBe(false);
    expect(isRetryableError(Object.assign(new Error('x'), { statusCode: 401 }))).toBe(false);
  });

  it('消息关键词判定(timeout/socket hang up/network)', () => {
    expect(isRetryableError(new Error('Request timeout (30000ms)'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableError(new Error('network is unreachable'))).toBe(true);
    expect(isRetryableError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('不可重试的错误返回 false(非错误/null/普通错误)', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError(new Error('file not found'))).toBe(false);
    expect(isRetryableError({ message: 'boom' })).toBe(false);
  });

  it('退避按指数增长且封顶', () => {
    expect(retryDelayMs(0, 1000, 30000)).toBeGreaterThanOrEqual(1000);
    expect(retryDelayMs(1, 1000, 30000)).toBeGreaterThanOrEqual(2000);
    // 封顶:5 次后 32000 > max 30000
    expect(retryDelayMs(5, 1000, 30000)).toBeLessThanOrEqual(30500);
    expect(retryDelayMs(0, 100, 100)).toBeLessThanOrEqual(600);
  });
});
