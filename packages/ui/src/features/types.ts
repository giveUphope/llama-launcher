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
  /** 一级项下的子标签（同一页面内按 query 切换，如参数页的「参数预设/自定义参数」）。
   *  子标签不产生独立路由；side 栏主项可展开/收起子树，点击子项以 query.tab 切换页内内容。 */
  children?: Array<{
    icon: string;
    labelKey: string;
    /** 点击子项时写入路由的 query.tab 值；页面读取该值决定渲染内容。 */
    tab: string;
    /** 页面未带 tab query 时的默认高亮子项（如 /params 无 query → 高亮 custom）。 */
  default?: boolean;
    /** 可选红点提示（子标签内容存在未保存调整时，如自定义参数有改动）。 */
  dot?: () => boolean;
  }>;
}

/** 应用内功能条目：侧栏导航 + 路由。 */
export interface FeatureDef {
  id: string;
  nav?: NavItem;
  routes: RouteRecordRaw[];
  /** 置 false 可停用该功能（注册表化开关）。 */
  enabled?: boolean;
}
