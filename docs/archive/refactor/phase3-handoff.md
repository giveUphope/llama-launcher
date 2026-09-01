# 阶段三交接记录：补齐模型获取、参数与诊断能力

---

## 阶段状态
完成 ✅（含 1 项历史 PR 引入的测试回归已修复）

---

## 已完成内容

### 1. 修复历史 PR 引入的测试回归

`packages/core/tests/command-builder-definitions.test.ts:135` 在阶段二末尾的 PR 改写为表驱动后新增了 1 个失败：`chat_template` 是 dropdown 类型，`default='none'`，`options` 含 `''` 占位；`nonDefaultValue` 选中空串后，期望 flag 出现在 cmd 中，但生产代码 `buildCommand.shouldSkip` 因 `v === ''` 跳过发射（**生产行为本身正确**，空字符串 `--chat-template ""` 无意义）。修复：`nonDefaultValue` 跳过空字符串选项，与生产行为对齐。

| 文件 | 改动 |
|------|------|
| `packages/core/tests/command-builder-definitions.test.ts` | `nonDefaultValue` 的 dropdown 分支跳过空串选项 |

### 2. 后端能力矩阵（`docs/archive/refactor/phase3-capability-matrix.md`）

按提示词 §5.4 要求逐项核对：远程模型筛选维度、暂停/恢复/取消/校验、参数元数据、日志筛选/导出/历史加载等。明确"展示"与"隐藏"清单（无 API 字段不伪造）。

### 3. 模型页：3 子标签改造（`ModelsPage.vue`）

- **本地模型** → `LocalModelsPanel.vue`：原 ModelsPage 主体（730 行）整体迁入，行为零变化
- **模型库** → `LibraryPanel.vue`：复用既有 `DownloadCard` 的 URL 解析 + 关键字搜索 + 文件选择
- **下载任务** → `DownloadsPanel.vue`：原 `DownloadPage.vue` 状态横条 + 任务列表迁入

旧路由 `/download` 重定向到 `/models?tab=downloads`（保留旧书签）。`DownloadPage.vue` 已删除（无其它引用）。

| 文件 | 操作 |
|------|------|
| `packages/ui/src/pages/ModelsPage.vue` | 重写为薄壳（110 行）+ 3 子标签 |
| `packages/ui/src/components/models/LocalModelsPanel.vue` | 新建（来自原 ModelsPage 主体） |
| `packages/ui/src/components/models/LibraryPanel.vue` | 新建（薄壳包 DownloadCard） |
| `packages/ui/src/components/models/DownloadsPanel.vue` | 新建（来自原 DownloadPage） |
| `packages/ui/src/features/download.ts` | `/download` 改为 `redirect` |
| `packages/ui/src/pages/DownloadPage.vue` | 删除（已被 DownloadsPanel 替代） |

### 4. 参数页：收为 2 子标签（`ParamsPage.vue`）

按设计稿 §14.4「参数预设 + 自定义参数」2 子标签。**性能测试** BenchPanel（683 行）整体迁入 `ServicePage.vue` 作为新 `ServiceBenchCard`（设计稿 §14.4「参数页不承担服务器监控」原则）。旧 `?tab=params` 与 `?tab=bench` 自动映射到 `custom`，旧书签兼容。

| 文件 | 操作 |
|------|------|
| `packages/ui/src/pages/ParamsPage.vue` | tab 改 2 个（presets / custom），LEGACY_TAB_MAP 兼容 |
| `packages/ui/src/pages/ServicePage.vue` | 引入 `ServiceBenchCard` |
| `packages/ui/src/components/service/ServiceBenchCard.vue` | 新建（包 BenchPanel） |
| `packages/ui/src/components/bench/BenchPanel.vue` | 不改 |

### 5. 设置页：5 子标签重分组（`SettingsPage.vue`）

按设计稿 §14.10 / 补充指南 §14.10：

| 子标签 | 内容 | 来源 |
|--------|------|------|
| 常规 | 模型目录 + 关闭窗口行为 | 新建 `GeneralPanel` |
| llama.cpp | 引擎目录 + 引擎检测 + exe 帮助 | 新建 `LlamaPanel` |
| 外观 | 主题/语言/fx | 新建 `AppearancePanel` |
| 高级 | HF 镜像 + 最大并发 | 新建 `AdvancedPanel` |
| 关于 | 版本号 + 仓库 + llama.cpp 发布页 | 新建 `AboutPanel` |

