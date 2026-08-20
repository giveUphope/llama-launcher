# AGENTS.md — llama Launcher

Desktop launcher for llama.cpp `llama-server`. Electron 33 + Vue 3 + Vite + Pinia + TypeScript 5.8, organized as a pnpm workspace managed by Turborepo. Does **not** bundle the llama.cpp binary — users select the engine directory and the app auto-detects `llama-server(.exe)`.

## Repository layout

- `apps/desktop/` — Electron app: `src/main/` (main process: IPC handlers, window, launcher bridge, bench-client), `src/preload/index.cjs` (CommonJS preload, `contextBridge`), `electron-builder.yml`.
- `packages/shared/` — **single source of truth** for types, the 56-param table (`src/params/definitions.ts`), and i18n (zh/en). All other packages depend on it.
- `packages/core/` — business logic: process spawn, command building, GGUF streaming read, model scan, download manager, ModelScope client, HuggingFace mirror client (hf-mirror.com, injectable Electron `net` transport).
- `packages/ui/` — Vue 3 + Vite frontend (router, Pinia stores, 4 pages: Models/Params/Launch/Download, param controls).
- `scripts/` — build helpers: `verify-ipc-sync.cjs` (IPC constant check), `verify-params-sync.cjs` (flags in `definitions.ts` vs `docs/params/LLAMA_SERVER_PARAMS.md` vs `docs/params/llama-server-help-out.txt`), `verify-help-drift.cjs` (二进制升级后的参数漂移审计：新 help vs 固定基线 flag 增删 / 默认值变化 / 应用参数缺失，re-pin 流程见 `docs/params-system.md` §5.5), `generate-params-doc.cjs` (regenerates `docs/params/LLAMA_SERVER_PARAMS.md` from help output), `check-docs-links.cjs` (docs/ + AGENTS.md/README.md 相对链接与锚点完整性检查，已接入 `pnpm lint`，可单独 `pnpm docs:check`), `copy-preload.cjs`, `copy-ui.cjs`, `before-pack.cjs`, `after-pack.cjs`, `clean-before-pack.cjs`, `dist-with-fallback.cjs`, `inject-icon.cjs`, `verify-server-start.mjs` (manual smoke test of `Launcher`; needs `core/dist` built first), `verify-bench-client.mjs` (manual smoke test of performance-test metrics/timings parsing; needs a real model).
- `docs/` — 分类文档（除本文件外全部项目文档都在此）：`docs/architecture.md`（概述/结构/Monorepo）、`docs/core-modules.md`（核心模块）、`docs/params-system.md`（参数系统）、`docs/desktop-main.md`（Electron 主进程）、`docs/frontend.md`（前端架构 + UI 风格规范 §7.5）、`docs/ipc-channels.md`（IPC 通道清单）、`docs/data-persistence.md`（类型/持久化）、`docs/packaging.md`（打包配置）、`docs/testing.md`、`docs/design-decisions.md`、`docs/workflow.md`、`docs/params/`（参数对照表 + help 输出）、`docs/style/STYLE_TODO.md`（UI 风格待修复清单）、`docs/CHANGELOG.md`、`docs/README.md`。
- `legacy/` — old Python prototype, no longer part of the active product line.
- `llama-*-bin-*` dirs — dev-only llama.cpp binaries (not committed logic).

Dependency flow (one-directional): `desktop → core+shared`, `core → shared`, `ui → shared`. `desktop` does not directly depend on `ui`; UI static assets are copied into `desktop/dist/ui` at build time.

## Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` (Node >=20, pnpm 10.12.1; `onlyBuiltDependencies`: electron, esbuild; Node 版本由 root `engines` 声明，resedit 打包钩子要求 Node 20+) |
| Dev (Vite + Electron HMR) | `pnpm dev` (or `pnpm --filter @llama-launcher/desktop dev:vite`) |
| Typecheck + IPC/doc sync check | `pnpm lint` (runs `turbo run lint` **and** `node scripts/verify-ipc-sync.cjs` **and** `node scripts/check-docs-links.cjs`) |
| Unit tests | `pnpm test` (Vitest 2; lives in `packages/core`) |
| Full build | `pnpm build` |
| Package Windows installer | `pnpm dist` (root; delegates to `@llama-launcher/desktop dist`, outputs `release/llama Launcher 0.0.03.exe`, Portable; uses `scripts/dist-with-fallback.cjs` for locked-output fallback) |
| Per-package typecheck | `pnpm --filter @llama-launcher/core lint` etc. |

`lint` will fail if the 51 IPC channel constants in `packages/shared/src/types/ipc.ts` and `apps/desktop/src/preload/index.cjs` drift — always re-run it after touching IPC.

## Architecture / editing rules

