# CI/CD 工作流

> 语言：中文 · [English](../en/ci-cd.md)
> 范围：GitHub Actions 流水线：PR/push 验证、main 分支发版闸门（版本递增在本地执行）。
> 索引：[README.md](../../README.md) · 相关：[auto-release.md](auto-release.md) · [packaging.md](packaging.md)

仓库使用两个工作流文件（.github/workflows/），共同组成完整的 CI/CD 流水线：

| 文件 | 触发 | 职责 |
|------|------|------|
| [`ci.yml`](../../.github/workflows/ci.yml) | `push main` + `pull_request` | 验证 + 发版闸门（核对本地已递增的版本号，打 tag 并触发 release） |
| [`release.yml`](../../.github/workflows/release.yml) | `workflow_dispatch`（由 ci 触发） | Windows runner 打包 .exe + GitHub Release |

详见 [auto-release.md](auto-release.md)。

---

## 1. ci.yml 结构

### 1.1 verify job（PR + push 均执行）

- **Runner**：ubuntu-latest
- **步骤**：
  1. `actions/checkout@v7`
  2. `pnpm/action-setup@v5`（version: 11.21.0）— **必须在 `setup-node` 之前**（否则 `cache: pnpm` 时找不到 pnpm）
  3. `actions/setup-node@v7`（node-version: 24, cache: pnpm）
  4. `pnpm install --frozen-lockfile`
  5. `pnpm build` — **必须先于 `pnpm lint`**（tsc project references 依赖 shared/dist / core/dist）
  6. `pnpm lint`（turbo run lint + `verify-ipc-sync.cjs` + `verify-params-sync.cjs` + `verify-version-sync.cjs` + `check-docs-links.cjs` + `verify-doc-pairs.cjs` + `verify-i18n-usage.cjs` + `lint:ox`（oxlint）——八项缺一不进门禁）
  7. `pnpm test`

pull_request 和 push 事件都走 verify。

### 1.2 release job（仅 push main + 非 bot + 非纯文档变更）

- **依赖**：needs: [verify, changes]（verify 失败则跳过；changes 判定为纯文档变更时跳过）
- **守卫条件**：`github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'github-actions[bot]' && needs.changes.outputs.non-doc == 'true'`
  - 只处理 push 到 main 的事件，PR 合并后的触发自动命中
  - `github.actor != 'github-actions[bot]'`：CI 自身已不向 main 写提交（见下），该守卫保留作第二层保险，挡住「将来以 bot / PAT 身份推送」时的意外发版。
  - **`non-doc == 'true'`**：`changes` job 解析本次 push 各提交的文件清单，仅当存在非文档文件变更（`docs/**`、根 `README.md`、`README.en.md`、`AGENTS.md` 之外）时才走发版——**纯文档更新不发版**，避免版本噪音
- **版本递增在本地（2026-10-08 起，根治推送分叉）**：非文档推送前必须在本地跑 `node scripts/bump-version.cjs` 并把结果（版本文件 + CHANGELOG 版本段）随推送提交进来。旧系统由 CI 在远端跑 bump 并 `commit → tag → push`——远端永远比本地多一个提交，下次推送必然非快进被拒、且 CHANGELOG 的 `[Unreleased]` 条目与 CI 的段落搬移必然冲突（2026-10-06 与 10-08 两次撞上）。CI 从此**不向 main 写任何内容**，本地与远端的版本声明零漂移。
- **步骤**：
  1. `actions/checkout@v7`（fetch-depth: 0——要能看到全部 tag）
  2. `actions/setup-node@v7`（**不跑 `pnpm install`**：核对逻辑是纯 node / shell）
  3. 核对：`V=$(node -p "require('./package.json').version")`；若 `refs/tags/v$V` **已存在** ⇒ `::error::` 红牌退出（= 本次推送忘了本地 bump，补 bump 后随下一次推送发版）；不存在 ⇒ 继续
  4. `git tag -a "v$V"` + `git push origin "v$V"`（只推 tag，**不 commit 不推 main**）
  5. `gh workflow run release.yml -f version="v$V"`（通过 GH_TOKEN 触发发版工作流）

每次 push 到 main，流水线：verify 校验全绿 → `changes` job 判定变更性质 —— **非纯文档变更**要求本地已递增版本（release job 核对后打 tag、触发 Windows 打包）；纯文档变更（仅 `docs/**` / 根 `README.md` / `README.en.md` / `AGENTS.md`）则 **Release 跳过**（verify 照常执行，保证文档/链路完整性）。

### 1.3 changes job（纯文档变更判定）

