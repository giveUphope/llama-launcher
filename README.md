# llama Launcher

> 为 [llama.cpp](https://github.com/ggerganov/llama.cpp) `llama-server` 打造的现代化桌面启动器。

[![stack](https://img.shields.io/badge/stack-Electron%20%2B%20Vue%203%20%2B%20TypeScript-blue)](#技术栈)
[![license](https://img.shields.io/badge/license-MIT-green)](#许可证)

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 模型管理 | 一键扫描本地 GGUF 模型，自动读取元数据、智能建议参数、检测多模态投影器与草稿模型 |
| 参数配置 | 49 个 `llama-server` 参数，滑块/下拉/开关等丰富控件，支持独立启用/禁用与预设保存 |
| 模型下载 | 支持 HuggingFace / HF Mirror / ModelScope 链接，多任务并发 + 断点续传 |
| 参数调优 | 实时命令预览，一键应用 GGUF 元数据建议参数 |
| 性能测试 | 在线实测 tok/s 与 DFlash 接受率，测试历史自动记录对比 |
| 启动监控 | 一键启动/停止/重启，实时日志，应用内嵌 Web UI |
| 版本兼容 | 自动检测 llama-server 目录（含子目录），不捆绑二进制，兼容任意版本 |
| 界面体验 | 胶囊玻璃设计，深浅主题切换（`Ctrl+D`），中英文界面，窗口几何持久化 |

> 更详细的功能说明见 [docs/README.md](docs/README.md)。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 33 |
| 前端框架 | Vue 3 + Pinia + Vue Router |
| 构建工具 | Vite + TypeScript 5.8 |
| Monorepo | pnpm workspace + Turborepo |
| 打包 | electron-builder |
| 测试 | Vitest |

---

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm 10.12.1
- Windows / macOS / Linux

### 安装

```bash
pnpm install
```

### 开发

```bash
pnpm dev
```

启动 Vite dev server + Electron，支持 UI 热重载。

### 构建与打包

```bash
pnpm build    # 全量构建
pnpm dist     # 打包安装程序（Portable 单文件，不含 llama.cpp 二进制）
```

### 测试与检查

```bash
pnpm test     # 单元测试
pnpm lint     # 类型检查 + IPC 同步校验 + 文档链接校验
```

---

## 使用指南（新手 3 分钟）

**1. 选择引擎目录** → 侧边栏「应用设置」→ 引擎卡片 → 选择 `llama-server.exe` 所在目录，应用自动检测。

**2. 设置模型目录** → 「应用设置」→ 模型目录 → 指向存放 `.gguf` 文件的文件夹。

**3. 选模型 → 调参数 → 启动** → 点击模型行，在「参数设置」页调整参数，点击启动按钮。

> 完整使用步骤见 [docs/README.md](docs/README.md)「使用指南」章节。

---

## 文档

项目全部文档在 [docs/](docs/README.md) 目录下，按主题分类：

| 主题 | 文档 |
|------|------|
| 项目总览 | [docs/README.md](docs/README.md)（功能总览 + 使用指南） |
| 架构 | [architecture.md](docs/architecture.md) |
| 核心模块 | [core-modules.md](docs/core-modules.md) |
| 参数系统 | [params-system.md](docs/params-system.md) |
| 参数对照表 | [LLAMA_SERVER_PARAMS.md](docs/params/LLAMA_SERVER_PARAMS.md) |
| Electron 主进程 | [desktop-main.md](docs/desktop-main.md) |
| IPC 通道 | [ipc-channels.md](docs/ipc-channels.md) |
| 前端 + UI 规范 | [frontend.md](docs/frontend.md) |
| 数据持久化 | [data-persistence.md](docs/data-persistence.md) |
| 打包配置 | [packaging.md](docs/packaging.md) |
| CI/CD | [ci-cd.md](docs/ci-cd.md) |
| 测试 | [testing.md](docs/testing.md) |

> 开发者完整参考（含架构决策、开发约定、构建陷阱）见仓库根目录的 [AGENTS.md](AGENTS.md)。

---

## 项目结构

```text
llama-launcher/
├── apps/desktop/          # Electron 桌面应用
├── packages/core/         # 核心逻辑（进程、命令构建、GGUF、下载）
├── packages/shared/       # 共享类型、参数定义、i18n
├── packages/ui/           # Vue 3 前端
├── scripts/               # 构建辅助脚本
├── docs/                  # 分类文档
├── AGENTS.md              # 开发者完整参考
├── README.md              # 本文件
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## 许可证

MIT