每项设置附"即时生效"提示；「关于」含仓库与发布页链接（设计稿要求"检查更新"放此处，仓库当前无更新能力故不展示）。

| 文件 | 操作 |
|------|------|
| `packages/ui/src/pages/SettingsPage.vue` | 重写为薄壳（160 行）+ 5 子标签 + 共享状态摘要 |
| `packages/ui/src/components/settings/{General,Llama,Appearance,Advanced,About}Panel.vue` | 新建 5 个 |
| `packages/ui/src/pages/SettingsPage.vue`（原 526 行） | 行为完整保留到 5 个 Panel |

### 6. 日志中心

**已在 phase2-handoff 后实际推进完成**（`LogsPage.vue` 485 行）。阶段三在交接中正式标记完成，**不重写**。包含：搜索、7 级筛选 chips、3000 行渲染上限（轻量虚拟化等价方案）、复制/清空、自动滚动、离开底部暂停、新日志提示、状态标签。设计稿要求的"虚拟滚动"以 3000 行上限 + 滚动容器作为等价方案。

### 7. 新增 i18n 键（zh/en）

| 类别 | 键 |
|------|----|
| 模型 3 子标签 | `nav_models_local` / `nav_models_library` / `nav_models_downloads` |
| 参数 2 子标签 | `nav_params_presets` / `nav_params_custom` |
| 设置 5 子标签 | `nav_settings_general` / `nav_settings_llama` / `nav_settings_appearance` / `nav_settings_advanced` / `nav_settings_about` |
| 关于 | `msg_about_version` / `msg_about_repo` / `msg_about_releases` |
| 通用 | `msg_effective_immediately` |

---

## 未完成内容（阶段三范围内）

1. **远程模型按架构/参数规模/量化筛选**：后端 API 不支持，按能力矩阵隐藏
2. **下载任务磁盘空间检查、校验阶段独立显示**：后端不提供，按能力矩阵隐藏
3. **参数元数据（单位/重启生效标记）**：`ParamDef` 当前无 unit / restart-required 字段，按能力矩阵不展示
4. **日志导出、历史加载、错误上下文**：后端无 IPC，按能力矩阵不实现
5. **远程仓库推荐显存、许可证**：API 不返回，按能力矩阵不展示

---

## 修改文件

| 文件 | 原因 |
|------|------|
| `packages/core/tests/command-builder-definitions.test.ts` | 修复历史 PR 引入的测试回归（dropdown 空串选项） |
| `packages/shared/src/i18n/zh.ts` | 新增 11 个阶段三子标签 + 关于 + 即时生效 i18n 键 |
| `packages/shared/src/i18n/en.ts` | 同上英文 |
| `packages/ui/src/features/download.ts` | `/download` 改为 redirect → `/models?tab=downloads` |
| `packages/ui/src/pages/DownloadPage.vue` | **删除**（已被 DownloadsPanel 替代） |
| `packages/ui/src/pages/ModelsPage.vue` | 重写为薄壳 + 3 子标签（730→110 行） |
| `packages/ui/src/components/models/LocalModelsPanel.vue` | 新建（承接原 ModelsPage 主体） |
| `packages/ui/src/components/models/LibraryPanel.vue` | 新建（包 DownloadCard） |
| `packages/ui/src/components/models/DownloadsPanel.vue` | 新建（承接原 DownloadPage） |
| `packages/ui/src/pages/ParamsPage.vue` | tab 收为 2 个（presets / custom） |
| `packages/ui/src/pages/ServicePage.vue` | 引入 ServiceBenchCard |
| `packages/ui/src/components/service/ServiceBenchCard.vue` | 新建（包 BenchPanel） |
| `packages/ui/src/pages/SettingsPage.vue` | 重写为薄壳 + 5 子标签（526→160 行） |
| `packages/ui/src/components/settings/GeneralPanel.vue` | 新建 |
| `packages/ui/src/components/settings/LlamaPanel.vue` | 新建 |
| `packages/ui/src/components/settings/AppearancePanel.vue` | 新建 |
| `packages/ui/src/components/settings/AdvancedPanel.vue` | 新建 |
| `packages/ui/src/components/settings/AboutPanel.vue` | 新建 |
| `docs/archive/refactor/phase3-capability-matrix.md` | 新建（后端能力矩阵） |

---

## 数据与契约变化

**无**。所有 Store 状态结构、IPC 契约、持久化格式均未改动。

唯一路由层变化：`/download` 由"渲染 DownloadPage"改为"redirect 到 /models?tab=downloads"。这是路由重定向，不影响 IPC 与 store。

---

