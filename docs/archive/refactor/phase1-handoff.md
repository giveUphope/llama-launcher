# 阶段一交接记录：审计、冻结边界与建立 UI 基础层

---

## 阶段状态
完成 ✅

---

## 已完成内容

### 1. 审计报告与页面映射（`docs/archive/refactor/phase1-audit.md`）
- 当前 7 项一级导航 → 设计稿 6 项（概览/模型/服务/参数/日志/设置）的映射
- 10 项业务功能与目标页面的对应关系（含 Web UI、日志中心缺口）
- Store 与 IPC 调用链审计
- 风格差异矩阵（色彩/字体/间距/圆角/装饰效果）

### 2. 设计令牌更新（`packages/ui/src/styles/`）

**色彩（`variables.scss` + `theme.scss`）**：
| 项 | 原值 | 新值 | 来源 |
|----|------|------|------|
| `--accent` 品牌色 | `#4a9eff`（浅蓝） | `#6c50e7`（蓝紫 P500） | 风格指南 §4.2 |
| `--accent-hover` | `#3a8ee5` | `#8068f0`（P400） | 风格指南 §4.2 |
| `--accent-pressed` | `#2e7bd4` | `#4930b8`（P700） | 风格指南 §4.2 |
| `--accent-dim` | `#9dc4f5` | `#b8acff`（P200） | 风格指南 §4.2 |
| 深色 `--bg-app` | `#1e1e1e` | `#080B14`（N950） | 风格指南 §4.1 |
| 深色 `--bg-sidebar` | `#252526` | `#0D111D`（N900） | 风格指南 §4.1 |
| 深色 `--bg-card` | `#2d2d2d` | `#111725`（N850） | 风格指南 §4.1 |
| 深色 `--border` | `#3c3c3c` | `#252D40`（N700） | 风格指南 §4.1 |
| 浅色主题 | 通用灰调 | 冷调蓝灰（`#F1F4F9`/`#111725`） | 与深色主题保持一致 |
| 侧栏玻璃 | `rgba(37,37,37,.72)` | `rgba(13,17,29,.82)` | 冷调深蓝灰 |

**字体（`variables.scss`）**：
- 界面字体：添加 `Inter`、`SF Pro Display` 到栈首
- 等宽字体：添加 `Fira Code`

**间距（`variables.scss`）**：
- 页面 padding：`12/16/14` → `20/24/24`
- 卡片 gap：`10` → `14`
- 卡片内 gap：`8` → `10`

**页面框架（`PageFrame.vue`）**：同步更新默认值。

### 3. 新增基础组件（`packages/ui/src/components/common/`）

| 组件 | 用途 | 覆盖状态 |
|------|------|----------|
| `Progress.vue` | 进度条（download 进度、百分比展示） | 默认/4 色/3 尺寸 |
| `EmptyState.vue` | 空状态（无模型/无日志/无任务） | 图标+标题+描述+操作区 |
| `Drawer.vue` | 右侧抽屉（详情/高级信息/错误详情） | 左右位置/Teleport/Escape 关闭 |
| `StatusTag.vue` | 状态标签（模型/服务/下载状态） | ok/warn/error/idle/loading + 文字+点+图标 |
| `Toast.vue` | 通知条（成功/信息/警告/错误） | 4 类型+自动/暂停计时+关闭 |

**未新建的组件（已有等价实现）**：
- 按钮：`TopBar.vue` 已提供 `btn`/`action-btn`/`mini-btn`/`icon-btn` 等完整类型学
- 输入框/选择器：`ParamRow.vue`/`TextParam.vue`/`DropdownParam.vue` 已有
- 卡片：`Card.vue` 已有
- Tooltip：`ToolTip.vue` 已有
- 对话框：`ConfirmModal.vue` 已有
- 图标按钮：`Icon.vue` + `icon-btn` 已有

### 4. i18n 键新增（`packages/shared/src/i18n/`）
- 模型状态：`model_status_available/missing/broken/checking/incompatible`
- 服务状态：`svc_status_stopped/starting/running/stopping/failed/crashed`
- 下载状态：`dl_status_waiting/downloading/paused/verifying/completed/failed/canceled`
- 空状态：`msg_empty_no_models/no_tasks/no_logs/no_presets`
- 加载/错误：`msg_loading_data`、`msg_error_load_failed`、`msg_error_retry`

---

## 未完成内容（阶段一范围内未实施）

