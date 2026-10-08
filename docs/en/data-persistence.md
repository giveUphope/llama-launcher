# Type definitions and persistence

> Language: English · [中文](../zh/data-persistence.md)
> Scope: Type definitions (shared/src/types) and persistence (settings / per-model parameter sets / trash cleanup).
> Index: [README.en.md](../../README.en.md) · Related: [architecture.md](architecture.md)

## 9. Type definitions

Every type file under `packages/shared/src/types/` and its key types:

| File | Key types |
|------|----------|
| `settings.ts` | `AppSettings`, `ThemeMode`, `CloseBehavior`, `Language` |
| `param.ts` | `ParamDef`, `ParamGroup`, `ParamType` |
| `model-params.ts` | `PresetValues` (the generic parameter value map, shared with command building), `ModelParams` (a per-model parameter set: model path + updated_at + values) |
| `server.ts` | `ServerInfo` (incl. the `values` launch snapshot, the `stop` stop-fact, `envOverrides` — the `LLAMA_ARG_*` variable names detected at launch — and `propsCheck`, the read-back reconciliation whose `checkedAt` timestamp tells the UI how fresh the verdict is (re-checks are driven by "the page is really visible" and back off `15s×2^n` capped at 60s while idle, dropping straight back to the fast tier when the verdict changes and stopping entirely when the page deactivates — so the timestamp is still only a freshness marker, never a fixed interval you can assume); `url` is built by `displayHost()` from the possibly comma-separated `host`, picking the loopback or first TCP address, and is empty for a pure `.sock` config; `readyAt`, this round's first readiness moment (epoch ms, same source as the status event — "uptime" is derived from it, while a renderer-recorded start goes wrong on first page entry or reload)), `PropsCheck`/`PropsMismatch` (the shape of the `/props` reconciliation result, defined in `params/props-mapping.ts`), `ServerStatus` (incl. `stopping`), `OutputEntry`, `AppLogEntry`/`AppLogKind` (application log), `ModelInfo` (a model scan entry, incl. `tags`), `LlamaBenchSummary`/`LlamaBenchJobState` (llama-bench offline health check) |
| `gguf.ts` | `GgufModelInfo` (60 fields, incl. `rope_freq_base`), suggested-parameter types |
| `vram.ts` | `DeviceMemInfo`, `PerfTarget`/`TargetRecommendation` (the four performance-target tiers), `OccupancySide`/`HardwareOccupancy`/`VramEstimateResult`/`OccupancyConfig` (VRAM/system-memory occupancy estimation), `ModelFitVerdict`/`ModelFitResult` (model fit verdict) |
| `download.ts` | `StartDownloadRequest`, download task/progress types |
| `trash.ts` | `TrashKind`, `TrashRoot`, `TrashItem`, `DetectResult`, `CleanResult` (app-generated file cleanup: config directory + model directory, dual root) |
| `ipc.ts` | `IPC` constant object (56 channels), `IpcChannel` |
| `index.ts` | Unified re-exports |

---

## 10. Persistence

- **Config directory**: `~/.llama_launcher/`
  - `settings.json`: application settings and session parameters (field list in the next section).
  - `bench-records.json`: model health-check results (the measured pp/tg numbers from llama-bench), written atomically by core `bench-records.ts`. Only terminal states (done / error) are stored, one record per path (the latest), and the oldest by `testedAt` are dropped beyond 300 records; the main process rehydrates its result cache from it at startup, so closing and reopening the app still shows the last measured speeds on the model page (previously those numbers disappeared with the process).

### Full `settings.json` field list

| Field | Type | Notes |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `settings_version`        | number                        | settings schema version (currently 1; field changes go through the `migrateSettings` migration) |
| `server_exe`              | string                        | llama-server executable path (auto-filled by the `llama_dir` inline detection, see the last two entries) |
| `llama_dir`               | string                        | llama.cpp engine directory (the directory containing llama-server that the user selected) |
| `models_dir`              | string                        | Model storage directory |
| `selected_model`          | string                        | Path of the currently selected model |
| `window_geometry`         | string                        | Window position and size (`x,y,width,height`) |
| `window_maximized`        | boolean                       | Recorded window maximized state (the app always starts maximized; the field is still saved for compatibility with old data / a future "remember restored size") |
| `theme_mode`              | 'dark' \| 'light' \| 'system' | Theme mode (`system` follows the system `prefers-color-scheme`) |
| `close_behavior`          | 'ask' \| 'exit' \| 'tray'     | On window close: ask / exit directly / minimize to tray |
| `sidebar_collapsed`       | boolean                       | Whether the sidebar is collapsed |
| `language`                | 'zh' \| 'en'                  | UI language |
| `last_tab`                | string                        | Last visited page |
| `download_max_concurrent` | number                        | Max concurrent downloads (1–5, default 3; the single source for the bounds and the default is `DOWNLOAD_CONCURRENCY_*` + `clampDownloadConcurrency` in `shared/src/settings-limits.ts`, so core's schema, the downloader's clamping and the Settings page dropdown all come from one place) |
| `hf_mirror_host`          | string                        | HuggingFace mirror source (empty = the default hf-mirror.com; the single source of the default hostname is `shared/src/hosts.ts`); on save it syncs `setHfMirrorHost` to drive the mirror path |
| `custom_args`             | string                        | **Extra arguments**: the raw text of user-defined command-line arguments, edited in its own text box in the command preview; `buildCommand` splits it with shell lexing and appends it to the end of the actual launch command. Fully separate from the built-in parameter command, so "Restore" on the params page does not touch it |
| `engine_hint_dismissed`   | string[]                      | **Dismissed engine-hint entries**: stores the full text of every message currently on the dismissible hint under the settings-page engine row when "Dismiss" is clicked (writes trimmed to the last 50); dismissed entries stay quiet while newly appearing messages still show — per entry rather than per line, because the "N differ" count changes with every parameter edit |

> Parameters no longer live in settings.json: the four dual-track fields `session_values` / `session_baseline` / `last_preset` / `last_preset_id` were removed with **per-model auto-persistence** (2026-10-08; parameters moved to `~/.llama_launcher/model-params/`, see below). Those keys in old settings files are stripped by the schema and silently ignored.

- **Writing and loading**: writes are an atomic replacement (`.tmp` + rename) plus a **CAS merge guard** (the on-disk value is read as the baseline before writing so updates from other windows/instances are not lost, the values passed in this call overwrite same-named keys, and a failed write is retried); loading normalizes field by field (`theme_mode`/`language` enum validation, boolean/number clamping, `download_max_concurrent` clamped to 1–5), and a corrupted or structurally invalid file is automatically backed up to `settings.json.bak` before falling back to the defaults (never silently swallowing user configuration).
- **Per-model parameter sets** (since 2026-10-08, replacing the dual-track mechanism and hand-saved presets): parameters follow the model — every model keeps its own parameter set under `~/.llama_launcher/model-params/`; tweaks are persisted automatically (the renderer throttles `modelParams:save` writes by 800ms) and loaded back on switch/restart, **with no manual saving anywhere**. One JSON file per model, file name = `<sanitized model file name>-<first 8 hex of the normalized-path sha1>.json`, shape: `format_version` (currently 1), `model_path` (the model's absolute path at write time, for display and post-move re-identification), `updated_at` (ISO, latest write), `values` (pure parameter values — no `model` and no legacy `_enabled` residue, serialized stably in `PARAMS` definition order so repeated saves produce no diff noise). Every read and write goes through core's `ModelParamsRepository` (`load`/`save`/`clear`/`deleteForModel`) — after the model directory moves, the set is re-identified by "the file name of the stored original path" and rewritten under the new key, so nothing is lost; deleting a model cleans up its parameter sets in sync (path-prefix matching). Legacy presets are merged in once by the startup migration `migratePresetsToModelParams` (model-bound presets collapse to the newest `saved_at` per model, and migrated source files are deleted; pure parameter sets without a model and corrupt files stay in place for the trash-cleaner). Shape validation (a `values` that is not an object falls back to an empty object); writes are atomic replacements (`.tmp` + rename).
- **Full list of app-generated files (the coverage of cleanup detection, dual-root scan in `trash-cleaner.ts`)**:
  - **Config directory** `~/.llama_launcher/`: `settings.json` (whitelisted, never cleaned), `settings.json.bak` (corruption backup), `settings.json.tmp` (atomic-write residue), `model-params/` (**the live per-model params directory**: `*.json` are valid data (only listed as `orphan_model_params` when the stored model file no longer exists, or as `broken_json` when parsing fails; valid sets are kept), `*.tmp|*.bak` atomic-write/backup residue → `temp_file`), `stats.jsonl` (legacy download statistics, retired → `legacy_stats`), corrupted JSON in the root (not settings → `broken_json`), `bench-records.json` (health-check records: a JSON file that parses is **never listed for cleaning** and only joins `broken_json` when it is corrupt, while the `.tmp` left by an interrupted atomic write joins `temp_file`), `*.tmp/*.bak/*.old/*.log` (`temp_file`).
  - **Model directory** `models_dir`: `*.part` (download temp files), `*.llama_dl.jsonl` (resume event logs), `*.llama_dl.json` (legacy periodic snapshots) → listed as `download_orphan` when no active task holds them. Parameter sets live in `~/.llama_launcher/model-params`, so the model directory gets no params scan; the two generations of legacy preset directories (`<models_dir>/presets` and `~/.llama_launcher/presets`) are **not scanned and not listed for cleaning** (the startup migration empties them; whatever it could not move — same-name collisions, corrupt or unbound files — is user data, and keeping it beats risking a wrong deletion).
  - **Protection and re-validation**: the localPath/partPath/resume-log paths held by tasks in `queued/downloading/paused/error` state are passed into the protection set by `DownloadManager.getProtectedPaths()`, so they are excluded at both detection and cleanup time; `cleanTrash` re-checks every incoming item against its declared kind for root membership (config → CONFIG_DIR, models → modelsDir), path characteristics and content (orphaned parameter sets are re-read at cleanup time and the deletion is abandoned if the model reappears); unrecognized files are never listed at all (conservative policy).
- **`stats.jsonl` (download statistics)**: retired along with the removal of the "total downloads" display (no longer written since 2026-08-14; the `download:stats` IPC and the `download-stats.ts` module were deleted).
- **Download resume log**: `.llama_dl.jsonl` (in the same directory as the downloaded file) is the event log of a download task (the JSONL source of truth) — the three event kinds `start` (with the segment layout) / `segment` (segment progress, persisted event by event) / `done` (terminal state) are appended; after a crash/restart the log is replayed to rebuild segment progress exactly (there is no periodic-snapshot window); pre-`start` legacy `.llama_dl.json` periodic snapshots are migrated in one shot by `migrateLegacyMeta`. The log is deleted once the download completes.
- **`server_exe`**: auto-filled by the `llama_dir` inline detection (`system:findLlamaExe` looks for `llama-server.exe` in the directory and its one-level subdirectories).
- **Default `server_exe`**: in dev mode resolved dynamically by `paths.ts`; in production it returns an empty string and is configured by the user.
