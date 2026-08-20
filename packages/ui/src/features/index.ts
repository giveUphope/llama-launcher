// 功能注册表：应用内各功能（侧栏导航 + 路由）的声明式装配点。
// 注册表化重构：路由与侧栏不再硬编码，而是由各功能模块声明、此处汇总；
// 未来插件可向 features 数组追加条目（enabled 置 false 可停用功能）。
import type { RouteRecordRaw } from 'vue-router';
import type { FeatureDef, NavItem } from './types.js';
import { modelsFeature } from './models.js';
import { downloadFeature } from './download.js';
import { paramsFeature } from './params.js';
import { launchFeature } from './launch.js';
import { settingsFeature } from './settings.js';
import { webuiFeature } from './webui.js';

export type { FeatureDef, NavItem } from './types.js';

/** 应用内功能清单（按声明顺序；order 决定侧栏排序）。 */
export const features: FeatureDef[] = [
  modelsFeature,
  downloadFeature,
  paramsFeature,
  launchFeature,
  settingsFeature,
  webuiFeature,
];

/** 启用的功能（enabled: false 可停用，注册表化开关）。 */
export const activeFeatures = features.filter((f) => f.enabled !== false);

/** 侧栏导航项（按 order 排序，供 Sidebar 渲染）。 */
export const navItems: NavItem[] = activeFeatures
  .filter((f) => f.nav)
  .sort((a, b) => a.nav!.order - b.nav!.order)
  .map((f) => f.nav!);

/** 全部路由（含根重定向），由注册表装配，供 router 使用。 */
export const featureRoutes: RouteRecordRaw[] = [
  { path: '/', redirect: '/models' },
  ...activeFeatures.flatMap((f) => f.routes),
];
