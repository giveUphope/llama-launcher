# Type definitions and persistence

> Language: English · [中文](../zh/data-persistence.md)
> Scope: Type definitions (shared/src/types) and persistence (settings / presets / trash cleanup).
> Index: [README.en.md](../../README.en.md) · Related: [architecture.md](architecture.md)

## 9. Type definitions

Every type file under `packages/shared/src/types/` and its key types:

| File | Key types |
|------|----------|
| `settings.ts` | `AppSettings`, `ThemeMode`, `CloseBehavior`, `Language`, `SessionBaseline` (parameter session baseline `{ preset_name, values }`) |
| `param.ts` | `ParamDef`, `ParamGroup`, `ParamType` |
| `preset.ts` | `PresetValues`, `Preset` |
| `server.ts` | `ServerInfo`, `ServerStatus`, `OutputEntry`, `AppLogEntry`/`AppLogKind` (application log), `ModelInfo` (a model scan entry, incl. `tags`), `LlamaBenchSummary`/`LlamaBenchJobState` (llama-bench offline health check) |
| `gguf.ts` | `GgufModelInfo` (60 fields, incl. `rope_freq_base`), suggested-parameter types |
| `vram.ts` | `DeviceMemInfo`, `PerfTarget`/`TargetRecommendation` (the four performance-target tiers), `OccupancySide`/`HardwareOccupancy`/`VramEstimateResult`/`OccupancyConfig` (VRAM/system-memory occupancy estimation), `ModelFitVerdict`/`ModelFitResult` (model fit verdict) |
| `download.ts` | `StartDownloadRequest`, download task/progress types |
| `trash.ts` | `TrashKind`, `TrashRoot`, `TrashItem`, `DetectResult`, `CleanResult` (app-generated file cleanup: config directory + model directory, dual root) |
| `ipc.ts` | `IPC` constant object (56 channels), `IpcChannel` |
| `index.ts` | Unified re-exports |

---

## 10. Persistence

- **Config directory**: `~/.llama_launcher/`

### Full `settings.json` field list

| Field | Type | Notes |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `settings_version`        | number                        | settings schema version (currently 1; field changes go through the `migrateSettings` migration) |
| `server_exe`              | string                        | llama-server executable path (auto-filled by the `llama_dir` inline detection, see the last two entries) |
| `llama_dir`               | string                        | llama.cpp engine directory (the directory containing llama-server that the user selected) |
| `models_dir`              | string                        | Model storage directory |
| `selected_model`          | string                        | Path of the currently selected model |
| `last_preset`             | string                        | Name of the last loaded preset |
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
| `session_values`          | object \| null                | **Parameter session** (the temporary track): the snapshot of the currently effective parameters, written on change with an 800ms throttle so the session survives restarts; **never written into preset files**; invalid shapes normalize to null |
| `session_baseline`        | object \| null                | **Parameter session baseline**: `{ preset_name, values }` = the preset the session loaded plus the snapshot taken when it was applied, null = no preset baseline; at startup it works together with `selected_model` + `last_preset` to decide the restore path |

- **Writing and loading**: writes are an atomic replacement (`.tmp` + rename) plus a **CAS merge guard** (the on-disk value is read as the baseline before writing so updates from other windows/instances are not lost, the values passed in this call overwrite same-named keys, and a failed write is retried); loading normalizes field by field (`theme_mode`/`language` enum validation, boolean/number clamping, `download_max_concurrent` clamped to 1–5), and a corrupted or structurally invalid file is automatically backed up to `settings.json.bak` before falling back to the defaults (never silently swallowing user configuration).
- **Dual-track parameter logic** (2026-08-29): **temporary track** = `session_values` (written automatically on any parameter change, restored across restarts, never touching preset files); **preset track** = the preset files, written only by an explicit save/overwrite from PresetsPanel (the save also refreshes `session_baseline` and zeroes the dirty flag). `hasChanges` = the deviation from the baseline (from the factory defaults when there is no baseline).
- **Preset files**: stored in the `presets/` subdirectory under the user-configured model directory, resolved dynamically by `resolvePresetsDir(modelsDir)`. One JSON file per preset, v2 shape: `preset_version` (currently 2), `name`, `created_at` (time of first creation, preserved across overwrite saves), `saved_at` (most recent save), `app_version` (the app version that wrote it, for parameter drift audits), `model` (top-level metadata: the path of the associated model file, null = a pure parameter set), `values` (pure parameter values — no `model` and no legacy `_enabled` residue, serialized stably in `PARAMS` definition order so repeated saves produce no diff noise). Loading uniformly migrates to the v2 in-memory shape (v1's `values.model` is promoted to the top-level `model`, files without a version field are treated as v1, a missing `created_at` is backfilled from `saved_at`; the file itself is only rewritten to disk on the next explicit save); shape validation (a `values` that is not an object falls back to an empty object). Writes are atomic replacements (`.tmp` + rename).
- **Full list of app-generated files (the coverage of cleanup detection, dual-root scan in `trash-cleaner.ts`)**:
  - **Config directory** `~/.llama_launcher/`: `settings.json` (whitelisted, never cleaned), `settings.json.bak` (corruption backup), `settings.json.tmp` (atomic-write residue), `presets/` (the legacy presets directory, migrated to modelsDir/presets → `stale_presets_dir`), `stats.jsonl` (legacy download statistics, retired → `legacy_stats`), corrupted JSON in the root (not settings → `broken_json`), `*.tmp/*.bak/*.old/*.log` (`temp_file`).
  - **Model directory** `models_dir`: `*.part` (download temp files), `*.llama_dl.jsonl` (resume event logs), `*.llama_dl.json` (legacy periodic snapshots) → listed as `download_orphan` when no active task holds them; `presets/*.json` are valid data (only listed as `orphan_preset` when the model file bound at the top level no longer exists, or as `broken_json` when parsing fails; pure parameter sets and valid presets are kept), `presets/*.tmp|*.bak` atomic-write/backup residue → `temp_file`.
  - **Protection and re-validation**: the localPath/partPath/resume-log paths held by tasks in `queued/downloading/paused/error` state are passed into the protection set by `DownloadManager.getProtectedPaths()`, so they are excluded at both detection and cleanup time; `cleanTrash` re-checks every incoming item against its declared kind for root membership (config → CONFIG_DIR, models → modelsDir), path characteristics and content (orphaned presets are re-read at cleanup time and the deletion is abandoned if the model reappears); unrecognized files are never listed at all (conservative policy).
- **`stats.jsonl` (download statistics)**: retired along with the removal of the "total downloads" display (no longer written since 2026-08-14; the `download:stats` IPC and the `download-stats.ts` module were deleted).
- **Download resume log**: `.llama_dl.jsonl` (in the same directory as the downloaded file) is the event log of a download task (the JSONL source of truth) — the three event kinds `start` (with the segment layout) / `segment` (segment progress, persisted event by event) / `done` (terminal state) are appended; after a crash/restart the log is replayed to rebuild segment progress exactly (there is no periodic-snapshot window); pre-`start` legacy `.llama_dl.json` periodic snapshots are migrated in one shot by `migrateLegacyMeta`. The log is deleted once the download completes.
- **`server_exe`**: auto-filled by the `llama_dir` inline detection (`system:findLlamaExe` looks for `llama-server.exe` in the directory and its one-level subdirectories).
- **Default `server_exe`**: in dev mode resolved dynamically by `paths.ts`; in production it returns an empty string and is configured by the user.
