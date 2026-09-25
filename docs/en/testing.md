# Testing

> Language: English · [中文](../zh/testing.md)
> Scope: test structure and case inventory (Vitest, living in packages/core/tests plus inline tests in packages/ui).
> Index: [README.en.md](../../README.en.md) · Related: [core-modules.md](core-modules.md) · [workflow.md](workflow.md)

- **Framework**: Vitest 4 (`pnpm test` runs both the core and the ui package through turbo)

- **Scale**: core 27 test files / **394** cases + ui **8** test files / **79** cases (`pnpm test` runs both packages through turbo)

- **Covered modules**:

| Test file                             | Covered module                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `settings-store.test.ts`              | Settings read/write (incl. shape validation of `session_values`/`session_baseline`)  |
| `presets-store.test.ts`               | Preset read/write                                                                   |
| `models-scanner.test.ts`              | Model scanning                                                                      |
| `command-builder.test.ts`             | Command building (incl. ignoring the legacy `_enabled`)                             |
| `command-builder-definitions.test.ts` | Command building (table-driven: generates the structural-constraint and emission cases for all 60 parameters from `definitions.ts`) |
| `launcher.test.ts`                    | Launch orchestration                                                                |
| `gguf-meta.test.ts`                   | GGUF metadata reading (incl. suggested-parameter generation, attached-model guards, rope field extraction) |
| `devices.test.ts`                     | Parsing of `--list-devices` output (per-line fault tolerance, Vulkan/CUDA line anchoring) |
| `vram-estimate.test.ts`               | KV memory model + the arithmetic of the VRAM/RAM dual-side usage estimate + solving for the largest OOM-free context (units hand-computed) |
| `target-recommend.test.ts`            | Linked suggestions across the four performance tiers (ctx / KV tier / offload layers / MTP derived within the budget for the target dtype) |
| `llama-bench.test.ts`                 | llama-bench JSON parsing and pp/tg summarization (real output samples)              |
| `process.test.ts`                     | Child-process management                                                            |
| `process-terminate.test.ts`           | Process termination strategies                                                      |
| `dev-session.test.ts`                 | Dev-session process-tree cleanup                                                    |
| `process-registry.test.ts`            | Window ↔ process mapping                                                            |
| `e2e-cleanup.test.ts`                 | Process cleanup after the window closes                                             |
| `trash-cleaner.test.ts`               | Config-directory garbage cleanup                                                    |
| `url-parser.test.ts`                  | Model URL parsing                                                                   |
| `model-relevance.test.ts`             | Quantization label parsing                                                          |
| `download-manager.test.ts`            | Multi-segment parallelism / pause / resume / resumable download                     |
| `download-log.test.ts`                | Download event log (`.llama_dl.jsonl` replay / legacy migration)                    |
| `modelscope-client.test.ts`           | ModelScope API (success mapping / quantization classification / the 3 backoff retries on retry with no retry on 404 / formatFileSize aliases) |
| `huggingface-client.test.ts`          | HF mirror configuration / injectable transport / file listing                       |
| `retry.test.ts`                       | Unified retryability decision and backoff                                           |
| `format.test.ts`                      | All boundaries of shared `formatBytes`/`formatDuration` (0/NaN/Infinity, the 1023/1024 switch point, tiers, whole-unit folding) |
| `host-env.test.ts`                    | shared `hostList`/`tcpHosts`/`displayHost` (multiple addresses and `.sock`) + `detectLlamaEnvOverrides` (`LLAMA_ARG_*` detection) |
| `props-check.test.ts`                 | `/props` read-back reconciliation: zero false alarms on a real b11178 snapshot, the float32 / uint32-seed / path normalizations, `onlyWhenSent` skips, and a failed read-back reported as unreachable rather than a mismatch |

### ui package (inline tests under `src/`)

| Test file                          | Covered module                                                            |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `src/stores/params.test.ts`         | Params store (dual-track values/baseline, dependency linkage `syncDependencies`, `clearSession` keeping the model, restoring the baseline) |
| `src/stores/server.test.ts`         | server store (`apiUrl` bound to the real service state: the three states running/starting/stopped) |
| `src/composables/useModelPreset.test.ts` | Silent matching and application of smart presets (alias/filename candidates, no second confirmation in a dirty state) |
| `src/composables/useAutoPresetName.test.ts` | Preset-name candidate generation (extension-stripped / directory-name variants) |
| `src/composables/useUrlHistory.test.ts` | URL history records                                                       |
| `src/dev/demo-mock.test.ts`         | Browser-mock command preview: default state emits the 4 baseline recommendations, sentinels stay out, custom args stay out of the built-in box, and the result is byte-equal to the `shared` emitter |
| `src/testing/arco-theme.test.ts`       | Theme token alignment (HTML `data-theme` / body `arco-theme`)             |
| `src/testing/status-tag.test.ts`       | Variant rendering of the `StatusTag` status label                         |

## Manual smoke scripts (require a real engine/model)

