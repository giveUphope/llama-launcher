// 模型下载功能条目。
import type { FeatureDef } from './types.js';

export const downloadFeature: FeatureDef = {
  id: 'download',
  nav: { icon: 'download', labelKey: 'nav_download', to: '/download', order: 4 },
  routes: [
    {
      path: '/download',
      name: 'download',
      redirect: { path: '/models', query: { tab: 'downloads' } },
    },
  ],
};
