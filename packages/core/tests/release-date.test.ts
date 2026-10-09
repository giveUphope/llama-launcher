/**
 * scripts/bump-version.cjs 的两个可判别性判据（TODO T16 的钉）。
 *
 * ① releaseDate() 必须给**本地日历日**，不是 UTC 日历日。
 *    旧写法 `new Date().toISOString().slice(0, 10)` 在本地 UTC+8 下 16:00 之后发版会把
 *    CHANGELOG 的日期写成前一天（v0.0.65 / v0.0.66 都实际踩到了）。判据用一个「UTC 日与
 *    本地日必然不同」的瞬时来区分两种实现；机器本身跑在 UTC 时（CI）这样的瞬时不存在，
 *    此时该条**显式跳过并打印理由**，不假装通过。
 * ② require 该脚本不得触发任何写盘（脚本尾部原先是无条件 run()）。这条是①能被测的前提，
 *    也是「被测试执行到的副作用」那类事故的防呆。
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootPkg = fileURLToPath(new URL('../../../package.json', import.meta.url));

const pad = (n: number) => String(n).padStart(2, '0');
/** 与实现无关的「本地日历日」参照系：只用 getFullYear/getMonth/getDate 独立算一遍 */
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

describe('scripts/bump-version.cjs releaseDate', () => {
  it('被 require 时不执行 CLI（root package.json 版本号不变）', () => {
    const before = JSON.parse(readFileSync(rootPkg, 'utf8')).version as string;
    const mod = require('../../../scripts/bump-version.cjs');
    expect(typeof mod.releaseDate).toBe('function');
    expect(JSON.parse(readFileSync(rootPkg, 'utf8')).version).toBe(before);
  });

  const { releaseDate } = require('../../../scripts/bump-version.cjs') as {
    releaseDate: (now?: Date) => string;
  };

  it('补零且形如 YYYY-MM-DD（月/日为个位时不得写成 2026-1-1）', () => {
    for (const d of [
      new Date(2026, 0, 9, 12), // 1 月 9 日
      new Date(2026, 8, 30, 12), // 9 月 30 日
      new Date(2026, 11, 1, 0, 5), // 12 月 1 日 00:05 本地
    ]) {
      expect(releaseDate(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(releaseDate(d)).toBe(localDay(d));
    }
  });

  it('取本地日历日而非 UTC 日历日（旧 UTC 写法在该瞬时必红）', () => {
    // 造一个「UTC 日 ≠ 本地日」的瞬时：本地 00:30。UTC-东八区下它等于 UTC 前一天 16:30。
    const now = new Date();
    const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30, 0);
    if (utcDay(probe) === localDay(probe)) {
      console.log(
        `[skip reason] 本机时区偏移 = ${-probe.getTimezoneOffset()} 分钟，` +
          `本地 00:30 的 UTC 日 (${utcDay(probe)}) 与本地日 (${localDay(probe)}) 相同，` +
          '该判据在非 UTC+0 机器上才有区分力，故本轮跳过（UTC 运行的 CI 即属此情形）',
      );
      return;
    }
    expect(releaseDate(probe)).toBe(localDay(probe));
    // 非空转对照：把实现退回 UTC 写法时必须与上面的期望不相等（否则这条判据是在空跑）
    expect(utcDay(probe)).not.toBe(localDay(probe));
  });

  it('bumpVersion 三种档位与进位（顺手把同文件的纯函数一起钉住）', () => {
    const mod = require('../../../scripts/bump-version.cjs') as {
      bumpVersion: (v: string, t: string) => string;
    };
    expect(mod.bumpVersion('0.0.66', 'patch')).toBe('0.0.67');
    expect(mod.bumpVersion('0.0.66', 'minor')).toBe('0.1.0');
    expect(mod.bumpVersion('0.0.66', 'major')).toBe('1.0.0');
    expect(mod.bumpVersion('0.9.9', 'minor')).toBe('0.10.0');
  });
});
