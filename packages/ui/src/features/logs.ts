// 日志中心功能条目：当前占位（阶段三实现虚拟滚动 + 筛选）。
import type { FeatureDef } from './types.js';

export const logsFeature: FeatureDef = {
  id: 'logs',
  nav: { icon: 'console', labelKey: 'nav_logs', to: '/logs', order: 4 },
  routes: [{ path: '/logs', name: 'logs', component: () => import('@/pages/LogsPage.vue') }],
};
