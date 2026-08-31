// 概览功能条目：应用默认入口，一眼展示运行状态与快速操作。
import type { FeatureDef } from './types.js';

export const dashboardFeature: FeatureDef = {
  id: 'dashboard',
  nav: { icon: 'dashboard', labelKey: 'nav_overview', to: '/dashboard', order: 0 },
  routes: [{ path: '/dashboard', name: 'dashboard', component: () => import('@/pages/DashboardPage.vue') }],
};
