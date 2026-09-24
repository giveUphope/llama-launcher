# Core modules in detail

> Language: English · [中文](../zh/core-modules.md)
> Scope: Core business modules: process management, launch orchestration, command building, model scanning, GGUF metadata, online downloads, path resolution.
> Index: [README.en.md](../../README.en.md) · Related: [params-system.md](params-system.md) · [desktop-main.md](desktop-main.md)

### 4.1 Process management (process.ts)

The `LlamaServerProcess` class (extends `EventEmitter`), wrapping `child_process.spawn`:

- **`start(opts)`**: spawns the child process configured with `windowsHide: true` and `shell: false`, so no extra shell layer is introduced.

- **Line buffering**: stdout/stderr are split line by line and emitted as `OutputEntry { kind, data, ts }` through the `output` event, so half-written lines cannot pollute the log.

- **`kill()`**: on Windows uses `taskkill /F /T /PID` to kill the whole process tree (prevents leftover child processes); on other platforms sends `SIGKILL` to the negative pid (process group) for immediate termination (graceful `SIGTERM` termination is only used by the two-phase `terminate()` flow).

- **Two-phase termination suite**: `LlamaServerProcess.terminate()` (graceful SIGTERM → escalates to killTree after a timeout, process.ts:188), `killSync()` (synchronous forced kill, process.ts:150), `sweepByName()` (sweeps leftover processes by executable file name, process.ts:98); **`forceStop()` lives on `Launcher`** (launcher.ts:100, combining killTree + sweepByName, called from Electron `before-quit` via launcher-bridge.ts:140) — not in process.ts.

- **`isRunning()`**: the condition is `exitCode === null && !killed`.

### 4.2 Launch orchestration (launcher.ts)

The `Launcher` class (extends `EventEmitter`), implementing a state machine:

- **State machine**: `stopped → starting → running → stopped`

- **`start(opts)`**: calls `buildCommand` to assemble the command → creates a `LlamaServerProcess` → listens to the `output` event and switches to `running` once a "listening" keyword is matched.

- **Generic listening detection**: matches lines containing both `"listening"` and (`"http"` or `"server"`), which stays compatible with the output format of every llama-server version.

- **`stop()`**: calls `proc.kill()`.

- **`restart(opts)`**: stops first, waits for the `exit` event, then starts, guaranteeing the port has been released.

- **`getStatus()`**: returns `ServerInfo { status, pid, host, port, url, values }` (`values` is the parameter snapshot taken for this launch, used by the Service page to show runtime details).

### 4.3 Command building (command-builder.ts)

- **`buildCommand(opts)`**: validates that `exePath` exists and produces the `[exePath, '-m', modelPath, ...flags]` array.

- **Emission rules** (there is no separate enable mechanism; `values._enabled` is a legacy field, ignored outright when read): a flag is emitted only when the value **differs from its default**; a checkbox emits `flag` when checked and `invert_flag` when unchecked (an always-on switch with no `invert_flag` and a default of false emits nothing when unchecked, e.g. `--metrics`); empty strings are skipped; params whose `dependsOn` dependency is unmet are skipped; `model` always gets `-m` appended (nothing is appended when the model is empty).

- **checkbox**: when `invert_flag` exists, true emits `flag` and false emits `invert_flag` (e.g. `--jinja` / `--no-jinja`); always-on switches without `invert_flag` (default false) emit only when true.

- **float\_slider**: keeps 2 decimals, so floating-point precision cannot make the command string unstable.

- **spec\_type**: `draft-model` is mapped to `draft-simple` for backward compatibility.

### 4.4 Model scanning (models-scanner.ts)

