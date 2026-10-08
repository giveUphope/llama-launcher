import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AppSettings } from '@llama-launcher/shared';

// 与 settings-store.test.ts 同形的路径重定向：SETTINGS_FILE 指向临时文件，
// 保留 DEFAULT_SERVER_EXE / DEFAULT_MODELS_DIR 真实值。文件名额外加随机后缀，
// 避免与并行的 settings-store.test.ts 在同一 worker 内撞名（process.pid 相同）。
vi.mock('../src/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/paths.js')>();
  const os = await import('node:os');
  const path = await import('node:path');
  return {
    ...actual,
    SETTINGS_FILE: path.join(
      os.tmpdir(),
      `llama-test-settings-edge-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    ),
  };
});

import { loadSettings, saveSettings, saveSettingsAsync, getDefaultSettings } from '../src/settings-store.js';
import { SETTINGS_FILE } from '../src/paths.js';

describe('settings-store - schema 剥离与副本隔离（settings-store.test.ts 未覆盖的分支）', () => {
  afterEach(() => {
    for (const suffix of ['', '.bak', '.tmp']) {
      const p = `${SETTINGS_FILE}${suffix}`;
      if (existsSync(p)) rmSync(p);
    }
  });

  it('旧版双轨字段残留（session_values/session_baseline/last_preset*）加载时被剥除', () => {
    writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({
        theme_mode: 'dark',
        // 2026-10-08 移除的双轨机制三件套 + 更早的 last_preset 家族
        session_values: { ctx_size: 4096 },
        session_baseline: { ctx_size: 2048 },
        last_preset: 'my-preset',
        last_preset_id: 'abc-123',
      }),
    );
    const settings = loadSettings();
    expect(settings.theme_mode).toBe('dark'); // 有效字段保留
    expect('session_values' in settings).toBe(false);
    expect('session_baseline' in settings).toBe(false);
    expect('last_preset' in settings).toBe(false);
    expect('last_preset_id' in settings).toBe(false);
  });

  it('saveSettings 落盘内容不含已废除的双轨字段（磁盘残留不会无限回响）', () => {
    writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ theme_mode: 'light', session_values: { x: 1 }, last_preset: 'legacy' }),
    );
    saveSettings({ theme_mode: 'dark' } as AppSettings);
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.theme_mode).toBe('dark');
    expect('session_values' in data).toBe(false);
    expect('last_preset' in data).toBe(false);
  });

  it('loadSettings 返回的是副本：调用方就地改写字段不会污染记忆化缓存', () => {
    // window.ts 会就地写回窗口几何——若返回缓存对象本身，第二次 load 会读到被改过的值
    writeFileSync(SETTINGS_FILE, JSON.stringify({ theme_mode: 'light' }));
    const grabbed = loadSettings();
    grabbed.theme_mode = 'dark';
    grabbed.models_dir = 'C:/mutated';

    const fresh = loadSettings();
    expect(fresh.theme_mode).toBe('light');
    expect(fresh.models_dir).toBe(getDefaultSettings().models_dir);
  });

  it('根为数组的 JSON（[]）按无效形状处理：备份为 .bak 并回退默认值', () => {
    writeFileSync(SETTINGS_FILE, '[]');
    const settings = loadSettings();
    expect(settings).toEqual(getDefaultSettings());
    expect(existsSync(`${SETTINGS_FILE}.bak`)).toBe(true);
    expect(existsSync(SETTINGS_FILE)).toBe(false);
  });

  it('数值字段容错：字符串数字可解析、小数向下取整、越界夹回范围', () => {
    writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({
        download_max_concurrent: '3',
      }),
    );
    expect(loadSettings().download_max_concurrent).toBe(3);

    writeFileSync(SETTINGS_FILE, JSON.stringify({ download_max_concurrent: 2.9 }));
    expect(loadSettings().download_max_concurrent).toBe(2);

    writeFileSync(SETTINGS_FILE, JSON.stringify({ download_max_concurrent: -7 }));
    expect(loadSettings().download_max_concurrent).toBe(1);
  });
});

describe('settings-store - saveSettingsAsync（异步原子写与串行化）', () => {
  afterEach(() => {
    for (const suffix of ['', '.bak', '.tmp']) {
      const p = `${SETTINGS_FILE}${suffix}`;
      if (existsSync(p)) rmSync(p);
    }
  });

  it('异步写盘生效且不留 .tmp 残留；连续两次写按提交顺序落定', async () => {
    // 两个写共用同一个 <file>.tmp，若不串行化，先完成的 rename 会搬走后一个的半成品
    await saveSettingsAsync({ theme_mode: 'dark' } as AppSettings);
    await saveSettingsAsync({ theme_mode: 'light', last_tab: '/service' } as AppSettings);

    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.theme_mode).toBe('light'); // 后提交者胜出
    expect(data.last_tab).toBe('/service');
    expect(data.settings_version).toBe(1);
    expect(existsSync(`${SETTINGS_FILE}.tmp`)).toBe(false);
  });

  it('异步写合并磁盘基线：本进程未见过的字段（另一实例写入）不丢', async () => {
    writeFileSync(SETTINGS_FILE, JSON.stringify({ hf_mirror_host: 'mirror.example.com' }));
    await saveSettingsAsync({ theme_mode: 'dark' } as AppSettings);
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    expect(data.hf_mirror_host).toBe('mirror.example.com');
    expect(data.theme_mode).toBe('dark');
  });
});
