// 统一的可重试错误判定与指数退避（download-manager / huggingface-client 共用）。
// 收敛了原先两份近似重复的实现：download-manager 侧重 err.code/statusCode 判定，
// huggingface-client 侧重消息关键词判定，合并后两者都覆盖；新增网络调用零成本复用。

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_MSG_KEYWORDS = [
  'timeout',
  'etimedout',
  'econnreset',
  'epipe',
  'econnrefused',
  'eai_again',
  'enotfound',
  'socket hang up',
  'network',
];

/** 判断错误是否可重试（瞬时网络错误或可重试 HTTP 状态码）。 */
export function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as any)?.code ?? (err as any)?.statusCode;
  if (code) {
    if (NETWORK_ERROR_CODES.has(String(code))) return true;
    if (typeof code === 'number' && RETRYABLE_HTTP_STATUS.has(code)) return true;
  }
  const message = ((err as Error)?.message ?? String(err)).toLowerCase();
  return RETRYABLE_MSG_KEYWORDS.some((k) => message.includes(k));
}

/** 指数退避延迟（ms）：base × 2^attempt + 抖动，封顶 maxMs。 */
export function retryDelayMs(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(maxMs, exponential) + jitter;
}
