import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 临时配置目录：在 mock 之前初始化，因为 trash-cleaner.ts 模块加载时
// 会读取 SETTINGS_FILE 构建 WHITELIST_ABS
const _initialTmpDir = mkdtempSync(join(tmpdir(), `llama-trash-init-${process.pid}-${Date.now()}-`));
let tmpConfigDir: string = _initialTmpDir;
let tmpParamsDir: string = join(_initialTmpDir, 'model-params');
let tmpSettingsFile: string = join(_initialTmpDir, 'settings.json');

vi.mock('../src/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/paths.js')>();
  return {
    ...actual,
    get CONFIG_DIR() { return tmpConfigDir; },
    get SETTINGS_FILE() { return tmpSettingsFile; },
    get MODEL_PARAMS_DIR() { return tmpParamsDir; },
  };
});

import { detectTrash, cleanTrash, formatSize } from '../src/trash-cleaner.js';

function setupTmpDir() {
  // 清理旧目录并创建新目录
  if (existsSync(_initialTmpDir)) {
    try { rmSync(_initialTmpDir, { recursive: true, force: true }); } catch {}
  }
  tmpConfigDir = mkdtempSync(join(tmpdir(), `llama-trash-test-${process.pid}-${Date.now()}-`));
  tmpParamsDir = join(tmpConfigDir, 'model-params');
  tmpSettingsFile = join(tmpConfigDir, 'settings.json');
}

function cleanupTmpDir() {
  if (existsSync(tmpConfigDir)) {
    try { rmSync(tmpConfigDir, { recursive: true, force: true }); } catch {}
  }
}

