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
  6. `pnpm lint`（turbo run lint + verify-ipc-sync.cjs + check-docs-links.cjs）
  7. `pnpm test`

pull_request 和 push 事件都走 verify。

### 1.2 bump job（仅 push main + 非 bot + 非纯文档变更）

- **依赖**：needs: [verify, changes]（verify 失败则跳过；changes 判定为纯文档变更时跳过）
- **守卫条件**：`github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'github-actions[bot]' && needs.changes.outputs.non-doc == 'true'`
  - 只处理 push 到 main 的事件，PR 合并后的触发自动命中
  - `github.actor != 'github-actions[bot]'` **防止无限循环**：bot 自己推入的版本 bump 提交不再触发第二次 bump
  - **`non-doc == 'true'`（2026-09-01 新增）**：`changes` job 解析本次 push 各提交的文件清单，仅当存在非文档文件变更（`docs/**`、根 `README.md`、`AGENTS.md` 之外）时才 bump——**纯文档更新不递增版本、不触发 Release**，避免每次都发版
- **步骤**：
  1. `actions/checkout@v7`（fetch-depth: 0, persist-credentials: true）
  2. `pnpm/action-setup@v5` + `actions/setup-node@v7` + `pnpm install --frozen-lockfile`
  3. `node scripts/bump-version.cjs patch` — patch 递增
  4. 配置 git user.name / git user.email 为 github-actions[bot]
  5. 读取新版本：`V=$(node -p "require('./package.json').version")`
  6. `git add -A` → `git commit -m "chore(release): vX"` → `git tag -a vX` → `git push origin HEAD:main` + `git push origin vX`
  7. `gh workflow run release.yml -f version="vX"`（通过 GH_TOKEN 触发发版工作流）

每次 push 到 main，流水线：verify 校验全绿 → `changes` job 判定变更性质 —— **非纯文档变更**才自动递增版本、打 tag、触发 Windows 打包；纯文档变更（仅 `docs/**` / 根 `README.md` / `AGENTS.md`）则 **bump 与 Release 均跳过**（verify 照常执行，保证文档/链路完整性）。

### 1.3 changes job（纯文档变更判定）

- `checkout`（fetch-depth: 0）后以 `github.event.before` 为基线执行 `git diff --name-only <before> HEAD`，汇总本次 push 的真实文件清单（不依赖 webhook `commits[].modified` 字段——Actions 环境中该字段不可靠）。
- 任一文件不属于 `docs/*` / `README.md` / `AGENTS.md` → 输出 `non-doc=true`（允许 bump）；全部文件均为文档 → `non-doc=false`（跳过 bump）。
- 用途：文档更新不产生版本噪音、不触发 Release；`.github/`、`package.json`、`packages/`、`scripts/` 等工程/代码变更仍照常发版。

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

原 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out env 已移除（该 env 是为 Node 20 时代临时续命用的，Node 24 下不再需要）。

### 2.2 pnpm/action-setup 必须位于 setup-node 之前

setup-node 的 `cache: pnpm` 需要 pnpm 命令已存在。顺序颠倒会报 `pnpm not found`。

### 2.3 pnpm build 必须先于 pnpm lint

tsc -b 使用 project references，desktop 包的 tsc --noEmit 需要 shared/dist 和 core/dist 已构建。CI 中 pnpm build 生成这些产物后再跑 pnpm lint。

### 2.4 反无限循环

bump job 通过 `github.actor != 'github-actions[bot]'` 跳过 bot 自己的提交。否则 bot 推入版本 bump 后，push 事件会再次触发 bump，形成无限循环。

### 2.5 并发控制

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

同一 ref 的重复推送只保留最新的一次运行，避免积压。

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
