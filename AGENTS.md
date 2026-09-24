# AGENTS.md — llama Launcher

Desktop launcher for llama.cpp `llama-server`. Electron 44 + Vue 3 + Vite 8 + Pinia 4 + TypeScript 6, organized as a pnpm workspace managed by Turborepo. Does **not** bundle the llama.cpp binary — users select the engine directory and the app auto-detects `llama-server(.exe)`.

## Repository layout

- `apps/desktop/` — Electron app: `src/main/` (main process: IPC handlers, window, launcher bridge), `src/preload/index.cjs` (CommonJS preload, `contextBridge`；IPC 常量由 `scripts/generate-preload.cjs` 生成到同级 `ipc-constants.cjs`，勿手工内联), `electron-builder.config.cjs`.

- `packages/shared/` — **single source of truth** for types, the 60-param table (`src/params/definitions.ts`), and i18n (zh/en). All other packages depend on it.

- `packages/core/` — business logic: process spawn, command building, GGUF streaming read, model scan, download manager, ModelScope client, HuggingFace mirror client (hf-mirror.com, injectable Electron `net` transport).

- `packages/ui/` — Vue 3 + Vite frontend (router, Pinia stores, 7 pages with 7-item sidebar nav: Dashboard/Models/Service/Params/Logs/Built-in Web UI/Settings; old routes `/download` `/launch` redirect, param controls).