- **`scanModels(dir, opts)`**: recursively scans `.gguf` files (asynchronous `fs/promises` parallel traversal, so the main process is never blocked), skipping files whose name contains the `mmproj` / `projector` / `multimodal` keywords (multimodal projectors) and draft-model files carrying the `dflash` / `draft` keywords. Directory entries are typed via the `Dirent` from `withFileTypes` (only the returned `.gguf` files are `stat`-ed for their size). The cache is keyed by **directory**, and the fingerprint is the `mtime+ctime` of that directory plus each of its subdirectories (capped at 200 directory fingerprints, 8 result entries), so any change inside any subtree is detected instead of only comparing the top-level directory mtime; when `invalidateScanCache(changedPath?)` is given the absolute path of the changed file, only the entries covering that path are invalidated (`MODELS_WATCH` already passes it that way, so a single `.gguf` change no longer wipes the whole cache and forces a full rescan); without it, or with a non-absolute path, it conservatively clears everything.

- **Missing directory**: throws the `DIR_NOT_FOUND` error code; the `createIfMissing` option creates the directory automatically.

- **`detectMmproj(modelPath)`**: looks for mmproj files in the model's own directory, preferring files whose name contains `"mmproj"`; used to auto-associate the multimodal projector.

- **`detectDraftModel(modelPath)`**: looks for draft-model files in the model's own directory (`.gguf` files whose name contains `dflash` / `draft`), preferring files containing `"dflash"`; used to auto-associate DFlash / speculative-decoding draft models.

- **`removeModelFile(modelPath, modelsDir)`**: removes per model file. It first inspects what else is in the model's directory — if the directory contains anything else (other quantization variants, user-created non-gguf files, subdirectories, etc.) **only the selected model file is deleted** and the rest is kept; if nothing else remains, the model file plus the related companion GGUFs (`.gguf/.bin` with the mmproj/projector/multimodal keywords, `.gguf` with the dflash/draft/mtp keywords) are deleted and the now-empty directory is removed too (returns `removedDir`, so preset cleanup can match on the directory prefix). Safety constraint: only paths inside modelsDir may be deleted; deleting modelsDir itself is refused.

### 4.5 GGUF metadata reading (gguf-meta.ts)

- **Streaming read**: `BufferReader` loads file content on demand in 64KB blocks, so memory usage stays constant and multi-GB model files can be read.

- **Array skipping strategy**: fixed-size arrays are skipped in one go via `count × elementSize` with `skipBytes`; string arrays (`tokenizer.ggml.tokens` commonly holds 100,000–250,000 elements) go through `skipStringArray()` — while the cursor is still inside an already loaded block the length is read directly with `readUInt32LE` and the cursor just advances, falling back to asynchronous `skipString()` only when crossing a block boundary. The previous per-element `await` produced the same order of magnitude of microtasks and 8-byte Buffer allocations, saturating the main process event loop and starving the IPC replies in the same process. Measured (synthetic 200,000 tokens / 3.4 MB header) the parse time went **48–53ms → 5.0–5.8ms**.

- **IPC payload trimming**: `MODELS_READ_GGUF_META` does not send back `info.metadata` (the full KV map) nor the raw `chat_template` (truncated to 200 characters) — the renderer only uses the derived fields and a "is there a template" checkbox (`ModelMetaCard`).

- **Version compatibility**: supports GGUF v1 / v2 / v3, validating the magic number `0x46554747` ("GGUF" in ASCII).

- **ARRAY types are skipped**: tokenizer and other array payloads can reach several MB, so they are skipped without being read into memory.

- **Extracts `GgufModelInfo`**: contains 60 fields (architecture, context length, quantization, sampling parameters, rope base, organization/license/dataset/tokenizer, etc.).

- **`buildSuggestions(info)`**: derives suggested parameters from the metadata, **11 rules** in total: `temperature` / `top_k` / `top_p` / `min_p` / `repeat_penalty` / `presence_penalty` / `spec_type` / `alias` / `cache_type_k` / `cache_type_v` / `flash_attn` (only items backed by metadata and deviating from the current value are suggested; purely informational data such as the `context_length` training ceiling produces no suggestion — `-c 0` already means "load from model", and the `ctx_size` suggestion was removed on 2026-09-03; main-model guard: non-model types / clip attachments produce no suggestions).

