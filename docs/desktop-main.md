# Electron 主进程

> 范围：Electron 主进程：入口、窗口管理、IPC 注册、Launcher 桥接、Preload。
> 索引：[README.md](README.md) · 相关：[ipc-channels.md](ipc-channels.md) · [core-modules.md](core-modules.md)

### 6.1 入口 (main/index.ts)

- **单实例锁**：`requestSingleInstanceLock`，防止多开；二次启动时聚焦已有窗口。
- **`whenReady`**：注册 IPC → 创建窗口 → 设置 `launcherBridge`。
- **`before-quit`**：`launcherBridge.disposeSync()`（同步强杀：`forceStop` + 进程树清扫）确保子进程停止，避免残留（退出路径不能 await 异步清理）。
- **外部链接**：在系统浏览器打开（`http://` / `https://`）。

### 6.2 窗口管理 (window.ts)

- **默认尺寸**：1280×800，最小 1024×680。
- **无边框窗口**：`frame: false` 自定义标题栏（TopBar `win-btn`），启动时自动最大化；窗口 icon `resources/icon.ico`。
- **窗口几何持久化**：`x,y,width,height` 格式存储，兼容旧版 `WxH` 格式。
- **防抖保存**：500ms 防抖，避免 resize 时频繁写盘。
- **安全配置**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`。
- **开发模式判据**：`NODE_ENV=development` 或 `!app.isPackaged`。
- **热重载逃生口**：`LLAMA_DEV_SERVER_URL` 环境变量指向 Vite dev server，生产构建也可连接本地前端。

### 6.3 IPC 注册 (ipc/index.ts 功能域注册表)

IPC 按功能域声明式注册：`ipc/` 目录下 settings/models/presets/server/logs/system/window/download 各模块导出 `register*Ipc`，`ipc/index.ts` 以 `ipcRegistrars` 数组汇总装配（`registerIpcHandlers()` 遍历调用）；共享的模型目录监听单例在 `ipc/models-watcher.ts`（`watchModelsDir`/`notifyModelsChanged`）。

共 51 个 IPC 通道，分 10 类：Settings / Models / Presets / Server / Logs / 通用 / Window / System / Download /
 FS。

- 下载完成时调用 `notifyModelsChanged()` 刷新模型列表。
- `models:watch` 递归监听 `.gguf` 文件变化，500ms 防抖后通知渲染进程。
- `system:findLlamaExe` 在指定目录（含一级子目录）查找 `llama-server.exe`，用于内联检测。
- `server:bench`：性能测试通道，委托 `bench-client.ts` 对运行中的 llama-server 发请求（读 completion `timings` + `/metrics`）。
- **关闭行为链路**：窗口关闭请求统一走 `app-exit.ts`，按设置 `close_behavior`（`ask`/`exit`/`tray`）分流；`ask` 时主进程向渲染进程发 `window:showCloseDialog`，渲染进程经 `window:closeDialogResult` 应答（10 秒超时兜底**最小化到托盘**，不丢数据），服务运行中附带二次确认。

### 6.4 Launcher 桥接 (launcher-bridge.ts)

- **单例** `launcherBridge`，跨窗口共享同一个 Launcher 实例。
- **输出缓冲区**：上限 5000 条，新窗口连接时重放历史输出，保证状态可见；输出经 **16ms 窗口批量合并推送**（模型加载等突发日志不逐行压 IPC）。
- **清理**：`disposeSync()`（同步强杀，供 `before-quit`）/ `dispose()`（异步等待 `exit` 或 5 秒超时）。
- **重启竞态规避**：`Launcher.restart()` 在运行中会 `proc.once('exit', () => start)` 等旧进程退出后再启动新进程（未运行时直接 start），避免手动 stop() 后立即 start() 时 `launcher.proc` 仍指向旧进程导致的 `Server is already running` 误判（taskkill 异步杀进程，exit 事件触发前 proc 未置 null）。

### 6.5 Preload (preload/index.cjs)

- **CommonJS 模块**：Electron sandbox 要求 preload 不能用 ESM。
- **`contextBridge.exposeInMainWorld('api', api)`**：向渲染进程暴露安全 API。
- **IPC 常量生成化**：preload 无法 import shared，IPC 通道常量由 `scripts/generate-preload.cjs` 从 `shared/src/types/ipc.ts` 生成到同级 `ipc-constants.cjs`（`pnpm generate:ipc`），`index.cjs` require 该生成物；`verify-ipc-sync.cjs` 校验生成物未过期，并禁止把常量手工内联回 `index.cjs`。
- **`clonePlain` 序列化**：所有参数经 clonePlain 序列化后再传递，确保跨上下文安全。
