// preload: CommonJS 模块（Electron preload 沙箱要求）
// 不依赖 workspace 包；IPC 频道常量来自同目录 ipc-constants.cjs（由 scripts/generate-preload.cjs 生成）
const { contextBridge, ipcRenderer } = require('electron');

// IPC 频道常量由 scripts/generate-preload.cjs 从 packages/shared/src/types/ipc.ts 生成，
// 运行时从同目录 ipc-constants.cjs 加载；改动 IPC 后运行 `pnpm generate:ipc` 重新生成。
const { IPC } = require('./ipc-constants.cjs');

let outputListeners = [];
let statusListeners = [];
let modelsChangedListeners = [];
let downloadProgressListeners = [];
let downloadCompleteListeners = [];
let downloadErrorListeners = [];
let appLogListeners = [];

ipcRenderer.on(IPC.SERVER_OUTPUT, (_e, entry) => {
  outputListeners.forEach(cb => { try { cb(entry); } catch (_) {} });
});
ipcRenderer.on(IPC.SERVER_STATUS, (_e, s) => {
  statusListeners.forEach(cb => { try { cb(s); } catch (_) {} });
});
ipcRenderer.on(IPC.MODELS_CHANGED, () => {
  modelsChangedListeners.forEach(cb => { try { cb(); } catch (_) {} });
});
ipcRenderer.on(IPC.DOWNLOAD_PROGRESS, (_e, payload) => {
  downloadProgressListeners.forEach(cb => { try { cb(payload); } catch (_) {} });
});
ipcRenderer.on(IPC.DOWNLOAD_COMPLETE, (_e, payload) => {
  downloadCompleteListeners.forEach(cb => { try { cb(payload); } catch (_) {} });
});
ipcRenderer.on(IPC.DOWNLOAD_ERROR, (_e, payload) => {
  downloadErrorListeners.forEach(cb => { try { cb(payload); } catch (_) {} });
});

// 应用日志推送（日志页：应用生命周期/操作记录）
ipcRenderer.on(IPC.LOGS_ONLOG, (_e, entry) => {
  appLogListeners.forEach(cb => { try { cb(entry); } catch (_) {} });
});

let windowMaximizedListeners = [];
let windowUnmaximizedListeners = [];
ipcRenderer.on(IPC.WINDOW_MAXIMIZED, () => {
  windowMaximizedListeners.forEach(cb => { try { cb(); } catch (_) {} });
});
ipcRenderer.on(IPC.WINDOW_UNMAXIMIZED, () => {
  windowUnmaximizedListeners.forEach(cb => { try { cb(); } catch (_) {} });
});

// 关闭窗口询问：主进程发起（窗口 close 事件被拦截后），渲染进程展示应用内弹窗并回复
let closeDialogListeners = [];
ipcRenderer.on(IPC.WINDOW_SHOW_CLOSE_DIALOG, (_e, request) => {
  closeDialogListeners.forEach(cb => { try { cb(request); } catch (_) {} });
});

function clonePlain(value) {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args.map(clonePlain));
}

function send(channel, ...args) {
  ipcRenderer.send(channel, ...args.map(clonePlain));
}