- `scripts/` — build helpers: `verify-ipc-sync.cjs` (IPC 常量同步检查：生成物 `ipc-constants.cjs` 未过期 + 防止 `index.cjs` 回退为内联常量 + 每个通道常量必须在 `index.cjs` 中有 API 包装引用（漏绑即 fail）+ 文档「N 个通道」声明与实测一致), `generate-preload.cjs` (从 `shared/src/types/ipc.ts` 生成 preload IPC 常量，`pnpm generate:ipc`), `verify-params-sync.cjs` (flags in `definitions.ts` vs `docs/params/LLAMA_SERVER_PARAMS.md` vs `docs/params/llama-server-help-out.txt`——三方对拍**有出入即 fail**（此前只打印，等于没守）；另含文档参数计数声明表（总数与分组数）与实测一致、以及 `PARAM_LABELS`/`PARAM_HELP` 键集与 PARAMS **双向完全相等**且 zh/en 非空）, `verify-help-drift.cjs` (二进制升级后的参数漂移审计：新 help vs 固定基线 flag 增删 / 默认值变化 / 应用参数缺失，re-pin 流程见 `docs/params-system.md` §5.5), `generate-params-doc.cjs` (regenerates `docs/params/LLAMA_SERVER_PARAMS.md` from help output), `check-docs-links.cjs` (docs/ + AGENTS.md/README.md 相对链接与锚点完整性检查，已接入 `pnpm lint`，可单独 `pnpm docs:check`), `verify-i18n-usage.cjs` (i18n 键使用一致性：zh/en 键集必须一致 + 源码字面量 `t('key')` 与间接引用键 `xxxKey: 'k'` 不得引用已删键 + **注释外裸中文串字面量即 fail**（扫描 `ui`/`core`/`shared`/`desktop` 四src，确不进界面的开发日志须就地 `// i18n-ignore` 豁免）+ **`.replace('{0}', x)` 手工插值即 fail** + `t(key, [..])` 实参数须等于该键 zh/en 文案的占位符槽数 + **动态拼接键族按枚举成员逐个校验**（`dl_err_*` ↔ `DownloadErrorType`，新前缀往 `DYNAMIC_KEY_FAMILIES` 加一行），已接入 `pnpm lint`), `style-audit.cjs` (UI 风格审计，`pnpm style:audit`), `verify-version-sync.cjs` (版本号一致性门禁：root/desktop `package.json` + `definitions.ts` 的 `APP_VERSION` + `docs/architecture.md` monorepo 版本表 desktop 行 + `docs/CHANGELOG.md` 最新已发布标题，五处必须相等；**解析不到值同样 fail**，防止声明位置改版后检查静默空转)。, `dev.cjs` (dev 模式三进程编排器：node 直接起 vite/tsc/dev-watch，见 Conventions「零 .cmd 批处理层」), `dev-watch.cjs` (dev 模式 Electron 增量重启：监视 main dist / preload 源 / shared 类型), `copy-preload.cjs`, `copy-ui.cjs`, `before-pack.cjs`, `after-pack.cjs`, `clean-before-pack.cjs`, `dist-with-fallback.cjs`, `reinstall-electron.cjs` (Electron 二进制缺失时的固定修复路径，`pnpm reinstall:electron`，见下方 Conventions), `inject-icon.cjs`, `icon-gen/` (图标生成，desktop `pnpm gen:icon`), `bump-version.cjs` (版本号自动递增), `integ_devsession.mjs` (开发会话集成测试入口), `verify-server-start.mjs` (manual smoke test of `Launcher`; needs `core/dist` built first; 模型由 `--model=` / `LLAMA_SMOKE_MODEL` / 设置里的模型目录依次解析，不写死本机路径)。

- `docs/` — 分类文档（仓库根 `README.md` 之外的文档都在此）：`docs/architecture.md`（概述/结构/Monorepo）、`docs/core-modules.md`（核心模块）、`docs/params-system.md`（参数系统）、`docs/desktop-main.md`（Electron 主进程）、`docs/frontend.md`（前端架构 + UI 风格规范 §7.5）、`docs/ipc-channels.md`（IPC 通道清单）、`docs/data-persistence.md`（类型/持久化）、`docs/packaging.md`（打包配置）、`docs/ci-cd.md`（CI/CD 工作流）、`docs/auto-release.md`（自动发版工作流）、`docs/testing.md`、`docs/design-decisions.md`、`docs/workflow.md`、`docs/params/`（参数对照表 + help 输出）、`docs/archive/`（历史归档：实验/重构交接，索引见 `docs/archive/INDEX.md`，不属于主文档体系）、`docs/badges/`（README 内联徽章 SVG，自绘不依赖外网）、`docs/style/STYLE_TODO.md`（UI 风格待修复清单）、`docs/CHANGELOG.md`。

- `llama-*-bin-*` dirs — dev-only llama.cpp binaries (not committed logic).

Dependency flow (one-directional): `desktop → core+shared`, `core → shared`, `ui → shared`. `desktop` does not directly depend on `ui`; UI static assets are copied into `desktop/dist/ui` at build time.

## Commands

| Task                           | Command                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Install                        | `pnpm install` (Node >=20, pnpm 11.21.0; `allowBuilds`（pnpm 11 取代 `onlyBuiltDependencies`）: electron/esbuild=true、@parcel/watcher=false; Node 版本由 root `engines` 声明，resedit 打包钩子要求 Node 20+) |
| Dev (Vite + Electron HMR)      | `pnpm dev` = `node scripts/dev.cjs` 三进程编排（Vite + `tsc -b --watch` + Electron 热重载），**不经 turbo/concurrently/pnpm shim**，原因见下方 Conventions；`pnpm dev:console` = 同款 dev 但默认打开 DevTools；单独跑某一层用 `pnpm --filter @llama-launcher/desktop dev:tsc:watch` / `dev:electron:watch` |
| Typecheck + IPC/doc/i18n sync check | `pnpm lint` (runs `turbo run lint` **and** `node scripts/verify-ipc-sync.cjs` **and** `node scripts/verify-params-sync.cjs` **and** `node scripts/verify-version-sync.cjs` **and** `node scripts/check-docs-links.cjs` **and** `node scripts/verify-i18n-usage.cjs` **and** `pnpm lint:ox`；oxlint 为静态分析门禁，correctness 级错误会 fail。`lint` 在 `turbo.json` 里声明 `dependsOn: ["^build"]`：`desktop` 的 `tsc` 走 project references，需要 `shared`/`core` 的 `dist` 产物，拉取新代码后直接 lint 否则会报出一堆假的 `has no exported member`（CI 显式 `pnpm build` 先于 `pnpm lint` 同因）) |
| Unit tests                     | `pnpm test` (Vitest 4; `packages/core` 25 个测试文件 / 362 用例 + `packages/ui` 7 个测试文件 / 69 用例，turbo 一并运行)                                                          |
| E2E（渲染层 + Electron 冒烟）    | `pnpm e2e:web` / `pnpm e2e:electron` / `pnpm test:e2e`（Playwright，详见 docs/testing.md「E2E」章节；首次需 `pnpm exec playwright install chromium`） |
| Full build                     | `pnpm build`                                                                                                                             |
| Package distribution build     | `pnpm dist` (build + `dist-with-fallback.cjs`)                                                                                           |
| Per-package typecheck          | `pnpm --filter @llama-launcher/core lint` etc.                                                                                           |

`lint` will fail if the 56 IPC channel constants in `packages/shared/src/types/ipc.ts` drift from the generated preload copy `apps/desktop/src/preload/ipc-constants.cjs` (regenerate via `pnpm generate:ipc`), or if any docs link/anchor breaks, or if a doc-stated count（通道数、参数总数与分组数）drifts from `ipc.ts`/`definitions.ts`, or if the version string drifts among `package.json`/`APP_VERSION`/`docs/architecture.md` 版本表/`CHANGELOG` 标题 (`verify-version-sync.cjs`), or if a bare Chinese string literal appears outside comments in `ui`/`core`/`shared`/`desktop` source (dev-only logs need an inline `// i18n-ignore`) — always re-run it after touching IPC, params, version, or docs.

## Architecture / editing rules

- **Add a param or IPC channel in the right place, then regenerate.** Params are defined once in `packages/shared/src/params/definitions.ts`. IPC channels are defined in `shared/src/types/ipc.ts`; the preload copies them via the **generated** file `src/preload/ipc-constants.cjs` (run `pnpm generate:ipc` after editing `ipc.ts` — hand-inlining constants into `index.cjs` is rejected by `verify-ipc-sync.cjs`).

- **Keep** **`shared`** **dependency-free of** **`core`/`ui`.** It is the shared contract; circular or downward deps break the build.

- **Preload must stay CommonJS** (`index.cjs`) — Electron requires preload scripts to be CJS (independent of `sandbox: false` in this app). All IPC payloads are passed through `clonePlain` serialization (no class instances / functions across the bridge).

- **Dual-track param logic (no** **`_enabled`).** `PresetValues` is a plain value map; the old `_enabled` JSON string was removed — `buildCommand` emits a flag when the value differs from its default (checkbox: `flag` when true, `invert_flag` when false; a no-`invert_flag` default-false checkbox emits only when true), and `model` is always passed (`-m`). The two tracks are: **临时轨道 (session)** — every edit auto-persists (800ms throttle) to `settings.session_values` + `session_baseline` in `~/.llama_launcher/settings.json`, restored on launch; **预设轨道 (presets)** — `<models_dir>/presets/*.json`, written only on explicit save. `hasChanges` is computed against the session baseline (`SessionBaseline { preset_name, values }`); switching models or applying a GGUF-suggested preset with unsaved changes triggers `confirmDiscardDirty()`; restore/clear entry points live on the Params page status bar (the baseline badge was removed as redundant in 2026-09).

- **Command building** lives in `packages/core/src/command-builder.ts` (`buildCommand`). `float_slider` keeps 2 decimals; `checkbox` emits `flag`/`invert_flag` (no `invert_flag` + default-false emits only when true); `draft-model` is normalized to `draft-simple`.

- **Server lifecycle** is a state machine in `launcher.ts` (`stopped→starting→running`). "listening" detection matches lines containing both `listening` and (`http` or `server`) for cross-version compat. Windows stop uses `taskkill /F /T /PID` to kill the process tree. **Restart via** **`Launcher.restart()`** (waits for old process `exit` then starts new), never manual stop→start (race causes `already running`).

- **Param dependency cleanup** lives in `stores/params.ts` (`syncDependencies`): params with `dependsOn` are auto-reset to defaults when dependency unmet (e.g. `spec_draft_ngl`/`n_max` reset when `spec_type` switches to draft-mtp/ngram) — **exception**: `file`/`dir` params (like `spec_draft_model`) keep the user-selected path and are simply not emitted by `buildCommand`. Draft-model params depend on **external draft types** (`draft-simple`/`draft-eagle3`/`draft-dflash`/`draft-dspark`); `draft-mtp`/`ngram-*` need no external draft.

- **DFlash auto-detect** in `detectDraftModel`: dflash-named files → `spec_type=draft-dflash` + `-fa on` + `spec_draft_n_max=15`; re-triggers when switching back to external draft types.


- **Packaging is sensitive to pnpm junctions.** Before editing `scripts/before-pack.cjs` / `after-pack.cjs`, read [docs/packaging.md](docs/packaging.md#打包配置-electron-builderconfigcjs). The hooks must (1) detect junctions via `fs.realpathSync`, (2) replace them with `dist/*.js`-only real directories, (3) restore the original junctions after pack. Drift here causes the packaged app to load stale `shared/dist` and fail to start.

- **Keep** **`electron-builder.config.cjs`** **`directories.output`** **stable.** It should normally be `../../release`. If you temporarily change it to bypass a file lock, restore it and remove the temporary directory before finishing.

- **Workspace root** **`package.json`** **is not** **`apps/desktop/package.json`.** It must contain the root `scripts` (`dev`/`build`/`lint`/`test`), `packageManager: pnpm@11.21.0`, and `turbo` devDependency. Do not overwrite it with a package-level manifest.

- **Version bumps are automated.** Pushing to `main` with **non-doc changes** triggers `scripts/bump-version.cjs` (patch increment) which updates `package.json` (root + desktop), `APP_VERSION` in `definitions.ts`, `CHANGELOG.md` header, and text references in `docs/packaging.md` / `README.md` / `AGENTS.md` / `docs/architecture.md`. **纯文档变更**（仅 `docs/**`、根 `README.md`、`AGENTS.md`）**跳过 bump 与 Release**（`changes` job 判定，见 [docs/ci-cd.md](docs/ci-cd.md) §1.3）——注意 `scripts/bump-version.cjs` 自身**不属于**文档路径，改它会照常 bump 发版。Manual bumps use `node scripts/bump-version.cjs [patch|minor|major]`. Only `CHANGELOG.md [Unreleased]` content and `docs/params/` baseline updates require manual editing (see [docs/ci-cd.md](docs/ci-cd.md) / [docs/auto-release.md](docs/auto-release.md)). **新增版本声明处时两件事都要做**：加进 `bump-version.cjs` 第 5 步的**清单数组**（只改文件头注释不算——该项目正是因此连漂三轮）+ 让 `verify-version-sync.cjs` 覆盖它，否则门禁与清单会互相掩护出静默漂移。 **CI 侧不变量（2026-09-09 优化 / 2026-09-19 收口）**：纯文档变更同样**跳过 `e2e` job**（复用 `changes` 输出门控，见 docs/ci-cd.md §1.4——job 级无 `paths-ignore`，勿试图在 job 上加该属性）；`bump` job 不做 `pnpm install`（`bump-version.cjs` 为纯 node 脚本）；`e2e` 不再单独全量 build（`e2e:web`/`e2e:electron` 脚本内部各自构建并行）。改流水线时守住四条：① `changes` 的基线**按事件分取**（push→`github.event.before`，PR→`github.event.pull_request.base.sha`——`pull_request` 事件里**没有** `before`，内插成空串会让 `git diff "" HEAD` exit 128 使 PR 全红并连带跳过 e2e），且解析不出基线时**保守判为非文档变更**；② CI 的 `cancel-in-progress` **只对 PR 生效**（`bump` 在同一 run 内 commit→tag→push→触发 Release，中途取消会留下「tag 已推、Release 未触发」的半程状态）；③ 每个 job 带 `timeout-minutes`（Windows 上 turbo daemon × vite 8 有挂死竞态，无超时一次挂死白占 6h）；④ `pnpm/action-setup` **停在 @v5**（v6 指定 `version` 时会装错 pnpm 版本，见 pnpm/action-setup#225）。

- **每轮任务完成后提交到本地，勿推送远端。** Agent 每完成一轮任务应 `git add` + `git commit` 到本地仓库（提交信息沿用仓库既有的 Conventional Commits 中文风格：`feat:`/`fix:`/`chore:`/`test:`/`docs:` 等，参考 `git log`），但**绝不** `git push`——推送 `main` 会触发上一条的自动 bump + Release。是否推送、何时推送由用户显式决定。

- **每轮任务完成后，自动调起内置浏览器显示 mock 页面供用户校验目测（收尾固定动作，勿遗漏）。** 流程：① 后台启动 `pnpm --filter @llama-launcher/ui dev`（纯前端 vite + `src/dev/demo-mock` 演示数据，`127.0.0.1:5173`，不启动 Electron）；② 确认 vite 就绪后调起内置浏览器打开 `127.0.0.1:5173`，并导航到**本轮改动的页面**（可直接 URL 深链 `127.0.0.1:5173/#/params?tab=custom`——`packages/ui/src/main.ts` 已让 URL 显式 hash 优先于 `last_tab` 恢复；注意同文档内只改 hash 不触发重载，须整页导航）；③ 标签保留、服务常驻——**收尾时勿 TaskStop vite、勿关闭标签**（历史上曾每次收尾关闭，导致用户无法目测）。涉及 Electron 主进程/IPC 的改动仍需用户自行 `pnpm dev` 交互验证，mock 预览仅覆盖渲染层。
  - **浏览器通道容错**：先探测 Chrome DevTools MCP 是否可用（`list_pages`）——该 MCP 曾因「关闭支持」失效（`MCP server is not found`），不可用时回退 TRAE-browseruse / agent-browser（浏览器自动化 skill / CLI）；全部通道不可用时不得静默跳过，须明示用户手动打开 `http://127.0.0.1:5173/`。
  - **页面归属校验（防串台）**：打开后必须校验当前标签确实指向本项目 mock 页——URL 以 `127.0.0.1:5173` 开头，且快照含本项目特征（标题 llama Launcher / 7 项侧边导航 / 版本号）。若当前标签停留在**其他项目的页面**，禁止直接复用，须新开标签导航到本项目 URL 后再校验（历史事故：mock 页展示其他项目内容，收尾无人发现）。

## 表述风格（对话回答与 `docs/` 文档一律适用）

- **先说清「出了什么事」，再说技术细节。** 描述问题用大白话：从用户视角讲明「点了哪个按钮 / 看到了什么 / 和期望差在哪」，一句话只说一件事；不要一上来就用内部名词堆句子（如「store 的 activated 钩子未配对导致派生值不刷新」），改成「切回页面时列表不刷新——刷新代码写在了页面销毁时才执行的位置」。
- **方案讲三件事**：改哪个文件/位置、为什么改这里而不是别处、改完怎么验证。只给函数名、变量名或一段 diff 不算说清楚了。
- **专业术语能用中文解释时先用中文解释。** 必须保留的英文标识符（文件名、命令、API 名、Arco / IPC / keep-alive 这类约定俗成的组件名）保持原文；首次出现生僻概念时用半句话说明它是什么，或打个比方，不要用术语代替解释。
- **必要时配图示。** 流程、状态机（如服务 `stopped→starting→running`）、跨进程数据流（渲染层 → preload → 主进程）、界面改版前后布局对比——这类「箭头链路」用文字讲三段不如一张图：文档里写 Mermaid 图，对话里用简短的 `A → B → C` 链条或表格。

## Conventions & gotchas

- **dev 编排必须保持「零 .cmd 批处理层」**：`pnpm dev` 由 `scripts/dev.cjs` 直接用 `process.execPath` 起 vite / tsc / dev-watch 三个 node 子进程，**不得**改回 `turbo run dev` + `concurrently` + `cross-env` + 子命令里嵌 `pnpm xxx` 的旧链路。原因：Windows 上 `node_modules/.bin/*` 与 `pnpm` 自身都是 `.cmd` 批处理 shim，cmd.exe 在批处理等待子进程时收到 CTRL_C_EVENT 会打印 `Terminate batch job (Y/N)?` 并阻塞等待按键——旧链路有 4 层批处理，于是一次 Ctrl+C 退不掉（表现为「要按两次 Ctrl+C」，且 turbo 还要等满优雅超时后 `Force killed Turborepo tasks`）。新增 dev 任务时：入口用 `binEntry()` 解析依赖 `package.json` 的 `bin` 真实 JS 文件后由 node 执行；退出语义沿用「首个任务退出码决定整体结果 + 其余 `taskkill /T /F` 杀整棵树」（Electron 正常关窗 → dev-watch 退 0 → 会话干净结束）。同理，`findDevSessionRoot()` 的父进程扫描只认 `turbo run dev`，dev 会话的收尾责任在编排器，故 `LLAMA_DEV_SKIP_QUIT_KILL=1` 时主进程信号处理也必须跳过该扫描（PowerShell 进程枚举是秒级的）。

- **控制台输出是批量通道**：`IPC.SERVER_OUTPUT_BATCH`（`server:output-batch`，载荷 `OutputEntry[]`，16ms 窗口合并）取代旧的逐行 `server:output`。渲染层入口是 `server` store 的 `pushOutputBatch()`，preload 侧 API 名为 `server.onOutputBatch(cb)`。**新增/改通道一律走 `shared/src/types/ipc.ts` + `pnpm generate:ipc`**（当前 56 个通道，改名不增数）。

- **渲染层热路径三条铁律**（详见 [docs/frontend.md](docs/frontend.md) §7.1 末）：① keep-alive 页面不卸载 → 定时器/`addEventListener`/`api.*.onXxx()` 订阅必须配对 `onActivated`/`onDeactivated`（`onUnmounted` 里的清理不会执行）；② 列表行的派生值（着色类名、时间戳、量化解析）在数据入队时算一次并随条目携带，不得放在 `v-for` 的函数调用里；③ 强制布局类操作（控制台自动滚动读 `scrollHeight`）要 `pageActive` 门控 + `requestAnimationFrame` 合帧。另：`a-slider` 的 `show-ticks` 按 `step` 逐格建 `<div>`（实测「缓存重用大小」单只 8195 节点、拖拽时每帧重算），**参数页滑块一律不开刻度**——曾按 `(max-min)/step > 40` 门控保留小量程，结果 13 只滑块只有「温度」画刻度，同页混排本身就是不统一（STYLE_TODO #73）。

- **UI 风格规范（完整版见 [docs/frontend.md §7.5](docs/frontend.md#75-样式系统arco-design-vue)，审计发现的不一致项登记 `docs/style/STYLE_TODO.md`）**：`@arco-design/web-vue` 是唯一的通用 UI 与设计 Token 基础（2026-09 全站迁移完成）。界面交互控件一律 Arco 组件（按钮/输入/下拉/开关/弹窗/浮层/页签/表格/列表），不得新增自定义交互控件或并行主题 Token；颜色直接引用 Arco CSS Variables，`theme.scss` 仅保留 Electron 布局尺寸、业务语义色（徽章/控制台/状态栏）与 4px 扁平化圆角兼容层。玻璃拟态与旧胶囊圆角体系已移除，禁止 `backdrop-filter`。主题切换须同时验证 `html[data-theme]` 和 `body[arco-theme]`。全部按钮（含 TopBar win-btn 窗口控制）均以 a-button 为基座；win-btn 仅保留窗口铬专属覆盖（46×52 贴边热区、关闭钮红色 hover），点击走 Electron 窗口协议。改动 UI 前后对照 §7.5.8 检查清单；发现风格不一致时先记录到 `docs/style/STYLE_TODO.md`（描述 + 修复效果验证方式）再决定是否修复。**Arco 按需引入（2026-09）：组件由 `unplugin-vue-components` + `ArcoResolver` 在 vite 侧按需解析（`vite.config.ts` 的 Components 插件 `dirs: []`，禁止给本地组件自动注册）；新增 Arco 组件无需显式 import，但删组件/依赖后须验证 `src/components.d.ts`（生成物，已入库）同步更新。**

- **i18n**: all user-facing strings go through `shared/src/i18n` (zh/en). Add a key there rather than a literal string. **删除键时必须同步清理所有引用**——悬空 `t('key')` 会让界面直接渲染出原始 key（历史事故：`b8c1d59` 删 `msg_autoscroll_*` 后迁移拉取带回引用，控制台显示裸键）；`pnpm lint` 的 `verify-i18n-usage.cjs` 会拦截此类悬空引用。**占位符填充的唯一写法是 `t(key, [args])`**（`tr` 内部按 `{N}` 全局替换）——`.replace('{0}', x)` 手工插值是并行的第二套机制（只填首个占位符、槽序易错），2026-09-21 一次性收敛 48 处后由 `verify-i18n-usage.cjs` 直接 fail。间接引用键（`labelKey` / `reasonKey` 等 `xxxKey` 字段）同样受双字典存在性校验。

- **数据层不产文案**（2026-09-21 硬编码审计立规）。core 与主进程 IPC 处理器不得把中文串拼进跨桥载荷再直出（历史缺陷：`target-recommend` 的理由串、`system.ts` 的探测错误在英文界面直出中文）。正确做法：下发 `xxxKey` + 仅含数值/枚举的 `args`，渲染端 `t(key, args)` 翻译；主进程确需即时文案时用 `shared` 的 `tr(key, args)`（其语言由 `IPC.SETTINGS_SAVE` 经 `setLang` 同步，见 `ipc/settings.ts`）。`verify-i18n-usage.cjs` 对注释外的裸中文串字面量直接 fail，纯诊断日志用行内 `// i18n-ignore` 豁免。

- **卡片操作区（Card `#actions`）**：卡片级操作按钮/计数一律放入 `Card` 的 `#actions` 插槽（与标题同行，右对齐，`a-space` 6px），不得留在卡片体内与标题错位。

- **Vite** **`base: './'`** is required for Electron `loadFile` (relative asset paths) — do not switch to `'/'`, or production windows go blank.

- **Path resolution**: dev mode auto-finds `llama-*-bin-*` under repo root (newest by dir name); production uses `system:findLlamaExe` to scan the user-selected dir + one subdir.

- **Persistence**: settings in `~/.llama_launcher/settings.json` (含会话参数 `session_values` / `session_baseline`，双轨参数逻辑见上); presets in `<models_dir>/presets/*.json` (resolved via `resolvePresetsDir`).

- **Packaging leaks**: `before-pack.cjs`/`after-pack.cjs` swap pnpm symlinks/junctions for real `dist/*.js` so `asar` excludes source/tests/config. On Windows, `fs.lstat().isSymbolicLink()` is **not** enough for junctions — the scripts use `fs.realpathSync` to detect them, and also handle broken/circular symlinks (e.g. `shamefully-hoist=true` leftovers) by falling back to root `node_modules/@llama-launcher/{core,shared}`. Keep `electron-builder.config.cjs` `signAndEditExecutable: false` (no admin signing on this setup). Because that flag also skips rcedit, `after-pack.cjs` must write the app's `VS_VERSION_INFO` (ProductName/FileDescription/OriginalFilename + app version) itself via `resedit` (pure-JS, root devDependency), then inject the icon via `inject-icon.cjs` — otherwise the packaged exe reports ProductName "Electron" in Task Manager / file properties.

- **Mirrors**: `.npmrc` points electron/electron-builder at npmmirror.com — relevant if installing on a restricted network.

- **Electron 二进制缺失（`pnpm dev` 报 `spawn electron ENOENT`）——按此固定流程处置，勿绕路**：
  - **症状**：dev-watch 日志先出现 `Downloading Electron binary...` + `TypeError: fetch failed`（electron 44 的 `index.js` 在被 require 时现场下载二进制，走 GitHub 官方源），随后 `Error: spawn electron ENOENT`，dev 会话整体退出。
  - **判定**：`apps/desktop/node_modules/electron/path.txt` 缺失（即 `dist/electron.exe` 未装）即可确诊。根因是 pnpm side-effects 缓存会整体跳过 electron 的 postinstall，`pnpm install` / `pnpm rebuild` 都不会重下。注意：`.pnpm` 下其他 electron 实例（如无后缀的 `electron@44.1.0`）存在 dist 不代表当前依赖解析实例已装，勿据此误判为已装好。
  - **修复**：直接运行 `pnpm reinstall:electron`（读 `.npmrc` 的 `electron_mirror` 注入镜像环境变量后运行 electron 的 install.js，幂等），输出「Electron 二进制就绪」后重跑 `pnpm dev` 验证。
  - **禁止**：手动 `node <electron>/install.js`（不经 pnpm 拿不到镜像，回退 GitHub 源在国内 fetch failed）；反复 `pnpm install` / `pnpm rebuild`（无效，不会重下）；为此改动 `scripts/dev-watch.cjs` 或硬编码二进制路径。

## Docs to read before sensitive changes

- `docs/architecture.md` — 项目概述、目录结构、Monorepo 架构与依赖流。

- `docs/core-modules.md` — 核心业务模块（进程、启动编排、命令构建、GGUF、下载等）。

- `docs/params-system.md` — 参数系统（定义、启用机制、依赖联动、控件）。

- `docs/desktop-main.md` — Electron 主进程（窗口、IPC 注册、launcher 桥接、preload）。

- `docs/frontend.md` — 前端架构（路由、stores、页面、组件）+ UI 风格规范 §7.5。

- `docs/ipc-channels.md` — IPC 通道完整清单（改 IPC 前必读，配合 `verify-ipc-sync.cjs`）。

- `docs/packaging.md` — 打包配置与陷阱（§11.5 常见故障、§11.7 版本一致性自动化）。

- `docs/data-persistence.md` — 类型定义与持久化。

- `docs/design-decisions.md` / `docs/workflow.md` / `docs/testing.md` — 设计决策、开发工作流、测试。

- `docs/style/STYLE_TODO.md` — 已知 UI 风格待修复项 + 已修复索引（完整验证记录归档于 `docs/archive/style-todo-resolved.md`）；改 UI 前阅读，避免回归已知问题。

- `docs/params/LLAMA_SERVER_PARAMS.md` — 参数与 llama-server 完整对照表（调整参数时对照）。

- `docs/CHANGELOG.md` — 版本历史与变更。

- `README.md` — 仓库根唯一 README：功能总览、文档地图、快速开始与使用说明（分类文档入口）。

