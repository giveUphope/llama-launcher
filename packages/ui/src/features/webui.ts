// Web UI 功能条目（实际渲染由布局层 WebUiFrame 承担，本页为路由占位）。
import type { FeatureDef } from './types.js';

export const webuiFeature: FeatureDef = {
  id: 'webui',
  nav: { icon: 'globe', labelKey: 'nav_webui', to: '/webui', order: 5 },
  routes: [{ path: '/webui', name: 'webui', component: () => import('@/pages/WebUiPage.vue') }],
};