const api = {
  settings: {
    load: () => invoke(IPC.SETTINGS_LOAD),
    save: (s) => invoke(IPC.SETTINGS_SAVE, s),
  },
  models: {
    scan: (dir) => invoke(IPC.MODELS_SCAN, dir),
    detectMmproj: (modelPath) => invoke(IPC.MODELS_DETECT_MMPROJ, modelPath),
    detectDraft: (modelPath) => invoke(IPC.MODELS_DETECT_DRAFT, modelPath),
    readGgufMeta: (modelPath) => invoke(IPC.MODELS_READ_GGUF_META, modelPath),
    watch: (dir) => invoke(IPC.MODELS_WATCH, dir),
    remove: (dir) => invoke(IPC.MODELS_REMOVE, dir),
    onChanged: (cb) => {
      modelsChangedListeners.push(cb);
      return () => {
        modelsChangedListeners = modelsChangedListeners.filter(l => l !== cb);
      };
    },
  },
  presets: {
    list: () => invoke(IPC.PRESETS_LIST),
    save: (name, values) => invoke(IPC.PRESETS_SAVE, name, values),
    delete: (name) => invoke(IPC.PRESETS_DELETE, name),
    load: (name) => invoke(IPC.PRESETS_LOAD, name),
  },
  server: {
    start: (values, settings) => invoke(IPC.SERVER_START, values, settings),
    stop: () => invoke(IPC.SERVER_STOP),
    restart: (values, settings) => invoke(IPC.SERVER_RESTART, values, settings),
    getStatus: () => invoke(IPC.SERVER_STATUS),
    previewCommand: (values, settings) => invoke(IPC.SERVER_PREVIEW, values, settings),
    bench: (req) => invoke(IPC.SERVER_BENCH, req),
    onOutput: (cb) => {
      outputListeners.push(cb);
      return () => {
        outputListeners = outputListeners.filter(l => l !== cb);
      };
    },
    onStatus: (cb) => {
      statusListeners.push(cb);
      return () => {
        statusListeners = statusListeners.filter(l => l !== cb);
      };
    },
  },
  clipboard: {
    write: (text) => invoke(IPC.CLIPBOARD_WRITE, text),
  },
  openExternal: (url) => invoke(IPC.OPEN_EXTERNAL, url),
  openPath: (path) => invoke(IPC.OPEN_PATH, path),
  window: {
    close: () => invoke(IPC.WINDOW_CLOSE),
    minimize: () => invoke(IPC.WINDOW_MINIMIZE),
    toggleMaximize: () => invoke(IPC.WINDOW_TOGGLE_MAXIMIZE),
    getState: () => invoke(IPC.WINDOW_STATE),
    onMaximized: (cb) => {
      windowMaximizedListeners.push(cb);
      return () => { windowMaximizedListeners = windowMaximizedListeners.filter(l => l !== cb); };
    },
    onUnmaximized: (cb) => {
      windowUnmaximizedListeners.push(cb);
      return () => { windowUnmaximizedListeners = windowUnmaximizedListeners.filter(l => l !== cb); };
    },
    onCloseDialog: (cb) => {
      closeDialogListeners.push(cb);
      return () => { closeDialogListeners = closeDialogListeners.filter(l => l !== cb); };
    },
    respondCloseDialog: (id, action, remember) =>
      send(IPC.WINDOW_CLOSE_DIALOG_RESULT, { id, action, remember }),
  },
  system: {
    checkPort: (port, host) => invoke(IPC.SYSTEM_CHECK_PORT, port, host),
    killProcess: (pid) => invoke(IPC.SYSTEM_KILL_PROCESS, pid),
    findFreePort: (port, host) => invoke(IPC.SYSTEM_FIND_FREE_PORT, port, host),
    fileExists: (path) => invoke(IPC.SYSTEM_FILE_EXISTS, path),
    findLlamaExe: (dir) => invoke(IPC.SYSTEM_FIND_LLAMA_EXE, dir),
    detectTrash: () => invoke(IPC.SYSTEM_DETECT_TRASH),
    cleanTrash: (items) => invoke(IPC.SYSTEM_CLEAN_TRASH, items),
    listDir: (path) => invoke(IPC.FS_LIST_DIR, path),
    mkdir: (path) => invoke(IPC.FS_MKDIR, path),
  },
  download: {
    parseUrl: (url) => invoke(IPC.DOWNLOAD_PARSE_URL, url),
    search: (author, modelName) => invoke(IPC.DOWNLOAD_SEARCH, author, modelName),
    listFiles: (namespace, name, source) => invoke(IPC.DOWNLOAD_LIST_FILES, namespace, name, source),
    start: (req) => invoke(IPC.DOWNLOAD_START, req),
    cancel: (id) => invoke(IPC.DOWNLOAD_CANCEL, id),
    pause: (id) => invoke(IPC.DOWNLOAD_PAUSE, id),
    resume: (id) => invoke(IPC.DOWNLOAD_RESUME, id),
    onProgress: (cb) => {
      downloadProgressListeners.push(cb);
      return () => {
        downloadProgressListeners = downloadProgressListeners.filter(l => l !== cb);
      };
    },
    onComplete: (cb) => {
      downloadCompleteListeners.push(cb);
      return () => {
        downloadCompleteListeners = downloadCompleteListeners.filter(l => l !== cb);
      };
    },
    onError: (cb) => {
      downloadErrorListeners.push(cb);
      return () => {
        downloadErrorListeners = downloadErrorListeners.filter(l => l !== cb);
      };
    },
  },
  logs: {
    list: () => invoke(IPC.LOGS_LIST),
    clear: () => invoke(IPC.LOGS_CLEAR),
    onLog: (cb) => {
      appLogListeners.push(cb);
      return () => {
        appLogListeners = appLogListeners.filter(l => l !== cb);
      };
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

