import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings, ThemeMode, Language } from '@llama-launcher/shared';
import { toPlain } from '@/composables/useIPC';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null);
  const themeMode = ref<ThemeMode>('dark');
  const language = ref<Language>('zh');

  async function load() {
    const s = await window.api.settings.load();
    if (!s) return; // 浏览器预览 mock 返回 null,跳过初始化
    settings.value = s;
    themeMode.value = s.theme_mode;
    language.value = s.language;
    applyTheme();
  }

  // 保存防抖：路径输入/主题/语言等高频变更合并为一次 IPC + 落盘，
  // 避免每次击键触发主进程同步文件 I/O（CAS 合并 + 原子写）造成卡顿。
  // 值本身同步更新（仅持久化延迟），最后触发的保存序列化完整 settings，合并无损。
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const SAVE_DEBOUNCE_MS = 200;

  async function persist() {
    if (!settings.value) return;
    await window.api.settings.save(toPlain(settings.value));
  }

  function save() {
    if (!settings.value) return;
    settings.value.theme_mode = themeMode.value;
    settings.value.language = language.value;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist();
    }, SAVE_DEBOUNCE_MS);
  }

  /** 立即持久化挂起的保存（窗口关闭/页面卸载前调用，避免防抖窗口内的变更丢失）。 */
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void persist();
  }

  function toggleTheme() {
    themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark';
    applyTheme();
    void save();
  }

  function toggleLanguage() {
    language.value = language.value === 'zh' ? 'en' : 'zh';
    void save();
  }

  // system 主题：注册系统主题变化监听，跟随 OS 实时切换（仅注册一次）
  let systemThemeQuery: MediaQueryList | null = null;
  function ensureSystemThemeWatcher() {
    if (!window.matchMedia || systemThemeQuery) return;
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeQuery.addEventListener('change', () => {
      if (themeMode.value === 'system') applyTheme();
    });
  }

  function applyTheme() {
    // system：跟随操作系统主题偏好（Electron 渲染进程支持 prefers-color-scheme）
    const resolved: ThemeMode =
      themeMode.value === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : themeMode.value;
    document.documentElement.setAttribute('data-theme', resolved);
    ensureSystemThemeWatcher();
  }

  return { settings, themeMode, language, load, save, flushSave, toggleTheme, toggleLanguage, applyTheme };
});
