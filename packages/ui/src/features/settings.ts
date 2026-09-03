// 应用设置功能条目。
import type { FeatureDef } from './types.js';

export const settingsFeature: FeatureDef = {
  id: 'settings',
  nav: { icon: 'settings', labelKey: 'nav_settings', to: '/settings', order: 6 },
  routes: [{ path: '/settings', name: 'settings', component: () => import('@/pages/SettingsPage.vue') }],
};
