# CI/CD 工作流

> 范围：GitHub Actions 流水线：PR/push 验证、main 分支自动版本递增与发版触发。
> 索引：[README.md](../README.md) · 相关：[auto-release.md](auto-release.md) · [packaging.md](packaging.md)

仓库使用两个工作流文件（.github/workflows/），共同组成完整的 CI/CD 流水线：

| 文件 | 触发 | 职责 |
|------|------|------|
| [`ci.yml`](../.github/workflows/ci.yml) | `push main` + `pull_request` | 验证 + main 分支自动 bump + 触发 release |
| [`release.yml`](../.github/workflows/release.yml) | `workflow_dispatch`（由 ci 触发） | Windows runner 打包 .exe + GitHub Release |

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
  6. `pnpm lint`（turbo run lint + `verify-ipc-sync.cjs` + `verify-params-sync.cjs` + `verify-version-sync.cjs` + `check-docs-links.cjs` + `verify-i18n-usage.cjs` + `lint:ox`（oxlint）——七项缺一不进门禁）
  7. `pnpm test`

pull_request 和 push 事件都走 verify。

### 1.2 bump job（仅 push main + 非 bot + 非纯文档变更）

- **依赖**：needs: [verify, changes]（verify 失败则跳过；changes 判定为纯文档变更时跳过）
- **守卫条件**：`github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'github-actions[bot]' && needs.changes.outputs.non-doc == 'true'`
  - 只处理 push 到 main 的事件，PR 合并后的触发自动命中
  - `github.actor != 'github-actions[bot]'` 是**第二层**保险：真正阻止循环的是 GitHub 的机制——用仓库默认 `GITHUB_TOKEN` 写入的 push **不会再触发工作流**，所以 bot 的 bump 提交本就不会带来新一轮 CI（实测 v0.0.34 的 bump 提交 `712233a` 在 CI 运行列表里不存在，其父 `e156388` 之后直接空档）。actor 守卫只是防住「将来改用 PAT / 手动以 bot 身份推送」时的回环。
  - **副作用（已知并接受）**：被发布的那个 bump 提交**没有独立 CI 校验**——它只改版本字符串（`package.json` / `APP_VERSION` / CHANGELOG 头 / 文档版本引用），风险面小；真正的校验发生在其父提交上。
  - **`non-doc == 'true'`（2026-09-01 新增）**：`changes` job 解析本次 push 各提交的文件清单，仅当存在非文档文件变更（`docs/**`、根 `README.md`、`AGENTS.md` 之外）时才 bump——**纯文档更新不递增版本、不触发 Release**，避免每次都发版
- **步骤**：
  1. `actions/checkout@v7`（fetch-depth: 0, persist-credentials: true）
  2. `actions/setup-node@v7`（**不跑 `pnpm install`**：`bump-version.cjs` 是纯 node 脚本、无 npm 依赖，2026-09-09 起免装）
  3. `node scripts/bump-version.cjs patch` — patch 递增。同步范围由脚本内**两处**定义：文件头「同步范围」注释 + 第 5 步的清单数组 `['docs/packaging.md','README.md','AGENTS.md','docs/architecture.md']`。二者曾经不一致（注释声称已收 `docs/architecture.md`、数组没动），导致 monorepo 版本表的 desktop 行连漂三轮 `0.0.12 → 0.0.34 → 0.0.40 → 0.0.41`；现已对齐，并由 `verify-version-sync.cjs` 在 `pnpm lint` 侧守住最终不变量。**该脚本自身不在文档路径内**，改它照常 bump 发版。
  4. 配置 git user.name / git user.email 为 github-actions[bot]
  5. 读取新版本：`V=$(node -p "require('./package.json').version")`
  6. `git add -A` → `git commit -m "chore(release): vX"` → `git tag -a vX` → `git push origin HEAD:main` + `git push origin vX`
  7. `gh workflow run release.yml -f version="vX"`（通过 GH_TOKEN 触发发版工作流）

