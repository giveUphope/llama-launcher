| 57 个 IPC 通道清单# llama Launcher

> 给 llama.cpp `llama-server` 用的桌面启动器 —— 选模型、调参数、一键起服务、看日志。

> 语言：中文 · [English](README.en.md)

[![stack](docs/badges/stack.svg)](#技术栈)
[![license](docs/badges/license.svg)](#许可证)

***

## 它在替你做掉什么

llama.cpp 自带服务端只有命令行：要跑起来得手拼 `-m`、`-c`、`-ngl` 等几十个参数，换个模型再来一遍。本应用把这些收进界面：

- 选好目录后点模型就能跑，**当前会执行哪条命令实时显示在屏幕上**，改了哪个参数一眼可见。
- 模型文件自带的信息（上下文长度、量化方式、推荐采样值）会被读出来，**给出一套建议参数**，不满意再手调。
- 服务的启动、停止、重启、日志、访问地址都在同一个窗口里，不用再开终端或浏览器。
- 应用**不打包** llama.cpp 二进制：指定一次引擎目录即可，之后自行换版本互不影响。

***

## 功能一览

**界面**

- Electron 44 + Vue 3 + Arco Design，浅色 / 深色主题、中 / 英文双语。
- 7 页侧边导航：总览 / 模型 / 服务 / 参数 / 日志 / 内置 Web UI / 设置。

**参数配置**

- **64 个** `llama-server` 参数，按 14 个分区归类（含「安全与跨域」）（网络 / 上下文 / KV 缓存 / 采样 / 推测解码…），基线对齐 llama.cpp **b11178**。
- 滑块 / 下拉 / 开关 / 文件选择齐全，悬停标签看中文说明；值与默认值不同才写进命令行。
- 改动自动存为「会话参数」，重启回到上次状态；要长期保留才显式存成预设（双轨机制）。
- 参数间 `dependsOn` 依赖联动：前置条件不满足时自动重置并提示。

**硬件适配**

- 显存 + 内存双侧占用估算，超限橙色警示；四档性能目标（最大上下文 / 均衡 / 最低延迟 / 省显存）一键联动。
- 模型列表标注 ✓ 全卸载 / △ 部分卸载 / ✗ 建议降档；可跑 llama-bench 实测 prefill / decode 速度。

**模型与下载**

- 递归扫描 `.gguf`，流式读取 60 个元数据字段（内存恒定），据此推导建议参数一键套用。
- 自动识别多模态投影器 mmproj 与 dflash / draft 草稿模型并配好推测解码；目录增删自动刷新。
- 粘贴 LM Studio / HuggingFace / HF Mirror / ModelScope 链接即解析；1–5 路并发、断点续传、暂停 / 恢复 / 重试。

**运行与兼容**

- 命令实时预览、启动前摘要核对、控制台 5000 行上限（切回页面自动滚到最新）、应用内嵌 llama-server Web UI。
- 引擎目录（含一级子目录）自动检测可执行文件，行内图标提示检测状态；「listening」日志识别兼容不同版本格式。

> 每条的完整规则（参数对照表、依赖联动、GGUF 建议条目、估算模型）在 `docs/` 展开，见下方[文档地图](#文档地图)。

***

## 快速开始

```bash
pnpm install     # Node >= 20、pnpm 11.21.0，Windows / macOS / Linux
pnpm dev         # 开发模式：Vite + tsc watch + Electron 热重载（Ctrl+C 一次即退）
pnpm build       # 类型检查 + 构建全部包
pnpm dist        # 打包 Portable 单文件 → release/*.exe
pnpm test        # 单元测试（core + ui）
pnpm lint        # 类型检查 + IPC / 参数三方对拍 / 版本一致性 / 文档链接与写死路径 / 中英双树配对 / i18n 校验 + oxlint 门禁
```

- **改完跑什么**：`pnpm lint` 一把覆盖（含 `verify-ipc-sync` / `verify-params-sync` / `verify-version-sync` / `check-docs-links` / `verify-doc-pairs` / `verify-i18n-usage`，文档里写死的通道数、参数总数与分组数、版本号漂移、以及中英双树只改一侧都会直接 fail）。动过 IPC 通道先 `pnpm generate:ipc`（通道定义在 `packages/shared/src/types/ipc.ts`）；动过参数表还需对照 [docs/zh/params/LLAMA_SERVER_PARAMS.md](docs/zh/params/LLAMA_SERVER_PARAMS.md)（该表由脚本一次生成中英两份，勿手改）。
- **E2E**：`pnpm e2e:web`（渲染层）/ `pnpm e2e:electron`（Electron 冒烟），首次需 `pnpm exec playwright install chromium`，详见 [testing.md](docs/zh/testing.md)。
- **首次运行提示**：从 GitHub 下载 `.exe` 后 Windows Defender SmartScreen 可能提示「未识别的应用程序」——本应用暂未使用付费签名证书，属正常现象，点「更多信息」→「仍要运行」即可，此后不再提示。

***

## 使用流程

1. **应用设置** → 选 llama-server 所在目录（自动检测可执行文件）与模型存放目录，可顺手配主题、语言、镜像源、并发下载数。
2. **模型** → 点选一个 `.gguf`，元数据与伴随文件（mmproj / 草稿模型）自动读取。
3. **参数设置** → 需要才调；「应用建议参数」按模型元数据一键套用（会先重置当前参数）。
4. 想长期保留这组参数，就在「预设」标签存一份 —— 预设文件写在模型目录的 `presets/` 子目录下，跟模型放在一起。
5. **服务** → 启动并看控制台输出；点顶栏「打开 Web UI」或侧边栏「内置 Web UI」在应用内直接使用。
6. llama.cpp 的冷门参数不在 60 个里？写进命令预览的**扩展参数**框，会原样追加到启动命令末尾，「还原」参数时不受影响。
7. 本地没有模型 → 「模型管理」页的**模型库**子标签粘贴链接下载，完成后列表自动刷新。

***

## 项目结构

```text
apps/desktop/      # Electron：src/main 主进程、src/preload 桥接、electron-builder 配置
packages/shared/   # 唯一事实源：类型、60 参数表、i18n（zh/en）
packages/core/     # 业务逻辑：进程、命令构建、GGUF 读取、模型扫描、下载、清理
packages/ui/       # Vue 3 前端：路由、Pinia store、7 个页面
scripts/           # 构建与校验脚本（IPC 生成、参数/文档同步审计、打包钩子）
docs/              # 项目 Wiki（即下方文档地图）
```

依赖单向：`desktop → core + shared`、`core → shared`、`ui → shared`，`shared` 不依赖任何上层包。完整目录树与依赖流见 [architecture.md](docs/zh/architecture.md) §2–3；开发者约定与构建陷阱见 [AGENTS.md](AGENTS.md)。

***

## 技术栈

Electron 44 · Vue 3.5 + Pinia 4 + Vue Router 5 · TypeScript 6 · Vite 8 + vue-tsc 3 · pnpm workspace + Turborepo · electron-builder（Portable 单文件） · Vitest 4 + Playwright

***

## 文档地图

全部文档在 `docs/zh/`（英文镜像在 [`docs/en/`](docs/en/architecture.md)，每篇标题下都有中英互链），本文件是**中文默认着陆页**，英文版见 [README.en.md](README.en.md)（两份同结构、同数字）。想弄明白某件事对应读哪一篇：

| 想弄明白…                               | 读这里                                                                 |
| ----------------------------------- | ------------------------------------------------------------------- |
| 60 个参数与 `--help` 的逐条对照              | [params/LLAMA\_SERVER\_PARAMS.md](docs/zh/params/LLAMA_SERVER_PARAMS.md) |
| 整体结构、目录树、Monorepo 依赖流               | [architecture.md](docs/zh/architecture.md)                             |
| 核心模块（进程、命令构建、GGUF、下载、清理）与关键函数索引     | [core-modules.md](docs/zh/core-modules.md)                             |
| 参数系统与双轨（会话 / 预设）、依赖联动、控件组件          | [params-system.md](docs/zh/params-system.md)                           |
| Electron 主进程（窗口、IPC 注册、托盘、preload）  | [desktop-main.md](docs/zh/desktop-main.md)                             |
| 57 个 IPC 通道清单（改 IPC 前必读）            | [ipc-channels.md](docs/zh/ipc-channels.md)                             |
| 前端架构 + **UI 风格规范 §7.5**            | [frontend.md](docs/zh/frontend.md)                                     |
| 类型定义与持久化（`settings.json` 全字段、预设格式） | [data-persistence.md](docs/zh/data-persistence.md)                     |
| 打包配置与常见故障（junction 陷阱、输出目录锁定）      | [packaging.md](docs/zh/packaging.md)                                   |
| CI/CD 与自动发版流水线                      | [ci-cd.md](docs/zh/ci-cd.md) · [auto-release.md](docs/zh/auto-release.md) |
| 测试结构与 E2E                           | [testing.md](docs/zh/testing.md)                                       |
| 日常命令、提交与发版约定、**文档编写约定**            | [workflow.md](docs/zh/workflow.md)                                     |
| 关键设计决策                              | [design-decisions.md](docs/zh/design-decisions.md)                     |
| UI 风格待修复清单                          | [style/STYLE\_TODO.md](docs/zh/style/STYLE_TODO.md)                    |
| 版本历史                                | [CHANGELOG.md](docs/CHANGELOG.md)                                   |
| 已结束的规划 / 实验 / 重构交接（只读归档）           | [archive/INDEX.md](docs/archive/INDEX.md)                           |

初次接触项目建议按 [architecture.md](docs/zh/architecture.md) → [core-modules.md](docs/zh/core-modules.md) → [frontend.md](docs/zh/frontend.md) 的顺序读。

***

## 许可证

MIT
