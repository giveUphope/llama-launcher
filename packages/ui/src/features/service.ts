// 服务功能条目：运行状态 + 控制台。
import type { FeatureDef } from './types.js';

export const serviceFeature: FeatureDef = {
  id: 'service',
  nav: { icon: 'server', labelKey: 'nav_service', to: '/service', order: 2 },
  routes: [{ path: '/service', name: 'service', component: () => import('@/pages/ServicePage.vue') }],
};
