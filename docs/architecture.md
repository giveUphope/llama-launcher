# 架构与项目结构

> 范围：项目概述、目录结构、Monorepo 架构与依赖流。
> 索引：[README.md](README.md) · 相关：[core-modules.md](core-modules.md) · [workflow.md](workflow.md)

## 1. 项目概述

llama_launcher 是面向 llama.cpp 的 `llama-server` 的桌面启动器。功能包括：选择 `.gguf` 模型、读取 GGUF 元数据自动推导建议参数、配置 56 个启动参数、启动/停止/重启服务、实时查看输出、保存/加载预设、在线下载模型、浅色/深色主题和中/英文切换。应用不捆绑 llama.cpp 二进制，用户选择 llama-server 所在目录后自动检测可执行文件。

当前只有一条主维护线：`apps/desktop` + `packages/*`（Electron + TypeScript + Vue 3 + Vite + Pinia）。整个项目通过 pnpm workspace + turborepo 管理，构建产物统一由 turbo 编排。

---

## 2. 项目结构

```
llama_launcher/
├── apps/
│   └── desktop/                      # Electron 主应用
│       ├── src/
│       │   ├── main/                  # 主进程
│       │   │   ├── index.ts           # 入口：单实例锁、窗口创建、生命周期
│       │   │   ├── ipc/               # 功能域 IPC 注册表（46 通道，register*Ipc + index 聚合）
│       │   │   ├── launcher-bridge.ts # Launcher 单例桥接 + 输出缓冲
│       │   │   ├── bench-client.ts    # 性能测试 HTTP 客户端（Electron net 读 /metrics + timings）
│       │   │   └── window.ts          # 窗口创建与几何持久化
│       │   └── preload/
│       │       └── index.cjs          # CommonJS preload（sandbox 要求）
│       ├── electron-builder.yml       # 打包配置
│       └── package.json               # @llama-launcher/desktop 1.4.3
├── packages/
│   ├── core/                          # 核心业务逻辑
│   │   └── src/
│   │       ├── index.ts               # 包导出聚合
│   │       ├── paths.ts               # llama-server 路径解析 + 预设目录解析
│   │       ├── settings-store.ts      # 设置读写
│   │       ├── presets-store.ts       # 预设读写（动态目录参数）
│   │       ├── models-scanner.ts      # .gguf 递归扫描 + mmproj/draft 检测
│   │       ├── command-builder.ts     # 启动命令构建
│   │       ├── process.ts             # 子进程封装
│   │       ├── launcher.ts            # 启动编排状态机
│   │       ├── gguf-meta.ts           # GGUF 元数据流式读取
│   │       ├── url-parser.ts          # 模型 URL 解析（LM Studio / HuggingFace / hf-mirror / ModelScope）
│   │       ├── modelscope-client.ts   # ModelScope API 客户端
│   │       ├── huggingface-client.ts  # HuggingFace 镜像客户端（hf-mirror.com，可注入 Electron net 传输）
│   │       ├── download-manager.ts    # 多任务断点续传下载（动态段数 + 可注入传输）
│   │       ├── cleanup-logger.ts      # 进程清理日志
│   │       └── trash-cleaner.ts       # 配置目录垃圾清理
│   ├── shared/                        # 共享层（类型/参数表/i18n 唯一来源）
│   │   └── src/
│   │       ├── types/                 # 类型定义
│   │       ├── params/definitions.ts  # 参数表（3 组 / 56 个参数）
│   │       └── i18n/                  # 中英文案
│   └── ui/                            # Vue 3 前端
│       └── src/
│           ├── router/                # 路由
│           ├── stores/                # Pinia store
│           ├── pages/                 # 6 个页面（模型管理/下载/参数/控制台/设置/Web UI）
│           ├── features/             # 功能注册表（侧栏导航 + 路由装配）
│           ├── components/            # 通用组件 + 参数控件
│           ├── composables/           # useIPC / useTheme / useStartServer / useAutoPresetName
│           └── styles/                # reset / theme / variables
├── scripts/                           # 构建辅助脚本
│   ├── before-pack.cjs                # 打包前：符号链接替换为 dist-only 真实目录
│   ├── after-pack.cjs                 # 打包后：恢复 pnpm 符号链接
│   ├── clean-before-pack.cjs          # 打包前：杀进程 + 清理输出目录
│   ├── copy-ui.cjs                    # 复制 UI dist 到 desktop dist/ui/
│   ├── copy-preload.cjs               # 复制 preload .cjs 到 dist/
│   ├── generate-preload.cjs         # 从 ipc.ts 生成 preload IPC 常量
│   ├── dev-watch.cjs                # 开发热重载：监视 dist/preload 变更重启 Electron
│   ├── dist-with-fallback.cjs       # 打包输出目录锁定回退
│   ├── verify-params-sync.cjs       # 参数定义 ↔ 文档 ↔ help 三方对拍
│   └── verify-ipc-sync.cjs           # IPC 常量一致性校验
├── package.json                       # 根 workspace 配置
└── turbo.json                         # turborepo 任务编排
```

> `llama-*-bin-*` 目录为开发用的 llama.cpp 二进制（版本不固定），由 `paths.ts` 在开发模式下动态查找。生产构建不打包二进制，用户在模型管理页选择引擎目录。

---

## 3. Monorepo 架构

共 4 个包，依赖关系单向流动：

| 包名 | 版本 | 职责 |
|------|------|------|
| `@llama-launcher/desktop` | 1.4.3 | Electron 主进程 + preload + 打包 |
| `@llama-launcher/core` | 1.0.0 | 核心业务逻辑（进程/命令/扫描/下载/GGUF） |
| `@llama-launcher/shared` | 1.0.0 | 类型定义、参数表、i18n 的唯一来源 |
| `@llama-launcher/ui` | 1.0.0 | Vue 3 + Vite + Pinia 前端 |

**依赖关系：**

```
desktop → core + shared
core    → shared
ui      → shared
```

- `shared` 是类型定义、参数表、i18n 的**唯一来源**，`core` 和 `ui` 都依赖它，避免重复定义。
- `desktop` 不直接依赖 `ui`，而是通过 `extraResources` / 构建产物在运行时加载 `ui` 的静态资源。
- 使用 **pnpm workspace** 管理本地包链接（`workspace:*`），**turborepo** 编排 `build` / `lint` / `test` / `dev` 任务。
