// 控制台功能条目。
import type { FeatureDef } from './types.js';

export const launchFeature: FeatureDef = {
  id: 'launch',
  nav: { icon: 'console', labelKey: 'nav_launch', to: '/launch', order: 3 },
  routes: [{ path: '/launch', name: 'launch', component: () => import('@/pages/LaunchPage.vue') }],
};