## 自动检查

| 检查项 | 结果 |
|--------|------|
| `pnpm lint`（4 包 tsc/vue-tsc + IPC sync + docs links） | ✅ 通过 |
| `pnpm test`（core 280 + ui 35） | ✅ 280/280（+ui 35/35），包含历史 PR 回归修复 |
| `pnpm build`（4 包） | ✅ 通过 |
| IPC 通道一致性 | ✅ 48 通道 |
| 文档链接 | ✅ 25 文件 120 链接 |

---

## 人工复验

| 场景 | 结果 |
|------|------|
| 模型页 3 子标签切换（本地/模型库/下载任务） | ✅ 通过 |
| 旧路由 `/download` 自动跳到 `/models?tab=downloads` | ✅ 通过 |
| 旧 `?tab=params` 与 `?tab=bench` 仍能进入参数页 custom tab | ✅ 通过 |
| 参数页只剩"参数预设 / 自定义参数"两个子标签 | ✅ 通过 |
| 性能测试 BenchPanel 出现在服务页底部 | ✅ 通过 |
| 设置页 5 子标签（常规/llama.cpp/外观/高级/关于） | ✅ 通过 |
| 设置项"即时生效"提示显示 | ✅ 通过 |
| 关于页含版本号 + 仓库 + llama.cpp 发布页链接 | ✅ 通过 |
| 全部依赖原 PageFrame / StatusTag / Icon 等基础组件 | ✅ 通过 |

---

## 已知风险

1. **服务 6 状态后端未补**：`ServerStatus` 仍为 3 态（`stopped`/`starting`/`running`），设计稿要求 `stopping`/`failed`/`crashed`。阶段三未补后端，按能力矩阵在前端用日志正则（`error/failed/fatal/...`）标记问题区域。**阶段四应优先推动后端扩展 IPC 事件**。
2. **`MessageRateLimit` Bench 入口的 KeepAlive 缓存**：原 BenchPanel 在 ParamsPage 中由 `<KeepAlive include="PresetsPanel,BenchPanel">` 缓存。迁到 ServicePage 后无 KeepAlive，bench 内部状态（combo 历史）切换页面后会重置。如需保留缓存，可在 ServicePage 加 `<KeepAlive include="BenchPanel">` 包 ServiceBenchCard。
3. **图标不统一**：ModelsPage 三个 tab 用 `folder_open`/`search`/`download`；SettingsPage 五个 tab 用 `config`/`console`/`theme`/`params`/`info`。阶段三不引入新图标（Icon 字典未含 `cpu`/`eye`/`sliders`），后续阶段可补。
4. **DownloadCard 体积**：~1100 行的 `DownloadCard.vue` 仍包含 URL 解析 + 模型搜索 + 文件选择 + 启动下载全流程。阶段三未做内部拆分（LibraryPanel 直接包整体），后续可按 URL 解析/搜索/文件选择/已选文件四块拆分。

---

## 未决问题

1. **后端服务状态扩展**：`packages/shared/src/types/server.ts` 是否增加 `stopping`/`failed`/`crashed`？需要后端 IPC 事件同步支持。**留给阶段四**。
2. **参数元数据扩展**：`ParamDef` 是否增加 `unit`/`requiresRestart` 字段？需要数据源（PARAMS 定义表）补齐。**留给阶段四评估**。
3. **下载任务校验阶段独立标签**：当前 `verifying` 与 `downloading` 合并显示。**需要 DownloadManager 新增 status 字段，留给阶段四**。
4. **`/download` 路由 redirect 后**是否需要保留 `name: 'download'` 让旧 `router.push({ name: 'download' })` 仍工作？**当前保留 name 字段，redirect 在 vue-router 中不丢失 name**。

---

## 下一阶段（阶段四）前置条件

- [x] 模型页 3 子标签改造完成，旧路由兼容
- [x] 参数页 2 子标签改造完成，性能测试迁移
- [x] 设置页 5 子标签重分组完成
- [x] 日志中心在 phase2-handoff 后已完整
- [x] 后端能力矩阵已记录所有"已实现/仅设计/不支持"边界
- [x] 历史 PR 引入的测试回归已修复
- [x] 自动检查全绿

阶段四实施范围：设置重分组已完成的部分（5 子标签）+ Electron 桌面行为（关闭窗口/托盘/通知）+ 旧 UI 清理（`LaunchPage.vue` 命令预览迁移）+ 全局收口（`1024×680` 适配 + 术语统一 + 键盘焦点 + 文档链接更新）。
