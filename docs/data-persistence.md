# 类型定义与持久化

> 范围：类型定义（shared/src/types）与持久化（settings / presets / trash 清理）。
> 索引：[README.md](README.md) · 相关：[architecture.md](architecture.md)

## 9. 类型定义

`packages/shared/src/types/` 下所有类型文件及关键类型：

| 文件 | 关键类型 |
|------|----------|
| `settings.ts` | `AppSettings`、`ThemeMode`、`Language` |
| `param.ts` | `ParamDef`、`ParamGroup`、`ParamType` |
| `preset.ts` | `PresetValues`、`Preset` |
| `server.ts` | `ServerInfo`、`ServerStatus`、`OutputEntry` |
| `gguf.ts` | `GgufModelInfo`、建议参数类型 |
| `download.ts` | `StartDownloadRequest`、下载任务/进度类型 |
| `ipc.ts` | `IPC` 常量对象、`IpcChannel` |
| `index.ts` | 统一导出 |

---

## 10. 持久化

- **配置目录**：`~/.llama_launcher/`
- **`settings.json`**：字段 — `settings_version`（schema 版本，当前 1，未来字段变更走 `migrateSettings` 迁移）、`server_exe`、`llama_dir`、`models_dir`、`selected_model`、`last_preset`、`window_geometry`、`window_maximized`、`theme_mode`、`fx_mode`、`close_behavior`、`sidebar_collapsed`、`language`、`last_tab`、`download_max_concurrent`（1–5）、`hf_mirror_host`（HuggingFace 镜像源，空 = 默认 hf-mirror.com）。写入为原子替换（`.tmp` + rename）+ **CAS 合并守卫**（写入前读取磁盘值作为基线，其他窗口/实例的更新不丢，本次传入值覆盖同名，写入失败重试）；加载时逐字段归一化（枚举/布尔/数值钳制），损坏文件自动备份为 `settings.json.bak` 后回退默认。
- **预设文件**：存储在用户设置的模型目录下 `presets/` 子目录，由 `resolvePresetsDir(modelsDir)` 动态解析。每个预设一个 JSON 文件，含 `preset_version`（当前 1）、`name`、`saved_at`、`values`；加载时做形状校验（`values` 非对象回退空对象），旧版无版本字段自动补齐默认 1。写入为原子替换（`.tmp` + rename）。
- **`stats.jsonl`（下载统计）**：已随「累计下载」展示移除一并停用（2026-08-14 起不再落盘，`download:stats` IPC 与 `download-stats.ts` 模块删除）。
- **下载续传日志**：`.llama_dl.jsonl`（与下载文件同目录）是下载任务的事件日志（JSONL 事实源）——`start`（含段布局）/`segment`（段进度，逐事件落盘）/`done`（终态）三类事件 append-only 写入；崩溃/重启后重放日志精确重建段进度（无周期快照窗口），`start` 前旧版 `.llama_dl.json` 周期快照由 `migrateLegacyMeta` 一次性迁移。下载完成后日志删除。
- **`server_exe`**：由 `llama_dir` 内联检测自动填充（`system:findLlamaExe` 查找目录及一级子目录中的 `llama-server.exe`）。
- **默认 `server_exe`**：开发模式下由 `paths.ts` 动态查找；生产模式下返回空字符串，由用户配置。
