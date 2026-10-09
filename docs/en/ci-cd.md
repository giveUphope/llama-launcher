# CI/CD workflow

> Language: English · [中文](../zh/ci-cd.md)
> Scope: GitHub Actions pipeline: PR/push validation, release gate on the main branch (version increment runs locally).
> Index: [README.en.md](../../README.en.md) · Related: [auto-release.md](auto-release.md) · [packaging.md](packaging.md)

The repository uses two workflow files (.github/workflows/), which together make up the complete CI/CD pipeline:

| File | Trigger | Responsibility |
|------|------|------|
| [`ci.yml`](../../.github/workflows/ci.yml) | `push main` + `pull_request` | Validation + release gate (checks the locally incremented version, creates the tag and triggers release) |
| [`release.yml`](../../.github/workflows/release.yml) | `workflow_dispatch` (triggered by ci) | Windows runner packages the .exe + GitHub Release |

See [auto-release.md](auto-release.md).

---

## 1. Structure of ci.yml

### 1.1 verify job (runs on both PR and push)

- **Runner**: ubuntu-latest
- **Steps**:
  1. `actions/checkout@v7`
  2. `pnpm/action-setup@v5` (version: 11.21.0) — **must come before `setup-node`** (otherwise `cache: pnpm` cannot find pnpm)
  3. `actions/setup-node@v7` (node-version: 24, cache: pnpm)
  4. `pnpm install --frozen-lockfile`
  5. `pnpm build` — **must run before `pnpm lint`** (tsc project references depend on shared/dist / core/dist)
  6. `pnpm lint` (turbo run lint + `verify-ipc-sync.cjs` + `verify-params-sync.cjs` + `verify-version-sync.cjs` + `check-docs-links.cjs` + `verify-doc-pairs.cjs` + `verify-i18n-usage.cjs` + `lint:ox` (oxlint) — eight checks, and the gate does not pass if any one of them is missing)
  7. `pnpm test`

Both pull_request and push events go through verify.

### 1.2 release job (push to main only + not a bot + not a documentation-only change)

- **Dependencies**: needs: [verify, changes] (skipped when verify fails; skipped when the `changes` job classifies the push as documentation-only)
- **Guard condition**: `github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'github-actions[bot]' && needs.changes.outputs.non-doc == 'true'`
  - Only pushes to main are handled; the event fired after a PR is merged is picked up automatically
  - `github.actor != 'github-actions[bot]'`: CI itself no longer writes commits to main (see below); the guard stays as a second layer of insurance against accidental releases from a future bot / PAT push.
  - **`non-doc == 'true'`**: the `changes` job resolves the file list of the commits in this push and only a push with at least one non-documentation file changed (anything other than `docs/**`, the root `README.md` and `AGENTS.md`) goes to release — **documentation-only updates never release**, which avoids version noise.
- **The version increment runs locally (since 2026-10-08, which fixed the push divergence at its root)**: a non-documentation push must have run `node scripts/bump-version.cjs` locally first, with its results (version files + the CHANGELOG version section) committed as part of the push. The old system had CI run the bump remotely with `commit → tag → push` — the remote was always one commit ahead of local, so the next push was always rejected as non-fast-forward, and the local CHANGELOG `[Unreleased]` entries always conflicted with CI's section move (hit on 2026-10-06 and again on 10-08). CI now **writes nothing to main**, and the version declarations on both sides no longer drift.
- **Steps**:
  1. `actions/checkout@v7` (fetch-depth: 0 — all tags must be visible)
  2. `actions/setup-node@v7` (**no `pnpm install`**: the check logic is plain node / shell)
  3. Check: `V=$(node -p "require('./package.json').version")`; if `refs/tags/v$V` **already exists** ⇒ fail with a `::error::` red flag (= this push forgot the local bump; run the bump and ship it with the next push); if not ⇒ continue
  4. `git tag -a "v$V"` + `git push origin "v$V"` (pushes the tag only — **no commit, no push of main**)
  5. `gh workflow run release.yml -f version="v$V"` (triggers the release workflow through GH_TOKEN)

On every push to main the pipeline runs: verify all green → the `changes` job classifies the nature of the change — a **non-documentation change** must have its version incremented locally (the release job checks that and creates the tag, triggering the Windows packaging); a documentation-only change (only `docs/**` / root `README.md` / `AGENTS.md`) means the **Release is skipped** (verify still runs, which is what guarantees documentation/link integrity).

### 1.3 changes job (documentation-only change detection)