1. **路由重组为 6 项导航**：当前 7 项导航（含 Web UI 独立页）。设计稿要求 6 项。Web UI 是否作为独立一级导航还是移入服务页，需在阶段二/四决定。
2. **日志中心新增**：当前无独立日志页面，阶段三新增。
3. **侧栏导航 icon 更新**：当前图标（`dashboard`/`models`/`download`/`params`/`launch`/`settings`/`webui`）需按新导航重新映射。
4. **设计稿 6 页导航映射实施**：阶段一仅建立映射，未实施路由重组。

---

## 修改文件

| 文件 | 修改原因 |
|------|----------|
| `packages/ui/src/styles/variables.scss` | 更新品牌色/字体/间距令牌 |
| `packages/ui/src/styles/theme.scss` | 深色/浅色主题改为冷调深蓝灰 |
| `packages/ui/src/components/common/PageFrame.vue` | 同步 padding/gap 默认值 |
| `packages/ui/src/components/common/Progress.vue` | 新增进度条组件 |
| `packages/ui/src/components/common/EmptyState.vue` | 新增空状态组件 |
| `packages/ui/src/components/common/Drawer.vue` | 新增右侧抽屉组件 |
| `packages/ui/src/components/common/StatusTag.vue` | 新增状态标签组件 |
| `packages/ui/src/components/common/Toast.vue` | 新增通知条组件 |
| `packages/shared/src/i18n/en.ts` | 新增 24 个通用状态/空状态 i18n 键 |
| `packages/shared/src/i18n/zh.ts` | 新增 24 个中文 i18n 键 |
| `docs/archive/refactor/phase1-audit.md` | 审计报告与页面映射 |

---

## 数据与契约变化

**无**。所有 Store 状态结构、IPC 契约、持久化格式均未改动。

---

## 自动检查

| 检查项 | 结果 |
|--------|------|
| `pnpm --filter @llama-launcher/ui build` | 通过 |
| `pnpm --filter @llama-launcher/shared build` | 通过 |
| `pnpm lint`（vue-tsc + tsc + IPC sync + docs links） | 通过 |
| `pnpm test` | 279/280 通过；1 个 pre-existing 失败（core `chat_template` 缺失，与本阶段无关） |

---

## 人工复验

| 场景 | 结果 |
|------|------|
| 深色主题背景色变冷调深蓝灰（`#080B14`） | 确认：应用背景、卡片、输入框均使用新调色板 |
| 品牌色变为蓝紫（`#6c50e7`） | 确认：焦点环、选中态、accent 按钮使用蓝紫 |
| 侧栏背景色变深蓝（`#0D111D`） | 确认 |
| 页面 padding 增大（`20px 24px 24px`） | 确认：PageFrame 内所有页面受影响 |
| 卡片间 gap 增大（`14px`） | 确认 |
| 玻璃层装饰斑块颜色变冷调 | 确认 |
| 浅色主题使用冷调蓝灰而非纯灰 | 确认 |

---

## 已知风险

1. **胶囊化圆角保留**：设计稿要求小圆角（4–12 px），当前为 999 px 胶囊化。这是 2026-08 用户确认的 UI 重构决策，非本阶段新增风格。
2. **毛玻璃效果保留**：设计稿不使用毛玻璃，当前已有且用户确认。
3. **彩虹点缀保留**：设计稿未使用，当前已有且用户确认。
4. **新 i18n 键未在当前页面使用**：阶段一仅添加键，页面在阶段二/三/四中才引用。当前页面不受影响。

---

## 未决问题

1. **Web UI 是否保留为独立一级导航**？设计稿 6 项导航不含 Web UI。建议移入服务页（作为"打开 Web UI"操作的对应入口），阶段二决定。
2. **日志中心实现方案**：设计稿要求虚拟滚动。当前项目无虚拟滚动库。阶段三需评估是新增 `vue-virtual-scroller` 还是使用 `IntersectionObserver` 自实现。
3. **设置页 5 子标签分组**：当前设置页已有引擎/模型/网络/外观/语言等分组。设计稿要求常规/llama.cpp/外观/高级/关于。阶段四重分组。

---

## 下一阶段（阶段二）前置条件

- [x] 设计令牌已更新为冷调深蓝灰 + 蓝紫品牌色
- [x] 新增基础组件已就位（Progress/EmptyState/Drawer/StatusTag/Toast）
- [x] i18n 状态术语键已准备
- [x] 审计报告与页面映射已完成
- [x] 自动检查全绿（除 pre-existing 失败）

阶段二实施范围：概览页、本地模型页（标签页）、服务页（运行状态 + 服务配置）。
