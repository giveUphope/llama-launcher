import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  listPresets, readPresetByName, readPresetFileByName, writePresetFile, deletePresetFile,
  parsePreset, normalizeValues, presetFileName, PRESET_VERSION,
} from '../src/presets-store.js';
import {
  createPresetRepository, migratePresetStore, PresetRepoError,
} from '../src/preset-repository.js';
import { MODEL_KEY, PARAMS } from '@llama-launcher/shared';

function tmpDir(tag: string): string {
  return path.join(os.tmpdir(), `llama-test-presets-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
}

// ---------------- 文件层：格式 / 版本迁移 / 文件名映射 ----------------

describe('presets-store 文件层（v3 格式）', () => {
  const PRESETS_DIR = tmpDir('file');

  beforeEach(() => {
    mkdirSync(PRESETS_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(PRESETS_DIR, { recursive: true, force: true });
  });

  it('writePresetFile 落盘 v3 结构（id/model 顶层/created_at 齐全），values 为纯参数', () => {
    const preset = writePresetFile(PRESETS_DIR, {
      preset_version: PRESET_VERSION,
      id: 'id-1',
      name: 'test-preset-1',
      created_at: '2026-01-01T00:00:00.000Z',
      saved_at: '2026-01-01T00:00:00.000Z',
      app_version: 'test',
      model: 'C:/models/foo.gguf',
      values: { ctx_size: 4096, port: 8080 },
    });
    expect(preset.preset_version).toBe(3);
    expect(preset.id).toBe('id-1');

    const data = JSON.parse(readFileSync(`${PRESETS_DIR}/test-preset-1.json`, 'utf-8'));
    expect(data.preset_version).toBe(3);
    expect(data.id).toBe('id-1');
    expect(data.model).toBe('C:/models/foo.gguf');
    expect(data.values).toEqual({ ctx_size: 4096, port: 8080 });
  });

  it('文件名由 name 清洗非法字符而来；readPresetByName 用同样的映射', () => {
    writePresetFile(PRESETS_DIR, {
      preset_version: PRESET_VERSION, id: 'id-2', name: 'preset\\with:special?chars',
      created_at: '', saved_at: '', app_version: '', model: null, values: { ctx_size: 1024 },
    });
    expect(existsSync(`${PRESETS_DIR}/preset_with_special_chars.json`)).toBe(true);
    const loaded = readPresetByName(PRESETS_DIR, 'preset\\with:special?chars');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('id-2');
  });

  it('listPresets 返回全部预设并按名称大小写不敏感排序', () => {
    writePresetFile(PRESETS_DIR, { preset_version: 3, id: 'b', name: 'beta', created_at: '', saved_at: '', app_version: '', model: null, values: {} });
    writePresetFile(PRESETS_DIR, { preset_version: 3, id: 'a', name: 'Alpha', created_at: '', saved_at: '', app_version: '', model: null, values: {} });
    expect(listPresets(PRESETS_DIR).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('deletePresetFile 删除文件；不存在返回 false；空 dir 安全', () => {
    writePresetFile(PRESETS_DIR, { preset_version: 3, id: 'x', name: 'gone', created_at: '', saved_at: '', app_version: '', model: null, values: {} });
    expect(deletePresetFile(PRESETS_DIR, presetFileName('gone'))).toBe(true);
    expect(existsSync(`${PRESETS_DIR}/gone.json`)).toBe(false);
    expect(deletePresetFile(PRESETS_DIR, presetFileName('gone'))).toBe(false);
    expect(deletePresetFile('', 'gone.json')).toBe(false);
  });

  it('parsePreset：v1 旧文件（model 在 values 内）迁移为 v3 形状并回填 id（needsUpgrade）', () => {
    const parsed = parsePreset(JSON.stringify({
      preset_version: 1,
      name: 'legacy-v1',
      saved_at: '2025-01-01T00:00:00.000Z',
      values: { [MODEL_KEY]: 'C:/models/foo.gguf', ctx_size: 2048, _enabled: 'ctx_size' },
    }), 'legacy-v1');
    expect(parsed).not.toBeNull();
    expect(parsed!.needsUpgrade).toBe(true);
    expect(parsed!.preset.preset_version).toBe(3);
    expect(parsed!.preset.id).toBeTruthy();
    expect(parsed!.preset.model).toBe('C:/models/foo.gguf');
    expect(parsed!.preset.created_at).toBe('2025-01-01T00:00:00.000Z');
    expect(parsed!.preset.values).toEqual({ ctx_size: 2048 });
  });

  it('parsePreset：v2 文件（无 id）回填 id；v3 文件 needsUpgrade=false', () => {
    const v2 = parsePreset(JSON.stringify({
      preset_version: 2, name: 'v2file', saved_at: '2025-06-01T00:00:00.000Z',
      model: 'C:/m/a.gguf', values: { ctx_size: 512 },
    }), 'v2file');
    expect(v2!.needsUpgrade).toBe(true);
    expect(v2!.preset.id).toBeTruthy();

    const v3 = parsePreset(JSON.stringify({
      preset_version: 3, id: 'stable-id', name: 'v3file', saved_at: '', created_at: '',
      app_version: '', model: null, values: {},
    }), 'v3file');
    expect(v3!.needsUpgrade).toBe(false);
    expect(v3!.preset.id).toBe('stable-id');
  });

  it('parsePreset：损坏 JSON 返回 null；values 形状非法回退空对象', () => {
    expect(parsePreset('{broken', 'x')).toBeNull();
    const bad = parsePreset(JSON.stringify({ name: 'bad', values: 'not-an-object' }), 'bad');
    expect(bad).not.toBeNull();
    expect(bad!.preset.values).toEqual({});
  });

  it('normalizeValues 剔除 model/_enabled 并按 PARAMS 定义顺序稳定排序（未知键殿后保持原序）', () => {
    const out = normalizeValues({ zzz_custom: 'x', port: 8080, ctx_size: 4096, flash_attn: 'on', [MODEL_KEY]: 'C:/m.gguf', _enabled: 'ctx_size' });
    // 已知键按 PARAMS 表顺序（不从测试里硬编码表序），未知键殿后
    const known = PARAMS.map((p) => p.key).filter((k) => k === 'ctx_size' || k === 'flash_attn' || k === 'port');
    expect(Object.keys(out)).toEqual([...known, 'zzz_custom']);
    expect(out[MODEL_KEY]).toBeUndefined();
    expect(out['_enabled']).toBeUndefined();
  });

  it('readPresetFileByName 仅接受 .json 文件名；目录不存在返回 null', () => {
    expect(readPresetFileByName(PRESETS_DIR, 'x.json')).toBeNull();
    expect(readPresetFileByName(PRESETS_DIR, 'x.txt')).toBeNull();
    expect(readPresetFileByName(path.join(PRESETS_DIR, 'missing'), 'x.json')).toBeNull();
  });
});

// ---------------- 领域层：id 主键 / upsert / 改名 / 按模型清理 ----------------

describe('preset-repository（id 主键与 upsert 语义）', () => {
  const DIR = tmpDir('repo');
  const repo = () => createPresetRepository(DIR);

  beforeEach(() => {
    mkdirSync(DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('save 新建：生成稳定 id，summaries 为不含 values 的轻量摘要', () => {
    const saved = repo().save({ name: 'alpha', values: { ctx_size: 4096 } });
    expect(saved.id).toBeTruthy();
    expect(saved.created_at).toBeTruthy();

    const summaries = repo().summaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({ id: saved.id, name: 'alpha', created_at: saved.created_at, saved_at: saved.saved_at, model: null });
    expect((summaries[0] as unknown as Record<string, unknown>).values).toBeUndefined();

    // get(id) 才拿得到完整实体
    const full = repo().get(saved.id);
    expect(full!.values).toEqual({ ctx_size: 4096 });
  });

  it('save 同名（无 id）= 覆盖：id 与 created_at 继承，saved_at 刷新', () => {
    const first = repo().save({ name: 'alpha', values: { ctx_size: 4096 } });
    const second = repo().save({ name: 'alpha', values: { ctx_size: 8192 } });
    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
    expect(second.values).toEqual({ ctx_size: 8192 });
    expect(repo().list()).toHaveLength(1);
  });

  it('save 带 id = 更新目标；同时改名时旧文件搬走、id 恒定', () => {
    const first = repo().save({ name: 'old-name', values: { ctx_size: 1024 } });
    const updated = repo().save({ id: first.id, name: 'new-name', values: { ctx_size: 2048 } });
    expect(updated.id).toBe(first.id);
    expect(updated.name).toBe('new-name');
    expect(existsSync(path.join(DIR, 'old-name.json'))).toBe(false);
    expect(existsSync(path.join(DIR, 'new-name.json'))).toBe(true);
    expect(repo().get(first.id)!.values).toEqual({ ctx_size: 2048 });
  });

  it('save 带未知 id 或改名为他人名字时报业务错误；空名拒绝', () => {
    const a = repo().save({ name: 'a', values: {} });
    repo().save({ name: 'b', values: {} });
    expect(() => repo().save({ id: 'no-such-id', name: 'x', values: {} })).toThrow(PresetRepoError);
    expect(() => repo().save({ id: a.id, name: 'b', values: {} })).toThrow(PresetRepoError);
    expect(() => repo().save({ name: '  ', values: {} })).toThrow(PresetRepoError);
    expect(existsSync(path.join(DIR, 'a.json'))).toBe(true);
  });

  it('rename：仅改展示名（id/saved_at 不变），同名冲突拒绝', () => {
    const a = repo().save({ name: 'a', values: { ctx_size: 1 } });
    repo().save({ name: 'b', values: {} });
    const before = repo().get(a.id)!;

    const renamed = repo().rename(a.id, 'a2');
    expect(renamed.id).toBe(a.id);
    expect(renamed.saved_at).toBe(before.saved_at);
    expect(existsSync(path.join(DIR, 'a.json'))).toBe(false);
    expect(repo().get(a.id)!.name).toBe('a2');

    expect(() => repo().rename(a.id, 'b')).toThrow(PresetRepoError);
    expect(() => repo().rename('no-such', 'zz')).toThrow(PresetRepoError);
  });

  it('delete 按主键删除；未知 id 返回 false', () => {
    const a = repo().save({ name: 'a', values: {} });
    expect(repo().delete(a.id)).toBe(true);
    expect(existsSync(path.join(DIR, 'a.json'))).toBe(false);
    expect(repo().delete(a.id)).toBe(false);
  });

  it('findByName 按展示名查（覆盖判定/旧引用兜底用）', () => {
    const a = repo().save({ name: 'alpha', values: {} });
    expect(repo().findByName('alpha')!.id).toBe(a.id);
    expect(repo().findByName('nope')).toBeNull();
  });

  it('deleteForModel：目录前缀/文件精确/分隔符与大小写兼容，其余保留', () => {
    repo().save({ name: 'dir-hit', values: { [MODEL_KEY]: 'C:/models/foo/Q4_K_M.gguf' } });
    repo().save({ name: 'file-hit', values: { [MODEL_KEY]: 'C:/models/bar/Q4_K_M.gguf' } });
    repo().save({ name: 'win-sep', values: { [MODEL_KEY]: 'D:\\models\\Foo\\win.gguf' } });
    repo().save({ name: 'other', values: { [MODEL_KEY]: 'C:/models/other/Q4_K_M.gguf' } });
    repo().save({ name: 'no-model', values: { ctx_size: 8 } });

    expect(repo().deleteForModel('C:/models/foo').sort()).toEqual(['dir-hit']);
    expect(repo().deleteForModel('C:/models/bar/Q4_K_M.gguf')).toEqual(['file-hit']);
    expect(repo().deleteForModel('D:/models/foo')).toEqual(['win-sep']);
    expect(repo().deleteForModel('')).toEqual([]);
    expect(repo().list().map((p) => p.name)).toEqual(['no-model', 'other']);
  });
});

// ---------------- 存储位置迁移 + v3 原位升级 ----------------

describe('migratePresetStore（旧位置搬入 + id 升级，幂等）', () => {
  const root = tmpDir('migrate');
  const fromDir = path.join(root, 'models', 'presets');
  const toDir = path.join(root, 'home', '.llama_launcher', 'presets');

  beforeEach(() => {
    mkdirSync(fromDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('v2 文件搬入即升级 v3（补 id）、源文件删除、空源目录移除', () => {
    writeFileSync(path.join(fromDir, 'p1.json'), JSON.stringify({
      preset_version: 2, name: 'p1', saved_at: '2025-01-01T00:00:00.000Z',
      model: 'C:/m/a.gguf', values: { ctx_size: 1024 },
    }));

    const result = migratePresetStore(fromDir, toDir);

    expect(result.moved).toBe(1);
    expect(existsSync(path.join(fromDir, 'p1.json'))).toBe(false);
    expect(existsSync(fromDir)).toBe(false); // 搬空后源目录壳也移除

    const preset = readPresetByName(toDir, 'p1')!;
    expect(preset.preset_version).toBe(3);
    expect(preset.id).toBeTruthy();
    expect(preset.model).toBe('C:/m/a.gguf');
  });

  it('同名目标已存在时跳过（目标优先），源文件保留、计数 skipped', () => {
    mkdirSync(toDir, { recursive: true });
    writeFileSync(path.join(toDir, 'p1.json'), JSON.stringify({
      preset_version: 3, id: 'target-id', name: 'p1', saved_at: '', created_at: '', app_version: '', model: null, values: {},
    }));
    writeFileSync(path.join(fromDir, 'p1.json'), JSON.stringify({
      preset_version: 2, name: 'p1', saved_at: '', model: null, values: { ctx_size: 1 },
    }));

    const result = migratePresetStore(fromDir, toDir);

    expect(result.moved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(existsSync(path.join(fromDir, 'p1.json'))).toBe(true);
    expect(readPresetByName(toDir, 'p1')!.id).toBe('target-id');
  });

  it('损坏 JSON 不搬运、原地保留', () => {
    writeFileSync(path.join(fromDir, 'broken.json'), '{broken');
    const result = migratePresetStore(fromDir, toDir);
    expect(result.moved).toBe(0);
    expect(existsSync(path.join(fromDir, 'broken.json'))).toBe(true);
  });

  it('目标目录内的 v1/v2 旧文件原位升级；重复迁移 id 保持稳定', () => {
    mkdirSync(toDir, { recursive: true });
    writeFileSync(path.join(toDir, 'old.json'), JSON.stringify({
      name: 'old', saved_at: '2024-01-01T00:00:00.000Z', values: { ctx_size: 64 },
    }));

    const first = migratePresetStore(fromDir, toDir);
    expect(first.upgraded).toBe(1);
    const idAfterFirst = readPresetByName(toDir, 'old')!.id;
    expect(idAfterFirst).toBeTruthy();

    const second = migratePresetStore(fromDir, toDir);
    expect(second.upgraded).toBe(0);
    expect(readPresetByName(toDir, 'old')!.id).toBe(idAfterFirst);
  });

  it('空参数边界：fromDir 为空 / 两目录相同 都不做事', () => {
    expect(migratePresetStore('', toDir)).toEqual({ moved: 0, upgraded: 0, skipped: 0 });
    expect(migratePresetStore(fromDir, fromDir)).toEqual({ moved: 0, upgraded: 0, skipped: 0 });
    expect(readdirSync(fromDir).length).toBe(0);
  });
});
