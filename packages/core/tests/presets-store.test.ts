import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listPresets, loadPreset, savePreset, deletePreset, deletePresetsForModel } from '../src/presets-store.js';
import { MODEL_KEY } from '@llama-launcher/shared';

// 预设目录现在由调用方传入，测试使用临时目录模拟
const PRESETS_DIR = path.join(
  os.tmpdir(),
  `llama-test-presets-${process.pid}-${Date.now()}`,
);

describe('presets-store', () => {
  beforeEach(() => {
    mkdirSync(PRESETS_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(PRESETS_DIR, { recursive: true, force: true });
  });

  it('listPresets returns empty array for empty directory', () => {
    expect(listPresets(PRESETS_DIR)).toEqual([]);
  });

  it('listPresets returns empty array for empty dir parameter', () => {
    expect(listPresets('')).toEqual([]);
  });

  it('listPresets returns empty array for non-existent directory', () => {
    expect(listPresets(path.join(PRESETS_DIR, 'nonexistent'))).toEqual([]);
  });

  it('savePreset creates a preset file and returns correct preset', () => {
    const preset = savePreset(PRESETS_DIR, 'test-preset-1', { ctx_size: 4096, port: 8080 });
    expect(preset.name).toBe('test-preset-1');
    expect(typeof preset.saved_at).toBe('string');
    expect(preset.values).toEqual({ ctx_size: 4096, port: 8080 });

    // 验证文件存在且内容正确
    const filePath = `${PRESETS_DIR}/test-preset-1.json`;
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.name).toBe('test-preset-1');
    expect(data.values).toEqual({ ctx_size: 4096, port: 8080 });
  });

  it('savePreset creates directory if it does not exist', () => {
    const newDir = path.join(PRESETS_DIR, 'sub', 'presets');
    savePreset(newDir, 'test-create', { ctx_size: 1024 });
    expect(existsSync(`${newDir}/test-create.json`)).toBe(true);
  });

  it('loadPreset loads an existing preset', () => {
    savePreset(PRESETS_DIR, 'load-test', { ctx_size: 2048 });
    const loaded = loadPreset(PRESETS_DIR, 'load-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('load-test');
    expect(loaded!.values).toEqual({ ctx_size: 2048 });
  });

  it('loadPreset returns null for non-existent preset', () => {
    expect(loadPreset(PRESETS_DIR, 'nonexistent-preset')).toBeNull();
  });

  it('loadPreset returns null for empty dir', () => {
    expect(loadPreset('', 'anything')).toBeNull();
  });

  it('savePreset overwrites existing preset', () => {
    savePreset(PRESETS_DIR, 'overwrite-test', { ctx_size: 4096, port: 9090 });
    savePreset(PRESETS_DIR, 'overwrite-test', { ctx_size: 8192 });
    const loaded = loadPreset(PRESETS_DIR, 'overwrite-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.values).toEqual({ ctx_size: 8192 });
  });

  it('deletePreset removes preset file and returns true', () => {
    savePreset(PRESETS_DIR, 'delete-me', { ctx_size: 1024 });
    const deleted = deletePreset(PRESETS_DIR, 'delete-me');
    expect(deleted).toBe(true);
    expect(existsSync(`${PRESETS_DIR}/delete-me.json`)).toBe(false);
  });

  it('deletePreset returns false for non-existent preset', () => {
    expect(deletePreset(PRESETS_DIR, 'nonexistent-preset')).toBe(false);
  });

  it('deletePreset returns false for empty dir', () => {
    expect(deletePreset('', 'anything')).toBe(false);
  });

  it('listPresets lists all saved presets', () => {
    savePreset(PRESETS_DIR, 'preset-a', { ctx_size: 4096 });
    savePreset(PRESETS_DIR, 'preset-b', { ctx_size: 8192 });
    const presets = listPresets(PRESETS_DIR);
    const presetNames = presets.map(p => p.name);
    expect(presetNames).toContain('preset-a');
    expect(presetNames).toContain('preset-b');
    expect(presets.length).toBe(2);
  });

  it('handles special characters in preset names (sanitizes to safe filenames)', () => {
    savePreset(PRESETS_DIR, 'preset\\with:special?chars', { ctx_size: 1024 });
    const loaded = loadPreset(PRESETS_DIR, 'preset\\with:special?chars');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('preset\\with:special?chars');

    // 文件名中的非法字符被替换为下划线
    const safeFilename = 'preset_with_special_chars.json';
    expect(existsSync(`${PRESETS_DIR}/${safeFilename}`)).toBe(true);

    deletePreset(PRESETS_DIR, 'preset\\with:special?chars');
  });

  it('handles filenames with backslashes correctly', () => {
    savePreset(PRESETS_DIR, 'a\\b', { ctx_size: 128 });
    const loaded = loadPreset(PRESETS_DIR, 'a\\b');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('a\\b');
    deletePreset(PRESETS_DIR, 'a\\b');
  });

  it('savePreset stamps v2 schema (model 分离顶层、created_at/app_version 齐全)', () => {
    const preset = savePreset(PRESETS_DIR, 'versioned', { [MODEL_KEY]: 'C:/models/foo.gguf', ctx_size: 4096 });
    expect(preset.preset_version).toBe(2);
    expect(preset.model).toBe('C:/models/foo.gguf');
    expect(preset.created_at).toBeTruthy();
    expect(preset.app_version).toBeTruthy();

    const data = JSON.parse(readFileSync(`${PRESETS_DIR}/versioned.json`, 'utf-8'));
    expect(data.preset_version).toBe(2);
    expect(data.model).toBe('C:/models/foo.gguf');
    // v2 values 为纯参数：不含 model
    expect(data.values).toEqual({ ctx_size: 4096 });
    expect(data.values[MODEL_KEY]).toBeUndefined();
  });

  it('savePreset 保留原 created_at 并刷新 saved_at（覆盖保存）', () => {
    const first = savePreset(PRESETS_DIR, 'times', { ctx_size: 4096 });
    const data1 = JSON.parse(readFileSync(`${PRESETS_DIR}/times.json`, 'utf-8'));
    data1.saved_at = '2020-01-01T00:00:00.000Z';
    require('node:fs').writeFileSync(`${PRESETS_DIR}/times.json`, JSON.stringify(data1));

    const second = savePreset(PRESETS_DIR, 'times', { ctx_size: 8192 });
    expect(second.created_at).toBe(first.created_at);
    expect(second.saved_at).not.toBe('2020-01-01T00:00:00.000Z');
    expect(new Date(second.saved_at).getTime()).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'));
  });

  it('values 按 PARAMS 定义顺序稳定序列化（重复保存键序一致）', () => {
    savePreset(PRESETS_DIR, 'order', { port: 8080, ctx_size: 4096, flash_attn: 'on' });
    const keys1 = Object.keys(JSON.parse(readFileSync(`${PRESETS_DIR}/order.json`, 'utf-8')).values);
    savePreset(PRESETS_DIR, 'order', { flash_attn: 'on', port: 8080, ctx_size: 4096 });
    const keys2 = Object.keys(JSON.parse(readFileSync(`${PRESETS_DIR}/order.json`, 'utf-8')).values);
    expect(keys2).toEqual(keys1);
    // 未知键不剔除，排在已知键之后（相对顺序保持）
    savePreset(PRESETS_DIR, 'order-unknown', { zzz_custom: 'x', ctx_size: 4096 });
    expect(JSON.parse(readFileSync(`${PRESETS_DIR}/order-unknown.json`, 'utf-8')).values.zzz_custom).toBe('x');
  });

  it('savePreset 剔除 legacy _enabled 键', () => {
    savePreset(PRESETS_DIR, 'legacy-clean', { ctx_size: 4096, _enabled: 'ctx_size' });
    const data = JSON.parse(readFileSync(`${PRESETS_DIR}/legacy-clean.json`, 'utf-8'));
    expect(data.values).toEqual({ ctx_size: 4096 });
    expect(data.values['_enabled']).toBeUndefined();
  });

  it('savePreset 空/纯空白 model 值落为顶层 null', () => {
    const preset = savePreset(PRESETS_DIR, 'no-model', { [MODEL_KEY]: '', ctx_size: 4096 });
    expect(preset.model).toBeNull();
    expect(JSON.parse(readFileSync(`${PRESETS_DIR}/no-model.json`, 'utf-8')).model).toBeNull();
  });

  it('v1 旧文件（model 在 values 内）加载时迁移到 v2 内存形状', () => {
    const legacy = path.join(PRESETS_DIR, 'legacy-v1.json');
    require('node:fs').writeFileSync(legacy, JSON.stringify({
      preset_version: 1,
      name: 'legacy-v1',
      saved_at: '2025-01-01T00:00:00.000Z',
      values: { [MODEL_KEY]: 'C:/models/foo.gguf', ctx_size: 2048, _enabled: 'ctx_size' },
    }));
    const loaded = loadPreset(PRESETS_DIR, 'legacy-v1');
    expect(loaded!.preset_version).toBe(2);
    expect(loaded!.model).toBe('C:/models/foo.gguf');
    expect(loaded!.created_at).toBe('2025-01-01T00:00:00.000Z');
    expect(loaded!.values).toEqual({ ctx_size: 2048 });
  });

  it('无版本字段的史前文件补齐迁移（同 v1 处理）', () => {
    // 旧版预设无 preset_version 字段:加载时按 v1 迁移
    const legacy = path.join(PRESETS_DIR, 'legacy.json');
    require('node:fs').writeFileSync(legacy, JSON.stringify({ name: 'legacy', values: { ctx_size: 2048 } }));
    const loaded = loadPreset(PRESETS_DIR, 'legacy');
    expect(loaded!.preset_version).toBe(2);
    expect(loaded!.model).toBeNull();
    expect(loaded!.values).toEqual({ ctx_size: 2048 });
  });

  it('loadPreset validates values shape (non-object values fall back to empty object)', () => {
    require('node:fs').writeFileSync(
      path.join(PRESETS_DIR, 'bad-values.json'),
      JSON.stringify({ name: 'bad-values', values: 'not-an-object' }),
    );
    const loaded = loadPreset(PRESETS_DIR, 'bad-values');
    expect(loaded).not.toBeNull();
    expect(loaded!.values).toEqual({});
    // 损坏 JSON 返回 null(静默跳过,不污染列表)
    require('node:fs').writeFileSync(path.join(PRESETS_DIR, 'broken.json'), '{broken');
    expect(loadPreset(PRESETS_DIR, 'broken')).toBeNull();
  });
});

describe('deletePresetsForModel（删除模型时同步清理关联预设）', () => {
  // 模拟 models_dir 结构：<tmp>/models + <tmp>/models/presets
  const modelsDir = path.join(os.tmpdir(), `llama-test-models-${process.pid}-${Date.now()}`);
  const presetsDir = path.join(modelsDir, 'presets');

  beforeEach(() => {
    mkdirSync(presetsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(modelsDir, { recursive: true, force: true });
  });

  it('删除模型目录时删除 model 路径以该目录开头的预设，其余保留', () => {
    savePreset(presetsDir, 'foo', { [MODEL_KEY]: 'C:/models/foo/Q4_K_M.gguf', ctx_size: 8192 });
    savePreset(presetsDir, 'bar', { [MODEL_KEY]: 'C:/models/bar/Q4_K_M.gguf', ctx_size: 4096 });

    const removed = deletePresetsForModel(modelsDir, 'C:/models/foo');

    expect(removed).toEqual(['foo']);
    expect(existsSync(path.join(presetsDir, 'foo.json'))).toBe(false);
    expect(existsSync(path.join(presetsDir, 'bar.json'))).toBe(true);
  });

  it('删除模型文件时删除 model 路径等于该文件的预设', () => {
    savePreset(presetsDir, 'm1', { [MODEL_KEY]: 'C:/models/foo/Q4_K_M.gguf' });

    const removed = deletePresetsForModel(modelsDir, 'C:/models/foo/Q4_K_M.gguf');

    expect(removed).toEqual(['m1']);
    expect(existsSync(path.join(presetsDir, 'm1.json'))).toBe(false);
  });

  it('路径分隔符兼容：预设以反斜杠存路径也能匹配正斜杠的删除目标', () => {
    savePreset(presetsDir, 'win', { [MODEL_KEY]: 'D:\\models\\foo\\Q4_K_M.gguf' });

    const removed = deletePresetsForModel(modelsDir, 'D:/models/foo');

    expect(removed).toEqual(['win']);
  });

  it('前缀不匹配的预设保留；空路径/无预设目录返回空列表', () => {
    savePreset(presetsDir, 'keep', { [MODEL_KEY]: 'C:/models/other/Q4_K_M.gguf' });

    expect(deletePresetsForModel(modelsDir, 'C:/models/foo')).toEqual([]);
    expect(existsSync(path.join(presetsDir, 'keep.json'))).toBe(true);
    // 边界：modelsDir 为空 / modelPath 为空 / 目录不存在
    expect(deletePresetsForModel('', 'C:/models/foo')).toEqual([]);
    expect(deletePresetsForModel(modelsDir, '')).toEqual([]);
    expect(deletePresetsForModel(path.join(modelsDir, 'missing'), 'C:/models/foo')).toEqual([]);
  });
});