- **LRU cache**: capped at 32 entries, keyed by `filePath:mtimeMs:size`, invalidated automatically when the file changes.

### 4.6 Online downloads (download-manager.ts + modelscope-client.ts + url-parser.ts)

**`DownloadManager`** (singleton, extends `EventEmitter`):

- **Multiple concurrent tasks**: `maxConcurrent = 3`, the rest queue.

- **Multi-segment parallel download**: the dynamic segment-count algorithm `computeSegmentCount` grows with file size (<100MB→1 segment, <1GB→2, <5GB→4, <20GB→6, ≥20GB→8), then takes the `max` with the target segment count computed from `SEGMENT_TARGET_SIZE`(100MB) and the `min` with the cap implied by `MIN_SEGMENT_SIZE_BYTES`(8MB), hard-capped at 32 segments; the worker queue model makes the number of concurrent workers equal the number of segments, and each worker claims the next segment as soon as one finishes, which removes the tail-segment bottleneck. `highWaterMark = 2MB` (`WRITE_STREAM_HWM`, download-manager.ts:198 — lowered from 16MB on 2026-09-19 to cut memory residency and backpressure latency during downloads).

- **Resume**: detects the size of an already existing file and sends a `Range` header; segment progress is persisted as a `.llama_dl.jsonl` **event log** (append-only: the three event kinds start/segment/done), and after a failure/pause the events are replayed to restore segment state; the legacy `.llama_dl.json` (a single JSON snapshot) is migrated automatically once by `migrateLegacyMeta`.

- **Temp file naming**: while downloading, bytes go to `<file>.part` (`PART_SUFFIX`); after the integrity check passes, the file is renamed within the same directory to the final `.gguf`. An incomplete download always keeps the `.part` suffix, so the model scan/watch never picks it up as a `.gguf` (incomplete `.gguf` files that older versions wrote directly under the target name are migrated to `.part` on resume); the rename on completion triggers the model directory watcher, and only then does the model appear in the list.

- **Pause/resume**: `pauseDownload(id)` saves the metadata and destroys the active requests; `resumeDownload(id)` recovers from the `paused`/`error` state, so failures can be retried.

- **HTTP redirect following**: 30x redirects are handled automatically (for both probing and segment requests).

- **Injectable transport layer**: the `DownloadTransport` interface allows injecting an Electron `net` module transport (the Chromium network stack). Only `hf-mirror.com` goes through the injected transport; every other source (ModelScope etc.) uses `node:https`, which sidesteps the problem of the BoringSSL TLS fingerprint being rejected.

- **Directory structure**: `models_dir/author/repo name/fileName`.

- **Progress push**: every **120ms** (`PROGRESS_INTERVAL_MS`) `downloadedSize` is aggregated across all segments and `progress` is emitted, so the progress bar advances continuously with real bytes; **rate/ETA are sampled on a separate 500ms window (`SPEED_SAMPLE_MS`) and smoothed with EMA(α=0.5)** — the two cadences are deliberately decoupled (120ms samples are too noisy, and using the same frequency would make the speed jump around violently). On completion/failure it emits `complete` / `error`; the `errorType` field lets the frontend display a friendly diagnosis.

- **State machine**: `queued → downloading → completed`; interruptible into `paused` / `error` / `canceled`.

**`modelscope-client`**: anonymous access to the ModelScope API, searching models and listing repository files. File entries include a `quantization` field (parsed from the file name by `parseQuantization`).

