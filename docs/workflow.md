# 开发工作流

> 范围：开发工作流：构建、类型检查、测试、打包、文档维护。
> 索引：[README.md](../README.md) · 相关：[architecture.md](architecture.md) · [packaging.md](packaging.md)

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发模式（turbo 编排） |
| `pnpm build` | 构建所有包 |
| `pnpm test` | 运行测试 |
| `pnpm lint` | 类型检查 + IPC 同步校验（`verify-ipc-sync.cjs`）+ 文档链接检查（`check-docs-links.cjs`，可单独 `pnpm docs:check`） |
| `pnpm dist` | 打包 Windows 安装程序（根目录一条命令，委托 `@llama-launcher/desktop dist`；electron-builder，自动处理输出目录锁定回退） |

开发模式热重载（`apps/desktop` 的 `dev:vite` 三进程编排）：Vite dev server（UI HMR）+ `tsc -b --watch`（shared/core/desktop 增量重建）+ `scripts/dev-watch.cjs`（监视主进程 dist / preload 源 / shared 类型，变更时自动重新生成 preload 并重启 Electron，通过 `LLAMA_DEV_SKIP_QUIT_KILL=1` 避免热重启连带杀掉 dev 会话树）。改 UI 组件/样式即时热更；改 core/shared/主进程/preload 代码自动重建并重启，无需手动操作。

---

## 依赖维护（迭代评估入口）

定期用以下命令评估依赖新鲜度（本仓库走 npmmirror 镜像）：

```bash
pnpm outdated -r                 # 哪些依赖可更新（-r 覆盖全部 5 个 workspace 包）
pnpm install --frozen-lockfile   # 校验 lockfile 与 package.json 同步（CI 里默认强制此模式）
```

**升级流程**：改 `package.json` 版本声明 → `pnpm install --no-frozen-lockfile`（刷新 lockfile）→ `pnpm lint` + `pnpm test` + `pnpm build` 全绿 → 再 `pnpm install --frozen-lockfile` 复验 → 更新 `docs/CHANGELOG.md [Unreleased]`。

**当前边界（2026-09-01）**：TypeScript 钉在 `^6.0.3`——TS 7.0（Go 原生）无稳定程序化 API（7.1 提供）且 `vue-tsc` 最新版仍崩溃（`./lib/tsc` 不再导出，上游修复 vuejs/language-tools#6123 未发布）。升级到 `^7` 的触发条件：① npm 发布包含 #6123 的 `vue-tsc`，或 ② TypeScript 7.1 稳定 API 落地且 vue-tsc 适配；届时一并清理 `--no-daemon`（turbo 3.0 已弃用该 flag）。
