// 参数设置功能条目（含旧路由重定向）。
import type { FeatureDef } from './types.js';
import { useParamsStore } from '@/stores/params';

export const paramsFeature: FeatureDef = {
  id: 'params',
  nav: {
    icon: 'params',
    labelKey: 'nav_params',
    to: '/params',
    order: 3,
    // 子标签：参数预设 / 自定义参数 / 性能测试（原 ParamsPage 页内 mini-nav，重构入侧边栏；
    // 性能测试自服务页迁入——调参与测试强相关，测试组件跟随参数设置）
    children: [
      { icon: 'presets', labelKey: 'nav_params_presets', tab: 'presets' },
      {
        icon: 'params',
        labelKey: 'nav_params_custom',
        tab: 'custom',
        default: true,
        // 自定义参数有未保存改动时红点提示（原 mini-nav 橙色小点）
        dot: () => useParamsStore().hasChanges,
      },
      { icon: 'clock', labelKey: 'nav_params_bench', tab: 'bench' },
    ],
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