- **机制（2026-10-09 修）**：`checkout`（fetch-depth: 0）后由 `dorny/paths-filter@v3` 对 `git diff <基线> HEAD` 的变更文件做过滤。过滤器为 `code`：`**` 排除 `docs/**`、根 `README.md`、`README.en.md`、`AGENTS.md`——存在任一非文档文件 → `non-doc=true`；全部为文档 → `non-doc=false`（跳过发版与 e2e）。
- **量化器必须是 `predicate-quantifier: some-with-excludes`（2026-10-09 修，TODO R01）**：dorny 默认 `some` 会**无视 `!` 排除**（任一正则命中即 true），旧写法 `doc` 过滤「任一文档文件命中即 true」被当成「纯文档变更」——「代码+AGENTS.md」的混合推送被判纯文档，e2e 与 release **静默跳过**（实证：run 37923177708 verify 绿、release 仍跳）。
- **基线按事件分取（2026-09-19 修）**：push → `github.event.before`；pull_request → `github.event.pull_request.base.sha`。**历史缺陷**：`pull_request` 事件**没有** `github.event.before`，旧实现展开成空串，`git diff` 以 **exit 128** 失败（本地实测复现），changes job 在 PR 上必红、`e2e`（`needs: changes`）连带被跳过。因该仓库以 push main 为主，此缺陷长期潜伏。
- **保守回退**：filter 步骤失败或无输出（基线解析不出等）→ `continue-on-error` + 打 `::warning::` 并输出 `non-doc=true`（照跑 E2E、照走发版判定），**宁可多跑不可漏检**。
- 用途：文档更新不产生版本噪音、不触发 Release；`.github/`、`package.json`、`packages/`、`scripts/` 等工程/代码变更仍照常发版。

### 1.4 e2e job（PR + push 均执行，与 verify 并行；纯文档变更跳过）

- **Runner**：ubuntu-latest，`timeout-minutes: 20`
- **触发门控（2026-09-09 新增）**：`needs: [changes]` + `if: needs.changes.outputs.non-doc == 'true'`——纯文档变更（changes 判定 `non-doc=false`）跳过 E2E，省去 Playwright 安装与构建。说明：job 级无 `paths-ignore`（事件级才支持），因此复用 changes job 的输出做门控。
- **步骤**：install → `actions/cache@v6` 缓存 `~/.cache/ms-playwright`（key 含 `pnpm-lock.yaml` 哈希）→ `pnpm exec playwright install --with-deps chromium` → `pnpm e2e:web` → `xvfb-run -a pnpm e2e:electron` → **`if: failure()` 上传诊断产物**
  - Chromium 下载实测是本 job 最长单步（**16s / 全 job 54s**），故按 lockfile 版本缓存。
  - 失败产物路径取自 `playwright.config.ts`：`outputDir: test-results` + HTML 报告 `playwright-report`（均在仓库根），`if-no-files-found: ignore`；此前失败只能靠 `list` 输出猜现场。
- 不再单独 `pnpm build`：`e2e:web` / `e2e:electron` 脚本内部各自构建（ui/desktop），turbo 本地缓存去重。
- Web 渲染层 E2E 走真实构建产物（vite preview + demo-mock，用例见 [testing.md](testing.md) 的 E2E 章节）；Electron 冒烟为 headless 启动打包产物，Linux 需 xvfb 虚拟显示。**preview 由 `e2e/run-web-e2e.mjs` 单点拥有**（`playwright.config.ts` 已移除死配置 `webServer`，详见 testing.md「要点与坑」）——CI 与本地跑的是同一条驱动路径。
- 不参与 `release` 的 needs 链（release 不等待 e2e）。

---

## 2. 关键配置要点

### 2.1 Actions 运行时版本

