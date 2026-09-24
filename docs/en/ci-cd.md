# CI/CD workflow

> Language: English · [中文](../zh/ci-cd.md)
> Scope: GitHub Actions pipeline: PR/push validation, automatic version increment on the main branch and release triggering.
> Index: [README.en.md](../../README.en.md) · Related: [auto-release.md](auto-release.md) · [packaging.md](packaging.md)

The repository uses two workflow files (.github/workflows/), which together make up the complete CI/CD pipeline:

| File | Trigger | Responsibility |
|------|------|------|
| [`ci.yml`](../../.github/workflows/ci.yml) | `push main` + `pull_request` | Validation + automatic bump on the main branch + triggering release |
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
  6. `pnpm lint` (turbo run lint + `verify-ipc-sync.cjs` + `verify-params-sync.cjs` + `verify-version-sync.cjs` + `check-docs-links.cjs` + `verify-i18n-usage.cjs` + `lint:ox` (oxlint) — seven checks, and the gate does not pass if any one of them is missing)
  7. `pnpm test`

Both pull_request and push events go through verify.

### 1.2 bump job (push to main only + not a bot + not a documentation-only change)

- **Dependencies**: needs: [verify, changes] (skipped when verify fails; skipped when the `changes` job classifies the push as documentation-only)
- **Guard condition**: `github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'github-actions[bot]' && needs.changes.outputs.non-doc == 'true'`
  - Only pushes to main are handled; the event fired after a PR is merged is picked up automatically
  - `github.actor != 'github-actions[bot]'` is the **second** layer of insurance: what actually breaks the loop is a GitHub mechanism — a push written with the repository's default `GITHUB_TOKEN` **does not trigger workflows again**, so the bot's bump commit never brings around another CI round by itself (measured: bump commit `712233a` of v0.0.34 does not exist in the CI run list at all; after its parent `e156388` the list simply has a gap). The actor guard only covers a future switch to a PAT, or someone pushing manually as the bot.
  - **Side effect (known and accepted)**: the bump commit that gets released **has no CI validation of its own** — it only changes version strings (`package.json` / `APP_VERSION` / the CHANGELOG heading / version references in the docs), so the risk surface is small; the real validation happened on its parent commit.
  - **`non-doc == 'true'` (added 2026-09-01)**: the `changes` job resolves the file list of the commits in this push and bumps only when at least one non-documentation file changed (anything other than `docs/**`, the root `README.md` and `AGENTS.md`) — **documentation-only updates neither increment the version nor trigger a Release**, which avoids cutting a release every single time
- **Steps**:
  1. `actions/checkout@v7` (fetch-depth: 0, persist-credentials: true)
  2. `actions/setup-node@v7` (**no `pnpm install`**: `bump-version.cjs` is a plain node script with no npm dependencies, so the install step was dropped starting 2026-09-09)
  3. `node scripts/bump-version.cjs patch` — the patch increment. The sync scope is defined in **two places** inside the script: the "sync scope" comment at the top of the file + the manifest array in step 5 `['docs/packaging.md','README.md','AGENTS.md','docs/architecture.md']`. Those two used to disagree (the comment claimed `docs/architecture.md` had been collected while the array had not been touched), which let the desktop row of the monorepo version table drift for three rounds in a row `0.0.12 → 0.0.34 → 0.0.40 → 0.0.41`; they are aligned now, and `verify-version-sync.cjs` holds the final invariant on the `pnpm lint` side. **The script itself is not inside the documentation paths**, so changing it still bumps and releases as usual.
  4. Configure git user.name / git user.email as github-actions[bot]
  5. Read the new version: `V=$(node -p "require('./package.json').version")`
  6. `git add -A` → `git commit -m "chore(release): vX"` → `git tag -a vX` → `git push origin HEAD:main` + `git push origin vX`
  7. `gh workflow run release.yml -f version="vX"` (triggers the release workflow through GH_TOKEN)

On every push to main the pipeline runs: verify all green → the `changes` job classifies the nature of the change — only a **non-documentation change** automatically increments the version, creates a tag and triggers the Windows packaging; a documentation-only change (only `docs/**` / root `README.md` / `AGENTS.md`) means **both bump and Release are skipped** (verify still runs, which is what guarantees documentation/link integrity).

### 1.3 changes job (documentation-only change detection)

