# 类型定义与持久化

> 语言：中文 · [English](../en/data-persistence.md)
> 范围：类型定义（shared/src/types）与持久化（settings / presets / trash 清理）。
> 索引：[README.md](../../README.md) · 相关：[architecture.md](architecture.md)

## 9. 类型定义

`packages/shared/src/types/` 下所有类型文件及关键类型：

| 文件 | 关键类型 |
|------|----------|
| `settings.ts` | `AppSettings`、`ThemeMode`、`CloseBehavior`、`Language`、`SessionBaseline`（参数会话基线 `{ preset_name, values }`） |
| `param.ts` | `ParamDef`、`ParamGroup`、`ParamType` |
| `preset.ts` | `PresetValues`、`Preset`（v3，含稳定 id）、`PresetSummary`（列表视图模型）、`PresetSaveInput`（upsert 载荷） |
| `server.ts` | `ServerInfo`（含 `values` 启动快照、`stop` 停止事实、`envOverrides` 检出的 `LLAMA_ARG_*` 变量名、`propsCheck` 回读对账结果（其 `checkedAt` 时刻供界面标注新鲜度——复检由「页面真的可见」驱动、空闲时按 `15s×2^n` 退避（封顶 60s），结论变了立刻回快档，页面失活即停表——所以「距上次核对多久」仍然只能当新鲜度标注用，不能反推固定周期；`url` 由 `displayHost()` 从可能是逗号分隔多地址的 `host` 中取回环/首个 TCP 地址，纯 `.sock` 配置为空串）、`readyAt` 本轮首次就绪时刻（epoch ms，与状态事件同源——「已运行时长」由它派生，渲染层自记起点会在首进页面/重载时失真））、`PropsCheck`/`PropsMismatch`（`/props` 对账结果形状，定义在 `params/props-mapping.ts`）、`ServerStatus`（含 `stopping`）、`OutputEntry`、`AppLogEntry`/`AppLogKind`（应用日志）、`ModelInfo`（模型扫描条目，含 `tags`）、`LlamaBenchSummary`/`LlamaBenchJobState`（llama-bench 离线体检） |
| `gguf.ts` | `GgufModelInfo`（60 字段，含 `rope_freq_base`）、建议参数类型 |
| `vram.ts` | `DeviceMemInfo`、`PerfTarget`/`TargetRecommendation`（性能目标四档）、`OccupancySide`/`HardwareOccupancy`/`VramEstimateResult`/`OccupancyConfig`（显存/内存占用估算）、`ModelFitVerdict`/`ModelFitResult`（模型适配判定） |
| `download.ts` | `StartDownloadRequest`、下载任务/进度类型 |
| `trash.ts` | `TrashKind`、`TrashRoot`、`TrashItem`、`DetectResult`、`CleanResult`（应用生成文件清理：配置目录 + 模型目录双根） |
| `ipc.ts` | `IPC` 常量对象（58 通道）、`IpcChannel` |
| `index.ts` | 统一导出 |

---

## 10. 持久化

- **配置目录**：`~/.llama_launcher/`
  - `settings.json`：应用设置与会话参数（字段清单见下节）。
  - `bench-records.json`：模型体检结果（llama-bench 的 pp/tg 实测值），由 core `bench-records.ts` 原子写。只存 done / error 终态，同一路径留最近一条，超过 300 条按 `testedAt` 丢最旧的；主进程启动时把它回灌进结果缓存，所以关掉应用再打开，模型页照样显示上次测出的速度（此前这些数字随进程退出一起消失）。

### `settings.json` 字段全清单

