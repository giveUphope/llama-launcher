// @vitest-environment happy-dom
// Arco 主题切换（DOM 环境）：settings store applyTheme 通过 body[arco-theme] / html[data-theme]
// 驱动 Arco 深浅主题切换（见 theme.scss / markup 规则）。node 环境无 document，故用 happy-dom。
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '@/stores/settings';

describe('Arco 主题切换 (happy-dom 组件环境)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.removeAttribute('arco-theme');
    document.documentElement.removeAttribute('data-theme');
  });

  it('dark 模式设置 body[arco-theme] 与 html[data-theme]', () => {
    const s = useSettingsStore();
    s.themeMode = 'dark';
    s.applyTheme();
    expect(document.body.getAttribute('arco-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('light 模式清空 body[arco-theme]（Arco 浅色不挂 dark 标）', () => {
    const s = useSettingsStore();
    s.themeMode = 'light';
    s.applyTheme();
    expect(document.body.getAttribute('arco-theme')).toBe('');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});