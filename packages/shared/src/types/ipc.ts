export const IPC = {
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',
  MODELS_SCAN: 'models:scan',
  MODELS_DETECT_MMPROJ: 'models:detectMmproj',
  MODELS_DETECT_DRAFT: 'models:detectDraft',
  MODELS_READ_GGUF_META: 'models:readGgufMeta',
  MODELS_REMOVE: 'models:remove',
  MODELS_WATCH: 'models:watch',
  MODELS_CHANGED: 'models:changed',
  PRESETS_LIST: 'presets:list',
  PRESETS_SAVE: 'presets:save',
  PRESETS_DELETE: 'presets:delete',
  PRESETS_LOAD: 'presets:load',
  SERVER_START: 'server:start',
  SERVER_STOP: 'server:stop',
  SERVER_RESTART: 'server:restart',
  SERVER_STATUS: 'server:status',
  SERVER_PREVIEW: 'server:preview',
  SERVER_OUTPUT: 'server:output',
  // 应用日志（区别于服务控制台：记录应用自身生命周期/操作）
  LOGS_LIST: 'logs:list',
  LOGS_CLEAR: 'logs:clear',
  LOGS_ONLOG: 'logs:onlog',
  CLIPBOARD_WRITE: 'clipboard:write',
  OPEN_EXTERNAL: 'open:external',
  OPEN_PATH: 'open:path',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggleMaximize',
  WINDOW_STATE: 'window:state',
  WINDOW_MAXIMIZED: 'window:maximized',
  WINDOW_UNMAXIMIZED: 'window:unmaximized',
  // 关闭窗口询问（应用内弹窗替代原生 dialog）：主进程 → 渲染进程请求 / 渲染进程 → 主进程回复
  WINDOW_SHOW_CLOSE_DIALOG: 'window:showCloseDialog',
  WINDOW_CLOSE_DIALOG_RESULT: 'window:closeDialogResult',
  SYSTEM_CHECK_PORT: 'system:checkPort',
  SYSTEM_FILE_EXISTS: 'system:fileExists',
  SYSTEM_FIND_LLAMA_EXE: 'system:findLlamaExe',
  SYSTEM_DETECT_TRASH: 'system:detectTrash',
  SYSTEM_CLEAN_TRASH: 'system:cleanTrash',
  SYSTEM_KILL_PROCESS: 'system:killProcess',
  SYSTEM_FIND_FREE_PORT: 'system:findFreePort',
  // 显存探测 + 上下文容量估算：主进程 spawn `llama-server --list-devices` + GGUF 元数据 KV 内存模型
  SYSTEM_ESTIMATE_VRAM: 'system:estimateVram',
  // llama-bench 离线体检：对未启动服务的模型文件测 pp512/tg128（run 启动作业，status 轮询状态）
  SYSTEM_BENCH_LLAMA_RUN: 'system:benchLlamaRun',
  SYSTEM_BENCH_LLAMA_STATUS: 'system:benchLlamaStatus',
  // 模型列表批量显存适配判定（fit/partial/no 徽章）
  SYSTEM_ESTIMATE_MODEL_FIT: 'system:estimateModelFit',
  FS_LIST_DIR: 'fs:listDir',
  FS_MKDIR: 'fs:mkdir',
  DOWNLOAD_PARSE_URL: 'download:parseUrl',
  DOWNLOAD_SEARCH: 'download:search',
  DOWNLOAD_LIST_FILES: 'download:listFiles',
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_COMPLETE: 'download:complete',
  DOWNLOAD_ERROR: 'download:error',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// 关闭窗口应用内弹窗的请求/回复载荷（主进程 app-exit.ts ↔ 渲染进程 CloseDialog.vue）。
// mode: ask = close_behavior=ask 的首次询问；exit-confirm = 模型服务运行中退出二次确认。
// action: exit = 退出应用；tray = 最小化到托盘；cancel = 取消（ask 模式按托盘处理，与
// 原原生弹窗关闭行为一致）。remember 仅 ask 模式有意义：勾选后把选择写入 close_behavior。
export interface CloseDialogRequest {
  id: number;
  mode: 'ask' | 'exit-confirm';
}

export interface CloseDialogResult {
  id: number;
  action: 'exit' | 'tray' | 'cancel';
  remember: boolean;
}
