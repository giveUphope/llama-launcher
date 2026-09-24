# 开发工作流

> 语言：中文 · [English](../en/workflow.md)
> 范围：开发工作流：构建、类型检查、测试、打包、文档维护与文档编写约定（含中英双树配对规则）。
> 索引：[README.md](../../README.md) · 相关：[architecture.md](architecture.md) · [packaging.md](packaging.md)

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发模式（`scripts/dev.cjs` 三进程编排，不经 turbo） |
| `pnpm build` | 构建所有包 |
| `pnpm test` | 运行测试 |
| `pnpm lint` | 类型检查 + IPC 同步校验（`verify-ipc-sync.cjs`）+ 参数三方对拍与字典/计数校验（`verify-params-sync.cjs`）+ 版本声明一致性（`verify-version-sync.cjs`）+ 文档链接检查（`check-docs-links.cjs`，可单独 `pnpm docs:check`）+ i18n 六项检查（`verify-i18n-usage.cjs`）+ oxlint（`pnpm lint:ox`） |
| `pnpm dist` | 打包 Portable 单文件（根目录一条命令，委托 `@llama-launcher/desktop dist`；electron-builder，输出 `release/*.exe`，自动处理输出目录锁定回退） |

开发模式热重载由 `scripts/dev.cjs` 编排三进程：Vite dev server（UI HMR）+ `tsc -b --watch`（shared/core/desktop 增量重建）+ `scripts/dev-watch.cjs`（监视主进程 dist / preload 源 / shared 类型，变更时自动重新生成 preload 并重启 Electron，通过 `LLAMA_DEV_SKIP_QUIT_KILL=1` 避免热重启连带杀掉 dev 会话树）。改 UI 组件/样式即时热更；改 core/shared/主进程/preload 代码自动重建并重启，无需手动操作。退出语义：任一任务先退出即以它的退出码结束整个会话，其余任务按进程树 `taskkill /T /F` 清理（用户关窗 → dev-watch 退 0 → vite/tsc 一并收走，端口不残留）。

**为什么不用 turbo / concurrently / 子命令里嵌 `pnpm`**：Windows 下这些都会经 `node_modules/.bin` 的 `.cmd` 批处理 shim，而 cmd.exe 在批处理等待子进程时收到 Ctrl+C 会打印 `Terminate batch job (Y/N)?` 并阻塞等待按键——旧链路叠了 4 层批处理，于是一次 Ctrl+C 退不出去（需要按两次，且 turbo 要等满优雅超时才 `Force killed Turborepo tasks`）。`dev.cjs` 三个任务全部由 node 直接执行依赖 `package.json` 里 `bin` 指向的真实 JS 入口，零批处理层，一次 Ctrl+C 即退出；新增 dev 任务须沿用同一写法。

---

## 依赖维护（迭代评估入口）

定期用以下命令评估依赖新鲜度（本仓库走 npmmirror 镜像）：

```bash
pnpm outdated -r                 # 哪些依赖可更新（-r 覆盖全部 5 个 workspace 包）
pnpm install --frozen-lockfile   # 校验 lockfile 与 package.json 同步（CI 里默认强制此模式）
```

**升级流程**：改 `package.json` 版本声明 → `pnpm install --no-frozen-lockfile`（刷新 lockfile）→ `pnpm lint` + `pnpm test` + `pnpm build` 全绿 → 再 `pnpm install --frozen-lockfile` 复验 → 更新 `docs/CHANGELOG.md [Unreleased]`。

**当前边界（2026-09-01）**：TypeScript 钉在 `^6.0.3`——TS 7.0（Go 原生）无稳定程序化 API（7.1 提供）且 `vue-tsc` 最新版仍崩溃（`./lib/tsc` 不再导出，上游修复 vuejs/language-tools#6123 未发布）。升级到 `^7` 的触发条件：① npm 发布包含 #6123 的 `vue-tsc`，或 ② TypeScript 7.1 稳定 API 落地且 vue-tsc 适配；届时一并评估 `--no-daemon` 去留（turbo 3.0 尚未发布，该 flag 的处理以发布后官方说明为准）。

---

