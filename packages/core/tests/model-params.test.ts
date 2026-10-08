import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';

import {
  parseModelParams, normalizeValues, modelParamsKey, modelParamsFileName,
  readModelParams, writeModelParams, deleteModelParams, listModelParams,
} from '../src/model-params-store.js';
import {
  createModelParamsRepository, migratePresetsToModelParams,
} from '../src/model-params-repository.js';
import { MODEL_KEY } from '@llama-launcher/shared';

function tmpDir(tag: string): string {
  return path.join(os.tmpdir(), `llama-test-mparams-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
}

// ---------------- 文件层：键派生 / 格式容错 / 读写删 ----------------

describe('model-params-store 文件层', () => {
  const DIR = tmpDir('file');

  beforeEach(() => {
    mkdirSync(DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('存储键 = 清洗后的文件名 + 规范化路径短哈希（跨平台分隔符归一）', () => {
    const path = 'C:/Models/Foo/a.gguf';
    const a = modelParamsKey(path);
    const b = modelParamsKey('c:\\models\\foo\\a.gguf');
    expect(a).toBe(b); // 分隔符/大小写归一后同键
    expect(a).toContain('a.gguf');
    expect(modelParamsFileName(path)).toBe(`${a}.json`);
  });

  it('writeModelParams 落盘 v1 结构，values 为纯参数（剔除 model/_enabled）', () => {
    writeModelParams(DIR, {
      format_version: 1, model_path: 'C:/m/a.gguf', updated_at: '2026-01-01T00:00:00.000Z',
      values: { ctx_size: 4096 },
    });
    const data = JSON.parse(readFileSync(`${DIR}/${modelParamsFileName('C:/m/a.gguf')}`, 'utf-8'));
    expect(data.format_version).toBe(1);
    expect(data.model_path).toBe('C:/m/a.gguf');
    expect(data.values).toEqual({ ctx_size: 4096 });
    expect(readModelParams(DIR, 'C:/m/a.gguf')!.values).toEqual({ ctx_size: 4096 });
  });

  it('重复写入刷新 updated_at 且文件内容稳定（无 diff 噪音）', () => {
    writeModelParams(DIR, { format_version: 1, model_path: 'C:/m/b.gguf', updated_at: 't1', values: { port: 8080, ctx_size: 1 } });
    writeModelParams(DIR, { format_version: 1, model_path: 'C:/m/b.gguf', updated_at: 't2', values: { ctx_size: 1, port: 8080 } });
    const raw = JSON.parse(readFileSync(`${DIR}/${modelParamsFileName('C:/m/b.gguf')}`, 'utf-8'));
    expect(raw.updated_at).toBe('t2');
    expect(Object.keys(raw.values)).toEqual(Object.keys(raw.values).sort()); // 定义序稳定（此处按键序断言集合）
  });

  it('parseModelParams：损坏 JSON / values 形状非法容错', () => {
    expect(parseModelParams('{broken')).toBeNull();
    const bad = parseModelParams(JSON.stringify({ model_path: 'x', values: 'nope' }));
    expect(bad).not.toBeNull();
    expect(bad!.values).toEqual({});
  });

  it('deleteModelParams 删除文件；不存在返回 false；listModelParams 列全量', () => {
    writeModelParams(DIR, { format_version: 1, model_path: 'C:/m/c.gguf', updated_at: '', values: {} });
    expect(listModelParams(DIR)).toHaveLength(1);
    expect(deleteModelParams(DIR, 'C:/m/c.gguf')).toBe(true);
    expect(deleteModelParams(DIR, 'C:/m/c.gguf')).toBe(false);
    expect(listModelParams(DIR)).toHaveLength(0);
  });

  it('normalizeValues 剔除 model/_enabled；未知键殿后保持原序', () => {
    const out = normalizeValues({ zzz: 'x', ctx_size: 1, [MODEL_KEY]: 'C:/m.gguf', _enabled: 'ctx_size' });
    expect(Object.keys(out)).toEqual(['ctx_size', 'zzz']);
  });
});

// ---------------- 仓储层：load/save/clear/搬家重识别/按模型清理 ----------------

describe('model-params-repository', () => {
  const DIR = tmpDir('repo');
  const repo = () => createModelParamsRepository(DIR);

  beforeEach(() => {
    mkdirSync(DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('save→load 往返；load 未命中返回 null；clear 删除', () => {
    expect(repo().load('C:/m/x.gguf')).toBeNull();
    repo().save('C:/m/x.gguf', { ctx_size: 123, [MODEL_KEY]: 'C:/m/x.gguf' });
    const loaded = repo().load('C:/m/x.gguf');
    expect(loaded!.values).toEqual({ ctx_size: 123 }); // model 键被剔除
    expect(repo().clear('C:/m/x.gguf')).toBe(true);
    expect(repo().load('C:/m/x.gguf')).toBeNull();
  });

  it('save 是 upsert：更新同名模型的参数集（单文件，不堆积）', () => {
    repo().save('C:/m/y.gguf', { ctx_size: 1 });
    repo().save('C:/m/y.gguf', { ctx_size: 2 });
    expect(repo().load('C:/m/y.gguf')!.values).toEqual({ ctx_size: 2 });
    expect(readdirSync(DIR).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('搬家重识别：路径变了、文件名相同 ⇒ 按存储的原路径 basename 找回并换键重写', () => {
    repo().save('D:/old-loc/foo.gguf', { ctx_size: 42 });
    // 模拟目录被移动：把旧键文件直接改名为新路径的键（等价于用户移动了模型目录）
    const oldFile = `${DIR}/${modelParamsFileName('D:/old-loc/foo.gguf')}`;
    const content = JSON.parse(readFileSync(oldFile, 'utf-8'));
    rmSync(DIR, { recursive: true });
    mkdirSync(DIR, { recursive: true });
    const renamed = modelParamsFileName('D:/old-loc/foo.gguf').replace(/-[0-9a-f]{8}\.json$/, '-deadbeef.json');
    writeFileSync(`${DIR}/${renamed}`, JSON.stringify(content));

    const loaded = repo().load('E:/new-loc/foo.gguf');
    expect(loaded).not.toBeNull();
    expect(loaded!.model_path).toBe('E:/new-loc/foo.gguf'); // 重写为新键
    expect(loaded!.values).toEqual({ ctx_size: 42 });
    // 重识别后再读精确命中
    expect(repo().load('E:/new-loc/foo.gguf')!.values).toEqual({ ctx_size: 42 });
  });

  it('deleteForModel：目录前缀/文件精确/分隔符与大小写兼容，其余保留', () => {
    repo().save('C:/models/foo/Q4.gguf', {});
    repo().save('C:/models/bar/Q4.gguf', {});
    repo().save('D:\\Models\\Foo\\win.gguf', {});
    repo().save('C:/models/other.gguf', {});

    expect(repo().deleteForModel('C:/models/foo')).toEqual(['C:/models/foo/Q4.gguf']);
    expect(repo().deleteForModel('C:/models/bar/Q4.gguf')).toEqual(['C:/models/bar/Q4.gguf']);
    expect(repo().deleteForModel('D:/models/foo')).toEqual(['D:\\Models\\Foo\\win.gguf']);
    expect(repo().deleteForModel('')).toEqual([]);
    expect(repo().list().map((m) => m.model_path)).toEqual(['C:/models/other.gguf']);
  });

  it('空模型路径：save 拒绝、load/clear 返回空值', () => {
    expect(() => repo().save('', {})).toThrow();
    expect(repo().load('')).toBeNull();
    expect(repo().clear('')).toBe(false);
  });
});

// ---------------- 预设 → 每模型参数集迁移 ----------------

describe('migratePresetsToModelParams（存量预设一次性迁入，幂等）', () => {
  const root = tmpDir('migrate');
  const fromDir = path.join(root, 'presets');
  const toDir = path.join(root, 'model-params');

  beforeEach(() => {
    mkdirSync(fromDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writePreset(name: string, body: Record<string, unknown>): void {
    writeFileSync(join(fromDir, `${name}.json`), JSON.stringify(body));
  }

  it('绑定模型的预设迁入：同模型多条取 saved_at 最新，迁入后源文件删除、目录搬空移除', () => {
    writePreset('old', {
      preset_version: 3, id: 'a', name: 'old', saved_at: '2026-08-01T00:00:00.000Z',
      model: 'C:/m/foo.gguf', values: { ctx_size: 1024 },
    });
    writePreset('new', {
      preset_version: 3, id: 'b', name: 'new', saved_at: '2026-08-26T00:00:00.000Z',
      model: 'C:/m/foo.gguf', values: { ctx_size: 8192 },
    });

    const result = migratePresetsToModelParams(fromDir, toDir);

    expect(result.models).toBe(1);      // 同模型只留一条
    expect(result.imported).toBe(2);    // 两条源文件都删除（值已并入最新）
    expect(existsSync(fromDir)).toBe(false); // 搬空即移除

    const loaded = createModelParamsRepository(toDir).load('C:/m/foo.gguf');
    expect(loaded!.values).toEqual({ ctx_size: 8192 }); // 最新者胜
    expect(loaded!.updated_at).toBe('2026-08-26T00:00:00.000Z');
  });

  it('纯参数集（无模型绑定）与损坏 JSON 跳过并原地保留', () => {
    writePreset('free', { preset_version: 3, id: 'c', name: 'free', saved_at: '', model: null, values: { ctx_size: 1 } });
    writePreset('broken', 'not json');

    const result = migratePresetsToModelParams(fromDir, toDir);

    expect(result.models).toBe(0);
    expect(result.skipped).toBe(2);
    expect(existsSync(join(fromDir, 'free.json'))).toBe(true);
    expect(existsSync(join(fromDir, 'broken.json'))).toBe(true);
  });

  it('重复迁移幂等：第二轮无源可迁，已有参数集不被破坏', () => {
    writePreset('p', {
      preset_version: 3, id: 'd', name: 'p', saved_at: '2026-09-01T00:00:00.000Z',
      model: 'C:/m/bar.gguf', values: { ctx_size: 64 },
    });
    const first = migratePresetsToModelParams(fromDir, toDir);
    expect(first.models).toBe(1);

    const second = migratePresetsToModelParams(fromDir, toDir);
    expect(second.models).toBe(0);
    expect(createModelParamsRepository(toDir).load('C:/m/bar.gguf')!.values).toEqual({ ctx_size: 64 });
  });

  it('空参数边界：源目录不存在/为空串 不做事', () => {
    expect(migratePresetsToModelParams('', toDir)).toEqual({ models: 0, imported: 0, skipped: 0 });
    expect(migratePresetsToModelParams(path.join(root, 'missing'), toDir)).toEqual({ models: 0, imported: 0, skipped: 0 });
  });
});