所有 actions 已升级到 node24 runtime 版本以消除弃用告警（GitHub runner 镜像的 Node.js 版本变更公告见 [actions/runner-images#14029](https://github.com/actions/runner-images/issues/14029)：Node.js 20 于 2026-04-30 EOL，2026-05-19~26 从 runner 镜像移除，默认版本改 Node.js 22）：

| Action | 之前的版本 | 当前版本 |
|--------|-----------|---------|
| `actions/checkout` | @v4（node20） | @v7（node24） |
| `actions/setup-node` | @v4（node20） | @v7（node24），工作流 node-version 20 → 24 |
| `pnpm/action-setup` | @v4（node20） | @v5（node24）— 不用 @v6：v6 存在指定 `version` 装错版本的问题（pnpm/action-setup#225） |
| `softprops/action-gh-release` | @v2（node20） | @v3（node24） |
| `actions/cache` | 未使用 | @v6（2026-09-19 引入，缓存 Playwright 浏览器；版本经 `gh api repos/actions/cache/releases/latest` 核对） |
| `actions/upload-artifact` | 未使用 | @v7（同上核对，仅 `failure()` 上传 E2E 现场） |

原 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out env 已移除（该 env 是为 Node 20 时代临时续命用的，Node 24 下不再需要）。

### 2.2 pnpm/action-setup 必须位于 setup-node 之前

setup-node 的 `cache: pnpm` 需要 pnpm 命令已存在。顺序颠倒会报 `pnpm not found`。

### 2.3 pnpm build 必须先于 pnpm lint

tsc -b 使用 project references，desktop 包的 tsc --noEmit 需要 shared/dist 和 core/dist 已构建。CI 中 pnpm build 生成这些产物后再跑 pnpm lint。

### 2.4 反无限循环

**2026-10-08 起机制性消除**：CI 不再向 main 写任何提交（版本递增收归本地，release job 只打 tag），「CI 的 push 又触发一轮 CI」这条链路不复存在。历史上靠的是 GitHub 的 token 规则（用仓库默认 `GITHUB_TOKEN` 做的 push 不会触发新的 `on: push` 工作流，v0.0.34 的 bump 提交 `712233a` 在 CI 运行历史里不存在即此故）+ actor 守卫双保险。

`github.actor != 'github-actions[bot]'` 仍保留在 release job 的守卫条件里：万一将来有人以 bot / PAT 身份推送版本提交，发版不会被意外触发。

连带结论里仍然成立的一条：release job 末尾用 `gh workflow run release.yml` **显式派发** Release——`workflow_dispatch` 不受 push 抑制规则影响，Release 照常跑（v0.0.34 实测成功，沿用至今）。

### 2.5 并发控制

```yaml
# ci.yml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}   # 2026-09-19 改
# release.yml
concurrency:
  group: release-v${{ inputs.version }}
  cancel-in-progress: false
```

- **CI 的取消只对 PR 生效**：原先 push main 也 `cancel-in-progress: true`，而发版 job 会在**同一个 run 内**连续 `tag → push tag → gh workflow run release.yml`（2026-10-08 前 还有 `commit → push main`，已随「bump 收归本地」移除），若这期间被新的 push 取消，可能留下「tag 已推、Release 未触发」的半程状态。发版 job 现仅剩秒级操作、整条流水线约 1 分钟，串行排队的代价可忽略，故 push 不取消。
- **Release 按版本号分组且永不取消**：同一版本的两次手动 dispatch 会争抢同一个 tag / Release；打包中途取消会留下半成品 Release。

### 2.6 超时兜底与耗时基线

每个 job 都带 `timeout-minutes`（2026-09-19 补齐）：`changes` 5 / `verify` 15 / `e2e` 20 / `release` 5 / `release.build` 45（其 build、dist 两步另有 20m 单步保险）。动机是 release 侧已实测过的挂死竞态（Windows runner 上 turbo daemon × vite 8 rolldown 的 stdout 管道——产物已生成但进程不退出）：没有 job 级超时时，一次挂死会白占 6h 额度。

实测耗时基线（run 35255644716，push main，2026-09-17，总墙钟 **1m11s**）：

| job | 耗时 | 最长单步 |
|-----|------|---------|
| verify | 56s | `pnpm build` 16s、`pnpm test` 15s |
| changes | 5s | — |
| e2e | 54s | **Playwright Chromium 下载 16s**（已改为缓存命中）、web e2e 13s、electron 冒烟 10s |
| release（旧 bump，2026-10-08 起仅打 tag 更快） | 7s | — |

结论：`pnpm install` 仅 4~5s（`setup-node` 的 `cache: pnpm` 已生效），跨 job 共享构建产物的 artifact 往返不划算；真正可省的是浏览器下载，故只对它上缓存。

---

## 3. 本地 bump 与发版（2026-10-08 起的唯一路径）

非文档变更的推送前，在本地完成版本递增：

```bash
node scripts/bump-version.cjs patch   # 或 minor / major
```

版本文件与 CHANGELOG 版本段随本轮提交推送后，CI 的 release job 核对「package.json 版本尚无对应 tag」即打 tag 并触发发版——**本地 bump 就是发版路径本身**。旧系统的警告「手动 bump 后直推 main 会被 CI 再递增一次」已随 bump 收归本地而消失；忘了本地 bump 时，release job 会红牌报错提示，补 bump 后随下一次推送发版。
