# 类型定义与持久化

> 语言：中文 · [English](../en/data-persistence.md)
> 范围：类型定义（shared/src/types）与持久化（settings / 每模型参数集 / trash 清理）。
> 索引：[README.md](../../README.md) · 相关：[architecture.md](architecture.md)

## 9. 类型定义

`packages/shared/src/types/` 下所有类型文件及关键类型：

| 文件 | 关键类型 |
|------|----------|
| `settings.ts` | `AppSettings`、`ThemeMode`、`CloseBehavior`、`Language` |
| `param.ts` | `ParamDef`、`ParamGroup`、`ParamType` |
| `model-params.ts` | `PresetValues`（通用参数值表，命令构建/快照共用）、`ModelParams`（每模型参数集：模型路径 + updated_at + values） |
| `server.ts` | `ServerInfo`（含 `values` 启动快照、`stop` 停止事实、`envOverrides` 检出的 `LLAMA_ARG_*` 变量名、`propsCheck` 回读对账结果（其 `checkedAt` 时刻供界面标注新鲜度——复检由「页面真的可见」驱动、空闲时按 `15s×2^n` 退避（封顶 60s），结论变了立刻回快档，页面失活即停表——所以「距上次核对多久」仍然只能当新鲜度标注用，不能反推固定周期；`url` 由 `displayHost()` 从可能是逗号分隔多地址的 `host` 中取回环/首个 TCP 地址，纯 `.sock` 配置为空串）、`readyAt` 本轮首次就绪时刻（epoch ms，与状态事件同源——「已运行时长」由它派生，渲染层自记起点会在首进页面/重载时失真））、`PropsCheck`/`PropsMismatch`（`/props` 对账结果形状，定义在 `params/props-mapping.ts`）、`ServerStatus`（含 `stopping`）、`OutputEntry`、`AppLogEntry`/`AppLogKind`（应用日志）、`ModelInfo`（模型扫描条目，含 `tags`）、`LlamaBenchSummary`/`LlamaBenchJobState`（llama-bench 离线体检） |
| `gguf.ts` | `GgufModelInfo`（60 字段，含 `rope_freq_base`）、建议参数类型 |
| `vram.ts` | `DeviceMemInfo`、`PerfTarget`/`TargetRecommendation`（性能目标四档）、`OccupancySide`/`HardwareOccupancy`/`VramEstimateResult`/`OccupancyConfig`（显存/内存占用估算）、`ModelFitVerdict`/`ModelFitResult`（模型适配判定） |
| `download.ts` | `StartDownloadRequest`、下载任务/进度类型 |
| `trash.ts` | `TrashKind`、`TrashRoot`、`TrashItem`、`DetectResult`、`CleanResult`（应用生成文件清理：配置目录 + 模型目录双根） |
| `ipc.ts` | `IPC` 常量对象（56 通道）、`IpcChannel` |
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
| `engine_hint_dismissed`   | string[]                      | **引擎提示已忽略条目**：设置页引擎行下方的可忽略提示点「忽略」时存入当前行各条消息全文（写入裁剪最近 50 条）；被忽略的条目保持安静，新出现的消息照常显示——按条而非按整行，因「N 项不同」计数随参数编辑逐次变化 |

> 参数不再存于 settings.json：`session_values` / `session_baseline` / `last_preset` / `last_preset_id` 四个双轨字段已随**每模型自动持久化**移除（2026-10-08，参数迁往 `~/.llama_launcher/model-params/`，见下）。旧设置文件里的这些键由 schema 剥除，静默忽略。