## 文档编写约定

所有 `docs/` 文档遵循统一编写逻辑与格式（新增/修改文档时请保持一致）。仓库根是**中英成对的两份着陆页**：[README.md](../../README.md)（英文）与 [README.zh-CN.md](../../README.zh-CN.md)（中文），各只保留「是什么 / 亮点 / 快速开始 / 使用流程 / 项目结构 / 技术栈 / 文档地图 / 许可证」八块，深度细节一律下沉到 `docs/`；`docs/` 内部按语言分两树——`docs/zh/`（中文权威版）与 `docs/en/`（英文镜像版），同名同结构一一对应：

1. **标题**：`# 文档名`，一句概括主题。
2. **说明块**：标题下紧跟三行——第一行**语言行**（中文侧以「语言：中文 · 」开头，后接一个指向同深度 `../en/` 同名文件的 English 链接；英文侧以「Language: English · 」开头，后接一个指向 `../zh/` 同名文件的中文链接；`docs/*/` 子目录内深度多一层，前缀改 `../../`），第二行 `> 范围：<覆盖内容>`，第三行 `> 索引：<README 相对链接> · 相关：<相关文档相对链接>`。语言行是双语配对的可见入口，缺它等于英文读者进不来。**注意：本节刻意不把语言行写成方括号链接语法**——`check-docs-links.cjs` 会连行内代码里的链接示例一并解析，占位目标会被判成断链。
3. **章节编号**：沿用架构文档原有编号（`N.x`），跨文档引用用「文档名 §N.x」或相对链接，不重编章节号（保证链接锚点稳定）。**中英两树保留同一套编号**，这样「frontend.md §7.5.4」在两种语言里都成立。
4. **术语统一**：参数/预设/打包等术语与 `AGENTS.md`、`docs/zh/params/LLAMA_SERVER_PARAMS.md` 一致。
5. **链接**：docs/ 内部一律相对路径（`frontend.md`、`style/STYLE_TODO.md`）；**指向兄弟文档时只指同语言树**（英文文档链 `docs/en/*`，中文文档链 `docs/zh/*`），链到 `docs/CHANGELOG.md`、`docs/archive/**` 这类不译的历史内容则两树共用同一路径；代码路径用反引号（如 `packages/ui/src/styles/`）；README / README.zh-CN.md 与 AGENTS.md 的相对链接与锚点由 `scripts/check-docs-links.cjs` 校验（`pnpm docs:check`）。**英文文档不得沿用中文标题产生的 `#锚点`**（英文标题 slug 不同），去掉锚点只留文件链接。
6. **双语同步方向**：先改中文，再同步英文镜像，**只改一侧视为未完成**；新增文档必须两树同时建。数字类声明（参数总数、通道数、分组数、实测像素与毫秒）两树必须相等——`verify-ipc-sync.cjs` 与 `verify-params-sync.cjs` 已递归扫两树，英文句式（"56 channels"）与中文句式（「56 个通道」）同样受检，翻译时漏掉一侧会当场 fail。
7. **不译清单**：`docs/CHANGELOG.md`（版本历史）、`docs/archive/**`（只读归档）、`docs/params/llama-server-help-out.txt`（语言无关的 help 基线）、`docs/badges/` 保持单份，不建 `en/` 镜像；两个门禁也按此跳过它们。
8. **来源**：拆分自原 CODE\_WIKI.md 的章节保持内容原样（仅调整格式），新增内容标注日期；待修复/已知问题登记到 `style/STYLE_TODO.md`（中英两份）而不是散落在正文。
9. **例外（保持自身格式）**：`docs/CHANGELOG.md`（历史版本记录，按版本分组）、`docs/{zh,en}/params/LLAMA_SERVER_PARAMS.md`（由 `scripts/generate-params-doc.cjs` **一次产出中英两份**，勿手改任何一侧）。
10. **表述风格**：见 [AGENTS.md](../../AGENTS.md)「表述风格」一节——先说清现象再上技术细节，方案讲明「改哪里 / 为什么这里 / 怎么验证」，流程与状态机优先用 Mermaid 图示而非文字描述箭头链路。
