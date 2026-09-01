import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration } from '@llama-launcher/shared';

describe('shared formatBytes（字节 → 可读，2026-09-01 收敛工具）', () => {
  it('非有限值/非正数 → 0 B（0/负数/NaN/Infinity）', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
    expect(formatBytes(Number.NEGATIVE_INFINITY)).toBe('0 B');
  });

  it('单位切换点：1023/1024 边界精确', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('KB/MB 1 位小数、GB/TB 2 位小数（含此前修正的档位错位回归）', () => {
    expect(formatBytes(1536)).toBe('1.5 KB'); // 回归：曾误显 1.5 MB
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB');
    expect(formatBytes(1024 ** 3 * 1.125)).toBe('1.13 GB');
  });

  it('TB 及以上封顶不溢出（idx 停在最大档）', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.00 TB');
    expect(formatBytes(1024 ** 5)).toBe('1024.00 TB');
  });
});

describe('shared formatDuration（秒 → 时长，2026-09-01 收敛工具）', () => {
  it('秒级与分钟级切换点', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(61)).toBe('1m 1s');
  });

  it('小时级切换点与整点折叠', () => {
    expect(formatDuration(3599)).toBe('59m 59s');
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3601)).toBe('1h 0m'); // 剩余 1s 在 h 格式中折叠
    expect(formatDuration(3661)).toBe('1h 1m');
  });

  it('长时长（多小时）仍为 h m 紧凑格式', () => {
    expect(formatDuration(2 * 3600 + 5 * 60 + 3)).toBe('2h 5m');
  });
});