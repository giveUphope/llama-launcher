# 类型定义与持久化

> 范围：类型定义（shared/src/types）与持久化（settings / presets / trash 清理）。
> 索引：[README.md](../README.md) · 相关：[architecture.md](architecture.md)

## 9. 类型定义

`packages/shared/src/types/` 下所有类型文件及关键类型：

| 文件 | 关键类型 |
|------|----------|
| `settings.ts` | `AppSettings`、`ThemeMode`、`FxMode`、`CloseBehavior`、`Language`、`SessionBaseline`（参数会话基线 `{ preset_name, values }`） |
| `param.ts` | `ParamDef`、`ParamGroup`、`ParamType` |
| `preset.ts` | `PresetValues`、`Preset` |
| `server.ts` | `ServerInfo`、`ServerStatus`、`OutputEntry`、`AppLogEntry`/`AppLogKind`（应用日志）、`ModelInfo`（模型扫描条目，含 `tags`）、`BenchRequest`/`BenchResult`/`BenchRunResult`/`BenchMetrics`（性能测试）、`LlamaBenchSummary`/`LlamaBenchJobState`（llama-bench 离线体检） |
| `gguf.ts` | `GgufModelInfo`（60 字段，含 `rope_freq_base`）、建议参数类型 |
| `vram.ts` | `DeviceMemInfo`、`PerfTarget`/`TargetRecommendation`（性能目标四档）、`OccupancySide`/`HardwareOccupancy`/`VramEstimateResult`/`OccupancyConfig`（显存/内存占用估算）、`ModelFitVerdict`/`ModelFitResult`（模型适配判定） |
| `download.ts` | `StartDownloadRequest`、下载任务/进度类型 |
| `trash.ts` | `TrashKind`、`TrashRoot`、`TrashItem`、`DetectResult`、`CleanResult`（应用生成文件清理：配置目录 + 模型目录双根） |
| `ipc.ts` | `IPC` 常量对象（57 通道）、`IpcChannel` |
| `index.ts` | 统一导出 |

---

## 10. 持久化

- **配置目录**：`~/.llama_launcher/`
- **`settings.json`**：字段 — `settings_version`（schema 版本，当前 1，未来字段变更走 `migrateSettings` 迁移）、`server_exe`、`llama_dir`、`models_dir`、`selected_model`、`last_preset`、`window_geometry`、`window_maximized`、`theme_mode`、`close_behavior`、`sidebar_collapsed`、`language`、`last_tab`、`download_max_concurrent`（1–5）、`hf_mirror_host`（HuggingFace 镜像源，空 = 默认 hf-mirror.com）、`custom_args`（**扩展参数**：用户自定义命令行参数原文，命令预览独立文本框编辑，`buildCommand` 按 shell 词法切分后追加到实际启动命令末尾，与内置参数命令完全分离、持久化于 settings.json）、`session_values`（**参数会话**（临时轨道）：当前生效参数快照，随变化节流 800ms 写入，重启恢复会话；**永不写入预设文件**）、`session_baseline`（**参数会话基线**：`{ preset_name, values }` = 会话加载的预设及应用时刻快照，null = 无预设基线）。两者形状非法时归一化 null（启动走 `selected_model` + `last_preset` 预设应用链）。写入为原子替换（`.tmp` + rename）+ **CAS 合并守卫**（写入前读取磁盘值作为基线，其他窗口/实例的更新不丢，本次传入值覆盖同名，写入失败重试）；加载时逐字段归一化（枚举/布尔/数值钳制），损坏文件自动备份为 `settings.json.bak` 后回退默认。
- **双轨参数逻辑**（2026-08-29）：**临时轨道** = `session_values`（任何参数变化自动写入，跨重启恢复，不碰预设文件）；**预设轨道** = 预设文件，只由 PresetsPanel 显式保存/覆盖写入（保存点同时刷新 `session_baseline` 并归零脏标记）。`hasChanges` = 相对基线的偏离（无基线时相对出厂默认）。
- **预设文件**：存储在用户设置的模型目录下 `presets/` 子目录，由 `resolvePresetsDir(modelsDir)` 动态解析。每个预设一个 JSON 文件，v2 结构：`preset_version`（当前 2）、`name`、`created_at`（首次创建时间，覆盖保存保留）、`saved_at`（最近保存）、`app_version`（写入方应用版本，参数漂移审计用）、`model`（顶层元数据：关联模型文件路径，null = 纯参数集）、`values`（纯参数值——不含 model 与 legacy `_enabled` 残留，按 `PARAMS` 定义顺序稳定序列化，重复保存无 diff 噪音）。加载统一迁移到 v2 内存形状（v1 的 `values.model` 提升为顶层 `model`，无版本字段按 v1 处理，`created_at` 缺失以 `saved_at` 回填；文件在下次显式保存时才改写落盘）；形状校验（`values` 非对象回退空对象）。写入为原子替换（`.tmp` + rename）。
- **应用生成文件全清单（清理检测覆盖范围，`trash-cleaner.ts` 双根扫描）**：
  - **配置目录** `~/.llama_launcher/`：`settings.json`（白名单永不清理）、`settings.json.bak`（损坏备份）、`settings.json.tmp`（原子写残留）、`presets/`（旧版预设目录，已迁移到 modelsDir/presets → `stale_presets_dir`）、`stats.jsonl`（旧版下载统计，已停用 → `legacy_stats`）、根目录损坏 JSON（非 settings → `broken_json`）、`*.tmp/*.bak/*.old/*.log`（`temp_file`）。
  - **模型目录** `models_dir`：`*.part`（下载临时文件）、`*.llama_dl.jsonl`（续传事件日志）、`*.llama_dl.json`（旧版周期快照）→ 无活动任务占用时列 `download_orphan`；`presets/*.json` 为有效数据（仅当顶层绑定模型文件不存在时列 `orphan_preset`、解析失败列 `broken_json`；纯参数集与有效预设保留）、`presets/*.tmp|*.bak` 原子写/备份残留 → `temp_file`。
  - **保护与再校验**：`queued/downloading/paused/error` 状态任务占用的 localPath/partPath/续传日志由 `DownloadManager.getProtectedPaths()` 传入保护，检测与清理时刻双重排除；`cleanTrash` 对每个传入项按声明 kind 复核根归属（config → CONFIG_DIR，models → modelsDir）、路径特征与内容（孤儿预设清理时刻重读，模型重新出现即放弃删除），未识别文件一律不列入（保守策略）。
- **`stats.jsonl`（下载统计）**：已随「累计下载」展示移除一并停用（2026-08-14 起不再落盘，`download:stats` IPC 与 `download-stats.ts` 模块删除）。
- **下载续传日志**：`.llama_dl.jsonl`（与下载文件同目录）是下载任务的事件日志（JSONL 事实源）——`start`（含段布局）/`segment`（段进度，逐事件落盘）/`done`（终态）三类事件 append-only 写入；崩溃/重启后重放日志精确重建段进度（无周期快照窗口），`start` 前旧版 `.llama_dl.json` 周期快照由 `migrateLegacyMeta` 一次性迁移。下载完成后日志删除。
- **`server_exe`**：由 `llama_dir` 内联检测自动填充（`system:findLlamaExe` 查找目录及一级子目录中的 `llama-server.exe`）。
- **默认 `server_exe`**：开发模式下由 `paths.ts` 动态查找；生产模式下返回空字符串，由用户配置。