**`huggingface-client`**: reaches the HuggingFace API through the `hf-mirror.com` mirror (`/api/models/{ns}/{name}/tree/main?recursive=true`) to list repository files. Supports an injectable transport (`HfHttpTransport` / `setHfTransport`); the Electron main process injects a `net`-module-based transport to work around BoringSSL TLS fingerprints being rejected by hf-mirror.com. **Redirect behaviour depends on the transport**: the core default transport (`node:https`) does not follow automatically — `request()` follows manually (at most 5 hops, each hop rebuilding `pathname + search` onto the current mirror host so it stays inside the mirror domain); the `net` transport injected by the main process uses `redirect: 'follow'` (Electron net's `'manual'` mode does not return the 3xx but throws `Redirect was cancelled`), so Chromium follows redirects automatically and **may leave the mirror host** — in that case `request()`'s 3xx branch is merely a safety net and never actually fires (see `apps/desktop/src/main/hf-transport.ts`). The mirror host is configurable (`setHfMirrorHost`, driven by the `hf_mirror_host` setting), so you can point it at your own reverse proxy. 3 retries with exponential backoff.

**`url-parser`**: parses model URLs from three sources: LM Studio / HuggingFace / ModelScope. Both `huggingface.co` and `hf-mirror.com` are recognized as `source: 'huggingface'`, in which case DownloadCard skips the ModelScope search and goes straight down the HF mirror path.

**`parseQuantization`** (shared/model-relevance.ts): recognizes quantization labels from the file name (Q4\_K\_M / IQ3\_XS / FP8 / BF16 / INT4 etc.) and returns `{ label, bits, family }`. Used for the badges in file lists and download tasks.

### 4.7 Path resolution (paths.ts)

- **Dev-mode llama-server lookup**: scans the `llama-*-bin-*` directories under the project root, with no version-number restriction.

- **Newest version wins**: when several versions exist, the directory names are sorted in descending order and the newest version is selected.

- **Production mode**: returns an empty string; the user picks the engine directory on the "Settings" page and the inline detection mechanism finds `llama-server.exe`.

- **`resolvePresetsDir(modelsDir)`**: returns `modelsDir/presets`; preset files are stored in the presets subdirectory under the model directory.

- **Companion tags**: `detectCompanionTags` (**defined in `models-scanner.ts:111`**, not paths.ts) annotates scan results with companion-file tags (whether a multimodal projector / draft model exists), writing them into `ModelInfo.tags` for the frontend to display.

### 4.8 Settings and preset storage (settings-store.ts / presets-store.ts)

- **`settings-store.ts`**: `loadSettings()` / `saveSettings(settings)` / `getDefaultSettings()`. Persists to `~/.llama_launcher/settings.json`; writes are an **atomic replacement** (`.tmp` + rename) plus a **CAS merge guard** (the on-disk value is read as the baseline before writing, so updates from other instances are not lost); loading normalizes field by field, and a corrupted file is automatically backed up to `settings.json.bak`. The schema version is managed by `SETTINGS_VERSION` (changes go through `migrateSettings`). When `hf_mirror_host` is present, `setHfMirrorHost` is synced to drive the mirror path. The full field list is in [data-persistence.md](data-persistence.md) §10.

- **`presets-store.ts`**: `listPresets(dir)` / `loadPreset(dir, name)` / `savePreset(dir, name, values)` / `deletePreset(dir, name)` / `deletePresetsForModel(modelsDir, modelPath)` (cleans up the associated presets when a model is removed). Preset files live at `<models_dir>/presets/*.json` (resolved dynamically by `resolvePresetsDir`), v2 shape: top-level `model` + pure `values` (no `model` inside the values and no legacy `_enabled` residue), serialized stably in `PARAMS` definition order; writes are atomic replacements. Loading uniformly migrates to the v2 in-memory shape (v1's `values.model` is promoted to the top-level `model`). Details in [data-persistence.md](data-persistence.md) §10.

### 4.9 Retryable-error detection and exponential backoff (retry.ts)

The network-resilience layer shared by download-manager and huggingface-client (converging two nearly duplicate implementations, so new network calls reuse it at zero cost):

- `isRetryableError(err)`: `code`/`statusCode` hits a transient network error code (`ECONNRESET`/`ETIMEDOUT`/`EPIPE`/`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`) or a retryable HTTP status (408/429/500/502/503/504), or the message hits a keyword (`timeout`/`econnreset`/`socket hang up`/`network` etc.).

- `retryDelayMs(attempt, baseMs=1000, maxMs=30000)`: `base × 2^attempt + jitter(0–500ms)`, capped at `maxMs`. huggingface-client's retry increments attempt on every hop.

### 4.10 Download resume event log (download-log.ts)

The **JSONL source of truth** for download resume (the counterpart of DSH's append-only session-log idea):

- Three event kinds: `start` (carries the segment layout, used as the baseline when replaying) / `segment` (segment progress, appended to disk) / `done` (terminal state, for diagnostics only).

- `appendDownloadEvent(localPath, event)` appends one line (write failures are silent, they never affect download correctness); `replayDownloadLog(localPath)` projects and rebuilds segment progress from the last valid `start` as the baseline (segment-progress lines out of range are skipped, taking the maximum monotonically); `deleteDownloadLog` cleans up on completion/cancel; `migrateLegacyMeta` converts the legacy `.llama_dl.json` (v1/v2 snapshots) in one shot and deletes the old file (it does not overwrite when a `.jsonl` already exists).

- Suffix constants: `DOWNLOAD_LOG_SUFFIX='.llama_dl.jsonl'`, `LEGACY_META_SUFFIX='.llama_dl.json'` (trash-cleaner identifies download leftovers by these same constants).
- **The terminal `errorType` is normalized on recovery**: a done record's `errorType` is only trusted when it falls inside `DOWNLOAD_ERROR_TYPES` (the runtime membership table in `shared`, from which the union type is derived); dirty values are discarded outright. Old logs (written before the field existed) only carry the raw `error` text, so when `status==='error'` the classification is backfilled with `classifyError(errorText)` — otherwise the renderer's `errorDisplay` would fall back to showing untranslated English text (the raw fallback branch in `DownloadCard`).

### 4.12 Process cleanup logger (cleanup-logger.ts)

A logger dedicated to process cleanup: a uniform `[cleanup:level]` prefix + timestamp, four levels (debug/info/warn/error), used to record the outcome of every terminate / sweep step along the window-close cleanup chain of process-registry; `setCleanupLogLevel` adjusts the minimum output level (debug is fine during development). No external dependency, it only wraps console. Note the difference from **`apps/desktop/src/main/app-log.ts`**: the latter is the **application log buffer** (ring buffer of 2000 entries + `logs:*` IPC pushing to the "Logs" page), recording application lifecycle events, not process-cleanup debug logs.

### 4.13 App-generated file cleanup (trash-cleaner.ts)

The data source behind "Settings → About → Clean Config Dir" (what `system:detectTrash` / `system:cleanTrash` delegate to), covering every location the app writes to:

- **Dual-root scan**: the config directory `~/.llama_launcher/` (`settings.json` is whitelisted and never cleaned, `.bak/.tmp` residues, the legacy `presets/`/`stats.jsonl`, corrupted JSON in the root) + the model directory (`*.part`, resume logs, orphaned/corrupted presets, `presets/*.tmp|*.bak`).

- **Strict validation**: paths must lie strictly inside a declared root and must not be symlinks; `cleanTrash` re-checks each incoming item against its declared `kind` for root membership and content (orphaned presets are re-read at cleanup time, and the deletion is abandoned the moment the model reappears); paths held by active/paused/retryable download tasks are handed to the protection set by `DownloadManager.getProtectedPaths()` and excluded at both stages; unrecognized files are never listed at all (conservative policy).

- Protection rules and the complete kind list are in [data-persistence.md](data-persistence.md) §10 "Full list of app-generated files".

### 4.14 Key class and function index

A quick-reference table of the main exports across packages (details live in each module's section):

**`packages/core/src` (the business logic core, `index.ts` re-exports everything)**

| File | Main exports | Notes |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `paths.ts`              | `CONFIG_DIR`/`SETTINGS_FILE`/`PRESETS_DIR`, `resolvePresetsDir(modelsDir)`, `basenameSafe` | Path constants and resolution; in dev mode it auto-finds the newest `llama-*-bin-*` directory |
| `settings-store.ts`     | `loadSettings` / `saveSettings` / `getDefaultSettings` | Settings read/write (CAS + atomic replacement, §4.8) |
| `presets-store.ts`      | `listPresets`/`loadPreset`/`savePreset`/`deletePreset`/`deletePresetsForModel` | Preset CRUD (v2, §4.8) |
| `models-scanner.ts`     | `scanModels` / `detectMmproj` / `detectDraftModel` / `removeModelFile` / `invalidateScanCache` / `ensureDir` | Recursive .gguf scanning + companion detection + removal (§4.4) |
| `command-builder.ts`    | `buildCommand` / `previewCommand` / `formatCommand` / `tokenizeArgs` / `quoteArg` | Launch command building (§4.3) |
| `process.ts`            | `LlamaServerProcess` / `killProcessTree` / `SimpleProcessInfo` / `findDevSessionRoot` / `pickTurboDevRoot` | Child-process wrapper + two-phase termination (§4.1) |
| `launcher.ts`           | `Launcher` (`start`/`stop`/`restart`/`getStatus`) | Launch orchestration state machine (§4.2) |
| `gguf-meta.ts`          | `readGgufMetadata` / `estimateModelParams` / `estimateQuantFromSize` / `nameContainsLabel` / `clearGgufCache` | GGUF streaming read + suggestion derivation (§4.5) |
| `devices.ts`            | `listDevices` / `parseListDevicesOutput` / `serverExeName` / `candidateServerExes` / `resolveServerExe` | VRAM probing: spawns `llama-server --list-devices` and parses total/free MiB per device (line-by-line fault tolerance, never throws on timeout). **Resolving the exe used for probing has a fallback chain** (`server_exe` → its own directory → the `llama_dir` root → one level of subdirectories → the repo-root `llama-*-bin-*` in dev mode), with each candidate checked for existence — renaming or moving the engine directory no longer makes it silently return nothing; deduplication ignores separator differences (win32 `path.join` yields backslashes while settings store forward slashes) |
| `vram-estimate.ts`      | `estimateVram` / `estimateOccupancy` / `solveMaxContext` / `kvLayersOf` / `kvBytesPerTokenOf` / `KV_DTYPE_BYTES` | GGUF KV memory model + two-sided VRAM/system-memory occupancy estimation + solving the largest context that stays OOM-free (joint budget) |
| `target-recommend.ts`   | `recommendForTarget` (four `PerfTarget` tiers: max-context / balanced / latency / memory) | Performance-target linked suggestions: for the target dtype it derives the OOM-free context within the VRAM (+system memory) budget, plus the KV quantization tier / offload layer count / MTP strategy. The reason carries **no prose** — it ships `reasonKey` plus `reasonArgs` containing only numbers/enums, and the renderer translates via `t(reasonKey, reasonArgs)` (this module used to embed `TARGET_LABEL` and Chinese template strings, which printed Chinese straight into the English UI; removed after the 2026-09-21 hardcoding audit) |
| `llama-bench.ts`        | `runLlamaBench` / `parseLlamaBenchJson` / `summarizeBenchRows` | llama-bench offline health check: measured prefill/decode at pp512/tg128 (parses `-o json`) |
| `url-parser.ts`         | `parseModelUrl` | Model URL source parsing (§4.6) |
| `modelscope-client.ts`  | `searchModels` / `listModelFiles` (both go through `requestWithRetry` exponential-backoff retries) / `buildDownloadUrl` / `buildModelPageUrl` / `formatFileSize` (alias re-export of shared `formatBytes`) | ModelScope API (§4.6) |
| `huggingface-client.ts` | `listHfFiles` / `buildHfDownloadUrl` / `buildHfModelPageUrl` / `setHfTransport` / `setHfMirrorHost` / `getHfMirrorHost` / `isHfMirrorHostname` | HF mirror client (§4.6) |
| `download-manager.ts`   | `DownloadManager` (singleton `getDownloadManager`) / `setDownloadTransport` / `DownloadTransport` | Multi-task resumable downloads (§4.6) |
| `download-log.ts`       | `appendDownloadEvent` / `replayDownloadLog` / `deleteDownloadLog` / `migrateLegacyMeta` | Resume event log (§4.10) |
| `retry.ts`              | `isRetryableError` / `retryDelayMs` | Retry classification and backoff (§4.9) |
| `error-classify.ts`     | `classifyError(err, httpStatus?)` | Classifies low-level errors into a `DownloadErrorType` (download failure diagnosis + backfilling the type when restoring old logs). A module of its own: `download-manager` depends on `download-log`, and `download-log` also classifies during recovery, so a reverse reference would form a cycle |
| `types.ts`              | `LauncherEvent` | Launcher event-name union (`output` / `status` / `exit` / `error` / `command`) |
| `trash-cleaner.ts`      | `detectTrash` / `detectTrashAsync` / `cleanTrash` / `cleanTrashAsync` (`TrashScanOptions`; the IPC side always uses the async variants) | App-generated file cleanup (§4.13) |
| `cleanup-logger.ts`     | `cleanupLogger` (debug/info/warn/error) / `setCleanupLogLevel` | Process cleanup logging (§4.12) |

**`packages/shared/src` (single source of truth for types / params / i18n)**

| File | Main exports | Notes |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `types/`                | `IPC` (56 channels), `AppSettings`, `ParamDef`, `Preset`, `ServerInfo`, `OutputEntry`, `ModelInfo`, `GgufModelInfo`, `DownloadTask`, `TrashItem`, `HardwareOccupancy`/`VramEstimateResult`/`PerfTarget` etc. | All cross-package types ([data-persistence.md](data-persistence.md) §9) |
| `params/definitions.ts` | `PARAMS` (60: basic 22 / advanced 28 / server 10) / `PARAM_GROUPS` (3 groups) / `MODEL_KEY` / `APP_VERSION` / `APP_NAME` / `APP_REPO_URL` + `LLAMA_CPP_RELEASES_URL` / `DEFAULT_HOST` + `DEFAULT_PORT` + `PORT_MIN` + `PORT_MAX` + `isValidPort()` (all four network entries are derived from the two `host`/`port` items) | Single source of the parameter table ([params-system.md](params-system.md)). ① Single source for network defaults and port bounds: the fallback values and range validation in the main process / core / renderer all reference this instead of each writing their own `'127.0.0.1'` / `?? 8080` / `> 65535` (the default used to be scattered over 7 places and the port upper bound over 5; missing one produced the false "port already in use" warning — "the UI probes 8080 while the server listens on another port" — or the split where the Params page accepts a value but the launch check rejects it); ② single source for outbound links (the llama.cpp releases URL used to be written out in full in both AboutPanel and GeneralPanel) |
| `hosts.ts`              | `MODELSCOPE_HOST` / `DEFAULT_HF_MIRROR_HOST` / `normalizeMirrorHost(raw)` / `HF_SOURCE_HOST_SUFFIXES` + `MODELSCOPE_HOST_SUFFIX` | Single source for download-source hostnames and the mirror fallback (shared by the core clients and the UI's "Open in browser" external links; a fork would send downloads to the self-hosted mirror while links still jumped to the default site). **The recognition suffixes and the host used for link building are two separate lists**: link building uses `www.modelscope.cn`, while the site check for pasted URLs must use the `modelscope.cn` suffix without www, otherwise bare-domain links are classified as unrecognized |
| `settings-limits.ts`    | `DOWNLOAD_CONCURRENCY_DEFAULT/MIN/MAX/OPTIONS` + `clampDownloadConcurrency(n)` | Single source for the value bounds of app settings: core's zod schema, the downloader's clamping and the Settings page dropdown all draw from here (`ui ↛ core`, so the constants have to live in shared) |
| `i18n/`                 | `tr` / `trAt(lang, …)` / `setLang` + the zh/en dictionaries | Bilingual UI copy (`trAt` serves pure functions that need an explicit language, e.g. `time-format`; all copy lives here, the data layer only emits keys) |
| `model-name.ts`         | `modelBaseName(modelPath)` | Model display-name / alias derivation (auto-fills alias) |
| `model-relevance.ts`    | `categorizeFile` / `parseQuantization` / relevance scoring | File classification + quantization label parsing (download badges) |
| `time-format.ts`        | `formatRelativeTime(input, lang)` | Humanized time formatting |

**`apps/desktop/src/main` (Electron main process)**

| File | Main exports | Notes |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `index.ts`              | Entry logic (single-instance lock / `registerIpcHandlers` / `installHfTransport` + `installDownloadTransport` / `createMainWindow` / `launcherBridge`) | Lifecycle entry ([desktop-main.md](desktop-main.md) §6.1) |
| `window.ts`             | `createMainWindow` (geometry persistence, 500ms debounce) | Window management (§6.2) |
| `ipc/index.ts`          | `registerIpcHandlers` (`ipcRegistrars` assembles 8 domains) | IPC registration (§6.3, list in [ipc-channels.md](ipc-channels.md)) |
| `ipc/*.ts`              | `registerSettingsIpc` / `registerModelsIpc` / `registerPresetsIpc` / `registerServerIpc` / `registerSystemIpc` / `registerWindowIpc` / `registerDownloadIpc` / `registerLogsIpc`; `watchModelsDir`/`notifyModelsChanged` from `models-watcher.ts` | Handlers per feature domain |
| `launcher-bridge.ts`    | `launcherBridge` (singleton Launcher shared across windows + 5000-entry output buffer + 16ms batch push + `disposeSync`) | Launch bridge (§6.4) |
| `app-exit.ts`           | `requestExit` / `minimizeToTray` / `handleWindowClose` / `handleCloseDialogResult` / `isQuitting` | Close-behaviour routing + the ask-once dialog (§6.6) |
| `app-log.ts`            | `logApp` / `getAppLogs` / `clearAppLogs` | Application log ring buffer (2000 entries) |
| `process-registry.ts`   | `ProcessRegistry` / `processRegistry` (`associate`/`cleanupWindow`/`cleanupAll`/`countFor`/`listAlivePids`) | Window↔process association + two-phase termination (§6.7) |
| `tray.ts`               | `createTray(win)` | System-tray keep-alive (§6.8) |
| `hf-transport.ts`       | `installHfTransport` | Injects the Electron `net` transport (§4.6) |
| `download-transport.ts` | `installDownloadTransport` | Injects the streaming download transport (§4.6) |

**`packages/ui/src` (Vue 3 frontend)**

| Directory | Main exports | Notes |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `stores/`      | `settings` / `i18n` / `params` (dual-track) / `server` / `download` / `appLog` | Pinia stores ([frontend.md](frontend.md) §7.2) |
| `composables/` | `useIPC` / `useTheme` / `useStartServer` / `useAutoPresetName` / `useModelPreset` / `useConfirm` / `useFilePicker` / `useUrlHistory` / `useVramEstimate` | IPC calls and logic wrappers |
| `features/`    | one `FeatureDef` per area — dashboard / models / service / params / logs / settings / webui — plus the `navItems`/`featureRoutes` aggregation | Feature registry (sidebar navigation + route assembly, §7.1) |
| `pages/`       | `DashboardPage` / `ModelsPage` / `ServicePage` / `ParamsPage` / `LogsPage` / `SettingsPage` / `WebUiPage` | 7 pages (§7.3) |
| `components/`  | common (`PageFrame`/`Card`/`Icon`/`ToolTip`/`StatusTag`/`DownloadCard`/`ModelMetaCard`/`ConfirmModal`/`CloseDialog`/`FileBrowserModal`…), layout (`Sidebar`/`TopBar`/`StatusBar`/`WebUiFrame`…), service (`ServiceStatusCard`/`CommandPreviewCard`/`ParamSummaryCard`/`TrashCleanCard`), models (`LocalModelsPanel`/`LibraryPanel`), presets (`PresetsPanel`), settings (4 panels), 6 param controls + `ParamRow` | Component library (§7.4) |

