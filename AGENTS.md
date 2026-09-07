# AGENTS.md — llama Launcher

Desktop launcher for llama.cpp `llama-server`. Electron 44 + Vue 3 + Vite 8 + Pinia 4 + TypeScript 6, organized as a pnpm workspace managed by Turborepo. Does **not** bundle the llama.cpp binary — users select the engine directory and the app auto-detects `llama-server(.exe)`.

## Repository layout

- `apps/desktop/` — Electron app: `src/main/` (main process: IPC handlers, window, launcher bridge), `src/preload/index.cjs` (CommonJS preload, `contextBridge`；IPC 常量由 `scripts/generate-preload.cjs` 生成到同级 `ipc-constants.cjs`，勿手工内联), `electron-builder.config.cjs`.

- `packages/shared/` — **single source of truth** for types, the 60-param table (`src/params/definitions.ts`), and i18n (zh/en). All other packages depend on it.

- `packages/core/` — business logic: process spawn, command building, GGUF streaming read, model scan, download manager, ModelScope client, HuggingFace mirror client (hf-mirror.com, injectable Electron `net` transport).

- `packages/ui/` — Vue 3 + Vite frontend (router, Pinia stores, 7 pages with 7-item sidebar nav: Dashboard/Models/Service/Params/Logs/Built-in Web UI/Settings; old routes `/download` `/launch` redirect, param controls).

- `scripts/` — build helpers: `verify-ipc-sync.cjs` (IPC 常量同步检查：生成物 `ipc-constants.cjs` 未过期 + 防止 `index.cjs` 回退为内联常量 + 每个通道常量必须在 `index.cjs` 中有 API 包装引用（漏绑即 fail）), `generate-preload.cjs` (从 `shared/src/types/ipc.ts` 生成 preload IPC 常量，`pnpm generate:ipc`), `verify-params-sync.cjs` (flags in `definitions.ts` vs `docs/params/LLAMA_SERVER_PARAMS.md` vs `docs/params/llama-server-help-out.txt`), `verify-help-drift.cjs` (二进制升级后的参数漂移审计：新 help vs 固定基线 flag 增删 / 默认值变化 / 应用参数缺失，re-pin 流程见 `docs/params-system.md` §5.5), `generate-params-doc.cjs` (regenerates `docs/params/LLAMA_SERVER_PARAMS.md` from help output), `check-docs-links.cjs` (docs/ + AGENTS.md/README.md 相对链接与锚点完整性检查，已接入 `pnpm lint`，可单独 `pnpm docs:check`), `style-audit.cjs` (UI 风格审计，`pnpm style:audit`), `dev-watch.cjs` (dev 模式 Electron 增量重启：监视 main dist / preload 源 / shared 类型), `copy-preload.cjs`, `copy-ui.cjs`, `before-pack.cjs`, `after-pack.cjs`, `clean-before-pack.cjs`, `dist-with-fallback.cjs`, `inject-icon.cjs`, `icon-gen/` (图标生成，desktop `pnpm gen:icon`), `bump-version.cjs` (版本号自动递增), `integ_devsession.mjs` (开发会话集成测试入口), `verify-server-start.mjs` (manual smoke test of `Launcher`; needs `core/dist` built first).

- `docs/` — 分类文档（仓库根 `README.md` 之外的文档都在此）：`docs/architecture.md`（概述/结构/Monorepo）、`docs/core-modules.md`（核心模块）、`docs/params-system.md`（参数系统）、`docs/desktop-main.md`（Electron 主进程）、`docs/frontend.md`（前端架构 + UI 风格规范 §7.5）、`docs/ipc-channels.md`（IPC 通道清单）、`docs/data-persistence.md`（类型/持久化）、`docs/packaging.md`（打包配置）、`docs/ci-cd.md`（CI/CD 工作流）、`docs/auto-release.md`（自动发版工作流）、`docs/testing.md`、`docs/design-decisions.md`、`docs/workflow.md`、`docs/params/`（参数对照表 + help 输出）、`docs/archive/`（历史归档：实验/重构交接，索引见 `docs/archive/INDEX.md`，不属于主文档体系）、`docs/badges/`（README 内联徽章 SVG，自绘不依赖外网）、`docs/style/STYLE_TODO.md`（UI 风格待修复清单）、`docs/CHANGELOG.md`。