- **Mechanism (fixed 2026-10-09)**: after `checkout` (fetch-depth: 0), `dorny/paths-filter@v3` filters the changed files of `git diff <base> HEAD`. The filter is `code`: `**` excluding `docs/**`, root `README.md`, `README.en.md`, `AGENTS.md` — any non-doc file changed → `non-doc=true`; all-documentation changes → `non-doc=false` (release and e2e skipped).
- **The quantifier must be `predicate-quantifier: some-with-excludes` (fixed 2026-10-09, TODO R01)**: dorny's default `some` **ignores `!` exclusions** (any positive match wins), so the old `doc` filter — true when ANY documentation file matched — was treated as "documentation-only change": mixed pushes (code + AGENTS.md) were classified as docs-only and e2e plus release were **silently skipped** (evidence: run 37923177708, verify green yet release still skipped).
- **The baseline is taken per event type (fixed 2026-09-19)**: push → `github.event.before`; pull_request → `github.event.pull_request.base.sha`. **Historical defect**: the `pull_request` event has **no** `github.event.before`, so the old implementation interpolated it as an empty string and `git diff` failed with **exit 128** (reproduced locally) → on a PR the changes job was always red and `e2e` (`needs: changes`) got skipped along with it. Because this repository is driven mainly by pushes to main, the defect stayed latent for a long time.
- **Conservative fallback**: if the filter step fails or yields no output (unresolvable base, etc.) → `continue-on-error` plus a `::warning::`, and `non-doc=true` (E2E runs, and the release decision runs as well), **better one extra run than a missed check**.
- Purpose: documentation updates produce no version noise and trigger no Release; engineering/code changes such as `.github/`, `package.json`, `packages/`, `scripts/` still release as usual.

### 1.4 e2e job (runs on both PR and push, in parallel with verify; skipped for documentation-only changes)

- **Runner**: ubuntu-latest, `timeout-minutes: 20`
- **Trigger gate (added 2026-09-09)**: `needs: [changes]` + `if: needs.changes.outputs.non-doc == 'true'` — documentation-only changes (where `changes` reports `non-doc=false`) skip E2E, saving the Playwright install and the build. Note: there is no `paths-ignore` at job level (it is only supported at event level), so the output of the changes job is reused as the gate.
- **Steps**: install → `actions/cache@v6` caching `~/.cache/ms-playwright` (the key includes the `pnpm-lock.yaml` hash) → `pnpm exec playwright install --with-deps chromium` → `pnpm e2e:web` → `xvfb-run -a pnpm e2e:electron` → **`if: failure()` uploads the diagnostic artifacts**
  - The Chromium download measured as the longest single step of this job (**16s / 54s for the whole job**), hence the cache keyed on the lockfile version.
  - The failure artifact paths come from `playwright.config.ts`: `outputDir: test-results` + the HTML report `playwright-report` (both at the repository root), with `if-no-files-found: ignore`; before this, a failure left nothing to go on but guessing the scene from the `list` output.
- No separate `pnpm build` any more: the `e2e:web` / `e2e:electron` scripts each build what they need (ui/desktop), and turbo's local cache deduplicates.
- The web render-layer E2E runs against real build output (vite preview + demo-mock; the cases are described in the E2E chapter of [testing.md](testing.md)); the Electron smoke test starts the packaged artifact headless, which on Linux needs an xvfb virtual display. **The preview is owned by exactly one place, `e2e/run-web-e2e.mjs`** (`playwright.config.ts` has had its dead `webServer` configuration removed, see the "key points and pitfalls" section of testing.md) — CI and local runs use the same driver path.
- It does not participate in the needs chain of `bump` (release does not wait for e2e).

---

## 2. Key configuration points

### 2.1 Actions runtime versions

