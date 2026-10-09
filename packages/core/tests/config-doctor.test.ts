/**
 * 配置诊疗（config doctor）单测：临时目录注入路径，覆盖 settings / model-params 两侧的
 * 诊断、修复与幂等纪律。出问题的现场全是真实会遇到的：手改坏 JSON、版本升级后的残留
 * 字段、已移除参数的残留值、以及「文件本来就是干净的」这条最重要的不变量（绝不搅动）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runConfigDoctor, healModelParamsFile } from '../src/config-doctor.js';
import { healSettingsFile } from '../src/settings-store.js';
import { getDefaultSettings } from '../src/settings-store.js';

let dir = '';

beforeEach(() => {
  dir = join(tmpdir(), `config-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const settingsPath = () => join(dir, 'settings.json');

describe('config doctor：settings 侧', () => {
  it('干净文件： healed=false 且内容逐字节不动（幂等纪律）', () => {
    const p = settingsPath();
    const canonical = JSON.stringify(getDefaultSettings(), null, 2);
    writeFileSync(p, canonical, 'utf-8');
    const r = healSettingsFile(p);
    expect(r.healed).toBe(false);
    expect(r.issues).toEqual([]);
    expect(readFileSync(p, 'utf-8')).toBe(canonical);
  });

  it('版本随迁 + 未知键剥离 + 非法字段回退：一次写回，问题逐类上报', () => {
    const p = settingsPath();
    const stale = {
      ...getDefaultSettings(),
      settings_version: 0, // 旧版本号 → 随迁
      theme_mode: 'blue', // 非法枚举 → 回退默认
      session_values: { legacy: true }, // 已移除的历史字段 → 剥离
    };
    writeFileSync(p, JSON.stringify(stale, null, 2), 'utf-8');
    const r = healSettingsFile(p);
    expect(r.healed).toBe(true);
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toContain('version_migrated');
    expect(kinds).toContain('unknown_keys');
    expect(kinds).toContain('invalid_fields');
    // 未知键清单要能指出是哪个
    const unknown = r.issues.find((i) => i.kind === 'unknown_keys');
    expect(unknown?.keys).toContain('session_values');
    // 写回的文件是干净规范形：再跑一次必须 healed=false
    const again = healSettingsFile(p);
    expect(again.healed).toBe(false);
    expect(again.issues).toEqual([]);
    const healed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(healed.theme_mode).toBe('light');
    expect(healed.session_values).toBeUndefined();
    expect(healed.settings_version).toBe(1);
  });

  it('已声明的字符串数组字段不被当未知键剥除（T13）', () => {
    const p = settingsPath();
    writeFileSync(p, JSON.stringify({
      ...getDefaultSettings(),
      engine_hint_dismissed: ['提示甲', '提示乙'],
    }, null, 2), 'utf-8');
    const r = healSettingsFile(p);
    // 内容与规范形一致：既不该报 unknown_keys，也不该写盘
    expect(r.issues).toEqual([]);
    expect(r.healed).toBe(false);
    expect(JSON.parse(readFileSync(p, 'utf-8')).engine_hint_dismissed).toEqual(['提示甲', '提示乙']);
    // 反面对照：同一条文件里混进真未知键时，只剥它、留下已声明的数组字段
    writeFileSync(p, JSON.stringify({
      ...getDefaultSettings(),
      engine_hint_dismissed: ['提示甲'],
      session_values: { legacy: true },
    }, null, 2), 'utf-8');
    const r2 = healSettingsFile(p);
    expect(r2.issues.find((i) => i.kind === 'unknown_keys')?.keys).toEqual(['session_values']);
    expect(JSON.parse(readFileSync(p, 'utf-8')).engine_hint_dismissed).toEqual(['提示甲']);
    // 修复后再跑一次必干净
    expect(healSettingsFile(p).healed).toBe(false);
  });

  it('损坏 JSON：备份 .bak 后重置为全新默认文件', () => {
    const p = settingsPath();
    writeFileSync(p, '{ this is not json', 'utf-8');
    const r = healSettingsFile(p);
    expect(r.healed).toBe(true);
    expect(r.issues).toEqual([{ kind: 'corrupt' }]);
    expect(existsSync(`${p}.bak`)).toBe(true);
    expect(readFileSync(`${p}.bak`, 'utf-8')).toBe('{ this is not json');
    const healed = JSON.parse(readFileSync(p, 'utf-8'));
    expect(healed.settings_version).toBe(1);
    expect(healed.theme_mode).toBe('light');
  });

  it('顶层形状非法（数组）：备份并重置', () => {
    const p = settingsPath();
    writeFileSync(p, '[1, 2, 3]', 'utf-8');
    const r = healSettingsFile(p);
    expect(r.healed).toBe(true);
    expect(r.issues).toEqual([{ kind: 'invalid_shape' }]);
    expect(JSON.parse(readFileSync(p, 'utf-8')).theme_mode).toBe('light');
  });

  it('文件不存在（首次启动）：不代写、不报问题', () => {
    const r = healSettingsFile(settingsPath());
    expect(r.healed).toBe(false);
    expect(r.issues).toEqual([]);
    expect(existsSync(settingsPath())).toBe(false);
  });
});

describe('config doctor：model-params 侧', () => {
  const mpDir = () => join(dir, 'model-params');

  it('已移除参数的残留值被清理，现役参数原样保留', () => {
    const d = mpDir();
    mkdirSync(d, { recursive: true });
    const f = join(d, 'a.gguf-e30c66ef.json');
    writeFileSync(
      f,
      JSON.stringify(
        {
          format_version: 1,
          model_path: 'D:/m/a.gguf',
          updated_at: '2026-01-01T00:00:00.000Z',
          values: { ctx_size: 4096, session_values: 1, last_preset: 'x' },
        },
        null,
        2,
      ),
      'utf-8',
    );
    const r = healModelParamsFile(f);
    expect(r.healed).toBe(true);
    const issue = r.issues.find((i) => i.kind === 'unknown_params');
    expect(issue?.count).toBe(2);
    expect(issue?.keys).toEqual(expect.arrayContaining(['session_values', 'last_preset']));
    const cleaned = JSON.parse(readFileSync(f, 'utf-8'));
    expect(cleaned.values).toEqual({ ctx_size: 4096 });
    expect(cleaned.model_path).toBe('D:/m/a.gguf');
  });

  it('损坏 JSON：备份 .bak 并移出活集（文件消失，原内容可恢复）', () => {
    const d = mpDir();
    mkdirSync(d, { recursive: true });
    const f = join(d, 'broken.json');
    writeFileSync(f, 'not json at all', 'utf-8');
    const r = healModelParamsFile(f);
    expect(r.healed).toBe(true);
    expect(r.issues).toEqual([{ kind: 'corrupt' }]);
    expect(existsSync(f)).toBe(false);
    expect(readFileSync(`${f}.bak`, 'utf-8')).toBe('not json at all');
  });

  it('顶层形状非法（数组）：备份 .bak 并移出活集', () => {
    const d = mpDir();
    mkdirSync(d, { recursive: true });
    const f = join(d, 'array.json');
    writeFileSync(f, '[1, 2, 3]', 'utf-8');
    const r = healModelParamsFile(f);
    expect(r.healed).toBe(true);
    expect(r.issues).toEqual([{ kind: 'invalid_shape' }]);
    expect(existsSync(f)).toBe(false);
    expect(readFileSync(`${f}.bak`, 'utf-8')).toBe('[1, 2, 3]');
  });

  it('干净文件：healed=false 且内容不动', () => {
    const d = mpDir();
    mkdirSync(d, { recursive: true });
    const f = join(d, 'clean.json');
    const canonical = JSON.stringify(
      {
        format_version: 1,
        model_path: 'D:/m/c.gguf',
        updated_at: '2026-01-01T00:00:00.000Z',
        values: { ctx_size: 8192 },
      },
      null,
      2,
    );
    writeFileSync(f, canonical, 'utf-8');
    const r = healModelParamsFile(f);
    expect(r.healed).toBe(false);
    expect(r.issues).toEqual([]);
    expect(readFileSync(f, 'utf-8')).toBe(canonical);
  });
});

describe('runConfigDoctor（聚合入口）', () => {
  it('两侧报告聚合：settings 干净 + model-params 一坏一好', () => {
    const settingsFile = join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(getDefaultSettings(), null, 2), 'utf-8');
    const mpDir = join(dir, 'model-params');
    mkdirSync(mpDir, { recursive: true });
    writeFileSync(join(mpDir, 'good.json'), JSON.stringify({ format_version: 1, model_path: 'D:/m/g.gguf', updated_at: '', values: {} }, null, 2), 'utf-8');
    writeFileSync(join(mpDir, 'bad.json'), '{oops', 'utf-8');
    const report = runConfigDoctor({ settingsFile, modelParamsDir: mpDir });
    expect(report.settings?.healed).toBe(false);
    expect(report.modelParams).toHaveLength(2);
    const bad = report.modelParams.find((r) => r.file.endsWith('bad.json'));
    expect(bad?.healed).toBe(true);
    expect(bad?.issues).toEqual([{ kind: 'corrupt' }]);
    // 坏文件已移出活集
    expect(existsSync(join(mpDir, 'bad.json'))).toBe(false);
  });
});
