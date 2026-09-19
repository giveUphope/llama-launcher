# 开发工作流

> 范围：开发工作流：构建、类型检查、测试、打包、文档维护。
> 索引：[README.md](../README.md) · 相关：[architecture.md](architecture.md) · [packaging.md](packaging.md)

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发模式（`scripts/dev.cjs` 三进程编排，不经 turbo） |
| `pnpm build` | 构建所有包 |
| `pnpm test` | 运行测试 |
| `pnpm lint` | 类型检查 + IPC 同步校验（`verify-ipc-sync.cjs`）+ 文档链接检查（`check-docs-links.cjs`，可单独 `pnpm docs:check`） |
| `pnpm dist` | 打包 Portable 单文件（根目录一条命令，委托 `@llama-launcher/desktop dist`；electron-builder，输出 `release/*.exe`，自动处理输出目录锁定回退） |

开发模式热重载由 `scripts/dev.cjs` 编排三进程：Vite dev server（UI HMR）+ `tsc -b --watch`（shared/core/desktop 增量重建）+ `scripts/dev-watch.cjs`（监视主进程 dist / preload 源 / shared 类型，变更时自动重新生成 preload 并重启 Electron，通过 `LLAMA_DEV_SKIP_QUIT_KILL=1` 避免热重启连带杀掉 dev 会话树）。改 UI 组件/样式即时热更；改 core/shared/主进程/preload 代码自动重建并重启，无需手动操作。退出语义：任一任务先退出即以它的退出码结束整个会话，其余任务按进程树 `taskkill /T /F` 清理（用户关窗 → dev-watch 退 0 → vite/tsc 一并收走，端口不残留）。

**为什么不用 turbo / concurrently / 子命令里嵌 `pnpm`**：Windows 下这些都会经 `node_modules/.bin` 的 `.cmd` 批处理 shim，而 cmd.exe 在批处理等待子进程时收到 Ctrl+C 会打印 `Terminate batch job (Y/N)?` 并阻塞等待按键——旧链路叠了 4 层批处理，于是一次 Ctrl+C 退不出去（需要按两次，且 turbo 要等满优雅超时才 `Force killed Turborepo tasks`）。`dev.cjs` 三个任务全部由 node 直接执行依赖 `package.json` 里 `bin` 指向的真实 JS 入口，零批处理层，一次 Ctrl+C 即退出；新增 dev 任务须沿用同一写法。

---

## 依赖维护（迭代评估入口）

定期用以下命令评估依赖新鲜度（本仓库走 npmmirror 镜像）：

```bash
pnpm outdated -r                 # 哪些依赖可更新（-r 覆盖全部 5 个 workspace 包）
pnpm install --frozen-lockfile   # 校验 lockfile 与 package.json 同步（CI 里默认强制此模式）
```

**升级流程**：改 `package.json` 版本声明 → `pnpm install --no-frozen-lockfile`（刷新 lockfile）→ `pnpm lint` + `pnpm test` + `pnpm build` 全绿 → 再 `pnpm install --frozen-lockfile` 复验 → 更新 `docs/CHANGELOG.md [Unreleased]`。

**当前边界（2026-09-01）**：TypeScript 钉在 `^6.0.3`——TS 7.0（Go 原生）无稳定程序化 API（7.1 提供）且 `vue-tsc` 最新版仍崩溃（`./lib/tsc` 不再导出，上游修复 vuejs/language-tools#6123 未发布）。升级到 `^7` 的触发条件：① npm 发布包含 #6123 的 `vue-tsc`，或 ② TypeScript 7.1 稳定 API 落地且 vue-tsc 适配；届时一并评估 `--no-daemon` 去留（turbo 3.0 尚未发布，该 flag 的处理以发布后官方说明为准）。
