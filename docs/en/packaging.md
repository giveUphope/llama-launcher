# Packaging configuration (electron-builder.config.cjs)

> Language: English · [中文](../zh/packaging.md)
> Scope: electron-builder packaging configuration: hook mechanics, output-directory lock fallback, icon injection, common failures, version-consistency checklist.
> Index: [README.en.md](../../README.en.md) · Related: [workflow.md](workflow.md) · [core-modules.md](core-modules.md)

- **appId**: `com.llama-launcher.app`
- **productName**: `llama Launcher`
- **Output directory**: `../../release` (if you temporarily point it at `release-fixed` or another directory to work around a file lock, you must restore it and clean up afterwards)
- **asar**: enabled; only the app itself is packaged, the llama.cpp binary is not

### 11.1 beforePack / afterPack hooks

On Windows a pnpm workspace links `node_modules/@llama-launcher/{core,shared}` to `packages/{core,shared}` using **junctions (directory junctions)** by default. If electron-builder follows those junctions directly while packaging, it also drags development resources such as `src/`, `tests/`, `.turbo/` and `tsconfig` into the asar, so at runtime the app loads a **stale `shared/dist`**, which then surfaces as IPC registration errors like `Attempted to register a second handler for 'undefined'` and a window that never appears after startup.

In addition, when `shamefully-hoist=true` is used — or when a failed pack was never properly restored — `apps/desktop/node_modules/@llama-launcher/{core,shared}` may end up as **broken/circular symlinks** (`fs.existsSync` returns `false`, `realpath` throws `ELOOP`). beforePack has to detect and remove links of that kind too.

The fix lives in [`scripts/before-pack.cjs`](../../scripts/before-pack.cjs) and [`scripts/after-pack.cjs`](../../scripts/after-pack.cjs):

1. **Detect links and broken links**: `fs.lstat().isSymbolicLink()` returns `false` for junctions on Windows, so the script combines `fs.realpathSync(pkgPath)` (a different result means a valid link) with `fs.lstatSync` + `fs.existsSync` (a symlink is present but `existsSync` is false → a broken/circular link).
2. **Resolve the source**: if the package inside `apps/desktop/node_modules` is invalid, fall back to `node_modules/@llama-launcher/<pkg>` (root), then to `packages/<pkg>`, so that the freshest `dist/` and `package.json` are always picked up.
3. **Replace with a real dist-only directory**: delete the original link/directory, create a real directory, and put only `package.json` and `dist/*.js` inside (excluding `.map` / `.d.ts` / `.d.ts.map`). If the original path was already a real directory, its `dist/` is cleared and re-synced as well, so the latest build output is guaranteed.
4. **Record the mapping**: `.pack-link-map.json` stores whether each package was originally a link and the target path used to restore it.
5. **Restore in afterPack**: once packaging is done the mapping is read, the temporary real directories are deleted and the junctions (Windows) or symlinks (other platforms) are restored. If the original target is no longer valid, fall back to root `node_modules/@llama-launcher/<pkg>` so the pnpm development environment is not broken.

### 11.2 Pre-pack cleanup

[`scripts/clean-before-pack.cjs`](../../scripts/clean-before-pack.cjs) takes care of:

