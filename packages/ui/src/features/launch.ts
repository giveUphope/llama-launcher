// 控制台功能条目。阶段四：旧路由 /launch 重定向到 /service（命令预览/参数摘要/控制台已合并到 ServicePage）。
import type { FeatureDef } from './types.js';

export const launchFeature: FeatureDef = {
  id: 'launch',
  nav: { icon: 'console', labelKey: 'nav_launch', to: '/launch', order: 3 },
  routes: [
    {
      path: '/launch',
      name: 'launch',
      redirect: { path: '/service' },
    },
  ],
};
