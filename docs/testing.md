# 测试

> 范围：测试结构与用例说明（Vitest，位于 packages/core/tests 与 packages/ui 内联测试）。
> 索引：[README.md](../README.md) · 相关：[core-modules.md](core-modules.md) · [workflow.md](workflow.md)

- **框架**：Vitest 4（`pnpm test` 经 turbo 一并运行 core 与 ui 两包）

- **规模**：core 21 个测试文件 / 315 个用例 + ui 4 个测试文件 / 48 个用例（`pnpm test` 经 turbo 一并运行两包）

- **覆盖模块**：

| 测试文件                                  | 覆盖模块                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `settings-store.test.ts`              | 设置读写（含 `session_values`/`session_baseline` 形状校验）                                |
| `presets-store.test.ts`               | 预设读写                                                                            |
| `models-scanner.test.ts`              | 模型扫描                                                                            |
| `command-builder.test.ts`             | 命令构建（含 legacy `_enabled` 忽略）                                                    |
| `command-builder-definitions.test.ts` | 命令构建（表驱动：从 `definitions.ts` 生成全部 58 参数的结构约束与发射行为用例）                             |
| `launcher.test.ts`                    | 启动编排                                                                            |
| `gguf-meta.test.ts`                   | GGUF 元数据读取                                                                      |
| `process.test.ts`                     | 子进程管理                                                                           |
| `process-terminate.test.ts`           | 进程终止策略                                                                          |
| `dev-session.test.ts`                 | 开发会话进程树清理                                                                       |
| `process-registry.test.ts`            | 窗口 ↔ 进程映射                                                                       |
| `e2e-cleanup.test.ts`                 | 窗口关闭后进程清理                                                                       |
| `trash-cleaner.test.ts`               | 配置目录垃圾清理                                                                        |
| `url-parser.test.ts`                  | 模型 URL 解析                                                                       |
| `model-relevance.test.ts`             | 量化标签解析                                                                          |
| `download-manager.test.ts`            | 多段并行 / 暂停 / 恢复 / 断点续传                                                           |
| `download-log.test.ts`                | 下载事件日志（`.llama_dl.jsonl` 重放 / legacy 迁移）                                        |
| `modelscope-client.test.ts`           | ModelScope API（成功映射 / 分类量化 / retry 的 3 次退避重试与 404 不重试 / formatFileSize 别名）      |
| `huggingface-client.test.ts`          | HF 镜像源配置 / 可注入传输 / 文件列表                                                         |
| `retry.test.ts`                       | 统一可重试判定与退避                                                                      |
| `format.test.ts`                      | shared `formatBytes`/`formatDuration` 全边界（0/NaN/Infinity、1023/1024 切换点、档位、整点折叠） |

## Windows 退出竞态兜底（ui 包）

vitest 2.1.x 时代在 Windows 上存在退出竞态：tinypool worker 销毁后其 IPC 管道句柄残留在主进程，ui 全量运行（4 个测试文件）时恰有被引用的句柄卡住事件循环——全部测试通过后进程静默不退出，`pnpm test`（turbo 管道）随之挂死。修复：`packages/ui/vitest.global-setup.mjs`（经 `vitest.config.ts` 的 `globalSetup` 引用）在运行结束、`process.exitCode` 已确定后 `process.exit` 强制退出——测试结果与退出码不变，仅跳过卡死的事件循环等待。**vitest 4 已重写 pool（移除 tinypool），该挂死根因在上游根治，此兜底保留为防御性**（防止将来再引入同类句柄残留）；仅 run 模式适用（本包 `test` 即 `vitest run`）；若确认无需兜底可整体删除。
