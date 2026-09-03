# 架构与项目结构

> 范围：项目概述、目录结构、Monorepo 架构与依赖流。
> 索引：[README.md](../README.md) · 相关：[core-modules.md](core-modules.md) · [workflow.md](workflow.md)

## 1. 项目概述

llama\_launcher 是面向 llama.cpp 的 `llama-server` 的桌面启动器。功能包括：选择 `.gguf` 模型、读取 GGUF 元数据自动推导建议参数、配置 58 个启动参数、启动/停止/重启服务、实时查看输出、保存/加载预设、在线下载模型、浅色/深色主题和中/英文切换。应用不捆绑 llama.cpp 二进制，用户选择 llama-server 所在目录后自动检测可执行文件。

当前只有一条主维护线：`apps/desktop` + `packages/*`（Electron + TypeScript + Vue 3 + Vite + Pinia）。整个项目通过 pnpm workspace + turborepo 管理，构建产物统一由 turbo 编排。

***

## 2. 项目结构

```
llama_launcher/
├── apps/
│   └── desktop/                      # Electron 主应用
│       ├── src/
│       │   ├── main/                  # 主进程
│       │   │   ├── index.ts           # 入口：单实例锁、窗口创建、生命周期、传输注入
│       │   │   ├── ipc/               # 功能域 IPC 注册表（51 通道，register*Ipc + index 聚合）
│       │   │   │   ├── index.ts       #   ipcRegistrars 数组汇总装配（registerIpcHandlers）
│       │   │   │   ├── settings.ts    #   settings:load/save
│       │   │   │   ├── models.ts      #   models:scan/detectMmproj/detectDraft/readGgufMeta/remove
│       │   │   │   ├── models-watcher.ts # models:watch 目录监听单例（watchModelsDir/notifyModelsChanged）
│       │   │   │   ├── presets.ts     #   presets:list/save/load/delete
│       │   │   │   ├── server.ts      #   server:start/stop/restart/status/preview/bench
│       │   │   │   ├── logs.ts        #   logs:list/clear/onlog
│       │   │   │   ├── system.ts      #   system:checkPort/fileExists/findLlamaExe/detectTrash/cleanTrash
│       │   │   │   ├── window.ts      #   window:close/minimize/toggleMaximize/state + 关闭弹窗转发
│       │   │   │   └── download.ts    #   download:parseUrl/search/listFiles/start/cancel/pause/resume
│       │   │   ├── launcher-bridge.ts # Launcher 单例桥接 + 输出缓冲（16ms 批量推送）
│       │   │   ├── app-exit.ts        # 退出行为：close_behavior 分流 + 关闭弹窗一问一答（requestExit/minimizeToTray/handleWindowClose）
│       │   │   ├── app-log.ts         # 应用日志环形缓冲（区别于服务控制台，走 logs:* IPC）
│       │   │   ├── process-registry.ts # 窗口 ↔ 子进程关联注册表（ProcessRegistry，两阶段终止）
│       │   │   ├── tray.ts            # 系统托盘保活（createTray，右键菜单定位在图标上方）
│       │   │   ├── bench-client.ts    # 性能测试 HTTP 客户端（Electron net 读 /metrics + timings）
│       │   │   ├── hf-transport.ts    # 注入 HfHttpTransport：Electron net 传输（规避 BoringSSL TLS 指纹被拒）
│       │   │   ├── download-transport.ts # 注入 DownloadTransport：Electron net 流式传输（仅 hf-mirror.com）
│       │   │   └── window.ts          # 窗口创建与几何持久化
│       │   └── preload/
│       │       ├── index.cjs          # CommonJS preload（sandbox 要求）
│       │       └── ipc-constants.cjs  # 由 scripts/generate-preload.cjs 生成（勿手改）
│       ├── electron-builder.config.cjs       # 打包配置
│       └── package.json               # @llama-launcher/desktop（版本随 root 自动 bump）
├── packages/
│   ├── core/                          # 核心业务逻辑
│   │   └── src/
│   │       ├── index.ts               # 包导出聚合
│   │       ├── paths.ts               # llama-server 路径解析 + 预设目录解析
│   │       ├── settings-store.ts      # 设置读写（CAS 合并守卫 + 原子替换）
│   │       ├── presets-store.ts       # 预设读写（动态目录参数，v2 结构）
│   │       ├── models-scanner.ts      # .gguf 递归扫描 + mmproj/draft 检测 + 移除
│   │       ├── command-builder.ts     # 启动命令构建（值≠默认才发射）
│   │       ├── process.ts             # 子进程封装（LlamaServerProcess，两阶段终止）
│   │       ├── launcher.ts            # 启动编排状态机（stopped→starting→running）
│   │       ├── gguf-meta.ts           # GGUF 元数据流式读取（64KB 块 + LRU）
│   │       ├── url-parser.ts          # 模型 URL 解析（LM Studio / HuggingFace / hf-mirror / ModelScope）
│   │       ├── modelscope-client.ts   # ModelScope API 客户端
│   │       ├── huggingface-client.ts  # HuggingFace 镜像客户端（hf-mirror.com，可注入 Electron net 传输）
│   │       ├── download-manager.ts    # 多任务断点续传下载（动态段数 + 可注入传输）
│   │       ├── download-log.ts        # 下载事件日志（.llama_dl.jsonl JSONL 事实源 + 重放投影）
│   │       ├── retry.ts               # 可重试错误判定 + 指数退避（download/hf 共用）
│   │       ├── trash-cleaner.ts       # 应用生成文件清理（配置目录 + 模型目录双根扫描）
│   │       ├── cleanup-logger.ts      # 进程清理日志（[cleanup] 前缀四级日志）
│   │       └── types.ts               # 核心内部类型
│   ├── shared/                    # 共享层（类型/参数表/i18n 唯一来源）
│   │   └── src/
│   │       ├── types/             # 类型定义（settings/param/preset/server/gguf/download/trash/ipc）
│   │       ├── params/definitions.ts # 参数表（3 组 / 58 个参数）
│   │       ├── i18n/              # 中英文案（zh/en/labels）
│   │       ├── model-name.ts      # 模型显示名/别名派生（modelBaseName）
│   │       ├── model-relevance.ts # 文件分类 + 量化标签解析（categorizeFile/parseQuantization）
│   │       └── time-format.ts     # 人性化时间格式化（formatRelativeTime）
│   └── ui/                        # Vue 3 前端
│       └── src/
│           ├── router/            # 路由（createWebHashHistory + featureRoutes 装配）
│           ├── stores/            # Pinia store（settings/i18n/params/server/download/appLog）
│           ├── pages/             # 7 个页面（概览/模型/服务/参数/日志/内置 Web UI/设置；侧栏 7 项一级导航，旧页路由重定向）
│           ├── features/          # 功能注册表（FeatureDef：侧栏导航 + 路由装配）
│           ├── components/        # 通用组件 + 参数控件（common/layout/models/params/presets/service/settings/bench）
│           ├── composables/       # useIPC / useTheme / useStartServer / useWaitRunning / useAutoPresetName / useModelPreset / useConfirm / useFilePicker / useUrlHistory
│           ├── dev/               # demo-mock（无 Electron preload 的浏览器预览环境注入）
│           └── styles/            # reset / theme / variables / surface / buttons
├── scripts/                           # 构建辅助脚本
│   ├── before-pack.cjs                # 打包前：符号链接替换为 dist-only 真实目录
│   ├── after-pack.cjs                 # 打包后：恢复 pnpm 符号链接
│   ├── clean-before-pack.cjs          # 打包前：杀进程 + 清理输出目录
│   ├── copy-ui.cjs                    # 复制 UI dist 到 desktop dist/ui/
│   ├── copy-preload.cjs               # 复制 preload .cjs 到 dist/
│   ├── generate-preload.cjs         # 从 ipc.ts 生成 preload IPC 常量
│   ├── generate-params-doc.cjs      # 从 help 输出再生 docs/params/LLAMA_SERVER_PARAMS.md
│   ├── dev-watch.cjs                # 开发热重载：监视主进程 dist / preload 源 / shared 类型，变更重启 Electron
│   ├── dist-with-fallback.cjs       # 打包输出目录锁定回退
│   ├── verify-params-sync.cjs       # 参数定义 ↔ 文档 ↔ help 三方对拍
│   ├── verify-ipc-sync.cjs          # IPC 常量一致性校验
│   ├── verify-help-drift.cjs        # 二进制升级后的参数漂移审计
│   ├── check-docs-links.cjs         # 文档相对链接与锚点完整性（lint 阶段执行）
│   ├── style-audit.cjs              # UI 风格规范审计（frontend.md §7.5 十项检查）
│   ├── verify-server-start.mjs      # Launcher 手动冒烟测试（需 core/dist 先构建）
│   ├── verify-bench-client.mjs      # 性能测试指标/timings 解析冒烟测试（需真实模型）
│   ├── integ_devsession.mjs         # 开发会话集成测试入口
│   ├── icon-gen/gen-icon.cjs        # 应用图标生成（desktop pnpm gen:icon）
│   ├── inject-icon.cjs              # 打包后注入 exe 图标
│   └── bump-version.cjs             # 版本自动递增（push main 触发）
├── package.json                       # 根 workspace 配置
└── turbo.json                         # turborepo 任务编排
```