| 字段                        | 类型                            | 说明                                                               |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `settings_version`        | number                        | settings schema 版本（当前 1，字段变更走 `migrateSettings` 迁移）              |
| `server_exe`              | string                        | llama-server 可执行文件路径（由 `llama_dir` 内联检测自动填充，见末两条）                |
| `llama_dir`               | string                        | llama.cpp 引擎目录（用户选择的包含 llama-server 的目录）                         |
| `models_dir`              | string                        | 模型存储目录                                                           |
| `selected_model`          | string                        | 当前选中的模型路径                                                        |
| `last_preset`             | string                        | **已废弃（兼容保留）**：v3 起由 `last_preset_id` 接管；仅启动链在 id 落空时按名兜底一次，命中后回填 id 并清空本字段 |
| `last_preset_id`          | string                        | 上次应用的预设 id（预设以稳定 id 为主键，改名/搬移不再使引用失效）；空 = 无                        |
| `window_geometry`         | string                        | 窗口位置和大小（`x,y,width,height`）                                      |
| `window_maximized`        | boolean                       | 窗口最大化状态记录（应用启动固定最大化；字段仍保存以兼容旧数据 / 未来可恢复「记住还原」）                    |
| `theme_mode`              | 'dark' \| 'light' \| 'system' | 主题模式（`system` 跟随系统 `prefers-color-scheme`）                       |
| `close_behavior`          | 'ask' \| 'exit' \| 'tray'     | 关闭窗口时：询问 / 直接退出 / 最小化到托盘                                             |
| `sidebar_collapsed`       | boolean                       | 侧边栏是否折叠                                                          |
| `language`                | 'zh' \| 'en'                  | 界面语言                                                             |
| `last_tab`                | string                        | 上次访问的页面                                                          |
| `download_max_concurrent` | number                        | 最大并发下载数（1–5，默认 3；边界与默认值唯一来源是 `shared/src/settings-limits.ts` 的 `DOWNLOAD_CONCURRENCY_*` + `clampDownloadConcurrency`，core 的 schema/下载器钳制与设置页下拉同源） |
| `hf_mirror_host`          | string                        | HuggingFace 镜像源（空 = 默认 hf-mirror.com，默认站名唯一来源 `shared/src/hosts.ts`），保存时同步 `setHfMirrorHost` 驱动镜像链路 |
| `custom_args`             | string                        | **扩展参数**：用户自定义命令行参数原文，命令预览独立文本框编辑，`buildCommand` 按 shell 词法切分后追加到实际启动命令末尾；与内置参数命令完全分离，「还原」参数不影响它 |
| `session_values`          | object \| null                | **参数会话**（临时轨道）：当前生效参数快照，随变化节流 800ms 写入，重启恢复会话；**永不写入预设文件**；形状非法时归一化 null |
| `session_baseline`        | object \| null                | **参数会话基线**：`{ preset_name, values }` = 会话加载的预设及应用时刻快照，null = 无预设基线；启动时与 `selected_model` + `last_preset_id`（旧版 `last_preset` 兜底）共同决定还原路径 |
| `engine_hint_dismissed`   | string[]                      | **引擎提示已忽略条目**：设置页引擎行下方的可忽略提示点「忽略」时存入当前行各条消息全文（写入裁剪最近 50 条）；被忽略的条目保持安静，新出现的消息照常显示——按条而非按整行，因「N 项不同」计数随参数编辑逐次变化 |

