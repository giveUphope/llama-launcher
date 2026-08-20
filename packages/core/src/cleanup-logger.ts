/**
 * 进程清理专用日志器。
 * 统一以 [cleanup] 前缀输出带时间戳的清理状态，便于调试窗口关闭后
 * 子进程是否被正确终止。不引入任何外部依赖，仅封装 console。
 *
 * 日志级别：
 *  - debug：详细追踪（窗口-进程映射、每次终止尝试）
 *  - info ：关键状态变化（开始清理、清理完成）
 *  - warn ：残留进程、兜底扫杀
 *  - error：清理过程中出现的异常
 */
export type CleanupLogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<CleanupLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: CleanupLogLevel = 'info';

/** 设置日志最低输出级别（如开发环境可设为 debug）。 */
export function setCleanupLogLevel(level: CleanupLogLevel): void {
  if (LEVEL_ORDER[level] !== undefined) minLevel = level;
}

function ts(): string {
  return new Date().toISOString();
}

function emit(level: CleanupLogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const prefix = `[cleanup:${level}]${scope ? ` ${scope}` : ''}`;
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`${ts()} ${prefix} ${message}`, meta);
  } else {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`${ts()} ${prefix} ${message}`);
  }
}

export const cleanupLogger = {
  debug(scope: string, message: string, meta?: unknown) { emit('debug', scope, message, meta); },
  info(scope: string, message: string, meta?: unknown) { emit('info', scope, message, meta); },
  warn(scope: string, message: string, meta?: unknown) { emit('warn', scope, message, meta); },
  error(scope: string, message: string, meta?: unknown) { emit('error', scope, message, meta); },
};