- `llama-*-bin-*` dirs — dev-only llama.cpp binaries (not committed logic).

Dependency flow (one-directional): `desktop → core+shared`, `core → shared`, `ui → shared`. `desktop` does not directly depend on `ui`; UI static assets are copied into `desktop/dist/ui` at build time.

## Commands

| Task                           | Command                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Install                        | `pnpm install` (Node >=20, pnpm 11.21.0; `allowBuilds`（pnpm 11 取代 `onlyBuiltDependencies`）: electron/esbuild=true、@parcel/watcher=false; Node 版本由 root `engines` 声明，resedit 打包钩子要求 Node 20+) |
| Dev (Vite + Electron HMR)      | `pnpm dev` (or `pnpm --filter @llama-launcher/desktop dev:vite`)；`pnpm dev:console` = 同款 dev 但默认打开 DevTools                              |
| Typecheck + IPC/doc sync check | `pnpm lint` (runs `turbo run lint` **and** `node scripts/verify-ipc-sync.cjs` **and** `node scripts/check-docs-links.cjs`)               |
| Unit tests                     | `pnpm test` (Vitest 4; `packages/core` 25 个测试文件 + `packages/ui` 5 个，turbo 一并运行)                                                          |
| Full build                     | `pnpm build`                                                                                                                             |
| Package distribution build     | `pnpm dist` (build + `dist-with-fallback.cjs`)                                                                                           |
| Per-package typecheck          | `pnpm --filter @llama-launcher/core lint` etc.                                                                                           |

`lint` will fail if the 56 IPC channel constants in `packages/shared/src/types/ipc.ts` drift from the generated preload copy `apps/desktop/src/preload/ipc-constants.cjs` (regenerate via `pnpm generate:ipc`), or if any docs link/anchor breaks — always re-run it after touching IPC or docs.

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

- **Version bumps are automated.** Pushing to `main` with **non-doc changes** triggers `scripts/bump-version.cjs` (patch increment) which updates `package.json` (root + desktop), `APP_VERSION` in `definitions.ts`, `CHANGELOG.md` header, and text references in `docs/packaging.md` / `README.md` / `AGENTS.md`. **Pure doc pushes**（仅 `docs/**`、根 `README.md`、`AGENTS.md`）**跳过 bump 与 Release**（`changes` job 判定，见 [docs/ci-cd.md](docs/ci-cd.md) §1.3）。Manual bumps use `node scripts/bump-version.cjs [patch|minor|major]`. Only `CHANGELOG.md [Unreleased]` content and `docs/params/` baseline updates require manual editing (see [docs/ci-cd.md](docs/ci-cd.md) / [docs/auto-release.md](docs/auto-release.md)).

- **每轮任务完成后提交到本地，勿推送远端。** Agent 每完成一轮任务应 `git add` + `git commit` 到本地仓库（提交信息沿用仓库既有的 Conventional Commits 中文风格：`feat:`/`fix:`/`chore:`/`test:`/`docs:` 等，参考 `git log`），但**绝不** `git push`——推送 `main` 会触发上一条的自动 bump + Release。是否推送、何时推送由用户显式决定。

## Conventions & gotchas

- **UI 风格规范（完整版见 [docs/frontend.md §7.5](docs/frontend.md#75-样式系统arco-design-vue)，审计发现的不一致项登记 `docs/style/STYLE_TODO.md`）**：`@arco-design/web-vue` 是唯一的通用 UI 与设计 Token 基础。新增界面优先使用 Arco 的组件和 CSS Variables，不得新增自定义按钮、下拉、开关、浮层或并行主题 Token；旧 `--*` 变量只供未迁移业务组件兼容。主题切换须同时验证 `html[data-theme]` 和 `body[arco-theme]`。Electron 窗口拖拽区与窗口控制按钮可保留定制。

- **i18n**: all user-facing strings go through `shared/src/i18n` (zh/en). Add a key there rather than a literal string.

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

