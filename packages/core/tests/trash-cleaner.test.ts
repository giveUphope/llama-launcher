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

  it('formatSize formats bytes correctly', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
  });
});