All actions have been upgraded to their node24 runtime versions to eliminate the deprecation warnings (the Node.js version change announcement for the GitHub runner images is in [actions/runner-images#14029](https://github.com/actions/runner-images/issues/14029): Node.js 20 reached EOL on 2026-04-30, was removed from the runner images during 2026-05-19~26, and the default version became Node.js 22):

| Action | Previous version | Current version |
|--------|-----------|---------|
| `actions/checkout` | @v4 (node20) | @v7 (node24) |
| `actions/setup-node` | @v4 (node20) | @v7 (node24), workflow node-version 20 → 24 |
| `pnpm/action-setup` | @v4 (node20) | @v5 (node24) — not @v6: v6 installs the wrong pnpm version when `version` is specified (pnpm/action-setup#225) |
| `softprops/action-gh-release` | @v2 (node20) | @v3 (node24) |
| `actions/cache` | not used | @v6 (introduced 2026-09-19, caches the Playwright browsers; the version was verified via `gh api repos/actions/cache/releases/latest`) |
| `actions/upload-artifact` | not used | @v7 (verified the same way; uploads the E2E scene only on `failure()`) |

The old `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out env has been removed (that env existed only to keep the Node 20 era alive temporarily and is no longer needed under Node 24).

### 2.2 pnpm/action-setup must come before setup-node

setup-node's `cache: pnpm` requires the pnpm command to already exist. Reversing the order fails with `pnpm not found`.

### 2.3 pnpm build must come before pnpm lint

tsc -b uses project references, and the desktop package's tsc --noEmit needs shared/dist and core/dist to have been built. In CI, pnpm build produces those artifacts and only then does pnpm lint run.

### 2.4 Preventing an infinite loop

**Mechanically eliminated since 2026-10-08**: CI no longer writes any commit to main (the version increment moved local; the release job only creates a tag), so the "CI's push triggers another CI round" chain no longer exists. Historically it was broken by two layers: GitHub's token rule (a push made with the repository's default `GITHUB_TOKEN` does not start a new `on: push` workflow run — the bump commit of v0.0.34, `712233a`, does not exist in the CI run history for exactly this reason) plus the actor guard.

`github.actor != 'github-actions[bot]'` remains in the release job's guard condition: should someone push a version commit as the bot or with a PAT in the future, the release would not be triggered accidentally.

One connected conclusion still holds: at the end, the release job **explicitly dispatches** the Release with `gh workflow run release.yml` — `workflow_dispatch` is not affected by the push-suppression rule, so the Release runs as usual (verified working on v0.0.34, still in use).

### 2.5 Concurrency control

```yaml
# ci.yml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}   # changed 2026-09-19
# release.yml
concurrency:
  group: release-v${{ inputs.version }}
  cancel-in-progress: false
```

- **CI cancellation applies to PRs only**: previously a push to main also had `cancel-in-progress: true`, yet the release job performs `tag → push tag → gh workflow run release.yml` **inside the same run** (before 2026-10-08 it also did `commit → push main`, removed when the bump moved local); if a new push cancelled it during that window, the result could be a half-finished state of "tag already pushed, Release never triggered". The release job is now a seconds-long operation and the whole pipeline about 1 minute, so the cost of serial queueing is negligible and pushes are not cancelled.
- **Release is grouped by version number and never cancelled**: two manual dispatches of the same version would fight over the same tag / Release, and cancelling mid-package leaves a half-built Release behind.

### 2.6 Timeout backstop and duration baseline

Every job carries `timeout-minutes` (filled in 2026-09-19): `changes` 5 / `verify` 15 / `e2e` 20 / `release` 5 / `release.build` 45 (its build and dist steps have an additional 20m per-step safeguard). The motivation is a hang race condition already observed on the release side (on a Windows runner, the turbo daemon × the vite 8 rolldown stdout pipe — the artifacts are produced but the process never exits): without a job-level timeout, a single hang burns 6h of quota for nothing.

Measured duration baseline (run 35255644716, push main, 2026-09-17, total wall clock **1m11s**):

| job | Duration | Longest single step |
|-----|------|---------|
| verify | 56s | `pnpm build` 16s, `pnpm test` 15s |
| changes | 5s | — |
| e2e | 54s | **Playwright Chromium download 16s** (since changed to a cache hit), web e2e 13s, electron smoke 10s |
| release (the former bump; tag-only and faster since 2026-10-08) | 7s | — |

Conclusion: `pnpm install` takes only 4~5s (the `cache: pnpm` of `setup-node` is already effective), so the artifact round trip for sharing build products between jobs is not worth it; the only genuinely savable cost is the browser download, which is why only it is cached.

---

## 3. Local bump and release (the only path since 2026-10-08)

For non-documentation changes, increment the version locally before pushing:

```bash
node scripts/bump-version.cjs patch   # or minor / major
```

Once the version files and the CHANGELOG version section are committed and pushed with the round, the CI release job checks "the package.json version has no tag yet" and, if so, creates the tag and triggers the release — **the local bump is the release path itself**. The old warning "a manual bump followed by a straight push to main would be incremented once more by CI" is gone together with the CI-side bump; if the local bump is forgotten, the release job turns red with an instructive error, and the supplementary bump ships with the next push.
