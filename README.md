# llama Launcher

> A desktop launcher for llama.cpp's `llama-server` — pick a model, tune the parameters, start the server, read the logs.

[![stack](docs/badges/stack.svg)](#tech-stack)
[![license](docs/badges/license.svg)](#license)

***

## What it takes off your plate

llama.cpp ships a command-line-only server: to get it running you hand-assemble `-m`, `-c`, `-ngl` and a few dozen other flags, then start over every time you swap models. This app moves all of that into a window:

- Pick a model and run — **the exact command line is on screen at all times**, so every parameter you touch is immediately visible.
- Metadata baked into the model file (context length, quantization, recommended sampling values) is read out and turned into **a set of suggested parameters**; apply them in one click, then override anything by hand.
- Start, stop, restart, live log output and the access address all live in the same window — no extra terminal, no extra browser tab.
- The app **does not bundle** llama.cpp: point it at your engine directory once, then swap llama.cpp versions freely without touching the launcher.

***

## Highlights

**Interface**

- Electron 44 + Vue 3 + Arco Design, light / dark theme, Chinese / English UI.
- Seven-item sidebar: Dashboard / Models / Service / Params / Logs / Built-in Web UI / Settings.

**Parameters**

- **60** `llama-server` parameters grouped into 13 sections (networking / context / KV cache / sampling / speculative decoding…), baseline aligned to llama.cpp **b11053**.
- Sliders, dropdowns, switches and file pickers; hover a label for help text. A parameter only reaches the command line when its value differs from the default.
- Edits are auto-saved as *session* parameters, so a restart returns to where you left off; save a *preset* only when you want it long-term.
- Parameters declare dependencies on each other (`dependsOn`): when a prerequisite is unmet the dependent value resets and the row says why.

**Hardware fit**

- Occupancy estimated on both sides — VRAM and system RAM — with an orange warning past the limit; four performance targets (max context / balanced / lowest latency / memory saving) apply linked recommendations in one click.
- The model list tags each quantized file ✓ full offload / △ partial offload / ✗ scale down; llama-bench can be run for measured prefill / decode speed.

**Models and downloads**

- Recursive `.gguf` scan; 60 metadata fields read by streaming at constant memory, which is what drives the suggestions.
- Multimodal projectors (mmproj) and draft models (dflash / draft) are detected automatically and speculative decoding is wired up; the list refreshes itself when the directory changes.
- Paste an LM Studio / HuggingFace / HF Mirror / ModelScope link to resolve it; 1–5 parallel downloads, resume after interruption, pause / resume / retry.

**Running and compatibility**

- Live command preview, pre-launch parameter summary, 5000-line console that jumps to newest output when you switch back, and the llama-server web UI embedded inside the app.
- The engine executable is found within the chosen directory plus one level of subdirectories, with an inline status icon; "listening" detection tolerates log wording differences between llama.cpp versions.

> Full rules for each item (parameter mapping tables, dependency chains, GGUF suggestion rules, the occupancy model) live in `docs/` — see the [documentation map](#documentation-map). Those documents are currently written in Chinese; this README is the English entry point.

***

## Quick start

```bash
pnpm install     # Node >= 20, pnpm 11.21.0; Windows / macOS / Linux
pnpm dev         # dev mode: Vite + tsc watch + Electron hot reload (one Ctrl+C exits)
pnpm build       # typecheck + build every package
pnpm dist        # package a portable single file -> release/*.exe
pnpm test        # unit tests (core + ui)
pnpm lint        # typecheck + IPC / docs-link / i18n / param sync checks + oxlint gate
```

- **After a change**: `pnpm lint` covers most of it. Touched an IPC channel? Run `pnpm generate:ipc` first (channels are declared in `packages/shared/src/types/ipc.ts`). Touched the parameter table? Also run `node scripts/verify-params-sync.cjs`.
- **E2E**: `pnpm e2e:web` (renderer) / `pnpm e2e:electron` (Electron smoke); the first run needs `pnpm exec playwright install chromium` — details in [testing.md](docs/testing.md).
- **First launch**: a `.exe` downloaded from GitHub may trigger a Windows Defender SmartScreen "unrecognized app" warning — the project has no paid code-signing certificate, so this is expected. Click "More info" → "Run anyway"; it won't ask again.

***

## How you use it

1. **Settings** → choose the directory holding llama-server (the executable is detected for you) and where your models live; theme, language, mirror host and download concurrency are on the same page.
2. **Models** → click a `.gguf`; its metadata and companion files (mmproj / draft) are read in.
3. **Params** → change only what you need; "Apply suggestions" fills in values derived from the model's own metadata (it resets current values first).
4. Want to keep that set? Save it under the **Presets** tab — preset files sit in `presets/` inside your model directory, next to the models themselves.
5. **Service** → start it and watch the console; the top bar's "Open Web UI" or the sidebar entry gives you the chat interface inside the app.
6. Need a llama.cpp flag that isn't among the 60? Type it into the **extra arguments** box of the command preview — it is appended verbatim to the launch command and survives "reset parameters".
7. No local model yet? Use the **Model library** sub-tab on the Models page, paste a link and download; the list refreshes when it finishes.

***

## Project layout

```text
apps/desktop/      # Electron: src/main process, src/preload bridge, electron-builder config
packages/shared/   # single source of truth: types, the 60-parameter table, i18n (zh/en)
packages/core/     # business logic: process, command builder, GGUF reader, model scan, downloads, cleanup
packages/ui/       # Vue 3 frontend: router, Pinia stores, 7 pages
scripts/           # build & verification scripts (IPC generation, param/docs sync audits, pack hooks)
docs/              # project wiki (see the documentation map below)
```

Dependencies run one way: `desktop → core + shared`, `core → shared`, `ui → shared`; `shared` depends on nothing above it. The full tree and dependency flow are in [architecture.md](docs/architecture.md) §2–3, and contributor rules and build pitfalls in [AGENTS.md](AGENTS.md).

***

## Tech stack

Electron 44 · Vue 3.5 + Pinia 4 + Vue Router 5 · TypeScript 6 · Vite 8 + vue-tsc 3 · pnpm workspace + Turborepo · electron-builder (portable single file) · Vitest 4 + Playwright

***

## Documentation map

Everything lives in `docs/`, and this file is the repository's **only README**. Pick the page that matches what you want to understand:

| To understand…                                              | Read                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| All 60 parameters mapped against `--help`                    | [params/LLAMA\_SERVER\_PARAMS.md](docs/params/LLAMA_SERVER_PARAMS.md)     |
| Overall structure, directory tree, Monorepo dependency flow | [architecture.md](docs/architecture.md)                                  |
| Core modules (process, command builder, GGUF, downloads)    | [core-modules.md](docs/core-modules.md)                                  |
| Parameter system, session vs preset, controls               | [params-system.md](docs/params-system.md)                                |
| Electron main process (window, IPC registry, tray, preload) | [desktop-main.md](docs/desktop-main.md)                                  |
| All 56 IPC channels — read before touching IPC              | [ipc-channels.md](docs/ipc-channels.md)                                  |
| Frontend architecture + **UI style guide §7.5**             | [frontend.md](docs/frontend.md)                                          |
| Types and persistence (`settings.json` fields, presets)     | [data-persistence.md](docs/data-persistence.md)                          |
| Packaging config and known failure modes                    | [packaging.md](docs/packaging.md)                                        |
| CI/CD and the release pipeline                              | [ci-cd.md](docs/ci-cd.md) · [auto-release.md](docs/auto-release.md)     |
| Test layout and E2E                                         | [testing.md](docs/testing.md)                                            |
| Day-to-day commands, commit rules, **doc writing style**     | [workflow.md](docs/workflow.md)                                          |
| Key design decisions                                        | [design-decisions.md](docs/design-decisions.md)                          |
| Outstanding UI style inconsistencies                        | [style/STYLE\_TODO.md](docs/style/STYLE_TODO.md)                         |
| Release history                                             | [CHANGELOG.md](docs/CHANGELOG.md)                                        |
| Ended plans / experiments / refactor handoffs (archived)    | [archive/INDEX.md](docs/archive/INDEX.md)                                |

New to the codebase? Read [architecture.md](docs/architecture.md) → [core-modules.md](docs/core-modules.md) → [frontend.md](docs/frontend.md) in that order.

***

## License

MIT
