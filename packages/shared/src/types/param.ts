export type ParamType =
  | 'text'
  | 'int_slider'
  | 'int_entry'
  | 'float_slider'
  | 'dropdown'
  | 'checkbox'
  | 'file'
  | 'dir';

export type ParamGroupKey = 'basic' | 'advanced' | 'server';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * 参数依赖关系定义。
 * 表示该参数仅在依赖参数满足条件时才有效。
 * - key: 依赖的参数 key
 * - values: 依赖参数应满足的值集合（任一匹配即满足）；若为空数组则表示仅要求依赖参数被启用
 */
export interface ParamDependsOn {
  key: string;
  /** 依赖参数应满足的值；空数组表示仅要求依赖参数被启用 */
  values?: string[];
  /** 依赖参数不应为的值（排除条件） */
  notValues?: string[];
}

export interface ParamDef {
  key: string;
  group: ParamGroupKey;
  type: ParamType;
  flag: string; // CLI flag e.g. '--port' or '-c'
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  labels?: string[]; // optional display labels for dropdown options
  editable?: boolean; // for dropdown: allow free input
  filetypes?: FileFilter[];
  save_as?: boolean; // for file: use save dialog
  invert_flag?: string; // for checkbox: flag to use when value is false
  /** 子分组分类 key（用于参数页内折叠分组），i18n 标签通过 subcat_<key> 查找 */
  subcategory?: string;
  /** 参数依赖关系：该参数仅在依赖满足时才有效 */
  dependsOn?: ParamDependsOn;
  /** 关联的 GGUF 元数据字段名（用于内联提示） */
  ggufField?: keyof import('./gguf.js').GgufModelInfo;
  /**
   * 值等于引擎缺省时**也**发射。发射规则默认「等于引擎缺省就不发」，而启动器要拿端口去
   * 探活与拼 URL——不显式发出去，实际监听端口就由引擎版本决定（b11524 起 `--port` 缺省
   * 从 8080 改 9931，老引擎上「界面说的端口」与「服务起的端口」就会分家）。
   * 只给这类「启动器自己要用」的参数，别拿它当默认值逃生舱。
   */
  alwaysEmit?: boolean;
  // i18n: label and help come from i18n dictionaries via param_label(key)/param_help(key)
}

export interface ParamGroup {
  key: ParamGroupKey;
  labelKey: string; // i18n key e.g. 'param_basic'
}
