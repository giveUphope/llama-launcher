# Electron 主进程

> 范围：Electron 主进程：入口、窗口管理、IPC 注册、Launcher 桥接、Preload。
> 索引：[README.md](../README.md) · 相关：[ipc-channels.md](ipc-channels.md) · [core-modules.md](core-modules.md)

### 6.1 入口 (main/index.ts)

- **单实例锁**：`requestSingleInstanceLock`，防止多开；二次启动时聚焦已有窗口。
- **`whenReady`**：注入网络传输（`installHfTransport()` + `installDownloadTransport()`，Electron `net` 栈规避 BoringSSL TLS 指纹被 hf-mirror.com 拒绝，见 [core-modules.md](core-modules.md) §4.6）→ 注册 IPC → 创建窗口 → 设置 `launcherBridge`。
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

共 57 个 IPC 通道，分 10 类：Settings / Models / Presets / Server / Logs / 通用 / Window / System / Download /
 FS。

- 下载完成时调用 `notifyModelsChanged()` 刷新模型列表。
- `models:watch` 递归监听 `.gguf` 文件变化，500ms 防抖后通知渲染进程。
- `system:findLlamaExe` 在指定目录（含一级子目录）查找 `llama-server.exe`，用于内联检测。
- `server:bench`：性能测试通道，委托 `bench-client.ts` 对运行中的 llama-server 发请求（读 completion `timings` + `/metrics`）。
- `system:estimateVram` / `system:estimateModelFit`：显存探测（spawn `llama-server --list-devices`）+ GGUF KV 内存模型，估算显存/内存双侧占用、无 OOM 上下文上限、性能目标联动建议与模型适配判定（委托 core `devices.ts` / `vram-estimate.ts` / `target-recommend.ts`；设备探测 30s 共享缓存，结果按模型|dtype|target 缓存 60s）。
- `system:benchLlamaRun` / `system:benchLlamaStatus`：llama-bench 离线体检（pp512/tg128，单模型单作业 + 状态轮询，委托 core `llama-bench.ts`）。
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

### 6.6 退出行为 (app-exit.ts)

关闭窗口 / 退出的统一入口，按设置 `close_behavior`（`ask`/`exit`/`tray`）分流：

- **`handleWindowClose(win)`**：`tray` → `minimizeToTray(win)`（隐藏窗口、进程保活）；`exit` → `requestExit(win)`；`ask` → 弹应用内 CloseDialog（一问一答），可选「记住选择」写入设置，超时/取消失败兜底最小化到托盘。
- **`requestExit(win)`**：模型服务运行中先弹二次确认（`exit-confirm`，超时默认取消不误停服务）；确认后 `app.quit()`，`before-quit` 阶段同步清理子进程。
- **一问一答机制**：主进程 `close` 事件被拦截后经 `IPC.WINDOW_SHOW_CLOSE_DIALOG` 发请求（`CloseDialogRequest { id, mode }`），渲染进程展示弹窗并经 `WINDOW_CLOSE_DIALOG_RESULT` 回传（`handleCloseDialogResult` 转发）；窗口不可用/渲染无响应时 10 秒超时兜底，不回退原生 dialog。`quitting` 标志位防止退出请求被 close 拦截循环。

### 6.7 窗口↔进程关联注册表 (process-registry.ts)

`ProcessRegistry`（单例 `processRegistry`）维护 `windowId → 该窗口关联子进程集合` 映射，供窗口关闭/应用退出时精确清理本窗口的 llama-server 进程：

- **`associate(win, proc, exeName)`**：建立关联（同一进程实例去重，避免重复 taskkill）。
- **`cleanupWindow(win)`**：对关联进程执行**两阶段终止**（先 `terminate()` 优雅退出 SIGTERM / taskkill 不带 /F，超时未退出升级强杀）；进程 PID 定向终止无法确认死亡时才按 exe 名兜底扫杀（`sweepByName`，避免误杀用户自启的同名 llama-server）。幂等，清理后移除映射。
- **`cleanupAll()`**：退出兜底，清理所有窗口关联进程。
- 跨窗口可扩展：当前产品单窗口，注册表天然支持多窗口各管各的进程。每步清理经 `cleanupLogger` 记录（见 [core-modules.md](core-modules.md) §4.12）。

### 6.8 系统托盘 (tray.ts)

窗口隐藏后应用驻留托盘的保活实现（`close_behavior='tray'` 或退出询问选「最小化到托盘」时生效）：

- **`createTray(win)`**：菜单两项（显示主窗口 / 退出——退出走 `requestExit`，服务运行中二次确认）；文案跟随设置语言。
- **图标**：优先 32px PNG（Windows 托盘各 DPI 渲染可靠），失败逐级兜底 16px PNG / icon.ico；dev 与打包（`extraResources`）两套路径。
- **右键菜单定位**：Windows 原生 `setContextMenu` 从鼠标位置向下展开（不会自动向上），改为 right-click 手动 `popUpContextMenu`——菜单底缘对齐图标上缘、右缘对齐图标右缘，按显示器工作区钳制，上方放不下时回退到图标下方；高度按模板逐项估算（项 33px / 分隔线 7px / 边框 4px）。
- 单击托盘图标：显示并聚焦主窗口。
