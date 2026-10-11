/// <reference types="vite/client" />
import type {
  AppSettings, ModelInfo, OutputEntry, PresetValues, ModelParams,
  ServerInfo, ServerStatusEvent, GgufReadResult,
  ParsedModelUrl, ModelScopeSearchResult, ModelScopeFileListResult,
  StartDownloadRequest, DownloadTask, DownloadProgressPayload, DownloadCompletePayload, DownloadErrorPayload,
  DownloadSource,
  TrashItem, DetectResult, CleanResult,
  CloseDialogRequest, CloseDialogResult,
  AppLogEntry,
  VramEstimateResult, ModelFitResult, OccupancyConfig,
  LlamaBenchJobState, PreviewErrorCode,
} from '@llama-launcher/shared';

export interface IpcResult<T = void> {
  ok: true;
  data: T;
}

export interface IpcError {
  ok: false;
  /** 诊断文本（日志用）；界面文案一律按 code 走 i18n，不插值这段文本 */
  error: string;
  /** 可辨识失败码（目前由 SERVER_PREVIEW 下发，见 shared 的 PREVIEW_ERROR_CODES） */
  code?: PreviewErrorCode;
}

export type IpcResponse<T = void> = IpcResult<T> | IpcError;

export interface ElectronAPI {
  settings: {
    load: () => Promise<AppSettings>;
    save: (s: AppSettings) => Promise<void>;
  };
  models: {
    scan: (dir: string, options?: { createIfMissing?: boolean }) => Promise<ModelInfo[]>;
    detectMmproj: (modelPath: string) => Promise<string>;
    detectDraft: (modelPath: string) => Promise<string>;
    readGgufMeta: (modelPath: string) => Promise<IpcResponse<GgufReadResult>>;
    watch: (dir: string) => Promise<IpcResponse>;
    remove: (modelPath: string) => Promise<IpcResponse>;
    onChanged: (cb: () => void) => () => void;
  };
  modelParams: {
    /** 读取某模型的已存参数集；无存储返回 null（回落出厂默认 + GGUF 建议自动应用） */
    load: (modelPath: string) => Promise<ModelParams | null>;
    /** 自动持久化某模型的当前参数（参数变化节流调用；upsert） */
    save: (modelPath: string, values: PresetValues) => Promise<ModelParams>;
    /** 清除某模型的已存参数（「全部重置」覆盖写之外的清理口）；删除了文件返回 true */
    clear: (modelPath: string) => Promise<boolean>;
  };
  server: {
    start: (values: PresetValues, settings: AppSettings) => Promise<IpcResponse>;
    stop: () => Promise<IpcResponse>;
    restart: (values: PresetValues, settings: AppSettings) => Promise<IpcResponse>;
    getStatus: (refresh?: boolean) => Promise<ServerInfo>;
    previewCommand: (values: PresetValues, settings: AppSettings) => Promise<IpcResponse<string[]>>;
    onOutputBatch: (cb: (entries: OutputEntry[]) => void) => () => void;
    onStatus: (cb: (e: ServerStatusEvent) => void) => () => void;
  };
  clipboard: {
    write: (text: string) => Promise<void>;
  };
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<IpcResponse>;
  window: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    getState: () => Promise<{ maximized: boolean }>;
    onMaximized: (cb: () => void) => () => void;
    onUnmaximized: (cb: () => void) => () => void;
    onCloseDialog: (cb: (req: CloseDialogRequest) => void) => () => void;
    respondCloseDialog: (id: number, action: CloseDialogResult['action'], remember: boolean) => void;
  };
  system: {
    checkPort: (port: number, host?: string) => Promise<{ inUse: boolean; pid?: number; name?: string }>;
    killProcess: (pid: number) => Promise<{ ok: boolean; error?: string }>;
    findFreePort: (port: number, host?: string) => Promise<number | null>;
    fileExists: (path: string) => Promise<boolean>;
    findLlamaExe: (dir: string) => Promise<string>;
    detectTrash: () => Promise<DetectResult>;
    cleanTrash: (items: TrashItem[]) => Promise<CleanResult>;
    listDir: (path: string) => Promise<FsDirResult>;
    mkdir: (path: string) => Promise<boolean>;
    estimateVram: (modelPath: string, dtype?: string, target?: string, occ?: Partial<OccupancyConfig>) => Promise<VramEstimateResult>;
    benchLlamaRun: (modelPath: string) => Promise<IpcResponse<LlamaBenchJobState>>;
    benchLlamaStatus: (modelPath: string) => Promise<LlamaBenchJobState | null>;
    onBenchStatus: (cb: (job: LlamaBenchJobState) => void) => () => void;
    estimateModelFit: (paths: string[], dtype?: string) => Promise<Record<string, ModelFitResult>>;
  };
  download: {
    parseUrl: (url: string) => Promise<IpcResponse<ParsedModelUrl | null>>;
    search: (author: string, modelName: string) => Promise<IpcResponse<ModelScopeSearchResult>>;
    listFiles: (namespace: string, name: string, source: DownloadSource) => Promise<IpcResponse<ModelScopeFileListResult>>;
    start: (req: StartDownloadRequest) => Promise<IpcResponse<DownloadTask>>;
    cancel: (id: string) => Promise<IpcResponse<boolean>>;
    pause: (id: string) => Promise<IpcResponse<boolean>>;
    resume: (id: string) => Promise<IpcResponse<boolean>>;
    onProgress: (cb: (payload: DownloadProgressPayload) => void) => () => void;
    onComplete: (cb: (payload: DownloadCompletePayload) => void) => () => void;
    onError: (cb: (payload: DownloadErrorPayload) => void) => () => void;
  };
  logs: {
    list: () => Promise<AppLogEntry[]>;
    clear: () => Promise<boolean>;
    onLog: (cb: (entry: AppLogEntry) => void) => () => void;
  };
}

export interface FsEntry {
  name: string;
  isDir: boolean;
  isFile: boolean;
}

export interface FsDirResult {
  /** 当前目录的绝对路径；根目录时为 null */
  path: string | null;
  /** 父目录路径；已在根目录时为 null */
  parent: string | null;
  /** 子项（目录在前、文件在后，各自按名称排序） */
  entries: FsEntry[];
  /** 目录是否存在(不存在时 entries 为空,但 parent 仍可用于向上导航) */
  exists: boolean;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};
