import { describe, it, expect } from 'vitest';
import { classifyError } from '../src/error-classify.js';

/**
 * 错误分类的分支表。此前没有专属测试，分类只被 download-manager 的个别路径间接带过——
 * errorType 会随 IPC 直出到下载页徽章，分类错了用户看到的就是错误诊断。
 */
function errWith(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra);
}

describe('classifyError（下载错误 → 诊断类型）', () => {
  it('磁盘空间不足：ENOSPC → disk_full', () => {
    expect(classifyError(errWith('write failed', { code: 'ENOSPC' }))).toBe('disk_full');
  });

  it.each(['EBUSY', 'EPERM', 'EACCES'])('文件被占用：%s → file_locked', (code) => {
    expect(classifyError(errWith('operation failed', { code })), code).toBe('file_locked');
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])(
    '网络层错误码：%s → network',
    (code) => {
      expect(classifyError(errWith('request failed', { code })), code).toBe('network');
    },
  );

  it('显式 httpStatus：5xx → http_5xx、4xx → http_4xx', () => {
    expect(classifyError(new Error('HTTP 503'), 503)).toBe('http_5xx');
    expect(classifyError(new Error('HTTP 404'), 404)).toBe('http_4xx');
  });

  it('无显式 httpStatus 时回退到错误对象上的数字 statusCode/code', () => {
    expect(classifyError(errWith('HTTP 500', { statusCode: 500 }))).toBe('http_5xx');
    expect(classifyError(errWith('HTTP 403', { code: 403 }))).toBe('http_4xx');
  });

  it('消息关键词：Range/重定向环/段溢出/超时/network', () => {
    expect(classifyError(new Error('Server does not support Range after redirect'))).toBe('range_unsupported');
    expect(classifyError(new Error('Too many redirects (>5): https://x'))).toBe('redirect_loop');
    expect(classifyError(new Error('Segment received more data than expected after redirect'))).toBe('segment_overflow');
    expect(classifyError(new Error('Request timeout (2500ms) for https://x'))).toBe('network');
    expect(classifyError(new Error('network unreachable'))).toBe('network');
  });

  it('判空优先：无错误 → unknown；不可识别的普通错误 → unknown', () => {
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
    expect(classifyError('plain string failure')).toBe('unknown');
    expect(classifyError(new Error('something entirely else'))).toBe('unknown');
  });

  it('code 分支先于 httpStatus：ENOSPC + 500 同给 → disk_full（磁盘满不该被读成服务端错）', () => {
    expect(classifyError(errWith('write failed', { code: 'ENOSPC' }), 500)).toBe('disk_full');
  });
});
