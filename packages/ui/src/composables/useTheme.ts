import { useSettingsStore } from '@/stores/settings';

export function useTheme() {
  const store = useSettingsStore();
  return {
    mode: store.themeMode,
    toggle: store.toggleTheme,
  };
}