describe('trash-cleaner', () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it('detectTrash returns empty for non-existent config dir', () => {
    rmSync(tmpConfigDir, { recursive: true, force: true });
    const result = detectTrash();
    expect(result.items).toHaveLength(0);
    expect(result.totalSize).toBe(0);
  });

  it('detectTrash returns empty for clean config dir (only settings.json)', () => {
    writeFileSync(tmpSettingsFile, '{}');
    const result = detectTrash();
    expect(result.items).toHaveLength(0);
  });

  it('参数集活目录（CONFIG_DIR/model-params）内的有效参数集不列入清理', () => {
    mkdirSync(tmpParamsDir, { recursive: true });
    // 模型文件必须真实存在（孤儿判定按 model_path 存在性）
    const modelFile = join(tmpConfigDir, 'present.gguf');
    writeFileSync(modelFile, 'model');
    writeFileSync(join(tmpParamsDir, 'valid.json'), JSON.stringify({
      format_version: 1, model_path: modelFile, updated_at: '', values: { ctx_size: 1 },
    }));
    writeFileSync(tmpSettingsFile, '{}');

    const result = detectTrash();
    expect(result.items).toHaveLength(0);
  });

  it('参数集活目录内的 .tmp/.bak 原子写残留识别为 temp_file（config 根）', () => {
    mkdirSync(tmpParamsDir, { recursive: true });
    writeFileSync(join(tmpParamsDir, 'crash.json.tmp'), '{}');
    writeFileSync(join(tmpParamsDir, 'old.bak'), '{}');
    writeFileSync(tmpSettingsFile, '{}');

    const result = detectTrash();
    const temps = result.items.filter(i => i.kind === 'temp_file');
    expect(temps.map(i => i.relPath).sort()).toEqual([join('model-params', 'crash.json.tmp'), join('model-params', 'old.bak')]);
    expect(temps.every(i => i.root === 'config')).toBe(true);
  });

  it('detectTrash identifies temp files by extension', () => {
    writeFileSync(tmpSettingsFile, '{}');
    writeFileSync(join(tmpConfigDir, 'cache.tmp'), 'temp');
    writeFileSync(join(tmpConfigDir, 'backup.bak'), 'backup');
    writeFileSync(join(tmpConfigDir, 'app.log'), 'log');
    writeFileSync(join(tmpConfigDir, 'old.old'), 'old');

    const result = detectTrash();
    const tempItems = result.items.filter(i => i.kind === 'temp_file');
    expect(tempItems).toHaveLength(4);
    expect(tempItems.map(i => i.relPath).sort()).toEqual(['app.log', 'backup.bak', 'cache.tmp', 'old.old']);
  });

  it('detectTrash identifies broken JSON files (not settings.json)', () => {
    writeFileSync(tmpSettingsFile, '{"valid": true}');
    writeFileSync(join(tmpConfigDir, 'broken.json'), '{invalid json content');

    const result = detectTrash();
    const brokenItems = result.items.filter(i => i.kind === 'broken_json');
    expect(brokenItems).toHaveLength(1);
    expect(brokenItems[0].relPath).toBe('broken.json');
  });

  it('detectTrash does NOT identify valid JSON files as trash', () => {
    writeFileSync(tmpSettingsFile, '{}');
    writeFileSync(join(tmpConfigDir, 'valid.json'), '{"valid": true}');

    const result = detectTrash();
    expect(result.items).toHaveLength(0);
  });

  it('detectTrash NEVER includes settings.json', () => {
    writeFileSync(tmpSettingsFile, '{broken');  // 即使损坏也不清理
    const result = detectTrash();
    const settingsItem = result.items.find(i => i.relPath === 'settings.json');
    expect(settingsItem).toBeUndefined();
  });

  it('detectTrash ignores unknown file extensions (conservative)', () => {
    writeFileSync(tmpSettingsFile, '{}');
    writeFileSync(join(tmpConfigDir, 'unknown.txt'), 'text');
    writeFileSync(join(tmpConfigDir, 'data.dat'), 'data');

    const result = detectTrash();
    expect(result.items).toHaveLength(0);
  });

  it('cleanTrash removes temp files (含参数集活目录内的原子写残留)', () => {
    mkdirSync(tmpParamsDir, { recursive: true });
    writeFileSync(tmpSettingsFile, '{}');
    const tmpFile = join(tmpConfigDir, 'cache.tmp');
    writeFileSync(tmpFile, 'temp');
    const paramsTmp = join(tmpParamsDir, 'p.json.tmp');
    writeFileSync(paramsTmp, '{}');

    const detected = detectTrash();
    const result = cleanTrash(detected.items);

    expect(result.cleaned).toBe(2);
    expect(existsSync(tmpFile)).toBe(false);
    expect(existsSync(paramsTmp)).toBe(false);
  });

  it('cleanTrash preserves settings.json', () => {
    writeFileSync(tmpSettingsFile, '{"key": "value"}');

    const detected = detectTrash();
    // 伪造一个 settings.json 的清理项（模拟恶意调用）
    const fakeItem = {
      relPath: 'settings.json',
      absPath: tmpSettingsFile,
      root: 'config' as const,
      kind: 'broken_json' as const,
      size: 100,
    };
    const result = cleanTrash([fakeItem, ...detected.items]);

    expect(result.failed).toBeGreaterThanOrEqual(1);
    // 逐项失败明细：伪造项带路径与原因（revalidated = 清理时刻复核未过）
    expect(result.failures.some(f => f.path === tmpSettingsFile && f.reason === 'revalidated')).toBe(true);
    expect(existsSync(tmpSettingsFile)).toBe(true);
  });

  it('cleanTrash rejects paths outside CONFIG_DIR', () => {
    // 创建外部临时文件
    const outsideFile = join(tmpdir(), `llama-outside-${Date.now()}.tmp`);
    writeFileSync(outsideFile, 'outside');

    const fakeItem = {
      relPath: '../../outside.tmp',
      absPath: outsideFile,
      root: 'config' as const,
      kind: 'temp_file' as const,
      size: 100,
    };
    const result = cleanTrash([fakeItem]);

    expect(result.failed).toBe(1);
    expect(result.cleaned).toBe(0);
    expect(existsSync(outsideFile)).toBe(true);

    // 清理外部文件
    rmSync(outsideFile);
  });

  it('detectTrash identifies legacy stats.jsonl', () => {
    writeFileSync(tmpSettingsFile, '{}');
    writeFileSync(join(tmpConfigDir, 'stats.jsonl'), '{"n":1}\n');

    const result = detectTrash();
    const stats = result.items.filter(i => i.kind === 'legacy_stats');
    expect(stats).toHaveLength(1);
    expect(stats[0].relPath).toBe('stats.jsonl');
    expect(stats[0].root).toBe('config');
  });

  it('formatSize formats bytes correctly', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
  });
});