| Script | Prerequisites | What it verifies |
| ---- | ---- | ---- |
| `scripts/verify-server-start.mjs` | Build `core/dist` first (`pnpm --filter @llama-launcher/core build`), and a llama-server binary in that directory | `Launcher` launch-orchestration smoke test: state machine / listening detection / stop cleanup, asserting stage by stage and printing the results |
| `scripts/integ_devsession.mjs` | `pnpm build` first (it needs the `packages/core/dist/process.js` artifact) | Integration check of dev-session teardown: it simulates the `turbo run dev` process tree and has a probe child (standing in for electron) call `findDevSessionRoot` + `killProcessTree`, asserting the whole dev tree is killed |

Both are run manually (they are not wired into `pnpm test`), for end-to-end verification against real binaries/engine environments.

## E2E (Playwright)

Renderer-layer E2E and the Electron smoke test live in the root-level `e2e/` (not through turbo, independent of `pnpm test`):

| Command | Prerequisites | What it verifies |
| ---- | ---- | ---- |
| `pnpm e2e:web` | none (it first runs `pnpm --filter @llama-launcher/ui build` internally) | Drives Chromium against the real build output (vite preview serving `packages/ui/dist` + demo-mock injection): each of the 7 sidebar navigation items is reachable, the demo list on the Models page, the running status card on the Service page, and a-switch / slider interaction on the Params page. Cases in `e2e/web/*.spec.ts` |
| `pnpm e2e:electron` | none (it builds desktop first internally) | `_electron` launches the packaged artifact headless in production mode (loadFile `dist/ui/index.html`), asserting the main-process version, the window title and the sidebar rendering; script `e2e/electron/run-smoke.mjs` |
| `pnpm test:e2e` | none | Runs a full build first, then executes `pnpm e2e:web` and `pnpm e2e:electron` in sequence (unified onto these two scripts since 2026-09-20 — the old form called `playwright test --project=web` directly, which bypassed the preview driver, and once `webServer` was removed from the config nobody started port 4173 at all) |

Key points and pitfalls:

- Browser binaries: the first run needs `pnpm exec playwright install chromium` (the CI e2e job already passes `--with-deps`).
- **The preview process is owned by exactly one place, `e2e/run-web-e2e.mjs` (local and CI take the same path)** — the definition of `pnpm e2e:web` is "build ui + run that driver", and CI is no exception. **The port number also exists in only this one place** (`PREVIEW_PORT`): once the driver has the server up it passes it to the `playwright test` child process through `E2E_PREVIEW_URL`, and `baseURL` in `playwright.config.ts` reads that variable instead of holding a second copy of `4173`; with the variable missing, the config **exits 1 immediately** under a `test` invocation (the consequence of bypassing the driver was measured on 2026-09-20: nobody started 4173, the browser connected to whatever leftover process held the port, and all 11 cases went red for a hard-to-locate reason). `playwright.config.ts` **no longer declares `webServer`**: the old config gave only `port` and not `url`, but Playwright creates its availability callback only when a `url` is given (`runner/index.js:839`), so ① port occupancy was never detected, ② a vite instance was spawned anyway (and exited with EADDRINUSE because the driver already held 4173), and ③ `_waitForProcess`, with no url and nothing to wait for on stdio, swallowed the exit via `processExitedPromise.catch(() => {})` (`runner/index.js:935-939`). Net effect: a doomed process started for nothing on every run, **whoever served 4173 depended on which of the two processes bound it first**, and the `reuseExistingServer` / `timeout` knobs were completely ineffective. The driver adds two more guarantees of determinism: before starting it probes 4173 and **exits 1 if the port is already taken** (no silent reuse, to avoid "green, but what was verified was the old artifact / somebody else's server"); it keeps the last 60 lines of the child's stdout/stderr and prints them on a timeout or a spawn failure (previously `stdio: 'ignore'` left nothing but a bare timeout message).
- Demo data: in a browser environment without `window.api`, `main.ts` injects demo-mock, so the static pages can be verified offline; but the demo setting's `last_tab` jumps back to "Overview" at startup, so the cases all navigate to the target page through the sidebar.
- The Electron smoke test starts headless (`--headless --disable-gpu`) and is finished off with a direct process-tree force-kill (`taskkill /T`) rather than a graceful exit — the app intercepts close and pops the "confirm quit again" dialog, which would hang the run; on local Windows no real window is displayed.
- Single-instance lock: the app calls `requestSingleInstanceLock` — before running the Electron smoke test, make sure no instance of the app is already running.

## Windows exit-race fallback (ui package)

Under vitest 2.1.x there was an exit race on Windows: after a tinypool worker was destroyed, its IPC pipe handle stayed behind in the main process, and when the full ui run (4 test files at the time) happened to have a referenced handle stuck in the event loop, the process exited silently without terminating even though every test had passed — and `pnpm test` (the turbo pipeline) hung along with it. The fix: `packages/ui/vitest.global-setup.mjs` (referenced through `globalSetup` in `vitest.config.ts`) calls `process.exit` after the run ends and `process.exitCode` is settled, forcing termination — test results and exit code are unchanged, only the stuck event-loop wait is skipped. **vitest 4 rewrote the pool (tinypool removed), so the root cause of that hang is fixed upstream and this fallback is kept as a defense** (in case the same class of leftover handle is reintroduced); it applies to run mode only (this package's `test` is `vitest run`); if the fallback is confirmed unnecessary it can be deleted wholesale.