- Closing File Explorer windows that point at `release/` (detected via COM `Shell.Application` and closed with `Quit()`), so Explorer does not hold a handle on the directory by using it as its working directory.
- Attempting to delete the `release/` directory. When the directory is locked by the Defender/indexer file-system filter driver, programmatic retries cannot break through, so the script uses **2 retries × 3-second interval** (to avoid wasting the user's time) and, when `fs.rmSync` fails, works around the `mmap` handles with **rename + `cmd rd /s /q`**.
- **Last-resort fallback**: if deletion fails, it tries to rename `release/` to `release_stuck_<timestamp>` and creates a new empty directory. If the rename fails as well (locked by a system process), it does not raise an error; it logs at info level that a fallback path will be taken and leaves it to the temporary-directory mechanism of `dist-with-fallback.cjs`.
- Cleaning up leftover historical temporary output directories (`release2`, `release3`, `release-fixed`, `release-1.3.0-backup`) and the `release-tmp-*` directories produced by `dist-with-fallback.cjs`.

`pnpm dist` calls this script automatically before packing via [`scripts/dist-with-fallback.cjs`](../../scripts/dist-with-fallback.cjs), so no manual step is needed.

### 11.3 Output-directory lock fallback (dist-with-fallback.cjs)

Even after `clean-before-pack`, `release/` can still be locked by Defender, the IDE, File Explorer or a lingering handle at the moment electron-builder actually writes to it, which produces `The process cannot access the file because it is being used by another process`.

[`scripts/dist-with-fallback.cjs`](../../scripts/dist-with-fallback.cjs) wraps electron-builder and provides the automatic fallback:

1. **Pre-clean**: calls `clean-before-pack.cjs` to handle process termination, Explorer window closing and directory cleanup.
2. **Lock detection**: before starting electron-builder it probes whether the directory is locked by trying to **rename `release/`** (being able to write inside the directory does not mean the directory as a whole can be replaced — for instance, while `app.asar` is in use a probe sub-directory can still be created); after a successful rename it restores the original name, so the empty directory prepared by `clean-before-pack` is left intact. A failed rename means the directory as a whole is locked (usually by the Defender/indexer file-system filter driver), and `release-tmp-<timestamp>` is generated as the alternative output directory.
3. **Temporary config**: generates a temporary `electron-builder.tmp-<timestamp>.cjs` (**a JS config, not .yml** — since electron-builder 26 this project uses a JS configuration file, see `scripts/dist-with-fallback.cjs:71` and the header comments of that file), changing only `directories.output` and leaving every other setting untouched; the temporary config is deleted immediately after packaging.
4. **Artifact move-back**: after a successful pack it tries to move the artifacts from the temporary directory back into `release/`. A plain `fs.renameSync` fails when the target directory is locked, so on Windows it falls back separately per target type:
   - **Directories**: `robocopy /MIR` overwrites the files inside the target directory directly (no need to delete the directory first), bypassing the handles held by Defender/the indexer; the source directory is deleted once the overwrite succeeds.
5. **Final summary**: whether the primary directory or the fallback was used, a successful run prints the `BUILD SUCCEEDED` summary (including the output path and the portable exe path) and a failed run prints `BUILD FAILED`.

### 11.4 Icon injection and version information

`signAndEditExecutable: false` skips the signing/resource editing built into electron-builder, which avoids failures of the local app-builder toolchain unpacking symlinks. But it also means the main executable's **VS_VERSION_INFO version resource keeps the Electron defaults** (ProductName/FileDescription = Electron, OriginalFilename = electron.exe, version number = the Electron version), so the Task Manager "App name" column and the exe's file properties display Electron. `scripts/after-pack.cjs` fills this in during the afterPack stage:

1. **Version resource (resedit)**: uses `resedit` (pure JS, a root devDependency) to rewrite `VS_VERSION_INFO` — `FileVersion`/`ProductVersion` get the application version (taken from the packaged appInfo, i.e. the package.json version, kept in sync with `APP_VERSION`), and `FileDescription`/`ProductName`/`OriginalFilename` get the application name and the main executable name.
2. **Icon**: calls [`scripts/inject-icon.cjs`](../../scripts/inject-icon.cjs), which injects `apps/desktop/resources/icon.ico` into the main executable's `RT_ICON` resource by **overwriting in place at the same byte length**.

The order is fixed: first resedit rewrites the version resource (rebuilding the PE), then inject-icon overwrites the icon in place (byte-level parsing, which works just as well on the standard PE produced by resedit).

### 11.5 Common packaging failures

| Symptom | Root cause | Remedy |
|------|------|------|
| No window after startup, stderr shows `Attempted to register a second handler for 'undefined'` | The `shared/dist` inside the asar is too old and is missing the newly added IPC channels | Make sure beforePack replaces the junctions correctly and that `pnpm build` has regenerated `shared/dist` |
| `The process cannot access the file because it is being used by another process` | An old process or Defender occupies `release/` | `pnpm dist` calls `dist-with-fallback.cjs` automatically: it switches to `release-tmp-<timestamp>` when the directory is locked and tries to move the result back after packing; if it still fails, close whatever program is holding `release/` |
| `release/` cannot be deleted/renamed | External handles hold it (most often a running `llama Launcher*.exe`, or Defender/the indexer) | clean-before-pack terminates every `llama Launcher*.exe` process through PowerShell, closes Explorer windows pointing at release/, then tries to delete; if that fails it renames to `release_stuck_*` and creates a fresh `release/`; if the rename fails too, dist-with-fallback.cjs automatically switches to a `release-tmp-*` temporary directory and moves the result back after packing via robocopy/copyFile. This is expected behaviour and the pack still completes successfully. |
| `open ...\node_modules\@llama-launcher\core\package.json: The name of the file cannot be resolved by the system` | `apps/desktop/node_modules/@llama-launcher/{core,shared}` are broken/circular symlinks | Run `pnpm install` to rebuild the links; before-pack now detects and removes broken links automatically and falls back to root `node_modules` as the source |
| The root `package.json` was overwritten by the desktop package.json | The workspace root configuration is lost, so commands such as `pnpm lint` stop working | Distinguish it from the desktop package.json: the root must contain `scripts.dev/build/lint/test`, `packageManager` and `turbo` |

### 11.7 Version consistency (automated)

Version-number syncing is handled automatically by [`scripts/bump-version.cjs`](../../scripts/bump-version.cjs): `node scripts/bump-version.cjs [patch|minor|major]` updates `package.json` (root + desktop), `APP_VERSION` (`definitions.ts`), the version section of `docs/CHANGELOG.md`, and the output file names and version numbers mentioned in `docs/{zh,en}/packaging.md` (one copy per language tree), `docs/{zh,en}/architecture.md` (the monorepo version table), `README.md` (the Chinese landing page) and `README.en.md` (the English landing page), and `AGENTS.md`, all at once.

Every `push` to `main` (including PR merge events) is handled by the `bump` job of the GitHub Actions `ci.yml`, which performs the patch increment + creates the tag + triggers `release.yml` to package the `.exe` and create the GitHub Release (see [ci-cd.md](ci-cd.md) / [auto-release.md](auto-release.md)).

**Items that still need manual maintenance**:

- The individual change entries under `CHANGELOG.md [Unreleased]` (the script only generates the version heading)
- The baseline files and the parameter reference tables under `docs/params/` (after a binary upgrade, redo the §5.5 procedure)
- When bumping manually and locally, confirming that the version number respects SemVer semantics

**electron-builder output file name (corrected on 2026-09-20 against the real artifacts)**: this project's portable artifact is named **`llama.Launcher.<version>.exe`** and the version number is **kept in full** (measured: the Release assets of v0.0.46 are `llama.Launcher.0.0.46.exe`, see `gh release view v0.0.46`), matching the Release tag `v0.0.46` one to one. Should electron-builder ever really rename its output, take the `release/` directory listing and the Release asset list as the source of truth and update this paragraph plus the `files` globs accordingly.

An earlier version of this text claimed that "electron-builder strips SemVer trailing zeros (e.g. `x.y.34` → `x.y.5`) and that the file name does not correspond strictly to the tag" — that claim contradicts the measurements (`34 → 5` has no arithmetic basis either) and contradicts [auto-release.md](auto-release.md) §3 "the version number is kept in full"; it has been corrected to the actual artifact behaviour. <!-- bump-ignore: this paragraph is a historical counter-example ("trailing-zero stripping" was never real); its version numbers must stay fixed and must not take part in the per-line bump replacement (full-text replace rewrote it for three consecutive releases — see scripts/bump-version.cjs step 5) -->

### 11.6 Version consistency checklist

When raising the version, sync at least the following places:

- `version` in `apps/desktop/package.json`
- `version` in `package.json` (workspace root)
- `APP_VERSION` in `packages/shared/src/params/definitions.ts` (the source of the version shown in the sidebar)
- The output file names / versions mentioned in `packaging.md` (this section), `AGENTS.md`, `README.md`
- The new version section in `CHANGELOG.md`
