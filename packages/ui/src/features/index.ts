// 功能注册表：应用内各功能（侧栏导航 + 路由）的声明式装配点。
// 注册表化重构：路由与侧栏不再硬编码，而是由各功能模块声明、此处汇总；
// 未来插件可向 features 数组追加条目（enabled 置 false 可停用功能）。
// 侧栏导航为 7 项（概览/模型/服务/参数/日志/内置 Web UI/设置），
// 旧页（控制台/下载）保留路由但隐藏侧栏导航，作为其他页面的子功能。
import type { RouteRecordRaw } from 'vue-router';
import type { FeatureDef, NavItem } from './types.js';
import { dashboardFeature } from './dashboard.js';
import { modelsFeature } from './models.js';
import { downloadFeature } from './download.js';
import { paramsFeature } from './params.js';
import { launchFeature } from './launch.js';
import { settingsFeature } from './settings.js';
import { webuiFeature } from './webui.js';
import { serviceFeature } from './service.js';
import { logsFeature } from './logs.js';

export type { FeatureDef, NavItem } from './types.js';

/** 应用内功能清单（按声明顺序；order 决定侧栏排序）。 */
export const features: FeatureDef[] = [
  dashboardFeature,  // 概览 (order 0)
  modelsFeature,     // 模型 (order 1)
  serviceFeature,    // 服务 (order 2)
  paramsFeature,     // 参数 (order 3)
  logsFeature,       // 日志 (order 4)
  webuiFeature,      // 内置 Web UI (order 5) — 侧栏一级项，内嵌帧由布局层 WebUiFrame 承担
  settingsFeature,   // 设置 (order 6)
  // 以下功能保留路由但隐藏侧栏导航，作为其他页面的子功能或入口
  downloadFeature,   // 下载 → 模型页的子标签页
  launchFeature,     // 控制台 → 服务页已整合控制台
];

// 隐藏侧栏但保留路由：将 nav 置为 undefined
const hiddenNavFeatures = ['download', 'launch'];
for (const f of features) {
  if (hiddenNavFeatures.includes(f.id)) {
    f.nav = undefined as any;
  }
}

/** 启用的功能（enabled: false 可停用，注册表化开关）。 */
export const activeFeatures = features.filter((f) => f.enabled !== false);

/** 侧栏导航项（按 order 排序，供 Sidebar 渲染）。 */
export const navItems: NavItem[] = activeFeatures
  .filter((f) => f.nav)
  .sort((a, b) => a.nav!.order - b.nav!.order)
  .map((f) => f.nav!);

/** 全部路由（含根重定向），由注册表装配，供 router 使用。 */
export const featureRoutes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  ...activeFeatures.flatMap((f) => f.routes),
];
