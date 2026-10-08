// 参数设置功能条目（含旧路由重定向）。
// 单页直出（2026-10-08 起无页内页签——参数预设页签随每模型自动持久化移除）；
// 2026-09 移除侧栏子树展开——次级页面统一回归单页。
import type { FeatureDef } from './types.js';
import { useParamsStore } from '@/stores/params';

export const paramsFeature: FeatureDef = {
  id: 'params',
  nav: {
    icon: 'params',
    labelKey: 'nav_params',
    to: '/params',
    order: 3,
    // 当前模型存在与出厂默认不同的参数时橙点提示（每模型自动持久化：即「该模型有自定义参数」）
    dot: () => useParamsStore().hasChanges,
  },
  routes: [
    { path: '/params', name: 'params', component: () => import('@/pages/ParamsPage.vue') },
    // 旧路由重定向到合并后的参数设置页（保持旧书签/快捷键可用）
    { path: '/basic', redirect: { path: '/params' } },
    { path: '/advanced', redirect: { path: '/params' } },
    { path: '/server', redirect: { path: '/params' } },
    { path: '/sampling', redirect: { path: '/params' } },
    { path: '/presets', redirect: { path: '/params' } },
  ],
};
