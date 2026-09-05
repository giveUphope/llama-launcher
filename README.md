# llama Launcher

> 为 [llama.cpp](https://github.com/ggerganov/llama.cpp) `llama-server` 打造的现代化桌面启动器。

[![stack](docs/badges/stack.svg)](#技术栈)
[![license](docs/badges/license.svg)](#许可证)

***

## 📚 项目 Wiki（文档地图）

项目全部文档集中在 `docs/`，作为项目 Wiki 使用。本文件为**仓库唯一 README**（功能总览 + 快速开始 + 使用指南 + 文档地图），其余按主题分类：

### 入门与使用

| 文档                                                                    | 内容                                         |
| --------------------------------------------------------------------- | ------------------------------------------ |
| [README.md](README.md)（本文件）                                           | 功能总览、文档地图、快速开始、使用指南                        |
| [params/LLAMA\_SERVER\_PARAMS.md](docs/params/LLAMA_SERVER_PARAMS.md) | 60 个参数与 llama-server b10734 `--help` 完整对照表 |

### 架构与核心

| 文档                                              | 内容                                                            |
| ----------------------------------------------- | ------------------------------------------------------------- |
| [architecture.md](docs/architecture.md)         | 项目概述、目录结构、Monorepo 架构与依赖流（§1–3）                               |
| [core-modules.md](docs/core-modules.md)         | 核心业务模块：进程、启动编排、命令构建、GGUF、下载、性能测试、设置/预设、清理、续传日志 + 关键类与函数索引（§4） |
| [params-system.md](docs/params-system.md)       | 参数定义、双轨机制（临时会话/预设）、依赖联动、控件组件（§5）                              |
| [data-persistence.md](docs/data-persistence.md) | 类型定义与持久化（§9–10）                                               |
| [design-decisions.md](docs/design-decisions.md) | 关键设计决策（§13）                                                   |

### Electron 与前端

| 文档                                               | 内容                                               |
| ------------------------------------------------ | ------------------------------------------------ |
| [desktop-main.md](docs/desktop-main.md)          | 主进程：窗口、IPC 注册、Launcher 桥接、退出/托盘/进程清理、Preload（§6） |
| [ipc-channels.md](docs/ipc-channels.md)          | 56 个 IPC 通道完整清单（改 IPC 前必读，§8）                    |
| [frontend.md](docs/frontend.md)                  | 前端架构 + **UI 风格规范 §7.5**（§7）                      |
| [style/STYLE\_TODO.md](docs/style/STYLE_TODO.md) | UI 风格待修复清单 + 已修复索引（完整记录见 docs/archive 归档）                    |

### 工程与发布

| 文档                                        | 内容                                                   |
| ----------------------------------------- | ---------------------------------------------------- |
| [packaging.md](docs/packaging.md)         | electron-builder 打包配置、常见故障、版本一致性清单（§11）              |
| [ci-cd.md](docs/ci-cd.md)                 | CI/CD 工作流：PR/push 验证、main 分支自动版本递增与发版触发（§15）         |
| [auto-release.md](docs/auto-release.md)   | 自动发版工作流：Windows runner 打包 + GitHub Release 自动创建（§16） |
| [testing.md](docs/testing.md)             | 测试结构与用例说明（§12）                                       |
| [CHANGELOG.md](docs/CHANGELOG.md)         | 版本历史                                                 |
| [archive/INDEX.md](docs/archive/INDEX.md) | 历史归档：已结束的规划 / 实验 / 重构交接文档（非当前 Wiki，只读保留）             |

> 开发者完整参考（架构决策、开发约定、构建陷阱）见仓库根目录的 [AGENTS.md](AGENTS.md)。

### 按任务快速定位

- **初次接触项目**：按 [architecture.md](docs/architecture.md) → [core-modules.md](docs/core-modules.md) → [frontend.md](docs/frontend.md) 顺序阅读。

- **改 IPC**：先读 [ipc-channels.md](docs/ipc-channels.md)，改完跑 `pnpm lint`（`verify-ipc-sync.cjs` 校验）。

- **改参数**：对照 [params/LLAMA\_SERVER\_PARAMS.md](docs/params/LLAMA_SERVER_PARAMS.md) 与 [params-system.md](docs/params-system.md)，改完跑 `node scripts/verify-params-sync.cjs`。

- **改 UI**：先对照 [frontend.md](docs/frontend.md) §7.5 检查清单；发现问题登记 [style/STYLE\_TODO.md](docs/style/STYLE_TODO.md)。

- **打包 / 发版**：先读 [packaging.md](docs/packaging.md) §11（junction 陷阱、输出目录锁定）+ [ci-cd.md](docs/ci-cd.md) + [auto-release.md](docs/auto-release.md)（GitHub Actions 流水线）。

- **做架构优化**：先对照 [design-decisions.md](docs/design-decisions.md) 与 [core-modules.md](docs/core-modules.md) 的既有架构约束，改完登记 [CHANGELOG.md](docs/CHANGELOG.md)。

***

## 特性一览

### 现代化桌面体验

- 基于 **Electron 44 + Vue 3 + Vite 8**，界面响应迅速

- **胶囊玻璃设计**（2026-08 重构）：交互元素胶囊化 + 全局半透明毛玻璃（单层模糊）+ 果冻弹性动效 + 统一蓝色系点缀（accent 用于下载进度条 / 分区装饰条 / 选中态等次级点缀；主按钮走黑白高对比 `--primary-*`，不用 accent 实底）

- 布局延续顶栏模型选择、可折叠侧边栏、底部状态栏的桌面范式

- 支持 **浅色 / 深色主题** 切换（`Ctrl+D`）

- 支持 **中文 / 英文** 界面语言切换

- **专属应用图标**：自绘羊驼品牌图标，统一用于标题栏、任务栏、Alt-Tab 与安装包

- **默认最大化启动**：应用每次启动即自动最大化窗口呈现

- **窗口几何持久化**：自动记忆窗口位置、大小与最大化状态（启动固定最大化，几何用于初始化尺寸）

### 全覆盖的参数配置

- 内置 **60 个** **`llama-server`** **参数**，分 3 组管理（基础 / 高级 / 服务）

- **参数基线对齐 llama.cpp b10734**：参数定义与 `--help` 输出经 `scripts/verify-params-sync.cjs` / `verify-help-drift.cjs` 双向审计（基线帮助固定于 `docs/params/llama-server-help-out.txt`，二进制升级走 re-pin 流程）；覆盖 b10734 新能力——惰性张量读取（`--lazy-mode`）、CPU FFN 层数（`-ncffn`）、每槽位统一 KV 上限（`--kv-unified-per-slot`）、投影器设备（`-mmdev`）、视频多模态（`--video-fps` 等）与投机合成基准（`--spec-synth-*`）

- 参数与 llama-server 的完整对照见 [params/LLAMA\_SERVER\_PARAMS.md](docs/params/LLAMA_SERVER_PARAMS.md)

- **硬件资源占用估算与性能目标**：按当前硬件（`--list-devices` 显存探测 + GGUF KV 内存模型）估算显存/内存双侧占用（随卸载层数、上下文、KV 档位实时联动，超限橙色警示）；四档性能目标（最大上下文/均衡/最低延迟/省显存）一键应用联动建议（上下文按显存+内存联合预算推算无 OOM 最大值）；OOM 启动失败时给出「上下文减半 / KV 量化」缓解动作

- 模型列表标注各量化文件的**显存适配性**（✓ 全卸载 / △ 部分卸载 / ✗ 建议降档），并可运行 llama-bench 离线体检实测 prefill / decode 速度

- 参数控件类型丰富：滑块、数字输入、下拉框、开关、文件选择、目录选择

- 鼠标悬停参数标签即可查看中文/英文帮助说明

- 参数无独立启用开关：值与默认值不同的参数才生成到命令行，其余使用 llama-server 内置默认值（旧版逐参数启用机制已随双轨参数逻辑移除）

- **参数依赖声明**：参数间通过 `dependsOn` 声明依赖关系，运行时检测并可视化提示

- **GGUF 元数据联动**：参数行内显示模型内置值，一键应用

### 应用设置

- **统一入口**：引擎目录（`llama-server.exe` 内联检测）、模型目录、HuggingFace 镜像源、最大并发下载数、主题、语言全部收敛到「应用设置」页（侧边栏齿轮入口），更改即时保存；此前分散在模型管理页与下载页的设置控件已移除

- **引擎内联检测**：选择 llama-server 所在目录（含一级子目录）自动检测可执行文件，行内图标提示检测状态（检测中/已检测/文件缺失/未找到），无需手动选择文件

- **镜像源可配置**：受限网络可指向自建镜像或内网缓存（默认 hf-mirror.com），下载/列表/传输选择全部跟随

- 主题与语言统一由本页「外观与语言」卡片调整（`Ctrl+D` 快捷键仍可切换主题；视觉效果固定为默认玻璃形态，无开关）

### 模型管理

- 一键递归扫描本地 `.gguf` 模型（模型目录在「应用设置」页指定）

- 表格展示模型名称、大小，**伴随文件标签**（mmproj / dflash / draft 徽章，按模型目录检测）；悬停名称查看完整路径

- **文件管理**：每行可「打开目录」在系统文件管理器中定位，或「移除」按模型子目录删除（含 mmproj/草稿等伴随文件，带确认与路径越界保护）；移除时同步清理关联该模型的预设文件（model 路径匹配，存于 `<models_dir>/presets/`）

- **智能刷新机制**：目录变化时自动扫描、文件系统监听文件增删自动刷新，无需手动刷新按钮

- **GGUF 元数据读取**：流式读取 60 个字段（架构、量化、上下文长度、采样参数、组织/许可证/数据集等），内存占用恒定

- **智能建议参数**：从模型元数据自动推导建议参数（上下文长度、采样、KV 缓存量化、Flash Attention、推测解码类型、别名等 12 条规则），一键应用

- **多模态投影器自动检测**：模型路径变化时自动检测同目录下的 mmproj 文件并填入；另支持视频多模态参数（`--video-fps` / `--video-timestamp-interval` / `--video-ffmpeg-dir`，b10734+）与投影器设备（`-mmdev`，自动/按 `--list-devices` 动态设备名）

- 实时监听模型目录变化，文件增删时自动刷新

### 在线模型下载

- 粘贴 LM Studio / HuggingFace / HF Mirror / ModelScope 链接，自动解析来源（HuggingFace/HF Mirror 走镜像直链，其余搜索 ModelScope 对应模型）

- 展示模型仓库中的 GGUF 文件列表，支持多选下载；推荐文件带「推荐」徽标并排序置顶提示，但**不自动勾选**，下载文件完全由用户主动勾选决定

- **多任务并发下载**（并发数在「应用设置」页配置，1–5），支持断点续传

- **暂停 / 恢复 / 失败重试**：下载任务可随时暂停，恢复后从断点继续，失败后可一键重试

- 下载目录结构：`模型目录/作者/模型仓库名/文件`（同一模型的多文件放同一子目录）

- 实时进度条、下载速度、状态显示

- 下载完成后自动刷新模型列表

### 预设管理

- 在「参数设置」页的预设标签中保存当前参数配置为预设，**自动以模型别名生成预设名**（可手动修改）

- 加载 / 覆盖 / 删除预设

- 预设保存参数值快照，加载时完整恢复

- **预设文件存储在模型目录下的** **`presets/`** **子目录**，与模型文件集中管理

### 性能测试

- 在「参数设置」页的性能测试标签中，通过 `--metrics` 端点 + completion `timings` 在线实测真实吞吐（生成/提示 tok/s、DFlash 接受率），帮助找到最佳参数组合

- 自动跟随「自定义参数」子标签中值 ≠ 默认值的参数（控件与参数配置页完全一致，值实时同步）

- **智能启动检测**：服务未运行自动启动、运行中参数一致则复用不重启、不一致则自动重启；一次性「运行测试」始终执行单并发，多并发仅在服务器并行槽位 `-np ≥ 2` 时执行（并发数 = min(np, 8)）

- **测试历史表格**：每次运行自动追加记录，调整参数前后并排对比（内存态，关闭应用清空）

- 注：`llama-bench` 等 CLI 不支持 DFlash/推测解码评测，故采用运行中 llama-server 在线实测

### 启动与监控

- 实时命令预览栏，所见即所得；内置参数命令（自动生成、只读展示）与扩展参数（自定义、持久化、追加到启动命令）分两个文本框，互不干扰

- 启动前参数摘要预览，快速核对已启用参数

- 实时服务器输出控制台（上限 5000 行），从其他页面切回自动滚动到最新日志

- 一键启动 / 停止 / 重启；侧边栏「内置 Web UI」或顶栏「打开 Web UI」进入应用内嵌 Web UI（`/webui` 页，服务运行时直接内嵌查看，不再跳转外部浏览器）

- 状态栏显示运行地址、模型名称，点击复制

### llama 版本兼容

- **目录选择 + 内联检测**：用户在「应用设置」页选择 llama-server 所在目录，应用自动检测目录（含一级子目录）中的 `llama-server.exe`，无需手动选择文件

- **不打包二进制**：应用本身不捆绑 llama.cpp 二进制，用户可自行替换任意版本，互不干扰

- **通用启动检测**：兼容不同版本 llama-server 的 "listening" 日志格式

- **DFlash/推测解码自动检测**：模型切换时自动检测同目录的 dflash/draft 草稿模型并配置对应 `--spec-type`（dflash → `draft-dflash` + `-fa on` + n\_max 15）

- 开发模式下自动扫描项目目录下的 `llama-*-bin-*` 目录

***

## 技术栈

| 层        | 技术                               | 说明             |
| -------- | -------------------------------- | -------------- |
| 桌面框架     | Electron 44                      | 跨平台桌面运行时       |
| 前端框架     | Vue 3.5 + Pinia 4 + Vue Router 5 | 响应式 UI         |
| 构建工具     | Vite 8 + vue-tsc 3               | 快速 HMR + 类型检查  |
| 语言       | TypeScript 6                     | 全栈类型安全         |
| Monorepo | pnpm workspace + Turborepo       | 多包管理           |
| 打包       | electron-builder                 | Portable 单文件输出 |
| 测试       | Vitest 4                         | 单元测试           |

***

## 项目结构

```text
llama_launcher/
├── apps/
│   └── desktop/              # Electron 桌面应用
│       ├── src/
│       │   ├── main/         # 主进程（IPC、窗口、launcher 桥接、托盘、传输注入）
│       │   └── preload/      # preload 脚本（contextBridge）
│       └── electron-builder.config.cjs   # 打包配置（Portable 单文件）
├── packages/
│   ├── core/                 # 核心逻辑（进程管理、命令构建、GGUF、下载、清理）
│   ├── shared/               # 共享类型、参数定义、i18n
│   └── ui/                   # Vue 3 前端
├── scripts/                  # 构建辅助脚本（打包清理、同步校验、参数审计等）
├── docs/                     # 分类文档（项目 Wiki，详见上方文档地图）
├── AGENTS.md                 # 开发者完整参考（架构约定、构建陷阱、同步校验）
├── README.md                 # 本文件（唯一 README：功能总览 + 快速开始 + 使用指南）
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

> `llama-*-bin-*` 目录为开发用的 llama.cpp 二进制（版本不固定），由 `paths.ts` 在开发模式下动态查找。生产构建不打包二进制，用户在「应用设置」页选择引擎目录。

### Monorepo 包依赖

```
@llama-launcher/desktop
  ├── @llama-launcher/core
  └── @llama-launcher/shared

@llama-launcher/core
  └── @llama-launcher/shared

@llama-launcher/ui
  └── @llama-launcher/shared
```

`shared` 包是所有类型定义、参数表和多语言字典的唯一来源，`core` 和 `ui` 均依赖它。完整目录树见 [architecture.md](docs/architecture.md) §2。

***

## 快速开始

### 环境要求

- Node.js >= 20

- pnpm 11.21.0

- Windows / macOS / Linux

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

此命令会启动 Vite dev server 和 Electron 主进程，支持 UI 热重载。

### 构建生产版本

```bash
pnpm build
```

### 打包安装程序

```bash
pnpm dist
```

打包前会自动终止可能占用文件的 llama Launcher 进程并清理输出目录。打包时不包含 llama.cpp 二进制，用户在首次使用时选择 llama-server 所在目录即可。

### 运行测试

```bash
pnpm test
```

### 类型检查 + 同步校验

```bash
pnpm lint
```

运行各包类型检查（`tsc --noEmit`），并校验 IPC 预生成常量未过期（`verify-ipc-sync.cjs`）与文档链接/锚点完整（`check-docs-links.cjs`）。

***

## 使用指南

### 1. 配置 llama-server 路径

首次启动时，在侧边栏「应用设置」页（引擎卡片）点击"更改"选择 llama-server 所在目录。应用会自动检测目录（含一级子目录）中的 `llama-server.exe`（Windows）或 `llama-server`（macOS/Linux），无需手动选择可执行文件。

开发模式下应用会自动扫描项目目录下的 `llama-*-bin-*` 目录。

### 2. 设置模型目录

在「应用设置」页设置存放 `.gguf` 模型文件的目录。应用会递归扫描该目录下的所有 `.gguf` 文件（多模态投影器文件会自动识别并排除）。

### 3. 选择模型

在模型列表中点击选择模型，应用会自动：

- 读取 GGUF 元数据（架构、量化、上下文长度等）

- 推导建议参数并显示在参数行内

- 检测同目录下的多模态投影器文件与草稿模型（dflash/draft，自动配置推测解码）

### 4. 调整参数

在"参数设置"页面调整 60 个启动参数（3 个子标签：参数预设 / 自定义参数 / 性能测试；自定义参数内按 13 个子分类分区，如网络 / 上下文 / 采样 / KV 缓存 / 推测解码等）。参数没有独立启用开关：值与默认值不同的参数才会出现在命令行中；参数默认值自动持久化为"会话参数"，重启应用后恢复。

点击"应用建议参数"可一键应用从 GGUF 元数据推导的参数（会先重置当前参数）。

### 5. 保存预设

在"参数设置"页的"预设"标签保存当前参数配置。预设名会自动以模型别名生成，你也可以手动修改。

### 6. 性能测试（可选）

在"参数设置"页的"性能测试"标签点击「运行测试」：

- 自动用当前参数启动/重启服务（参数一致则复用不重启）

- 在线实测生成/提示 tok/s 与 DFlash 接受率，测试历史表格自动追加记录，便于调整参数前后对比

- 模型/参数配置错误时给出明确提示，不会长时间卡在等待状态

### 7. 启动服务

在"服务"页面点击启动按钮，应用会启动 `llama-server` 子进程并实时显示输出。启动后可点击侧边栏"内置 Web UI"（或顶栏"打开 Web UI"），在应用内直接使用 llama-server 的 Web UI（内嵌 iframe，不再跳转外部浏览器）。

### 8. 下载模型

在"模型管理"页的"模型库"子标签粘贴 LM Studio / HuggingFace / HF Mirror / ModelScope 链接。HuggingFace/HF Mirror 链接走镜像直链列出文件，其余来源自动搜索 ModelScope 中的对应模型，展示 GGUF 文件列表：推荐文件带「推荐」徽标并排在最前（不自动勾选），勾选所需文件后点"下载所选"开始下载，下载进度与任务管理（暂停/恢复/重试）就在模型库下方任务区查看。下载完成后模型列表会自动刷新。

### 安全下载

首次从 GitHub 下载 `.exe` 时，Windows Defender SmartScreen 可能显示「未识别的应用程序」警告。这是因为本应用暂未使用付费数字签名证书，属于正常现象。

按以下步骤即可安全运行：

1. 双击 `.exe` 后，点击左下角「**更多信息**」
2. 点击「**仍要运行**」
3. 应用正常启动，此后不再提示

***

## IPC 通道

应用通过 56 个 IPC 通道实现主进程与渲染进程通信，分为 10 类：

| 类别       | 通道数 | 说明                                    |
| -------- | --- | ------------------------------------- |
| Settings | 2   | 加载/保存应用设置                             |
| Models   | 7   | 扫描、mmproj/草稿检测、GGUF 读取、目录监听、移除、变更通知   |
| Presets  | 4   | 预设 CRUD                               |
| Server   | 7   | 启动/停止/重启/状态/命令预览/输出推送/性能测试            |
| Logs     | 3   | 应用日志读取/清空/推送（区别于服务控制台）                |
| 通用       | 3   | 剪贴板、打开外链、打开目录                         |
| Window   | 8   | 关闭、最小化、最大化切换、状态查询、最大化/还原通知、关闭弹窗一问一答   |
| System   | 11  | 端口检测（含占用者识别）、结束进程、空闲端口扫描、文件存在检测、llama-server 查找、回收站检测/清理、显存/内存占用估算、llama-bench 离线体检（运行/状态）、模型适配估算 |
| Download | 10  | URL 解析、搜索、文件列表、下载、取消、暂停、恢复、进度/完成/错误推送 |
| FS       | 2   | 目录列表、创建目录                             |

IPC 常量唯一事实源为 `packages/shared/src/types/ipc.ts`，preload 侧由 `scripts/generate-preload.cjs` 生成，`scripts/verify-ipc-sync.cjs` 在 lint 阶段校验产物未过期。完整清单见 [ipc-channels.md](docs/ipc-channels.md)。

***

## 配置文件

应用配置存储在 `~/.llama_launcher/` 目录下：

```
~/.llama_launcher/
└── settings.json     # 应用设置
```

预设文件存储在用户设置的模型目录下的 `presets/` 子目录，与模型文件集中管理。

### settings.json 字段

| 字段                        | 类型                            | 说明                                                               |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `settings_version`        | number                        | settings schema 版本（当前 1，字段变更走 `migrateSettings` 迁移）              |
| `server_exe`              | string                        | llama-server 可执行文件路径（由 `llama_dir` 内联检测自动填充）                     |
| `llama_dir`               | string                        | llama.cpp 引擎目录（用户选择的包含 llama-server 的目录）                         |
| `models_dir`              | string                        | 模型存储目录                                                           |
| `selected_model`          | string                        | 当前选中的模型路径                                                        |
| `last_preset`             | string                        | 上次加载的预设名                                                         |
| `window_geometry`         | string                        | 窗口位置和大小（`x,y,width,height`）                                      |
| `window_maximized`        | boolean                       | 窗口最大化状态记录（应用启动固定最大化；该字段仍保存以兼容旧数据/未来可恢复"记住还原"）                    |
| `theme_mode`              | 'dark' \| 'light' \| 'system' | 主题模式（`system` 跟随系统 `prefers-color-scheme`）                       |
| `close_behavior`          | 'ask' \| 'exit' \| 'tray'     | 关闭窗口时：询问/直接退出/最小化到托盘                                             |
| `sidebar_collapsed`       | boolean                       | 侧边栏是否折叠                                                          |
| `language`                | 'zh' \| 'en'                  | 界面语言                                                             |
| `last_tab`                | string                        | 上次访问的页面                                                          |
| `download_max_concurrent` | number                        | 最大并发下载数（1–5）                                                     |
| `hf_mirror_host`          | string                        | HuggingFace 镜像源（空 = 默认 hf-mirror.com）                            |
| `custom_args`             | string                        | 扩展参数（追加到启动命令末尾的自定义参数，命令预览独立框编辑、持久化；「还原」不影响它）                     |
| `session_values`          | object \| null                | **参数会话**（临时轨道）：当前生效参数快照，随变化节流 800ms 写入，重启恢复会话；永不写入预设文件           |
| `session_baseline`        | object \| null                | **参数会话基线**：`{ preset_name, values }`，会话加载的预设及应用时刻快照；null = 无预设基线 |

***

## 文档编写约定

所有 `docs/` 文档遵循统一编写逻辑与格式（新增/修改文档时请保持一致）：

1. **标题**：`# 文档名`，一句概括主题。
2. **范围说明**：标题下紧跟两行说明块——第一行 `> 范围：<覆盖内容>`，第二行 `> 索引：<本 README 相对链接> · 相关：<相关文档相对链接>`；说明本文覆盖范围、指向本索引、列出相关文档（docs/ 内一律相对路径）。
3. **章节编号**：沿用架构文档原有编号（`N.x`），跨文档引用用「文档名 §N.x」或相对链接，不重编章节号（保证链接锚点稳定）。
4. **术语统一**：参数/预设/性能测试/打包等术语与 `AGENTS.md`、`docs/params/LLAMA_SERVER_PARAMS.md` 一致。
5. **链接**：docs/ 内部一律相对路径（`frontend.md`、`style/STYLE_TODO.md`）；代码路径用反引号（如 `packages/ui/src/styles/`）。
6. **来源**：拆分自原 CODE\_WIKI.md 的章节保持内容原样（仅调整格式），新增内容标注日期；待修复/已知问题登记到 `style/STYLE_TODO.md` 而不是散落在正文。
7. **例外（保持自身格式）**：`docs/CHANGELOG.md`（历史版本记录，按版本分组）、`docs/params/LLAMA_SERVER_PARAMS.md`（由 `scripts/generate-params-doc.cjs` 生成，勿手改）。

***

## 许可证

MIT
