// 功能注册表类型（注册表化重构：各功能以声明式条目接入，未来插件可扩展）。
import type { RouteRecordRaw } from 'vue-router';

/** 侧栏导航项（由功能模块声明，注册表按 order 排序渲染）。 */
export interface NavItem {
  icon: string;
  labelKey: string;
  to: string;
  order: number;
  /** 可选红点提示（如参数有调整时）；在渲染上下文中求值以保持响应式。 */
  dot?: () => boolean;
}

/** 应用内功能条目：侧栏导航 + 路由。 */
export interface FeatureDef {
  id: string;
  nav?: NavItem;
  routes: RouteRecordRaw[];
  /** 置 false 可停用该功能（注册表化开关）。 */
  enabled?: boolean;
}
