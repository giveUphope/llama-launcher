// 模型下载功能条目。
// 下载任务页签已移除（模型库 DownloadCard 内置任务区）；保留 /download 旧路由
// 并指向模型库 tab，让旧书签仍能落到下载功能所在页面。
import type { FeatureDef } from './types.js';

export const downloadFeature: FeatureDef = {
  id: 'download',
  nav: { icon: 'download', labelKey: 'nav_download', to: '/download', order: 4 },
  routes: [
    {
      path: '/download',
      name: 'download',
      redirect: { path: '/models', query: { tab: 'library' } },
    },
  ],
};