- **Add a param or IPC channel in both places.** Params are defined once in `packages/shared/src/params/definitions.ts`. IPC channels are defined in `shared/src/types/ipc.ts` and **inline-repeated** in the CommonJS preload (`index.cjs`); `verify-ipc-sync.cjs` enforces they match. Do not edit one without the other.
- **Keep `shared` dependency-free of `core`/`ui`.** It is the shared contract; circular or downward deps break the build.
- **Preload must stay CommonJS** (`index.cjs`) — Electron sandbox cannot use ESM there. All IPC payloads are passed through `clonePlain` serialization (no class instances / functions across the bridge).
- **`_enabled` JSON string** in `PresetValues` explicitly records which params are enabled; disabled params emit no flag. `model` and `mmproj` keys are always passed.
- **Command building** lives in `packages/core/src/command-builder.ts` (`buildCommand`). `float_slider` keeps 2 decimals; `checkbox` always emits `flag`/`invert_flag`; `draft-model` is normalized to `draft-simple`.
- **Server lifecycle** is a state machine in `launcher.ts` (`stopped→starting→running`). "listening" detection matches lines containing both `listening` and (`http` or `server`) for cross-version compat. Windows stop uses `taskkill /F /T /PID` to kill the process tree. **Restart via `Launcher.restart()`** (waits for old process `exit` then starts new), never manual stop→start (race causes `already running`).
- **Param dependency cleanup** lives in `stores/params.ts` (`syncDependencies`): params with `dependsOn` are auto-reset when dependency unmet (e.g. `-md` cleared when `spec_type` switches to draft-mtp/ngram). Draft-model params depend on **external draft types** (`draft-simple`/`draft-eagle3`/`draft-dflash`/`draft-dspark`); `draft-mtp`/`ngram-*` need no external draft.
- **DFlash auto-detect** in `detectDraftModel`: dflash-named files → `spec_type=draft-dflash` + `-fa on` + `spec_draft_n_max=15`; re-triggers when switching back to external draft types.
- **Performance test** lives in `main/bench-client.ts` (Electron `net` HTTP: `/metrics` Prometheus + completion `timings`; llama-bench does NOT support DFlash) + `ui/components/bench/BenchPanel.vue` (dynamic enabled params, `waitRunning` two-phase + startup-failure detection). IPC: `server:bench` / `server:benchMetrics`.
- **Packaging is sensitive to pnpm junctions.** Before editing `scripts/before-pack.cjs` / `after-pack.cjs`, read [docs/packaging.md](docs/packaging.md#打包配置-electron-builderyml). The hooks must (1) detect junctions via `fs.realpathSync`, (2) replace them with `dist/*.js`-only real directories, (3) restore the original junctions after pack. Drift here causes the packaged app to load stale `shared/dist` and fail to start.
- **Keep `electron-builder.yml` `directories.output` stable.** It should normally be `../../release`. If you temporarily change it to bypass a file lock, restore it and remove the temporary directory before finishing.
- **Workspace root `package.json` is not `apps/desktop/package.json`.** It must contain the root `scripts` (`dev`/`build`/`lint`/`test`), `packageManager: pnpm@10.12.1`, and `turbo` devDependency. Do not overwrite it with a package-level manifest.
- **Version bumps must be consistent.** When bumping `apps/desktop/package.json`, also update root `package.json`, `electron-builder.yml`-referenced output filename expectations, `packages/shared/src/params/definitions.ts` (`APP_VERSION`, used by the UI sidebar), `docs/CHANGELOG.md`, `docs/README.md`, and `docs/packaging.md` §11.6（版本一致性检查清单）。

## Conventions & gotchas

- **UI 风格规范（完整版见 [docs/frontend.md §7.5](docs/frontend.md#75-样式系统ui-风格规范)，审计发现的不一致项登记 `docs/style/STYLE_TODO.md`）**：所有颜色必须走 CSS 变量（`--bg-*`、`--fg-*`、`--border`、`--accent`、`--success`/`--warn`/`--danger`/`--info`、`--badge-*` 徽章色）；浮层阴影/遮罩必须走 `--shadow-tooltip/dropdown/modal/control` 与 `--overlay`；`#fff`/`#1a1a1a` 仅允许作为彩色按钮文字色（accent/danger/success 底→`#fff`，warn 底→`#1a1a1a`）。字号必须走 `--fs-xs..xl`（11–20px，2026-08 上调），禁止裸 px。间距：页面 `18px 20px 24px`、卡片间距 `gap: 14px`、按钮组 `flex; gap: 8px`（弹窗 10px）。圆角：标准 4px、mini 3px、下拉/tab 6px、卡片 8px、弹窗 10px、胶囊 12px、圆形 50%。按钮复用既有类（`btn`/`action-btn`/`mini-btn`/`head-btn`/`tab-btn`/`modal-btn`/`icon-btn`/`win-btn`），不另造同义类；`action-btn` 高度统一引用 `--btn-h`；描边变体按语义用 accent/danger/warn。数值与路径用 `--font-mono`，正文用 `--font-family`（system-ui + Segoe UI Variable + CJK 栈）。深浅主题都要验证（控制台/侧边栏/工具提示为恒定深色）。改动 UI 前后对照 §7.5.8 检查清单；发现风格不一致时先记录到 `docs/style/STYLE_TODO.md`（描述 + 修复效果验证方式）再决定是否修复。
- **i18n**: all user-facing strings go through `shared/src/i18n` (zh/en). Add a key there rather than a literal string.
- **Vite `base: './'`** is required for Electron `loadFile` (relative asset paths) — do not switch to `'/'`, or production windows go blank.
- **Path resolution**: dev mode auto-finds `llama-*-bin-*` under repo root (newest by dir name); production uses `system:findLlamaExe` to scan the user-selected dir + one subdir.
- **Persistence**: settings in `~/.llama_launcher/settings.json`; presets in `<models_dir>/presets/*.json` (resolved via `resolvePresetsDir`).
- **Packaging leaks**: `before-pack.cjs`/`after-pack.cjs` swap pnpm symlinks/junctions for real `dist/*.js` so `asar` excludes source/tests/config. On Windows, `fs.lstat().isSymbolicLink()` is **not** enough for junctions — the scripts use `fs.realpathSync` to detect them, and also handle broken/circular symlinks (e.g. `shamefully-hoist=true` leftovers) by falling back to root `node_modules/@llama-launcher/{core,shared}`. Keep `electron-builder.yml` `signAndEditExecutable: false` (no admin signing on this setup). Because that flag also skips rcedit, `after-pack.cjs` must write the app's `VS_VERSION_INFO` (ProductName/FileDescription/OriginalFilename + app version) itself via `resedit` (pure-JS, root devDependency), then inject the icon via `inject-icon.cjs` — otherwise the packaged exe reports ProductName "Electron" in Task Manager / file properties.
- **Windows file locks during pack**: `pnpm dist` now runs `scripts/dist-with-fallback.cjs`, which first invokes `clean-before-pack.cjs` to kill running `llama Launcher*.exe` processes (including the versioned portable output like `llama Launcher 0.0.03.exe` via PowerShell path/name matching), close Explorer windows pointing to `release/`, wait 1s for handles to be released, then attempt directory removal with `rename+rd` (2 retries × 3s — no longer wastes 30s on system-locked dirs). If `release/` is still locked by Defender/Indexer, `dist-with-fallback.cjs` probes whether `release/` can be renamed; if not, it switches to `release-tmp-<timestamp>`, builds there, and moves artifacts back via `robocopy /MIR` (directories) and `copyFileSync` (files). A clear `BUILD SUCCEEDED` / `BUILD FAILED` summary is printed at the end. The fallback flow is expected behavior — the build still succeeds. If you want to avoid fallback, close all programs accessing `release/` before running `pnpm dist`.
- **Verify the packaged app starts**: after `pnpm dist`, launch `release/llama Launcher 0.0.03.exe` and confirm a window with title containing "llama Launcher" appears and no `undefined` IPC errors appear in stderr. See [docs/packaging.md §11.5](docs/packaging.md#115-常见打包故障) for troubleshooting.
- **Mirrors**: `.npmrc` points electron/electron-builder at npmmirror.com — relevant if installing on a restricted network.

## Docs to read before sensitive changes

- `docs/architecture.md` — 项目概述、目录结构、Monorepo 架构与依赖流。
- `docs/core-modules.md` — 核心业务模块（进程、启动编排、命令构建、GGUF、下载等）。
- `docs/params-system.md` — 参数系统（定义、启用机制、依赖联动、控件）。
- `docs/desktop-main.md` — Electron 主进程（窗口、IPC 注册、launcher 桥接、preload）。
- `docs/frontend.md` — 前端架构（路由、stores、页面、组件）+ UI 风格规范 §7.5。
- `docs/ipc-channels.md` — IPC 通道完整清单（改 IPC 前必读，配合 `verify-ipc-sync.cjs`）。
- `docs/packaging.md` — 打包配置与陷阱（§11.5 常见故障、§11.6 版本一致性检查清单）。
- `docs/data-persistence.md` — 类型定义与持久化。
- `docs/design-decisions.md` / `docs/workflow.md` / `docs/testing.md` — 设计决策、开发工作流、测试。
- `docs/style/STYLE_TODO.md` — 已知 UI 风格待修复项（含修复效果验证）；改 UI 前阅读，避免回归已知问题。
- `docs/params/LLAMA_SERVER_PARAMS.md` — 参数与 llama-server 完整对照表（调整参数时对照）。
- `docs/CHANGELOG.md` — 版本历史与变更。
- `docs/README.md` — 功能总览与用户使用说明。