- After `checkout` (fetch-depth: 0) it takes the baseline and runs `git diff --name-only <base> HEAD`, aggregating the real list of changed files (it does not rely on the webhook's `commits[].modified` fields — that field is unreliable in the Actions environment).
- **The baseline is taken per event type (fixed 2026-09-19)**: push → `github.event.before`; pull_request → `github.event.pull_request.base.sha`. **Historical defect**: the `pull_request` event has **no** `github.event.before`, so the old implementation interpolated it as an empty string and `git diff --name-only "" HEAD` failed with **exit 128** (reproduced locally), while `run` defaults to `bash -e` → on a PR the changes job was always red and `e2e` (`needs: changes`) got skipped along with it. Because this repository is driven mainly by pushes to main, the defect stayed latent for a long time (both PR runs in the repository predate the introduction of the changes job, so it never surfaced).
- **Conservative fallback**: empty baseline / all 0 (first push) / `git rev-parse --verify` cannot resolve it (shallow clone or rewritten history) → emit a `::warning::` and output `non-doc=true` (E2E runs, and the release decision runs as well), **better one extra run than a missed check**.
- If any file does not belong to `docs/*` / `README.md` / `AGENTS.md` → `non-doc=true`; if all of them are documentation → `non-doc=false` (skip bump and e2e).
- Event context is always injected into the script through `env:`; `${{ }}` is never interpolated directly inside `run:` (this blocks the script-injection pattern and makes it easy to extract the very same script body and run it locally).
- **Locally verifiable**: the decision logic of `changes` is plain shell, so it can be pulled out of the workflow with js-yaml and executed directly with different `EVENT_NAME/PUSH_BEFORE/PR_BASE` combinations — all 7 scenarios of this round (push non-doc / push documentation-only / no changes at all / PR with base / PR without base / all-0 baseline / unknown sha) passed in real runs.
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

**The primary mechanism is GitHub's token rule, not the actor check inside the workflow**: a push made with the repository's default `GITHUB_TOKEN` does not start a new `on: push` workflow run, so the version bump commit pushed by the `bump` job naturally never triggers another CI round. Measured evidence: the bump commit of v0.0.34, `712233a`, **does not exist** in the CI run history (the list jumps from its parent `e156388` straight to the older `13b5ee8`).

`github.actor != 'github-actions[bot]'` is kept as the **second** layer: should a PAT be used for pushing in the future, or should someone manually push a version commit as the bot, the token rule no longer applies and the guard still blocks the loop.

Two connected conclusions — do not trip over them when changing the pipeline: ① **the released bump commit has no CI validation of its own** (it only changes version strings, so the risk is acceptable, and the real validation lives on its parent commit); ② at the end, `bump` **explicitly dispatches** the Release with `gh workflow run release.yml` — `workflow_dispatch` is not affected by the push-suppression rule above, so the Release runs as usual (verified working on v0.0.34).

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

- **CI cancellation applies to PRs only**: previously a push to main also had `cancel-in-progress: true`, yet the `bump` job performs `commit → tag → push → gh workflow run release.yml` **inside the same run**; if a new push cancelled it during that window, the result could be a half-finished state of "tag already pushed, Release never triggered". Measured: `bump` takes only 7s and the whole pipeline about 1 minute, so the cost of serial queueing is negligible and pushes are not cancelled.
- **Release is grouped by version number and never cancelled**: two manual dispatches of the same version would fight over the same tag / Release, and cancelling mid-package leaves a half-built Release behind.

### 2.6 Timeout backstop and duration baseline

Every job carries `timeout-minutes` (filled in 2026-09-19): `changes` 5 / `verify` 15 / `e2e` 20 / `bump` 10 / `release.build` 45 (its build and dist steps have an additional 20m per-step safeguard). The motivation is a hang race condition already observed on the release side (on a Windows runner, the turbo daemon × the vite 8 rolldown stdout pipe — the artifacts are produced but the process never exits): without a job-level timeout, a single hang burns 6h of quota for nothing.

Measured duration baseline (run 35255644716, push main, 2026-09-17, total wall clock **1m11s**):

| job | Duration | Longest single step |
|-----|------|---------|
| verify | 56s | `pnpm build` 16s, `pnpm test` 15s |
| changes | 5s | — |
| e2e | 54s | **Playwright Chromium download 16s** (since changed to a cache hit), web e2e 13s, electron smoke 10s |
| bump | 7s | — |

Conclusion: `pnpm install` takes only 4~5s (the `cache: pnpm` of `setup-node` is already effective), so the artifact round trip for sharing build products between jobs is not worth it; the only genuinely savable cost is the browser download, which is why only it is cached.

---

## 3. Manual local triggering

Version increment and release can be completed locally without depending on GitHub Actions:

```bash
node scripts/bump-version.cjs patch   # or minor / major
```

**Note**: bumping manually and then `git push origin main` hits CI's bump job, which increments once more (the bump guard looks only at the change type `non-doc` and at whether the actor is the bot — it does not recognise "already bumped locally") — the local version number is skipped and neither tagged nor released, so the published version ends up being the result of CI's second bump. Optional approaches:

- **Locally only bump + create the tag + push the tag**, then trigger `release.yml` manually on GitHub (workflow_dispatch → enter the version number vX.Y.Z) — this avoids the second CI bump;
- or accept the semantics "bump locally then push straight to main = the published version is CI's +1", and treat the tag output by CI as authoritative.

Or rely entirely on the automated release: push non-documentation changes straight to main and let the bump job complete bump + tag + release.
