# 阶段三 后端实际能力矩阵

> 范围：阶段三（模型库/下载任务/参数预设/自定义参数/日志中心）涉及的所有后端真实能力。
> 来源：`packages/core/src/{huggingface-client,modelscope-client,download-manager}.ts`、`packages/shared/src/types/{download,server,params}.ts`、现有 IPC 桥。
> 目的：明确「前端可以展示/触发什么」「哪些 UI 仅作为设计稿占位、不能接通」。

---

## 1. 远程模型（hf-mirror / ModelScope）

| 能力 | 真实支持 | 后端 API | 字段 | UI 可用性 |
|------|----------|----------|------|-----------|
| URL 解析（hf / ms / 直链） | ✅ | `parseUrl` 系列 | `namespace`、`name`、`filePath`（可选） | 可在搜索框直接粘贴 |
| 关键字搜索 | ✅ | `searchModels(query)` | 返回模型列表（含 size/downloads/lastModified） | 阶段三保留 |
| 仓库文件列表 | ✅ | `listRepoFiles` / `listModelFiles` | 完整文件名列表（不做 GGUF/分片/量化筛选） | 阶段三保留 |
| 文件分类（GGUF/分片/伴随） | ✅ | `categorizeFile` | `FileCategory` 枚举 | 阶段三可按类别筛选展示 |
| 文件量化信息 | ✅ | `parseQuantization` | `QuantizationInfo` | 阶段三可显示量化标签 |
| 推荐文件 | ✅ | `recommendFileName` | 单一文件名 | 阶段三可一键选择 |
| 远程仓库筛选维度 | ⚠️ 有限 | 仅 `query` 字符串 | 不支持按「架构/参数规模/量化」维度 API 过滤 | **前端不展示无意义筛选** |
| 远程仓库按架构筛选 | ❌ | 无 | — | 隐藏 |
| 远程仓库按参数规模筛选 | ❌ | 无 | — | 隐藏 |
| 远程仓库分页 | ✅ | 返回分页/滚动 | — | 阶段三可加分页或滚动加载 |
| 多文件选择 | ✅ | `MultiFileSelector` 风格 | 多个文件 | 阶段三支持 |
| 远程仓库的「许可证」/「推荐显存」 | ❌ | API 不返回 | — | 隐藏，不伪造 |
| 直链下载（非 hf/ms 平台） | ✅ | `buildDownloadUrl` + URL 直传 | — | 保留 |

**结论**：模型库采用「URL 解析 + 关键字搜索 + 文件列表 + 推荐」四级结构，**不展示**「按架构/参数规模筛选」「推荐显存」「许可证」等无数据源字段。

---

## 2. 下载任务

| 能力 | 真实支持 | 后端 | 字段 | UI 状态 |
|------|----------|------|------|---------|
| 创建任务 | ✅ | `download:start` | `DownloadTask` | `queued` |
| 暂停任务 | ✅ | `download:pause` | 同一 task | `paused` |
| 恢复任务 | ✅ | `download:resume` | 同一 task | `downloading` |
| 取消任务 | ✅ | `download:cancel` | 同一 task | `canceled` |
| 进度推送 | ✅ | `download:onProgress` | `progress`/`speed`/`downloaded` | 进度条 + 速度 |
| 错误事件 | ✅ | `download:onError` | `errorType` | 红色错误标签 + 重试 |
| 完成事件 | ✅ | `download:onComplete` | `localPath` | 绿色 + 进入本地模型按钮 |
| 校验阶段 | ⚠️ 部分 | `.llama_dl.jsonl` 段日志 + 自动 rename `<file>.part → <file>` | 状态字段不区分 `verifying`，与 `downloading` 同标签 | 阶段三前端**不**显示「校验中」独立标签，与 downloading 合并 |
| 任务列表 | ✅ | `getAllTasks` | `DownloadTask[]` | 表格 |
| 目标目录 | ✅ | `DownloadTask.targetDir` | 字符串 | 阶段三显示 |
| 磁盘空间检查 | ❌ | 无 | — | **不展示** |
| 同时下载并发 | ✅ | `download_max_concurrent`（settings） | 数字 1-5 | 阶段三显示当前值 |
| 一键全部暂停 | ⚠️ | `pauseAll` 存在 | — | 阶段三保留（按现有 store 行为） |
| 一键清除已完成 | ✅ | `clearFinished` | — | 阶段三保留 |

**结论**：下载任务状态展示 `queued`/`downloading`/`paused`/`completed`/`error`/`canceled` 6 态，**不展示**未实现的「磁盘空间」「独立校验阶段」。

---

## 3. 参数

