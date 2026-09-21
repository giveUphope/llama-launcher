import type { DownloadErrorType } from '@llama-launcher/shared';

/**
 * 错误分类：将底层错误归类为友好诊断类型。
 *
 * 单独成模块而非留在 download-manager：download-manager 依赖 download-log，
 * 而恢复旧日志时也要用同一套分类（见 download-log 的 done 事件），反向引用会成环。
 *
 * @param err 原始错误（Error / code 对象 / 纯消息串都可）
 * @param httpStatus HTTP 状态码（可选，来自段请求 reject 时附带）
 */
export function classifyError(err: unknown, httpStatus?: number): DownloadErrorType {
  if (!err) return 'unknown';
  const code = (err as any)?.code ?? (err as any)?.statusCode;
  const message = ((err as Error)?.message ?? String(err)).toLowerCase();

  // 磁盘空间不足
  if (code === 'ENOSPC') return 'disk_full';
  // 文件被占用(Windows 常见)
  if (['EBUSY', 'EPERM', 'EACCES'].includes(code)) return 'file_locked';
  // 网络层错误
  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return 'network';
  }
  // HTTP 状态码分类
  if (httpStatus) {
    if (httpStatus >= 500 && httpStatus < 600) return 'http_5xx';
    if (httpStatus >= 400 && httpStatus < 500) return 'http_4xx';
  }
  if (typeof code === 'number') {
    if (code >= 500 && code < 600) return 'http_5xx';
    if (code >= 400 && code < 500) return 'http_4xx';
  }
  // 消息匹配
  if (message.includes('does not support range')) return 'range_unsupported';
  if (message.includes('too many redirects')) return 'redirect_loop';
  if (message.includes('more data than expected')) return 'segment_overflow';
  if (message.includes('timeout') || message.includes('network')) return 'network';
  return 'unknown';
}
