import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings, ThemeMode, Language, FxMode } from '@llama-launcher/shared';
import { toPlain } from '@/composables/useIPC';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null);
  const themeMode = ref<ThemeMode>('dark');
  const language = ref<Language>('zh');
  const fxMode = ref<FxMode>('glass');

  async function load() {
    const s = await window.api.settings.load();
    if (!s) return; // 浏览器预览 mock 返回 null,跳过初始化
    settings.value = s;
    themeMode.value = s.theme_mode;
    language.value = s.language;
    fxMode.value = s.fx_mode ?? 'glass';
    applyTheme();
    applyFx();
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
    settings.value.fx_mode = fxMode.value;
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

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', themeMode.value);
  }

  function applyFx() {
    document.documentElement.setAttribute('data-fx', fxMode.value);
  }

  /** 切换视觉效果（glass/off）；off 即纯实底回退开关 */
  function setFx(mode: FxMode) {
    fxMode.value = mode;
    applyFx();
    void save();
  }

  return { settings, themeMode, language, fxMode, load, save, flushSave, toggleTheme, toggleLanguage, applyTheme, applyFx, setFx };
});
