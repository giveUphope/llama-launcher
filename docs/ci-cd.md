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
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4`（version: 10.12.1）— **必须在 `setup-node` 之前**（否则 `cache: pnpm` 时找不到 pnpm）
  3. `actions/setup-node@v4`（node-version: 20, cache: pnpm）
  4. `pnpm install --frozen-lockfile`
  5. `pnpm build` — **必须先于 `pnpm lint``**（tsc project references 依赖 shared/dist / core/dist）
  6. `pnpm lint`（turbo run lint + verify-ipc-sync.cjs + check-docs-links.cjs）
  7. `pnpm test`

pull_request 和 push 事件都走 verify。

### 1.2 bump job（仅 push main + 非 bot）

- **依赖**：needs: verify（验证失败则跳过）
- **守卫条件**：github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'github-actions[bot]'
  - 只处理 push 到 main 的事件，PR 合并后的触发自动命中
  - `github.actor != 'github-actions[bot]'` **防止无限循环**：bot 自己推入的版本 bump 提交不再触发第二次 bump
- **步骤**：
  1. `actions/checkout@v4`（fetch-depth: 0, persist-credentials: true）
  2. `pnpm/action-setup@v4` + `actions/setup-node@v4` + `pnpm install --frozen-lockfile`
  3. `node scripts/bump-version.cjs patch` — patch 递增
  4. 配置 git user.name / git user.email 为 github-actions[bot]
  5. 读取新版本：`V=$(node -p "require('./package.json').version")`
  6. `git add -A` → `git commit -m "chore(release): vX"` → `git tag -a vX` → `git push origin HEAD:main` + `git push origin vX`
  7. `gh workflow run release.yml -f version="vX"`（通过 GH_TOKEN 触发发版工作流）

每次 push 到 main（含手动 git push、PR merge 事件），流水线自动递增版本、打 tag、触发 Windows 打包。

---

## 2. 关键配置要点

### 2.1 Node 20 deprecation

GitHub Actions runner 默认 Node 24，但项目要求 Node 20。必须在 `setup-node` 的 env 中添加：

```yaml
env:
  ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION: "true"
```

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
git push origin main                   # 触发 CI → bump → release
```

或在 github.com 上手动触发 `release.yml`（workflow_dispatch → 输入版本号 vX.Y.Z）。
