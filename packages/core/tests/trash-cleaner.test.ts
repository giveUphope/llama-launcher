import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 临时配置目录：在 mock 之前初始化，因为 trash-cleaner.ts 模块加载时
// 会读取 SETTINGS_FILE 构建 WHITELIST_ABS
const _initialTmpDir = mkdtempSync(join(tmpdir(), `llama-trash-init-${process.pid}-${Date.now()}-`));
let tmpConfigDir: string = _initialTmpDir;
let tmpPresetsDir: string = join(_initialTmpDir, 'presets');
let tmpSettingsFile: string = join(_initialTmpDir, 'settings.json');

vi.mock('../src/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/paths.js')>();
  return {
    ...actual,
    get CONFIG_DIR() { return tmpConfigDir; },
    get SETTINGS_FILE() { return tmpSettingsFile; },
    get PRESETS_DIR() { return tmpPresetsDir; },
  };
});

import { detectTrash, cleanTrash, formatSize } from '../src/trash-cleaner.js';

function setupTmpDir() {
  // 清理旧目录并创建新目录
  if (existsSync(_initialTmpDir)) {
    try { rmSync(_initialTmpDir, { recursive: true, force: true }); } catch {}
  }
  tmpConfigDir = mkdtempSync(join(tmpdir(), `llama-trash-test-${process.pid}-${Date.now()}-`));
  tmpPresetsDir = join(tmpConfigDir, 'presets');
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

  it('detectTrash identifies stale presets directory', () => {
    mkdirSync(tmpPresetsDir, { recursive: true });
    writeFileSync(join(tmpPresetsDir, 'preset1.json'), '{"name":"p1"}');
    writeFileSync(join(tmpPresetsDir, 'preset2.json'), '{"name":"p2"}');
    writeFileSync(tmpSettingsFile, '{}');

    const result = detectTrash();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe('stale_presets_dir');
    expect(result.items[0].relPath).toBe('presets');
    expect(result.items[0].size).toBeGreaterThan(0);
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

  it('cleanTrash removes stale presets directory', () => {
    mkdirSync(tmpPresetsDir, { recursive: true });
    writeFileSync(join(tmpPresetsDir, 'preset1.json'), '{"name":"p1"}');
    writeFileSync(tmpSettingsFile, '{}');

    const detected = detectTrash();
    const result = cleanTrash(detected.items);

    expect(result.cleaned).toBe(1);
    expect(result.failed).toBe(0);
    expect(existsSync(tmpPresetsDir)).toBe(false);
  });

  it('cleanTrash removes temp files', () => {
    writeFileSync(tmpSettingsFile, '{}');
    const tmpFile = join(tmpConfigDir, 'cache.tmp');
    writeFileSync(tmpFile, 'temp');

    const detected = detectTrash();
    const result = cleanTrash(detected.items);

    expect(result.cleaned).toBe(1);
    expect(existsSync(tmpFile)).toBe(false);
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

describe('trash-cleaner 模型目录扫描（下载残留/孤儿预设/保护集）', () => {
  let tmpModelsDir: string;
  let tmpModelsPresetsDir: string;

  function setupModels() {
    if (existsSync(tmpConfigDir)) {
      try { rmSync(tmpConfigDir, { recursive: true, force: true }); } catch {}
    }
    tmpConfigDir = mkdtempSync(join(tmpdir(), `llama-trash-cfg-${process.pid}-${Date.now()}-`));
    tmpPresetsDir = join(tmpConfigDir, 'presets');
    tmpSettingsFile = join(tmpConfigDir, 'settings.json');
    writeFileSync(tmpSettingsFile, '{}');
    tmpModelsDir = mkdtempSync(join(tmpdir(), `llama-trash-models-${process.pid}-${Date.now()}-`));
    tmpModelsPresetsDir = join(tmpModelsDir, 'presets');
    mkdirSync(tmpModelsPresetsDir, { recursive: true });
  }

  function cleanupModels() {
    for (const d of [tmpConfigDir, tmpModelsDir]) {
      if (existsSync(d)) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    }
  }

  /** 写一个 v2 形状预设文件 */
  function writePresetFile(name: string, model: string | null) {
    writeFileSync(join(tmpModelsPresetsDir, `${name}.json`), JSON.stringify({
      preset_version: 2, name, created_at: '', saved_at: '', app_version: '', model,
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

  it('presets 目录：孤儿预设识别、有效/纯参数集保留、.tmp 残留识别', () => {
    writePresetFile('gone', join(tmpModelsDir, 'deleted-model.gguf')); // 模型不存在 → 孤儿
    const existing = join(tmpModelsDir, 'present.gguf');
    writeFileSync(existing, 'model');
    writePresetFile('alive', existing);                                 // 模型存在 → 有效
    writePresetFile('pure', null);                                      // 纯参数集 → 保留
    writeFileSync(join(tmpModelsPresetsDir, 'crash.json.tmp'), '{}');   // 原子写残留

    const result = detectTrash({ modelsDir: tmpModelsDir });
    const orphans = result.items.filter(i => i.kind === 'orphan_preset');
    expect(orphans.map(i => i.relPath)).toEqual([join('presets', 'gone.json')]);
    const temps = result.items.filter(i => i.kind === 'temp_file' && i.root === 'models');
    expect(temps.map(i => i.relPath)).toEqual([join('presets', 'crash.json.tmp')]);
  });

  it('presets 目录：损坏 JSON 识别为 broken_json（形状非法不误报）', () => {
    writeFileSync(join(tmpModelsPresetsDir, 'broken.json'), '{oops');
    writeFileSync(join(tmpModelsPresetsDir, 'weird.json'), JSON.stringify({ values: 'not-object', name: 42 }));

    const result = detectTrash({ modelsDir: tmpModelsDir });
    const broken = result.items.filter(i => i.kind === 'broken_json');
    expect(broken.map(i => i.relPath)).toEqual([join('presets', 'broken.json')]);
  });

  it('cleanTrash：删除孤儿预设；模型重新出现则放弃（revalidate）', () => {
    const modelPath = join(tmpModelsDir, 'vanished.gguf');
    writePresetFile('gone', modelPath);

    const detected = detectTrash({ modelsDir: tmpModelsDir });
    const orphans = detected.items.filter(i => i.kind === 'orphan_preset');
    expect(orphans).toHaveLength(1);
    let result = cleanTrash(orphans, { modelsDir: tmpModelsDir });
    expect(result.cleaned).toBe(1);
    expect(existsSync(join(tmpModelsPresetsDir, 'gone.json'))).toBe(false);

    // 模型重新出现的场景：再检失败，不删
    writePresetFile('back', modelPath);
    writeFileSync(modelPath, 'model');
    const reDetected = detectTrash({ modelsDir: tmpModelsDir });
    expect(reDetected.items.filter(i => i.kind === 'orphan_preset')).toHaveLength(0);
    // 伪造一个已过时的孤儿项（模拟检测后模型被放回）
    const stale = { relPath: join('presets', 'back.json'), absPath: join(tmpModelsPresetsDir, 'back.json'), root: 'models' as const, kind: 'orphan_preset' as const, size: 1 };
    result = cleanTrash([stale], { modelsDir: tmpModelsDir });
    expect(result.failed).toBe(1);
    expect(existsSync(join(tmpModelsPresetsDir, 'back.json'))).toBe(true);
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
