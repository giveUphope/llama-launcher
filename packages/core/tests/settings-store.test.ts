import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AppSettings } from '@llama-launcher/shared';

// Mock paths.js：把 SETTINGS_FILE 重定向到临时文件，保留 DEFAULT_SERVER_EXE /
// DEFAULT_MODELS_DIR 真实值，确保测试覆盖真实模块的合并逻辑与真实默认值。
vi.mock('../src/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/paths.js')>();
  const os = await import('node:os');
  const path = await import('node:path');
  return {
    ...actual,
    SETTINGS_FILE: path.join(
      os.tmpdir(),
      `llama-test-settings-${process.pid}-${Date.now()}.json`,
    ),
  };
});

import { loadSettings, saveSettings, getDefaultSettings } from '../src/settings-store.js';
import { setHfMirrorHost, getHfMirrorHost } from '../src/huggingface-client.js';
import { SETTINGS_FILE, DEFAULT_SERVER_EXE, DEFAULT_MODELS_DIR } from '../src/paths.js';

describe('settings-store', () => {
  afterEach(() => {
    if (existsSync(SETTINGS_FILE)) rmSync(SETTINGS_FILE);
    const bak = `${SETTINGS_FILE}.bak`;
    if (existsSync(bak)) rmSync(bak);
    setHfMirrorHost(''); // 复位镜像源，避免跨用例污染
  });

  it('getDefaultSettings returns correct defaults', () => {
    const defaults = getDefaultSettings();
    expect(defaults.server_exe).toBe(DEFAULT_SERVER_EXE);
    expect(defaults.models_dir).toBe(DEFAULT_MODELS_DIR);
    expect(defaults.selected_model).toBe('');
    expect(defaults.last_preset).toBe('');
    expect(defaults.window_geometry).toBe('');
    expect(defaults.theme_mode).toBe('dark');
    expect(defaults.sidebar_collapsed).toBe(false);
    expect(defaults.language).toBe('zh');
    expect(defaults.last_tab).toBe('');
  });

  it('loadSettings returns defaults when no file exists', () => {
    const defaults = getDefaultSettings();
    const settings = loadSettings();
    expect(settings).toEqual(defaults);
  });

  it('loadSettings loads custom settings from file', () => {
    const customSettings: AppSettings = {
      server_exe: '/custom/path/llama-server.exe',
      models_dir: '/custom/models',
      selected_model: 'model.gguf',
      last_preset: 'default',
      window_geometry: '100,100,1920,1080',
      theme_mode: 'light',
      sidebar_collapsed: true,
      language: 'en',
      last_tab: '/basic',
    };
    writeFileSync(SETTINGS_FILE, JSON.stringify(customSettings, null, 2));
    const settings = loadSettings();
    expect(settings.server_exe).toBe('/custom/path/llama-server.exe');
    expect(settings.models_dir).toBe('/custom/models');
    expect(settings.selected_model).toBe('model.gguf');
    expect(settings.theme_mode).toBe('light');
    expect(settings.sidebar_collapsed).toBe(true);
    expect(settings.language).toBe('en');
    expect(settings.last_preset).toBe('default');
  });

  it('loadSettings merges file settings with defaults', () => {
    // 部分字段：其余字段应回退到默认值
    const partialSettings = { theme_mode: 'light', sidebar_collapsed: true };
    writeFileSync(SETTINGS_FILE, JSON.stringify(partialSettings, null, 2));
    const settings = loadSettings();
    const defaults = getDefaultSettings();
    expect(settings.theme_mode).toBe('light');
    expect(settings.sidebar_collapsed).toBe(true);
    // 未提供的字段使用默认值
    expect(settings.server_exe).toBe(defaults.server_exe);
    expect(settings.models_dir).toBe(defaults.models_dir);
    expect(settings.selected_model).toBe('');
  });

  it('loadSettings handles invalid JSON gracefully and returns defaults', () => {
    writeFileSync(SETTINGS_FILE, 'not valid json {{{');
    const settings = loadSettings();
    expect(settings).toEqual(getDefaultSettings());
  });

  it('saveSettings writes settings to file', () => {
    const settings: AppSettings = {
      server_exe: '/custom/exe',
      models_dir: '/models',
      selected_model: 'test.gguf',
      last_preset: 'test-preset',
      window_geometry: '1366x768',
      theme_mode: 'dark',
      sidebar_collapsed: false,
      language: 'zh',
      last_tab: '/launch',
    };
    saveSettings(settings);
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    // 保存时盖章 settings_version，其余字段原样保留
    expect(data.settings_version).toBe(1);
    expect(data.server_exe).toBe('/custom/exe');
    expect(data.models_dir).toBe('/models');
    expect(data.theme_mode).toBe('dark');
    expect(existsSync(SETTINGS_FILE)).toBe(true);
    // 原子写不留 .tmp 残留
    expect(existsSync(`${SETTINGS_FILE}.tmp`)).toBe(false);
  });

  it('saveSettings overwrites existing file', () => {
    const firstSettings: AppSettings = {
      server_exe: '/first/path',
      models_dir: '/first/models',
      selected_model: '',
      last_preset: '',
      window_geometry: '1280x800',
      theme_mode: 'dark',
      sidebar_collapsed: false,
      language: 'zh',
      last_tab: '',
    };
    saveSettings(firstSettings);
    let data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.server_exe).toBe('/first/path');

    const secondSettings: AppSettings = {
      server_exe: '/second/path',
      models_dir: '/second/models',
      selected_model: 'model.gguf',
      last_preset: '',
      window_geometry: '1280x800',
      theme_mode: 'dark',
      sidebar_collapsed: false,
      language: 'zh',
      last_tab: '',
    };
    saveSettings(secondSettings);
    data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.server_exe).toBe('/second/path');
    expect(data.models_dir).toBe('/second/models');
  });

  it('saveSettings does not throw on write failure (catches error)', () => {
    const settings: AppSettings = {
      server_exe: '/path',
      models_dir: '/models',
      selected_model: '',
      last_preset: '',
      window_geometry: '1280x800',
      theme_mode: 'dark',
      sidebar_collapsed: false,
      language: 'zh',
      last_tab: '',
    };
    expect(() => saveSettings(settings)).not.toThrow();
  });

  it('loadSettings backs up corrupt file and returns defaults', () => {
    writeFileSync(SETTINGS_FILE, 'not valid json {{{');
    const settings = loadSettings();
    expect(settings).toEqual(getDefaultSettings());
    // 损坏文件被备份为 .bak，原文件不再存在
    expect(existsSync(`${SETTINGS_FILE}.bak`)).toBe(true);
    expect(existsSync(SETTINGS_FILE)).toBe(false);
  });

  it('loadSettings normalizes invalid field types to safe values', () => {
    writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({
        theme_mode: 'purple',
        language: 'klingon',
        download_max_concurrent: 99,
        sidebar_collapsed: 'true',
        window_maximized: 0,
      }),
    );
    const settings = loadSettings();
    expect(settings.theme_mode).toBe('dark');
    expect(settings.language).toBe('zh');
    expect(settings.download_max_concurrent).toBe(5);
    expect(settings.sidebar_collapsed).toBe(true);
    expect(settings.window_maximized).toBe(false);
  });

  it('loadSettings fills settings_version for legacy files', () => {
    // 旧版文件没有 settings_version 字段
    writeFileSync(SETTINGS_FILE, JSON.stringify({ theme_mode: 'light' }));
    const settings = loadSettings();
    expect(settings.settings_version).toBe(1);
    expect(settings.theme_mode).toBe('light');
  });

  it('loadSettings wires hf_mirror_host to huggingface-client mirror', () => {
    writeFileSync(SETTINGS_FILE, JSON.stringify({ hf_mirror_host: 'mirror.example.com' }));
    const settings = loadSettings();
    expect(settings.hf_mirror_host).toBe('mirror.example.com');
    expect(getHfMirrorHost()).toBe('mirror.example.com');
  });

  it('saveSettings normalizes junk fields before writing', () => {
    saveSettings({
      server_exe: '/x',
      models_dir: '/m',
      selected_model: '',
      last_preset: '',
      window_geometry: '',
      window_maximized: true,
      theme_mode: 'neon',
      sidebar_collapsed: false,
      language: 'xx',
      last_tab: '',
      download_max_concurrent: 42,
    } as any);
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.theme_mode).toBe('dark');
    expect(data.language).toBe('zh');
    expect(data.download_max_concurrent).toBe(5);
    expect(data.settings_version).toBe(1);
  });

  it('saveSettings merges concurrent on-disk updates (CAS merge baseline)', () => {
    // 磁盘已被另一实例/窗口更新(hf_mirror_host、last_tab);
    // 本实例只改 theme_mode,保存后磁盘上其他字段不应丢失(以磁盘为基线合并而非盲写默认值)
    writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ theme_mode: 'light', hf_mirror_host: 'mirror.example.com', last_tab: '/launch' }),
    );
    saveSettings({
      server_exe: '/merged/exe',
      models_dir: '/models',
      theme_mode: 'dark',
      // 不含 hf_mirror_host / last_tab —— 模拟部分更新/旧内存副本
    } as any);
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.theme_mode).toBe('dark'); // 本次修改生效
    expect(data.hf_mirror_host).toBe('mirror.example.com'); // 磁盘已有更新保留
    expect(data.last_tab).toBe('/launch');
    expect(data.server_exe).toBe('/merged/exe');
    expect(data.settings_version).toBe(1);
  });
});
