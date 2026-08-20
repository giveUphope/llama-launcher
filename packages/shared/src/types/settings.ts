export type ThemeMode = 'dark' | 'light';
export type Language = 'zh' | 'en';
/** 视觉效果模式：glass = 毛玻璃/果冻/彩虹点缀；off = 实底无动效（回退开关） */
export type FxMode = 'glass' | 'off';
/** 关闭窗口时的退出行为：ask = 首次询问并可选记住；exit = 直接退出；tray = 最小化到托盘保活 */
export type CloseBehavior = 'ask' | 'exit' | 'tray';

export interface AppSettings {
  /**
   * 设置文件 schema 版本（可选：旧文件无此字段，loadSettings 时补齐为当前版本）。
   * 新增字段/调整语义时递增，由 settings-store 的 migrate 逻辑处理旧版本迁移。
   */
  settings_version?: number;
  server_exe: string;
  /** llama.cpp 引擎目录(用户选择的包含 llama-server 的目录,server_exe 从此目录内联检测) */
  llama_dir: string;
  models_dir: string;
  selected_model: string;
  last_preset: string;
  window_geometry: string;
  /** 窗口是否以最大化状态启动/恢复;默认 true,使应用开箱即最大化 */
  window_maximized: boolean;
  theme_mode: ThemeMode;
  /** 视觉效果（毛玻璃/果冻/彩虹点缀）；off 为纯实底回退，见 docs/frontend.md §7.5 */
  fx_mode: FxMode;
  /** 关闭窗口时的退出行为（ask 首次询问 / exit 直接退出 / tray 最小化到托盘） */
  close_behavior: CloseBehavior;
  sidebar_collapsed: boolean;
  language: Language;
  /** 上次查看的页签路径,用于恢复导航状态 */
  last_tab: string;
  /** 最大并发下载任务数(1-5) */
  download_max_concurrent: number;
  /** HuggingFace 镜像源 host（空字符串 = 默认 hf-mirror.com；如自建镜像/内网缓存） */
  hf_mirror_host?: string;
}
