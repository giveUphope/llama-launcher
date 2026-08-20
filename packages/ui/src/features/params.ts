// 参数设置功能条目（含旧路由重定向）。
import type { FeatureDef } from './types.js';

export const paramsFeature: FeatureDef = {
  id: 'params',
  nav: {
    icon: 'params',
    labelKey: 'nav_params',
    to: '/params',
    order: 2,
    // 参数设置入口不再显示"已调整"小黄点（2026-08 按需移除）
  },
  routes: [
    { path: '/params', name: 'params', component: () => import('@/pages/ParamsPage.vue') },
    // 旧路由重定向到合并后的参数设置页（保持旧书签/快捷键可用）
    { path: '/basic', redirect: { path: '/params', query: { tab: 'basic' } } },
    { path: '/advanced', redirect: { path: '/params', query: { tab: 'advanced' } } },
    { path: '/server', redirect: { path: '/params', query: { tab: 'server' } } },
    { path: '/sampling', redirect: { path: '/params', query: { tab: 'basic' } } },
    { path: '/presets', redirect: { path: '/params', query: { tab: 'presets' } } },
  ],
};
