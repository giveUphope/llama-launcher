/** 主题模式：dark / light / system（跟随操作系统主题偏好） */
export type ThemeMode = 'dark' | 'light' | 'system';
export type Language = 'zh' | 'en';
/** 关闭窗口时的退出行为：ask = 首次询问并可选记住；exit = 直接退出；tray = 最小化到托盘保活 */
export type CloseBehavior = 'ask' | 'exit' | 'tray';
import type { PresetValues } from './preset.js';

/** 参数会话基线：当前会话加载的预设（名称 + 应用时刻的完整参数快照）；null = 无预设基线（出厂默认） */
export interface SessionBaseline {
  preset_name: string;
  values: PresetValues;
}

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
  /**
   * 扩展参数（用户自定义命令行参数）：原样追加到 llama-server 启动命令末尾，
   * 持久化于 settings.json。与「内置参数命令」（由参数表自动生成）完全分离，
   * 命令预览的「还原」只重置内置命令，不影响此处。空 = 无扩展参数。
   */
  custom_args: string;
  /**
   * 参数会话（临时轨道）：当前生效的全部参数值快照，随参数变化节流写入。
   * 仅供重启恢复会话使用，**永不写入预设文件**（预设文件只由显式保存写入）。
   * 空/缺失 = 无会话，启动走 selected_model + last_preset 预设应用链。
   */
  session_values?: PresetValues | null;
  /** 参数会话基线：会话加载的预设（名称 + 应用时刻快照）；null = 无预设基线（出厂默认） */
  session_baseline?: SessionBaseline | null;
}