每次 push 到 main，流水线：verify 校验全绿 → `changes` job 判定变更性质 —— **非纯文档变更**才自动递增版本、打 tag、触发 Windows 打包；纯文档变更（仅 `docs/**` / 根 `README.md` / `AGENTS.md`）则 **bump 与 Release 均跳过**（verify 照常执行，保证文档/链路完整性）。

### 1.3 changes job（纯文档变更判定）

- `checkout`（fetch-depth: 0）后取基线执行 `git diff --name-only <base> HEAD`，汇总本次变更的真实文件清单（不依赖 webhook `commits[].modified` 字段——Actions 环境中该字段不可靠）。
- **基线按事件分取（2026-09-19 修）**：push → `github.event.before`；pull_request → `github.event.pull_request.base.sha`。**历史缺陷**：`pull_request` 事件**没有** `github.event.before`，旧实现展开成空串，`git diff --name-only "" HEAD` 以 **exit 128** 失败（本地实测复现），而 `run` 默认 `bash -e` → changes job 在 PR 上必红、`e2e`（`needs: changes`）连带被跳过。因该仓库以 push main 为主，此缺陷长期潜伏（仓库内两次 PR 运行都早于 changes job 引入，未暴露）。
- **保守回退**：基线为空 / 全 0（首次 push）/ `git rev-parse --verify` 解析不出（浅克隆或历史被改写）→ 打 `::warning::` 并输出 `non-doc=true`（照跑 E2E、照走发版判定），**宁可多跑不可漏检**。
- 任一文件不属于 `docs/*` / `README.md` / `AGENTS.md` → `non-doc=true`；全部为文档 → `non-doc=false`（跳过 bump 与 e2e）。
- 事件上下文一律经 `env:` 注入脚本，不在 `run:` 里直接内插 `${{ }}`（防脚本注入姿势，也便于本地把同一段脚本抽出来跑）。
- **本地可验证**：`changes` 的判定逻辑是纯 shell，可用 js-yaml 从工作流里取出 `run` 体、以不同 `EVENT_NAME/PUSH_BEFORE/PR_BASE` 组合直接执行——本轮 7 个场景（push 非文档 / push 纯文档 / 无改动 / PR 有 base / PR 无 base / 全 0 基线 / 未知 sha）全部实测通过。
- 用途：文档更新不产生版本噪音、不触发 Release；`.github/`、`package.json`、`packages/`、`scripts/` 等工程/代码变更仍照常发版。

### 1.4 e2e job（PR + push 均执行，与 verify 并行；纯文档变更跳过）

- **Runner**：ubuntu-latest，`timeout-minutes: 20`
- **触发门控（2026-09-09 新增）**：`needs: [changes]` + `if: needs.changes.outputs.non-doc == 'true'`——纯文档变更（changes 判定 `non-doc=false`）跳过 E2E，省去 Playwright 安装与构建。说明：job 级无 `paths-ignore`（事件级才支持），因此复用 changes job 的输出做门控。
- **步骤**：install → `actions/cache@v6` 缓存 `~/.cache/ms-playwright`（key 含 `pnpm-lock.yaml` 哈希）→ `pnpm exec playwright install --with-deps chromium` → `pnpm e2e:web` → `xvfb-run -a pnpm e2e:electron` → **`if: failure()` 上传诊断产物**
  - Chromium 下载实测是本 job 最长单步（**16s / 全 job 54s**），故按 lockfile 版本缓存。
  - 失败产物路径取自 `playwright.config.ts`：`outputDir: test-results` + HTML 报告 `playwright-report`（均在仓库根），`if-no-files-found: ignore`；此前失败只能靠 `list` 输出猜现场。
- 不再单独 `pnpm build`：`e2e:web` / `e2e:electron` 脚本内部各自构建（ui/desktop），turbo 本地缓存去重。
- Web 渲染层 E2E 走真实构建产物（vite preview + demo-mock，用例见 [testing.md](testing.md) 的 E2E 章节）；Electron 冒烟为 headless 启动打包产物，Linux 需 xvfb 虚拟显示。**preview 由 `e2e/run-web-e2e.mjs` 单点拥有**（`playwright.config.ts` 已移除死配置 `webServer`，详见 testing.md「要点与坑」）——CI 与本地跑的是同一条驱动路径。
- 不参与 `bump` 的 needs 链（release 不等待 e2e）。

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