> `llama-*-bin-*` 目录为开发用的 llama.cpp 二进制（版本不固定），由 `paths.ts` 在开发模式下动态查找。生产构建不打包二进制，用户在「应用设置」页选择引擎目录。

***

## 3. Monorepo 架构

共 4 个包，依赖关系单向流动：

| 包名                        | 版本    | 职责                          |
| ------------------------- | ----- | --------------------------- |
| `@llama-launcher/desktop` | 0.0.12 | Electron 主进程 + preload + 打包 |
| `@llama-launcher/core`    | 1.0.0 | 核心业务逻辑（进程/命令/扫描/下载/GGUF）    |
| `@llama-launcher/shared`  | 1.0.0 | 类型定义、参数表、i18n 的唯一来源         |
| `@llama-launcher/ui`      | 1.0.0 | Vue 3 + Vite + Pinia 前端     |

**依赖关系：**

```
desktop → core + shared
core    → shared
ui      → shared
```

- `shared` 是类型定义、参数表、i18n 的**唯一来源**，`core` 和 `ui` 都依赖它，避免重复定义。

- `desktop` 不直接依赖 `ui`，而是通过 `extraResources` / 构建产物在运行时加载 `ui` 的静态资源。

- 使用 **pnpm workspace** 管理本地包链接（`workspace:*`），**turborepo** 编排 `build` / `lint` / `test` / `dev` 任务。