- **写入与加载**：写入为原子替换（`.tmp` + rename）+ **CAS 合并守卫**（写入前读取磁盘值作为基线，其他窗口/实例的更新不丢，本次传入值覆盖同名，写入失败重试）；加载时逐字段归一化（`theme_mode`/`language` 枚举校验、布尔/数值钳制、`download_max_concurrent` 钳到 1–5），损坏或结构非法的文件自动备份为 `settings.json.bak` 后回退默认（不静默吞掉用户配置）。
- **每模型参数集**（2026-10-08 起，取代双轨机制与手存预设）：参数跟模型走——每个模型在 `~/.llama_launcher/model-params/` 下有一份自己的参数集，调整即自动持久化（渲染层 800ms 节流写 `modelParams:save`）、切换/重启即自动载回，**全程无手动保存**。每个模型一个 JSON 文件，文件名 = `<清洗后的模型文件名>-<规范化路径 sha1 前 8 位>.json`，结构：`format_version`（当前 1）、`model_path`（写入时的模型绝对路径，用于展示与搬家后重识别）、`updated_at`（ISO 最近写入）、`values`（纯参数值——不含 model 与 legacy `_enabled` 残留，按 `PARAMS` 定义顺序稳定序列化，重复保存无 diff 噪音）。读写全部经 core 的 `ModelParamsRepository`（`load`/`save`/`clear`/`deleteForModel`）——模型目录移动后按「存储原路径的文件名」重识别并换键重写，参数不丢；删除模型时同步清理其名下参数集（路径前缀匹配）。存量预设由启动迁移 `migratePresetsToModelParams` 一次性并入（绑定模型的预设同模型多条取 `saved_at` 最新，迁入后源文件删除；无模型绑定的纯参数集与损坏文件原地保留，交给垃圾清理流程）。形状校验（`values` 非对象回退空对象）；写入为原子替换（`.tmp` + rename）。
- **应用生成文件全清单（清理检测覆盖范围，`trash-cleaner.ts` 双根扫描）**：
  - **配置目录** `~/.llama_launcher/`：`settings.json`（白名单永不清理）、`settings.json.bak`（损坏备份）、`settings.json.tmp`（原子写残留）、`model-params/`（**每模型参数集活目录**：`*.json` 为有效数据（仅当存储的模型文件不存在时列 `orphan_model_params`、解析失败列 `broken_json`；有效参数集保留）、`*.tmp|*.bak` 原子写/备份残留 → `temp_file`）、`stats.jsonl`（旧版下载统计，已停用 → `legacy_stats`）、根目录损坏 JSON（非 settings → `broken_json`）、`bench-records.json`（体检记录：解析得开的 JSON **不列入清理**，只有损坏时才归入 `broken_json`，其原子写残留的 `.tmp` 归 `temp_file`）、`*.tmp/*.bak/*.old/*.log`（`temp_file`）。
  - **模型目录** `models_dir`：`*.part`（下载临时文件）、`*.llama_dl.jsonl`（续传事件日志）、`*.llama_dl.json`（旧版周期快照）→ 无活动任务占用时列 `download_orphan`。参数集在 `~/.llama_launcher/model-params`，模型目录内没有参数集扫描；两代历史遗留的预设目录（`<models_dir>/presets` 与 `~/.llama_launcher/presets`）**不扫描、不列入清理**（启动迁移搬空它们，搬不动的同名冲突/损坏/无绑定文件属于用户数据，宁可保留不冒误删风险）。
  - **保护与再校验**：`queued/downloading/paused/error` 状态任务占用的 localPath/partPath/续传日志由 `DownloadManager.getProtectedPaths()` 传入保护，检测与清理时刻双重排除；`cleanTrash` 对每个传入项按声明 kind 复核根归属（config → CONFIG_DIR，models → modelsDir）、路径特征与内容（孤儿参数集清理时刻重读，模型重新出现即放弃删除），未识别文件一律不列入（保守策略）。
- **`stats.jsonl`（下载统计）**：已随「累计下载」展示移除一并停用（2026-08-14 起不再落盘，`download:stats` IPC 与 `download-stats.ts` 模块删除）。
- **下载续传日志**：`.llama_dl.jsonl`（与下载文件同目录）是下载任务的事件日志（JSONL 事实源）——`start`（含段布局）/`segment`（段进度，逐事件落盘）/`done`（终态）三类事件 append-only 写入；崩溃/重启后重放日志精确重建段进度（无周期快照窗口），`start` 前旧版 `.llama_dl.json` 周期快照由 `migrateLegacyMeta` 一次性迁移。下载完成后日志删除；`checksum_mismatch` 失败时同样删除（校验失败的字节不可信、不可续传），`.part` 一并清理并回填期望校验和，重试即干净的全量重下。
- **`server_exe`**：由 `llama_dir` 内联检测自动填充（`system:findLlamaExe` 查找目录及一级子目录中的 `llama-server.exe`）。
### 配置诊疗（config doctor，2026-10-09 起）

- **是什么**：应用自带的配置「诊断 + 修复」模块（core `config-doctor.ts`）。每次启动（`app.whenReady`，先于任何 IPC 注册）跑一遍 `runConfigDoctor()`：对 `settings.json` 与 `model-params/*.json` 逐文件检查，修复能安全修复的，报告走应用日志（日志页可见——干净也报一行「检查通过」，有修复按文件逐行列出问题种类；损坏/形状类升为 warn 级）。
- **修什么（settings.json）**：① JSON 损坏 / 顶层形状非法 → 备份 `.bak` 后**立即重置为全新默认文件**（此前只重置内存、磁盘要等下次保存才恢复）；② 版本号旧于当前 schema（`settings_version` < 当前）→ `migrateSettings` 迁移后**原子写回**——版本更新后配置文件随之升到当前版式，不再等「恰好触发保存」；③ schema 外的未知键（历史版本残留）剥离；④ 非法/缺失字段修复写回（枚举回默认、新字段补默认）。内容与规范形逐字节一致时**绝不写**（幂等，不搅动 mtime 与读取缓存）。
- **修什么（model-params/*.json）**：JSON 损坏 / 形状非法 → 备份 `.bak` 并移出活集（该模型回落出厂默认，原内容可手工恢复）；`values` 里已从参数表移除的参数键（版本升级残留）清理写回，现役值原样保留。
- **报告文案**：主进程经 `tr()` 组装（数据层只出 issue 种类与计数，不产文案），键 `applog_config_doctor_*` / `cfg_issue_*`；单测见 `packages/core/tests/config-doctor.test.ts`（临时目录注入路径，含「干净文件绝不写」的幂等判据）。诊疗产生的 `.bak` 由垃圾清理按 `temp_file` 收走——损坏原文件的恢复窗口到用户手动清理为止；损坏参数集在清理页的分类因此从 `broken_json` 前移为 `temp_file`（诊疗已先一步处置）。

- **默认 `server_exe`**：开发模式下由 `paths.ts` 动态查找；生产模式下返回空字符串，由用户配置。

