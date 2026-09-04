# IPC 通道清单

> 范围：IPC 通道完整清单（共 56 个），按类别分组。改 IPC 前必读。常量唯一事实源为 `packages/shared/src/types/ipc.ts`，preload 侧常量由 `scripts/generate-preload.cjs` 生成（改完运行 `pnpm generate:ipc`），`scripts/verify-ipc-sync.cjs` 在 lint 阶段检查产物未过期。
> 索引：[README.md](../README.md) · 相关：[desktop-main.md](desktop-main.md)

共 56 个 IPC 通道，按类别分组如下：

### Settings（2）

| 通道              | 用途   |
| --------------- | ---- |
| `settings:load` | 加载设置 |
| `settings:save` | 保存设置 |

### Models（7）

| 通道                    | 用途                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `models:scan`         | 扫描模型目录                                                                                        |
| `models:detectMmproj` | 检测多模态投影器文件                                                                                    |
| `models:detectDraft`  | 检测草稿模型文件（dflash/draft）                                                                        |
| `models:readGgufMeta` | 读取 GGUF 元数据                                                                                   |
| `models:watch`        | 递归监听 .gguf 文件变化                                                                               |
| `models:remove`       | 按模型文件移除（目录有其他量化版本/文件时仅删选中文件；否则连同 mmproj/mtp/dflash 伴随文件与空目录删除；仅允许删除 models\_dir 内路径；同步清理关联预设） |
| `models:changed`      | 模型变化通知（主进程 → 渲染进程）                                                                            |

### Presets（4）

| 通道               | 用途     |
| ---------------- | ------ |
| `presets:list`   | 列出所有预设 |
| `presets:save`   | 保存预设   |
| `presets:load`   | 加载预设   |
| `presets:delete` | 删除预设   |

### Server（6）

| 通道               | 用途                                              |
| ---------------- | ----------------------------------------------- |
| `server:start`   | 启动服务                                            |
| `server:stop`    | 停止服务                                            |
| `server:restart` | 重启服务                                            |
| `server:status`  | 查询服务状态                                          |
| `server:preview` | 预览启动命令                                          |
| `server:output`  | 输出推送（主进程 → 渲染进程）                                |

### Logs（3）

| 通道           | 用途                             |
| ------------ | ------------------------------ |
| `logs:list`  | 读取应用日志（区别于服务控制台：记录应用自身生命周期/操作） |
| `logs:clear` | 清空应用日志                         |
| `logs:onlog` | 应用日志推送（主进程 → 渲染进程）             |

### 通用（3）

| 通道                | 用途           |
| ----------------- | ------------ |
| `clipboard:write` | 写入剪贴板        |
| `open:external`   | 在系统浏览器打开链接   |
| `open:path`       | 在系统文件管理器打开路径 |

### Window（8）

| 通道                         | 用途                                                                 |
| -------------------------- | ------------------------------------------------------------------ |
| `window:close`             | 关闭窗口                                                               |
| `window:minimize`          | 最小化窗口                                                              |
| `window:toggleMaximize`    | 切换最大化/还原                                                           |
| `window:state`             | 查询窗口状态                                                             |
| `window:maximized`         | 最大化通知（主进程 → 渲染进程）                                                  |
| `window:unmaximized`       | 还原通知（主进程 → 渲染进程）                                                   |
| `window:showCloseDialog`   | 关闭窗口询问请求（主进程 → 渲染进程，应用内弹窗替代原生 dialog；payload `CloseDialogRequest`） |
| `window:closeDialogResult` | 关闭窗口询问回复（渲染进程 → 主进程；payload `CloseDialogResult`）                   |

### System（11）

| 通道                    | 用途                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `system:checkPort`    | 检查端口是否被占用（按 llama-server 将绑定的 `--host` 地址探测；默认 127.0.0.1，0.0.0.0/局域网 IP 时按对应地址——2026-09 实测：占用者绑局域网 IP 时探 127.0.0.1 漏报、探对应地址命中，覆盖其他网卡占用者场景；Windows 上通配与回环可共存，探测为尽力而为；占用时返回占用者 PID/进程名） |
| `system:killProcess`  | 结束指定进程（端口占用处理：Windows `taskkill /F /PID`、POSIX SIGKILL；由渲染端确认后调用）                                                    |
| `system:findFreePort` | 从指定端口向后扫描，返回首个空闲端口（host 语义同 checkPort；无可用返回 null）                                                                    |
| `system:estimateVram` | 显存探测 + 上下文容量估算（spawn `llama-server --list-devices` 取每设备空闲显存 + GGUF KV 内存模型估算全卸载上下文上限 + 性能目标联动建议；尽力而为，失败字段为 null；结果按 模型\|dtype\|target\|ngl\|ctxSize 缓存 60s） |
| `system:benchLlamaRun`    | 启动 llama-bench 离线体检（pp512/tg128 全卸载，fire-and-forget 单模型单作业；结果按模型路径缓存会话期） |
| `system:benchLlamaStatus` | 轮询体检作业状态/结果（running/done/error + LlamaBenchSummary） |
| `system:estimateModelFit` | 模型列表批量显存适配判定（fit/partial/no 徽章 + 全卸载上下文上限；元数据不可读 verdict 为 null） |
| `system:fileExists`   | 检查文件是否存在                                                                                                             |
| `system:findLlamaExe` | 在目录中查找 llama-server 可执行文件（内联检测）                                                                                      |
| `system:detectTrash`  | 检测应用生成文件中的可清理项（配置目录 + 模型目录双根扫描；活动/暂停/可重试下载任务路径自动保护）                                                                  |
| `system:cleanTrash`   | 执行清理（逐项重校验根归属、kind 特征、保护集与符号链接）                                                                                      |

### FS（2）

| 通道           | 用途     |
| ------------ | ------ |
| `fs:listDir` | 列出目录内容 |
| `fs:mkdir`   | 创建目录   |

### Download（10）

| 通道                   | 用途                  |
| -------------------- | ------------------- |
| `download:parseUrl`  | 解析模型 URL            |
| `download:search`    | 搜索 ModelScope 模型    |
| `download:listFiles` | 列出模型仓库文件            |
| `download:start`     | 启动下载                |
| `download:cancel`    | 取消下载（删除部分文件与事件日志）   |
| `download:pause`     | 暂停下载（保留部分文件与事件日志）   |
| `download:resume`    | 恢复下载（含 error 状态的重试） |
| `download:progress`  | 下载进度推送（主进程 → 渲染进程）  |
| `download:complete`  | 下载完成推送（主进程 → 渲染进程）  |
| `download:error`     | 下载错误推送（主进程 → 渲染进程）  |

