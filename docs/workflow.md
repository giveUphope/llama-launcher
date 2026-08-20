# 开发工作流

> 范围：开发工作流：构建、类型检查、测试、打包、文档维护。
> 索引：[README.md](README.md) · 相关：[architecture.md](architecture.md) · [packaging.md](packaging.md)

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发模式（turbo 编排） |
| `pnpm build` | 构建所有包 |
| `pnpm test` | 运行测试 |
| `pnpm lint` | 类型检查 + IPC 同步校验（`verify-ipc-sync.cjs`） |
| `pnpm dist` | 打包 Windows 安装程序（根目录一条命令，委托 `@llama-launcher/desktop dist`；electron-builder，自动处理输出目录锁定回退） |

开发模式热重载（`apps/desktop` 的 `dev:vite` 三进程编排）：Vite dev server（UI HMR）+ `tsc -b --watch`（shared/core/desktop 增量重建）+ `scripts/dev-watch.cjs`（监视主进程 dist / preload 源 / shared 类型，变更时自动重新生成 preload 并重启 Electron，通过 `LLAMA_DEV_SKIP_QUIT_KILL=1` 避免热重启连带杀掉 dev 会话树）。改 UI 组件/样式即时热更；改 core/shared/主进程/preload 代码自动重建并重启，无需手动操作。