**主机制是 GitHub 的 token 规则，不是工作流里的 actor 判断**：用仓库默认 `GITHUB_TOKEN` 做的 push 不会触发新的 `on: push` 工作流运行，因此 `bump` job 推入的版本 bump 提交天然不会再跑一轮 CI。实测证据：v0.0.34 的 bump 提交 `712233a` 在 CI 运行历史里**不存在**（列表从其父 `e156388` 直接跳到更早的 `13b5ee8`）。

`github.actor != 'github-actions[bot]'` 作为**第二层**保留：万一将来改用 PAT 推送、或有人以 bot 身份手动推版本提交，token 规则不再适用，守卫仍能挡住回环。

两点连带结论，改流水线时别踩：① **被发布的 bump 提交没有独立 CI 校验**（只改版本串，风险可接受，真校验在其父提交上）；② `bump` 末尾用 `gh workflow run release.yml` **显式派发** Release——`workflow_dispatch` 不受上述 push 抑制规则影响，所以 Release 照常跑（v0.0.34 实测成功）。

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

- **CI 的取消只对 PR 生效**：原先 push main 也 `cancel-in-progress: true`，而 `bump` job 会在**同一个 run 内**连续 `commit → tag → push → gh workflow run release.yml`，若这期间被新的 push 取消，可能留下「tag 已推、Release 未触发」的半程状态。实测 `bump` 仅 7s、整条流水线约 1 分钟，串行排队的代价可忽略，故 push 不取消。
- **Release 按版本号分组且永不取消**：同一版本的两次手动 dispatch 会争抢同一个 tag / Release；打包中途取消会留下半成品 Release。

### 2.6 超时兜底与耗时基线

每个 job 都带 `timeout-minutes`（2026-09-19 补齐）：`changes` 5 / `verify` 15 / `e2e` 20 / `bump` 10 / `release.build` 45（其 build、dist 两步另有 20m 单步保险）。动机是 release 侧已实测过的挂死竞态（Windows runner 上 turbo daemon × vite 8 rolldown 的 stdout 管道——产物已生成但进程不退出）：没有 job 级超时时，一次挂死会白占 6h 额度。

实测耗时基线（run 35255644716，push main，2026-09-17，总墙钟 **1m11s**）：

| job | 耗时 | 最长单步 |
|-----|------|---------|
| verify | 56s | `pnpm build` 16s、`pnpm test` 15s |
| changes | 5s | — |
| e2e | 54s | **Playwright Chromium 下载 16s**（已改为缓存命中）、web e2e 13s、electron 冒烟 10s |
| bump | 7s | — |

结论：`pnpm install` 仅 4~5s（`setup-node` 的 `cache: pnpm` 已生效），跨 job 共享构建产物的 artifact 往返不划算；真正可省的是浏览器下载，故只对它上缓存。

---

## 3. 本地手动触发

无需依赖 GitHub Actions 也可以本地完成版本递增与发版：

```bash
node scripts/bump-version.cjs patch   # 或 minor / major
```

**注意**：手动 bump 后再 `git push origin main` 会命中 CI 的 bump job 再递增一次（bump 守卫只看变更性质 `non-doc` 与 actor 是否 bot，不识别「本地已 bump」）——本地版本号会被跳过且不打 tag/发版，最终发布版本为 CI 二次 bump 的结果。可选做法：

- **本地只 bump + 打 tag + 推送 tag**，随后在 GitHub 手动触发 `release.yml`（workflow_dispatch → 输入版本号 vX.Y.Z）——避免 CI 二次 bump；
- 或接受「本地 bump 后直推 main = 发布版本为 CI 再 +1」的语义，以 CI 输出的 tag 为准。

或完全依赖自动发版：直推非文档变更到 main，由 bump job 自动完成 bump + tag + release。
