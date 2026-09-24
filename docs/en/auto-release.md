# Automated release workflow

> Language: English · [中文](../zh/auto-release.md)
> Scope: Remote packaging of the .exe on a Windows runner + automatic creation of the GitHub Release.
> Index: [README.md](../../README.md) · Related: [ci-cd.md](ci-cd.md) · [packaging.md](packaging.md)

release.yml is triggered by the bump job of ci.yml through `gh workflow run release.yml -f version="vX"`, and it can also be dispatched manually on GitHub via workflow_dispatch by entering the version number.

---

## 1. Trigger modes

- **Automatic trigger**: push main → ci.yml verify passes → the bump job increments the version automatically and runs `gh workflow run release.yml -f version="vX"`
- **Manual trigger**: GitHub → Actions → release → Run workflow → enter the version number (e.g. v0.0.19)

---

## 2. Workflow steps

- **Runner**: windows-latest (mandatory for Windows packaging; linux cannot produce a .exe)
- **Concurrency**: `group: release-v${{ inputs.version }}` + `cancel-in-progress: false` (no parallel runs for the same version, and a run in progress is never cancelled); **job-level `timeout-minutes: 45`** as the backstop
- **Steps**:

| # | Step | Description |
|---|------|------|
| 1 | actions/checkout@v7 (ref: vX) | Checks out the tag of the corresponding version |
| 2 | pnpm/action-setup@v5 + actions/setup-node@v7 | Environment preparation (Node 24, pnpm 11.21.0) |
| 3 | pnpm install --frozen-lockfile | Installs the dependencies |
| 4 | Verify that the tag version matches package.json | Gate added 2026-09-19: compares `inputs.version` against the `version` in `package.json` and against `APP_VERSION` in `definitions.ts` (extracted with sed, since dist is not built at this point); any mismatch fails with `::error::` — otherwise we would publish an artifact where "the Release title says vA while the exe actually reports vB" (see [packaging.md](packaging.md) §11.7) |
| 5 | pnpm build | Builds all packages |
| 6 | pnpm dist | electron-builder portable packaging, output to release/ |
| 7 | Get-ChildItem -Recurse release/ | Diagnostic step, prints the list of artifacts |
| 8 | Read the version from package.json | `V=$(node -p "...")` |
| 9 | softprops/action-gh-release@v3 | Creates the GitHub Release + uploads the .exe |

> On a Windows runner there is a hang race condition between the turbo daemon and the vite 8 (rolldown) stdout pipe (the build artifacts are produced but the process never exits), so both `pnpm build` and `pnpm dist` set `TURBO_DAEMON: "false"` and add a 20-minute timeout backstop, failing fast on a hang instead of burning time.

---

## 3. Packaging output

pnpm dist calls electron-builder through [scripts/dist-with-fallback.cjs](../../scripts/dist-with-fallback.cjs), which handles file locks on the release/ directory automatically (falling back to a release-tmp-* temporary directory when Defender / the indexer / Explorer occupy it, then moving the artifacts back). See [packaging.md](packaging.md).

The electron-builder artifact file name = `llama.Launcher.{version}.exe` (the space in the productName "llama Launcher" becomes a dot in the file name; **the version number is kept in full, with no trailing-zero stripping** — evidence: the artifacts of the remote v0.0.8/v0.0.9/v0.0.10 were named `llama.Launcher.0.0.8.exe` / `0.0.9.exe` / `0.0.10.exe` respectively).

The Release tag keeps the full version number (e.g. v0.0.19, not zero-padded) and matches the artifact file name (both retain the complete version number).

---

## 4. Release asset upload

The files field of softprops/action-gh-release@v3 uses the glob `release/*.exe`, not an exact path such as `release/llama.Launcher.0.0.19.exe`.

Reason: the artifact file name = `llama.Launcher.{version}.exe` (the version number rises with every bump, so an exact path would mean editing the workflow each time), whereas the glob needs no maintenance and stays compatible with future versions.

**Correct configuration**:

```yaml
- uses: softprops/action-gh-release@v3
  with:
    tag_name: v${{ steps.ver.outputs.v }}
    generate_release_notes: true
    files: release/*.exe
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

---

## 5. Feasibility summary for remote packaging

| Stage | Local | Remote (GitHub Actions) |
|------|------|----------------------|
| pnpm install | ✅ | ✅ |
| pnpm build | ✅ | ✅ |
| pnpm dist (.exe) | ✅ | ✅ (requires a windows-latest runner) |
| GitHub Release | ❌ | ✅ |
| Signing (signAndEditExecutable: false) | skipped | skipped (no signing needed) |

Windows .exe packaging can be completed entirely on a remote windows-latest runner; no local Windows machine is required.
