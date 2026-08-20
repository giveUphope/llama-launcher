// 模型管理功能条目。
import type { FeatureDef } from './types.js';

export const modelsFeature: FeatureDef = {
  id: 'models',
  nav: { icon: 'models', labelKey: 'nav_models', to: '/models', order: 1 },
  routes: [{ path: '/models', name: 'models', component: () => import('@/pages/ModelsPage.vue') }],
};
