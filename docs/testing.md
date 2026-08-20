# 测试

> 范围：测试结构与用例说明（Vitest，位于 packages/core/tests）。
> 索引：[README.md](README.md) · 相关：[core-modules.md](core-modules.md) · [workflow.md](workflow.md)

- **框架**：Vitest 2
- **规模**：15 个测试文件，200 个测试用例（全部通过）
- **覆盖模块**：

| 测试文件 | 覆盖模块 |
|----------|----------|
| `settings-store.test.ts` | 设置读写 |
| `presets-store.test.ts` | 预设读写 |
| `models-scanner.test.ts` | 模型扫描 |
| `command-builder.test.ts` | 命令构建 |
| `launcher.test.ts` | 启动编排 |
| `gguf-meta.test.ts` | GGUF 元数据读取 |
| `process.test.ts` | 子进程管理 |
| `process-terminate.test.ts` | 进程终止策略 |
| `dev-session.test.ts` | 开发会话进程树清理 |
| `process-registry.test.ts` | 窗口 ↔ 进程映射 |
| `e2e-cleanup.test.ts` | 窗口关闭后进程清理 |
| `trash-cleaner.test.ts` | 配置目录垃圾清理 |
| `url-parser.test.ts` | 模型 URL 解析 |
| `model-relevance.test.ts` | 量化标签解析 |
| `download-manager.test.ts` | 多段并行 / 暂停 / 恢复 / 断点续传 |
