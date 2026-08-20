# IPC 通道清单

> 范围：IPC 通道完整清单（共 46 个），按类别分组。改 IPC 前必读。常量唯一事实源为 `packages/shared/src/types/ipc.ts`，preload 侧常量由 `scripts/generate-preload.cjs` 生成（改完运行 `pnpm generate:ipc`），`scripts/verify-ipc-sync.cjs` 在 lint 阶段检查产物未过期。
> 索引：[README.md](README.md) · 相关：[desktop-main.md](desktop-main.md)

共 46 个 IPC 通道，按类别分组如下：

### Settings（2）
| 通道 | 用途 |
|------|------|
| `settings:load` | 加载设置 |
| `settings:save` | 保存设置 |

### Models（7）
| 通道 | 用途 |
|------|------|
| `models:scan` | 扫描模型目录 |
| `models:detectMmproj` | 检测多模态投影器文件 |
| `models:detectDraft` | 检测草稿模型文件（dflash/draft） |
| `models:readGgufMeta` | 读取 GGUF 元数据 |
| `models:watch` | 递归监听 .gguf 文件变化 |
| `models:remove` | 按模型文件移除（目录有其他量化版本/文件时仅删选中文件；否则连同 mmproj/mtp/dflash 伴随文件与空目录删除；仅允许删除 models_dir 内路径；同步清理关联预设） |
| `models:changed` | 模型变化通知（主进程 → 渲染进程） |

### Presets（4）
| 通道 | 用途 |
|------|------|
| `presets:list` | 列出所有预设 |
| `presets:save` | 保存预设 |
| `presets:load` | 加载预设 |
| `presets:delete` | 删除预设 |

### Server（7）
| 通道 | 用途 |
|------|------|
| `server:start` | 启动服务 |
| `server:stop` | 停止服务 |
| `server:restart` | 重启服务 |
| `server:status` | 查询服务状态 |
| `server:preview` | 预览启动命令 |
| `server:output` | 输出推送（主进程 → 渲染进程） |
| `server:bench` | 性能测试：一次运行依次执行单并发与多并发两个场景，返回 timings 与 DFlash 指标 |

### 通用（3）
| 通道 | 用途 |
|------|------|
| `clipboard:write` | 写入剪贴板 |
| `open:external` | 在系统浏览器打开链接 |
| `open:path` | 在系统文件管理器打开路径 |

### Window（8）
| 通道 | 用途 |
|------|------|
| `window:close` | 关闭窗口 |
| `window:minimize` | 最小化窗口 |
| `window:toggleMaximize` | 切换最大化/还原 |
| `window:state` | 查询窗口状态 |
| `window:maximized` | 最大化通知（主进程 → 渲染进程） |
| `window:unmaximized` | 还原通知（主进程 → 渲染进程） |
| `window:showCloseDialog` | 关闭窗口询问请求（主进程 → 渲染进程，应用内弹窗替代原生 dialog；payload `CloseDialogRequest`） |
| `window:closeDialogResult` | 关闭窗口询问回复（渲染进程 → 主进程；payload `CloseDialogResult`） |

### System（5）
| 通道 | 用途 |
|------|------|
| `system:checkPort` | 检查端口是否被占用 |
| `system:fileExists` | 检查文件是否存在 |
| `system:findLlamaExe` | 在目录中查找 llama-server 可执行文件（内联检测） |
| `system:detectTrash` | 检测配置目录中的垃圾文件 |
| `system:cleanTrash` | 清理配置目录中的垃圾文件 |

### FS（2）
| 通道 | 用途 |
|------|------|
| `fs:listDir` | 列出目录内容 |
| `fs:mkdir` | 创建目录 |

### Download（10）
| 通道 | 用途 |
|------|------|
| `download:parseUrl` | 解析模型 URL |
| `download:search` | 搜索 ModelScope 模型 |
| `download:listFiles` | 列出模型仓库文件 |
| `download:start` | 启动下载 |
| `download:cancel` | 取消下载（删除部分文件与事件日志） |
| `download:pause` | 暂停下载（保留部分文件与事件日志） |
| `download:resume` | 恢复下载（含 error 状态的重试） |
| `download:progress` | 下载进度推送（主进程 → 渲染进程） |
| `download:complete` | 下载完成推送（主进程 → 渲染进程） |
| `download:error` | 下载错误推送（主进程 → 渲染进程） |