describe('trash-cleaner 模型目录扫描（下载残留/保护集）与参数集活目录孤儿检测', () => {
  let tmpModelsDir: string;

  function setupModels() {
    if (existsSync(tmpConfigDir)) {
      try { rmSync(tmpConfigDir, { recursive: true, force: true }); } catch {}
    }
    tmpConfigDir = mkdtempSync(join(tmpdir(), `llama-trash-cfg-${process.pid}-${Date.now()}-`));
    tmpParamsDir = join(tmpConfigDir, 'model-params');
    mkdirSync(tmpParamsDir, { recursive: true });
    tmpSettingsFile = join(tmpConfigDir, 'settings.json');
    writeFileSync(tmpSettingsFile, '{}');
    tmpModelsDir = mkdtempSync(join(tmpdir(), `llama-trash-models-${process.pid}-${Date.now()}-`));
  }

  function cleanupModels() {
    for (const d of [tmpConfigDir, tmpModelsDir]) {
      if (existsSync(d)) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    }
  }

  /** 写一个参数集文件到活目录（CONFIG_DIR/model-params） */
  function writeParamsFile(name: string, modelPath: string | null) {
    writeFileSync(join(tmpParamsDir, `${name}.json`), JSON.stringify({
      format_version: 1, model_path: modelPath, updated_at: '',
      values: { ctx_size: 4096 },
    }));
  }

  beforeEach(setupModels);
  afterEach(cleanupModels);

  it('识别下载残留（.part / .llama_dl.jsonl / .llama_dl.json），模型文件本体不列入', () => {
    const modelDir = join(tmpModelsDir, 'author', 'repo');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'good.gguf'), 'model');
    writeFileSync(join(modelDir, 'good.gguf.part'), 'partial');
    writeFileSync(join(modelDir, 'good.gguf.llama_dl.jsonl'), '{"e":1}\n');
    writeFileSync(join(modelDir, 'old.gguf.llama_dl.json'), '{}');

    const result = detectTrash({ modelsDir: tmpModelsDir });
    const orphans = result.items.filter(i => i.kind === 'download_orphan');
    expect(orphans.map(i => i.relPath).sort()).toEqual([
      join('author', 'repo', 'good.gguf.llama_dl.jsonl'),
      join('author', 'repo', 'good.gguf.part'),
      join('author', 'repo', 'old.gguf.llama_dl.json'),
    ]);
    expect(orphans.every(i => i.root === 'models')).toBe(true);
  });

  it('保护集内的下载残留不列入清理（进行中/暂停任务断点数据）', () => {
    const partPath = join(tmpModelsDir, 'author', 'x.gguf.part');
    mkdirSync(join(tmpModelsDir, 'author'), { recursive: true });
    writeFileSync(partPath, 'partial');

    const result = detectTrash({ modelsDir: tmpModelsDir, protectedPaths: new Set([partPath]) });
    expect(result.items.filter(i => i.kind === 'download_orphan')).toHaveLength(0);
  });

  it('参数集活目录：孤儿识别（config 根）、有效保留；模型目录不再有参数集扫描', () => {
    writeParamsFile('gone', join(tmpModelsDir, 'deleted-model.gguf')); // 模型不存在 → 孤儿
    const existing = join(tmpModelsDir, 'present.gguf');
    writeFileSync(existing, 'model');
    writeParamsFile('alive', existing);                                 // 模型存在 → 有效

    const result = detectTrash({ modelsDir: tmpModelsDir });
    const orphans = result.items.filter(i => i.kind === 'orphan_model_params');
    expect(orphans.map(i => i.relPath)).toEqual([join('model-params', 'gone.json')]);
    expect(orphans.every(i => i.root === 'config')).toBe(true);
    expect(result.items.filter(i => i.root === 'models')).toHaveLength(0);
  });

  it('参数集活目录：损坏 JSON 识别为 broken_json（形状非法不误报）', () => {
    writeFileSync(join(tmpParamsDir, 'broken.json'), '{oops');
    writeFileSync(join(tmpParamsDir, 'weird.json'), JSON.stringify({ values: 'not-object', model_path: 42 }));

    const result = detectTrash({ modelsDir: tmpModelsDir });
    const broken = result.items.filter(i => i.kind === 'broken_json');
    expect(broken.map(i => i.relPath)).toEqual([join('model-params', 'broken.json')]);
  });

  it('历史版本遗留的 <models_dir>/presets 目录不再扫描（用户数据宁可保留不误删）', () => {
    const legacyPresets = join(tmpModelsDir, 'presets');
    mkdirSync(legacyPresets, { recursive: true });
    writeFileSync(join(legacyPresets, 'leftover.json'), '{broken');
    writeFileSync(join(legacyPresets, 'x.tmp'), '{}');

    const result = detectTrash({ modelsDir: tmpModelsDir });
    expect(result.items.filter(i => i.relPath.startsWith('presets'))).toHaveLength(0);
  });

  it('cleanTrash：删除孤儿参数集；模型重新出现则放弃（revalidate）', () => {
    const modelPath = join(tmpModelsDir, 'vanished.gguf');
    writeParamsFile('gone', modelPath);

    const detected = detectTrash({ modelsDir: tmpModelsDir });
    const orphans = detected.items.filter(i => i.kind === 'orphan_model_params');
    expect(orphans).toHaveLength(1);
    let result = cleanTrash(orphans, { modelsDir: tmpModelsDir });
    expect(result.cleaned).toBe(1);
    expect(existsSync(join(tmpParamsDir, 'gone.json'))).toBe(false);

    // 模型重新出现的场景：再检失败，不删
    writeParamsFile('back', modelPath);
    writeFileSync(modelPath, 'model');
    const reDetected = detectTrash({ modelsDir: tmpModelsDir });
    expect(reDetected.items.filter(i => i.kind === 'orphan_model_params')).toHaveLength(0);
    // 伪造一个已过时的孤儿项（模拟检测后模型被放回）
    const stale = { relPath: join('model-params', 'back.json'), absPath: join(tmpParamsDir, 'back.json'), root: 'config' as const, kind: 'orphan_model_params' as const, size: 1 };
    result = cleanTrash([stale], { modelsDir: tmpModelsDir });
    expect(result.failed).toBe(1);
    // 模型重新出现的放弃项进逐项失败明细（revalidated）
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe('revalidated');
    expect(result.failures[0].path).toBe(stale.absPath);
    expect(existsSync(join(tmpParamsDir, 'back.json'))).toBe(true);
  });

  it('cleanTrash：models 项缺 modelsDir 参数一律拒绝（路径隔离）', () => {
    const partPath = join(tmpModelsDir, 'x.gguf.part');
    writeFileSync(partPath, 'partial');
    const fake = { relPath: 'x.gguf.part', absPath: partPath, root: 'models' as const, kind: 'download_orphan' as const, size: 1 };

    expect(cleanTrash([fake]).failed).toBe(1);
    expect(existsSync(partPath)).toBe(true);
    // 清理时刻新任务占用（保护集）→ 拒绝
    expect(cleanTrash([fake], { modelsDir: tmpModelsDir, protectedPaths: new Set([partPath]) }).failed).toBe(1);
    expect(existsSync(partPath)).toBe(true);
    // 未保护 → 删除
    expect(cleanTrash([fake], { modelsDir: tmpModelsDir }).cleaned).toBe(1);
    expect(existsSync(partPath)).toBe(false);
  });

  it('modelsDir 位于配置目录内时跳过模型扫描（避免与 config 扫描重复）', () => {
    const nested = join(tmpConfigDir, 'models');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'a.gguf.part'), 'x');
    const result = detectTrash({ modelsDir: nested });
    expect(result.items.filter(i => i.root === 'models')).toHaveLength(0);
  });
});
