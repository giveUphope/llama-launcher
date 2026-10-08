// @vitest-environment happy-dom
/**
 * 设置 store：值同步更新、持久化防抖合并、窗口关闭前的 flushSave、主题解析（含 system 跟随）。
 * 守的判据：
 *  - 防抖窗口内的多次 save 合并为一次 IPC（路径输入/主题/语言高频变更，每次击键都同步落盘会卡顿）；
 *  - flushSave 取消挂起定时器并立即落盘（防抖窗口内的变更不能在关窗时丢）；
 *  - applyTheme 的双通道写法：html[data-theme] 与 body[arco-theme] 必须同时设置
 *    （frontend.md §7.5：Arco 主题切换两处都要验证）；
 *  - system 模式跟随 matchMedia 的 prefers-color-scheme。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { AppSettings } from '@llama-launcher/shared';
import { useSettingsStore } from './settings';

// ---- window.api.settings 桩 ----
let loadResult: AppSettings | null = null;
const savedPayloads: AppSettings[] = [];

(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).window.api = {
  settings: {
    load: vi.fn(async () => loadResult),
    save: vi.fn(async (s: AppSettings) => {
      savedPayloads.push(s);
    }),
  },
};

function baseSettings(): AppSettings {
  return {
    server_exe: 'D:/llama/llama-server.exe',
    llama_dir: '',
    models_dir: 'D:/models',
    selected_model: '',
    window_geometry: '1280x800',
    window_maximized: false,
    theme_mode: 'dark',
    sidebar_collapsed: false,
    language: 'zh',
    last_tab: '',
    close_behavior: 'ask',
    download_max_concurrent: 3,
    custom_args: '',
  };
}

/** 当前 DOM 上的主题双通道取值 */
function domTheme(): { html: string | null; body: string | null } {
  return {
    html: document.documentElement.getAttribute('data-theme'),
    body: document.body?.getAttribute('arco-theme') ?? null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  loadResult = baseSettings();
  savedPayloads.length = 0;
  document.documentElement.removeAttribute('data-theme');
  document.body?.removeAttribute('arco-theme');
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settings store - load', () => {
  it('读到设置：三个响应式位就位，并把主题写到 DOM 双通道', async () => {
    const store = useSettingsStore();
    await store.load();
    expect(store.settings?.server_exe).toBe('D:/llama/llama-server.exe');
    expect(store.themeMode).toBe('dark');
    expect(store.language).toBe('zh');
    expect(domTheme()).toEqual({ html: 'dark', body: 'dark' });
  });

  it('load 返回 null（浏览器 mock 环境）→ 保持 null，不动 DOM', async () => {
    loadResult = null;
    const store = useSettingsStore();
    await store.load();
    expect(store.settings).toBeNull();
    expect(domTheme()).toEqual({ html: null, body: null });
  });
});

describe('settings store - 保存防抖', () => {
  it('防抖窗口内多次 save 合并为一次落盘，且带最后时刻的完整值', async () => {
    const store = useSettingsStore();
    await store.load();
    store.themeMode = 'light';
    store.save();
    store.themeMode = 'dark';
    store.language = 'en';
    store.save();
    store.save();
    expect(savedPayloads, '防抖窗口内不得提前落盘').toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    expect(savedPayloads).toHaveLength(1);
    expect(savedPayloads[0].theme_mode).toBe('dark');
    expect(savedPayloads[0].language).toBe('en');
  });

  it('save 把当前主题/语言快照进 settings（防抖期间值已同步，仅持久化延迟）', async () => {
    const store = useSettingsStore();
    await store.load();
    store.themeMode = 'light';
    store.language = 'en';
    store.save();
    // 值立即可见（不等落盘）
    expect(store.settings?.theme_mode).toBe('light');
    expect(store.settings?.language).toBe('en');
    await vi.advanceTimersByTimeAsync(250);
  });

  it('flushSave 立即落盘挂起的保存，不等防抖窗口', async () => {
    const store = useSettingsStore();
    await store.load();
    store.language = 'en';
    store.save();
    store.flushSave();
    expect(savedPayloads).toHaveLength(1);
    expect(savedPayloads[0].language).toBe('en');
    // 挂起定时器已取消：时间推进不再重复落盘
    await vi.advanceTimersByTimeAsync(500);
    expect(savedPayloads).toHaveLength(1);
  });

  it('无设置对象时 save/flushSave 是安全空操作', async () => {
    const store = useSettingsStore();
    store.save();
    store.flushSave();
    await vi.advanceTimersByTimeAsync(500);
    expect(savedPayloads).toHaveLength(0);
  });
});

describe('settings store - 主题与语言切换', () => {
  it('toggleTheme 在 light/dark 间翻转，DOM 与持久化同步', async () => {
    const store = useSettingsStore();
    await store.load();
    store.toggleTheme();
    expect(store.themeMode).toBe('light');
    expect(domTheme()).toEqual({ html: 'light', body: '' }); // light 态 arco-theme 为空串（非 dark 即清空）
    await vi.advanceTimersByTimeAsync(250);
    expect(savedPayloads[0]?.theme_mode).toBe('light');

    store.toggleTheme();
    expect(store.themeMode).toBe('dark');
    expect(domTheme()).toEqual({ html: 'dark', body: 'dark' });
  });

  it('toggleLanguage 在 zh/en 间翻转并进入持久化值', async () => {
    const store = useSettingsStore();
    await store.load();
    store.toggleLanguage();
    expect(store.language).toBe('en');
    await vi.advanceTimersByTimeAsync(250);
    expect(savedPayloads[0]?.language).toBe('en');
  });

  it('themeMode=system 跟随 matchMedia 的 prefers-color-scheme 解析', async () => {
    // 桩掉 matchMedia：返回可控的 matches 与可捕获的 change 监听
    let prefersDark = true;
    let changeCb: (() => void) | null = null;
    (globalThis as any).window.matchMedia = (query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      addEventListener: (_: string, cb: () => void) => {
        if (query.includes('dark')) changeCb = cb;
      },
    });
    const store = useSettingsStore();
    await store.load();
    store.themeMode = 'system';
    store.applyTheme();
    expect(domTheme().html, '系统偏好深色 → 解析为 dark').toBe('dark');
    // body 上 dark 用显式值，light 用空串——只断言「dark 态为显式 dark」
    expect(domTheme().body).toBe('dark');

    // OS 切到浅色：注册过的 change 监听要能重算（且只注册一次）
    prefersDark = false;
    changeCb!();
    expect(domTheme().html).toBe('light');
  });
});
