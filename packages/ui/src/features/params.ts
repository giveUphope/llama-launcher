// 参数设置功能条目（含旧路由重定向）。
// 单页 + 页内 tab-strip 切换（参数预设 / 自定义参数 / 性能测试，与设置页同一体例）；
// 2026-09 移除侧栏子树展开——次级页面统一回归页内切换。
import type { FeatureDef } from './types.js';
import { useParamsStore } from '@/stores/params';

export const paramsFeature: FeatureDef = {
  id: 'params',
  nav: {
    icon: 'params',
    labelKey: 'nav_params',
    to: '/params',
    order: 3,
    // 自定义参数有未保存改动时橙点提示
    dot: () => useParamsStore().hasChanges,
  },
  routes: [
    { path: '/params', name: 'params', component: () => import('@/pages/ParamsPage.vue') },
    // 旧路由重定向到合并后的参数设置页（保持旧书签/快捷键可用）
    { path: '/basic', redirect: { path: '/params' } },
    { path: '/advanced', redirect: { path: '/params' } },
    { path: '/server', redirect: { path: '/params' } },
    { path: '/sampling', redirect: { path: '/params' } },
    { path: '/presets', redirect: { path: '/params', query: { tab: 'presets' } } },
  ],
};
