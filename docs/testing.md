# 测试

> 范围：测试结构与用例说明（Vitest，位于 packages/core/tests 与 packages/ui 内联测试）。
> 索引：[README.md](../README.md) · 相关：[core-modules.md](core-modules.md) · [workflow.md](workflow.md)

- **框架**：Vitest 4（`pnpm test` 经 turbo 一并运行 core 与 ui 两包）

- **规模**：core 25 个测试文件 / 355 个用例 + ui 5 个测试文件 / 54 个用例（`pnpm test` 经 turbo 一并运行两包）

- **覆盖模块**：

| 测试文件                                  | 覆盖模块                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `settings-store.test.ts`              | 设置读写（含 `session_values`/`session_baseline` 形状校验）                                |
| `presets-store.test.ts`               | 预设读写                                                                            |
| `models-scanner.test.ts`              | 模型扫描                                                                            |
| `command-builder.test.ts`             | 命令构建（含 legacy `_enabled` 忽略）                                                    |
| `command-builder-definitions.test.ts` | 命令构建（表驱动：从 `definitions.ts` 生成全部 60 参数的结构约束与发射行为用例）                             |
| `launcher.test.ts`                    | 启动编排                                                                            |
| `gguf-meta.test.ts`                   | GGUF 元数据读取（含建议参数生成、附件模型守卫、rope 字段抽取）                                        |
| `devices.test.ts`                     | `--list-devices` 输出解析（逐行容错、Vulkan/CUDA 行锚定）                                    |
| `vram-estimate.test.ts`               | KV 内存模型 + 显存/内存双侧占用估算数学 + 无 OOM 最大上下文求解（单位手算）                               |
| `target-recommend.test.ts`            | 性能目标四档联动建议（按目标 dtype 预算内推算 ctx/KV 档位/卸载层数/MTP）                              |
| `llama-bench.test.ts`                 | llama-bench JSON 解析与 pp/tg 汇总（真实输出样本）                                           |
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

### ui 包（`src/` 内联测试）

| 测试文件                               | 覆盖模块                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `src/stores/params.test.ts`         | 参数 store（双轨值/基线、依赖联动 `syncDependencies`、`clearSession` 保留模型、恢复基线）          |
| `src/stores/server.test.ts`         | server store（`apiUrl` 与真实服务状态绑定：running/starting/stopped 三态）              |
| `src/composables/useModelPreset.test.ts` | 智能预设静默匹配与应用（别名/文件名候选、脏态不二次确认）                                         |
| `src/composables/useAutoPresetName.test.ts` | 预设名候选生成（去扩展名/目录名变体）                                                     |
| `src/composables/useUrlHistory.test.ts` | URL 历史记录                                                                  |

## 手动冒烟脚本（需真实引擎/模型）

| 脚本 | 前置条件 | 验证内容 |
| ---- | ---- | ---- |
| `scripts/verify-server-start.mjs` | 先构建 `core/dist`（`pnpm --filter @llama-launcher/core build`），目录下有 llama-server 二进制 | `Launcher` 启动编排冒烟：状态机 / listening 检测 / 停止清理，逐阶段断言并打印结果 |

两者均为手动执行（不接入 `pnpm test`），用于真实二进制/引擎环境下的链路验证。

## Windows 退出竞态兜底（ui 包）

vitest 2.1.x 时代在 Windows 上存在退出竞态：tinypool worker 销毁后其 IPC 管道句柄残留在主进程，ui 全量运行（当时 4 个测试文件）时恰有被引用的句柄卡住事件循环——全部测试通过后进程静默不退出，`pnpm test`（turbo 管道）随之挂死。修复：`packages/ui/vitest.global-setup.mjs`（经 `vitest.config.ts` 的 `globalSetup` 引用）在运行结束、`process.exitCode` 已确定后 `process.exit` 强制退出——测试结果与退出码不变，仅跳过卡死的事件循环等待。**vitest 4 已重写 pool（移除 tinypool），该挂死根因在上游根治，此兜底保留为防御性**（防止将来再引入同类句柄残留）；仅 run 模式适用（本包 `test` 即 `vitest run`）；若确认无需兜底可整体删除。