| 能力 | 真实支持 | 后端 | 字段 | UI 可用性 |
|------|----------|------|------|-----------|
| 参数定义 | ✅ | `packages/shared/src/params/definitions.ts` | 49 个 `ParamDef` | 唯一事实源 |
| 默认值 | ✅ | `p.default` | — | UI 显示 |
| 范围（min/max） | ✅ | `p.min`/`p.max` | 仅 int_*/float_* | 滑块约束 |
| 单位 | ⚠️ 部分 | `p.unit` 字段（如存在） | 字符串 | 仅在定义有 unit 时展示 |
| 步长 | ✅ | `p.step` | float_slider | 滑块步进 |
| 依赖关系 | ✅ | `p.dependsOn` | 联动 | UI 联动启用/禁用 |
| 隐藏条件 | ✅ | `p.hideWhen` | — | 联动隐藏 |
| 重启生效标记 | ❌ | 无 | — | 阶段三**不**显示「需重启」徽标（按提示词 §5.4：不假设） |
| 预设（保存/加载/删除） | ✅ | `presets:save/load/list/delete` | 路径 `<models_dir>/presets/*.json` | 阶段三 |
| 系统内置预设 | ⚠️ | 取决于当前内置列表 | — | 阶段三禁止删除（提示词要求） |
| 预设正在被使用 | ⚠️ | Store 记录 currentPreset | — | 阶段三显示「使用中」 |
| 校验 | ⚠️ 部分 | 范围/依赖 | — | 阶段三提交前显示 |
| 应用到运行实例 | ⚠️ | `useStartServer` 重启生效 | — | 阶段三明确「修改后保存，重启后生效」 |

**结论**：参数页按 6 组（常用/采样/上下文与缓存/性能/GPU 与设备/高级）分组，**高级默认折叠**；只展示定义表内已声明的元数据，不伪造。

---

## 4. 日志

| 能力 | 真实支持 | 后端 | 字段 | UI 可用性 |
|------|----------|------|------|-----------|
| 实时输出推送 | ✅ | `server:onOutput` | `OutputEntry { ts, kind, data }` | 现有 `LogsPage.vue` |
| 级别分类 | ✅ | `OutputKind` 枚举 | `stdout/stderr/info/success/warn/error` | 现有筛选 |
| 文本搜索 | ✅ | 前端 `String.includes` | — | 现有 |
| 自动滚动 | ✅ | 前端 `scrollTop` | — | 现有 |
| 离开底部暂停 | ✅ | 前端距离判定 | — | 现有 |
| 新日志提示 | ✅ | 前端 badge | — | 现有 |
| 复制 | ✅ | `clipboard.write` | — | 现有 |
| 导出 | ❌ | 无 IPC | — | 阶段三**不**做 |
| 历史加载 | ❌ | 无分页/时间范围 IPC | — | 阶段三**不**做 |
| 错误上下文（前后 N 行） | ❌ | 无结构化日志 | — | 阶段三**不**做 |
| 虚拟滚动 | ⚠️ 3000 行渲染上限 | 前端 | — | 等价于「高性能」 |

**结论**：日志中心**已完整**（`LogsPage.vue` 485 行），阶段三仅需在交接中正式标记完成，**不重写**。

---

## 5. 服务状态（已记录缺口，阶段三不补）

- 设计稿：6 态（`stopped`/`starting`/`running`/`stopping`/`failed`/`crashed`）。
- 后端实际：`packages/shared/src/types/server.ts` 仅 `'stopped' | 'starting' | 'running'`。
- 阶段三**不**新增后端状态；前端仅展示实际状态 + 用日志正则（`error/failed/fatal/...`）标记问题区域。

---

## 6. 设计稿可对照表（阶段三范围内）

| 设计稿要求 | 后端能力 | 阶段三处理 |
|-----------|----------|------------|
| 模型库先选模型再选文件 | ✅ | 沿用「URL/搜索 → 仓库详情 → 文件选择」两级 |
| 暂停/恢复/取消按真实状态 | ✅ | 6 态按钮按 IPC 实际能力 |
| 校验阶段独立显示 | ⚠️ | 不单独展示，与 downloading 合并 |
| 目标目录 + 磁盘空间 | 部分 | 显示目标目录，**不**做磁盘空间检查 |
| 远程按架构/参数规模筛选 | ❌ | 隐藏 |
| 远程显示推荐显存/许可证 | ❌ | 隐藏 |
| 参数元数据完整 | 部分 | 只展示定义表内已声明字段；无 unit/restart 字段 |
| 滑块 + 精确输入 | ✅ | 已有 `IntEntryParam`/`SliderParam` |
| 日志虚拟滚动 | ⚠️ | 3000 行渲染上限作为等价方案 |
| 日志筛选/搜索/复制 | ✅ | 已实现 |
| 日志导出 | ❌ | 阶段三不实现，缺口记录 |