- **写入与加载**：写入为原子替换（`.tmp` + rename）+ **CAS 合并守卫**（写入前读取磁盘值作为基线，其他窗口/实例的更新不丢，本次传入值覆盖同名，写入失败重试）；加载时逐字段归一化（`theme_mode`/`language` 枚举校验、布尔/数值钳制、`download_max_concurrent` 钳到 1–5），损坏或结构非法的文件自动备份为 `settings.json.bak` 后回退默认（不静默吞掉用户配置）。
- **双轨参数逻辑**（2026-08-29；2026-10-08 解耦重构）：**临时轨道** = `session_values`（任何参数变化自动写入，跨重启恢复，不碰预设文件）；**预设轨道** = 预设文件，只由显式保存写入（保存点同时刷新 `session_baseline` 并归零脏标记），读写全部经 core 的 `PresetRepository` 承接——IPC 载荷与界面只认 id 与摘要（`PresetSummary`），目录位置、文件名、JSON 布局都是存储层内部。`hasChanges` = 相对基线的偏离（无基线时相对出厂默认）。
- **预设文件**：统一存放在 `~/.llama_launcher/presets/`（2026-10-08 起与模型目录解耦——预设是「应用的参数集合」而非模型目录附属物，换模型目录预设不丢；旧版 `<models_dir>/presets` 由 `migratePresetStore` 在应用启动时一次性搬入，搬空即移除源目录，同名冲突目标优先，损坏文件原地保留）。每个预设一个 JSON 文件，v3 结构：`preset_version`（当前 3）、`id`（**稳定主键** UUID，文件名只是 `name` 的清洗落盘形态——改名 = 换文件名 + 更新 `name`，id 恒定）、`name`、`created_at`（首次创建时间，覆盖保存保留）、`saved_at`（最近保存）、`app_version`（写入方应用版本，参数漂移审计用）、`model`（顶层元数据：关联模型文件路径，null = 纯参数集）、`values`（纯参数值——不含 model 与 legacy `_enabled` 残留，按 `PARAMS` 定义顺序稳定序列化，重复保存无 diff 噪音）。加载统一迁移到 v3 内存形状（v1 的 `values.model` 提升为顶层 `model`、v1/v2 无 id 回填 UUID；文件落盘升级由迁移流程或下次显式保存完成）；形状校验（`values` 非对象回退空对象）。写入为原子替换（`.tmp` + rename）。
- **应用生成文件全清单（清理检测覆盖范围，`trash-cleaner.ts` 双根扫描）**：
  - **配置目录** `~/.llama_launcher/`：`settings.json`（白名单永不清理）、`settings.json.bak`（损坏备份）、`settings.json.tmp`（原子写残留）、`presets/`（**预设活目录**：`*.json` 为有效数据（仅当顶层绑定模型文件不存在时列 `orphan_preset`、解析失败列 `broken_json`；纯参数集与有效预设保留）、`*.tmp|*.bak` 原子写/备份残留 → `temp_file`）、`stats.jsonl`（旧版下载统计，已停用 → `legacy_stats`）、根目录损坏 JSON（非 settings → `broken_json`）、`bench-records.json`（体检记录：解析得开的 JSON **不列入清理**，只有损坏时才归入 `broken_json`，其原子写残留的 `.tmp` 归 `temp_file`）、`*.tmp/*.bak/*.old/*.log`（`temp_file`）。
  - **模型目录** `models_dir`：`*.part`（下载临时文件）、`*.llama_dl.jsonl`（续传事件日志）、`*.llama_dl.json`（旧版周期快照）→ 无活动任务占用时列 `download_orphan`。预设已迁往 `~/.llama_launcher/presets`，模型目录内不再有预设扫描；历史版本遗留的 `<models_dir>/presets` **不扫描、不列入清理**（迁移流程搬空它，搬不动的同名冲突/损坏文件属于用户数据，宁可保留不冒误删风险）。
  - **保护与再校验**：`queued/downloading/paused/error` 状态任务占用的 localPath/partPath/续传日志由 `DownloadManager.getProtectedPaths()` 传入保护，检测与清理时刻双重排除；`cleanTrash` 对每个传入项按声明 kind 复核根归属（config → CONFIG_DIR，models → modelsDir）、路径特征与内容（孤儿预设清理时刻重读，模型重新出现即放弃删除），未识别文件一律不列入（保守策略）。
- **`stats.jsonl`（下载统计）**：已随「累计下载」展示移除一并停用（2026-08-14 起不再落盘，`download:stats` IPC 与 `download-stats.ts` 模块删除）。
- **下载续传日志**：`.llama_dl.jsonl`（与下载文件同目录）是下载任务的事件日志（JSONL 事实源）——`start`（含段布局）/`segment`（段进度，逐事件落盘）/`done`（终态）三类事件 append-only 写入；崩溃/重启后重放日志精确重建段进度（无周期快照窗口），`start` 前旧版 `.llama_dl.json` 周期快照由 `migrateLegacyMeta` 一次性迁移。下载完成后日志删除。
- **`server_exe`**：由 `llama_dir` 内联检测自动填充（`system:findLlamaExe` 查找目录及一级子目录中的 `llama-server.exe`）。
- **默认 `server_exe`**：开发模式下由 `paths.ts` 动态查找；生产模式下返回空字符串，由用户配置。
