# 前端架构

> 范围：前端架构：路由、Pinia stores、页面、通用组件；§7.5 为 UI 风格规范（唯一权威来源）。
> 索引：[README.md](../README.md) · 相关：[ipc-channels.md](ipc-channels.md) · [params-system.md](params-system.md) · [style/STYLE_TODO.md](style/STYLE_TODO.md)

### 7.1 路由与功能注册表 (router/index.ts + features/)

路由由**功能注册表**装配：`packages/ui/src/features/` 中每个功能模块声明 `FeatureDef`（`nav` 侧栏导航 + `routes`），`features/index.ts` 汇总为 `navItems`（侧栏渲染）与 `featureRoutes`（路由装配）；`router/index.ts` 仅 `createWebHashHistory` + `featureRoutes`。新增功能 = 注册表加一个条目；`enabled:false` 可停用；`order` 决定侧栏排序；参数页橙点经 `nav.dot()` 在渲染上下文求值保持响应式。**侧栏子树已移除**（2026-09：`children[]`/展开机制随参数设置回归单页删除）——次级页面统一回归**页内 tab-strip 切换**（参数设置两页签与设置页同一体例，`query.tab` 可深链）；调整提示橙点以**图标右上角标**呈现（侧栏收起态，不被 56px 导轨 overflow 裁切），全部导航按钮带 `title`/`aria-label`。**启动顺序**（main.ts）：`settings.load()` 与 `last_tab` 页签恢复在 `app.mount()` **之前**完成——首帧即为目标页签，启动期不存在第二次导航（挂载后的恢复重定向会在首屏中途注入导航，表现为路由已切换而视图停留在旧页）；设置加载带 **3s 超时兜底**（`Promise.race`，加载异常时按当前 URL 直接进入，不阻塞启动）。**页面切换**（PageHost）为**结构化直接替换**：`keep-alive` 直接替换激活组件（结构上不存在双页同框窗口），路由 `watch` 后对内容区做 90ms 容器淡入（WAAPI，opacity 0.55→1，`prefers-reduced-motion` 跳过）；**不用 `<transition>`**——KeepAlive 失活移除时序下 JS 钩子 `done()`/`transitionend` 可能永不触发，快速导航时出现短暂双页同框（旧方案已废弃，见 STYLE_TODO #40）。**浏览器预览**（无 Electron preload 的环境）：`main.ts` 注入 `dev/demo-mock.ts` 的 `createDemoApi()` 演示数据，其中 `buildDemoPreviewCommand` 按 core `buildCommand` 同规则动态构建命令预览。

`createWebHashHistory`，共 15 条路由（7 个功能页 + 1 条根重定向 + 7 条旧路由重定向）：

| 路径 | 说明 |
|------|------|
| `/` | 重定向到 `/dashboard` |
| `/dashboard` | 概览（服务状态卡 + 最近问题） |
| `/models` | 模型管理（2 子标签：本地模型 / 模型库；模型库内含下载任务区） |
| `/service` | 服务（命令预览 + 参数摘要 + 配置清理 + 控制台） |
| `/params` | 参数设置（页内 tab-strip 两页签：参数预设 / 自定义参数，与设置页同一体例，`query.tab` 可深链；无 query 进入默认落在首个页签「参数预设」并归一化 URL） |
| `/logs` | 应用日志中心 |
| `/settings` | 应用设置（4 子标签：常规 / 外观 / 高级 / 关于） |
| `/webui` | 内置 Web UI（侧栏一级项；服务运行时 iframe 直接展示 llama-server Web UI，替代跳转外部浏览器） |
| `/download` | 重定向到 `/models?tab=library`（旧书签兼容） |
| `/launch` | 重定向到 `/service`（旧书签兼容） |
| `/basic` | 重定向到 `/params` |
| `/advanced` | 重定向到 `/params` |
| `/sampling` | 重定向到 `/params` |
| `/server` | 重定向到 `/params` |
| `/presets` | 重定向到 `/params?tab=presets` |

### 7.2 Stores (6 个 Pinia store)

| Store | 职责 |
|-------|------|
| `settings.ts` | 加载/保存设置（200ms 防抖 + `flushSave` 强制落盘）、切换主题（`data-theme`，含 `system` 跟随 `prefers-color-scheme`）、切换语言 |
| `i18n.ts` | 以 `settings.language` 为数据源，`watchEffect` 同步 |
| `params.ts` | **双轨参数逻辑**：`values` 值表 + `baseline`（`SessionBaseline { preset_name, values }`）——临时轨道经 `persistSession` 将 `session_values`/`session_baseline` 节流写入 settings.json（autoSave watch 800ms 节流，**永不写预设文件**），启动经 `restoreSession` 恢复；预设轨道仅显式保存写入。`hasChanges` 有基线时逐键对比基线快照（无基线对比出厂默认）；`markBaseline`/`restoreBaseline`/`clearSession` 管理会话；换模型/应用 GGUF 建议（`applyModel`/`applyModelWithSuggestions`）前 `confirmDiscardDirty` 防丢确认，启动重挂模型走 `reattachModelRuntime`（不确认、不动基线）；`set(MODEL_KEY)` 自动派生 `alias`（`modelBaseName`）；依赖联动清理（`syncDependencies`）+ 草稿模型自动检测 |
| `server.ts` | 状态/pid/host/port/url、`apiUrl`（**API 地址唯一来源**，见 §7.5.7）、`runningValues`（最近启动参数快照）、输出数组（上限 5000） |
| `download.ts` | 任务列表、IPC 监听注册（`ensureSubscribed` 仅注册一次） |
| `appLog.ts` | 应用日志缓冲（消费 `logs:*` IPC 推送，供日志中心页渲染） |

### 7.3 页面 (7 个，侧栏 7 项一级导航)

| 页面 | 功能 |
|------|------|
| `DashboardPage` | 概览：服务状态卡（`ServiceStatusCard`，自服务页迁入——状态/当前模型/API 地址/主机/端口/PID/运行时长，服务状态的唯一页面级展示区）+ 最近问题（应用日志 warn/error 最近 3 条，`.q-section` 分区分隔） |
| `ModelsPage` | 2 子标签：本地模型（`LocalModelsPanel`）/ 模型库（`LibraryPanel`，DownloadCard library 模式，内置下载任务区） |
| `ServicePage` | 命令预览（`CommandPreviewCard`：**双文本框**——「内置参数命令」**只读**展示、随参数实时自动生成（改内置参数走参数设置页控件，无编辑/还原逻辑）；「扩展参数」为唯一可编辑区，绑定 `settings.custom_args` 持久化、原样追加到启动命令末尾；复制 = 内置+扩展合并）、参数摘要（`ParamSummaryCard`）、配置目录清理（`TrashCleanCard`）、控制台输出（上限 5000 行；运行状态卡已迁至概览，本页不再重复展示状态/模型/API 地址） |
| `ParamsPage` | 页内 tab-strip 两页签（与设置页统一）：参数预设（`PresetsPanel`）/ 自定义参数（13 个子分类分区，`param-grid` `repeat(auto-fit, minmax(340px, 1fr))` 响应式网格）；60 参数经 `ParamRow` + 6 类控件渲染（值 ≠ 默认时行 `--warn` 橙描边提示，依赖未满足行加底色与警示图标）；自定义页签状态条含**硬件占用估算 stat**（`useVramEstimate`：显存占用百分比 + 构成明细 tooltip，超限橙色警示）与**性能目标选择器**（四档联动建议差集 chips + 一键应用）；恢复基线/清除会话入口（无基线徽章，与「已调整」统计去重） |
| `LogsPage` | 应用日志中心：级别筛选 chips、搜索、控制台渲染上限 3000 行、自动滚动 |
| `SettingsPage` | 4 子标签：常规（`GeneralPanel`，引擎/模型目录内联检测）/ 外观（`AppearancePanel`）/ 高级（`AdvancedPanel`）/ 关于（`AboutPanel`）；原 llama.cpp 标签已并入常规；全部即时保存；顶部状态摘要（即时保存提示 + 模型目录/引擎文件状态）**整体仅常规页签展示**，版本提示已移除（「关于」页签与侧边栏页脚已展示；idle「未设置」与 missing「路径不存在」文案分离，不再自相矛盾） |
| `WebUiPage` | 内置 Web UI 路由占位（侧栏一级项「内置 Web UI」）；实际渲染由布局层 `WebUiFrame`（iframe 常驻文档，`v-show` 切换显隐，切页不重载）承担：服务运行时展示 llama-server Web UI，未运行时显示占位提示 |

### 7.4 通用组件

| 组件 | 用途 |
|------|------|
| `PageFrame` | 基于 Arco `LayoutContent` 的统一页面容器 |
| `Card` | 基于 Arco `Card` 的标题、内容与 actions 容器 |
| `Icon` | Arco 图标适配器，维持业务图标名称映射 |
| `ToolTip` | Arco `Tooltip` 适配器 |
| `NavButton` | 侧边栏导航按钮（一级项，激活 = path 命中；支持收起态图标形态与调整橙点角标） |
| `StatusTag` | 状态标签（状态点 + 文字，ok/warn/error/idle/loading 变体） |
| `ServiceStatusCard` | 服务状态卡（概览页，页面级唯一展示区）：状态标签 / 当前模型 / API 地址（boxed InfoStrip + 复制按钮）/ 主机·端口·PID·运行时长网格 / 失败 banner（防跳动槽位）/ 快捷操作（打开 Web UI·管理模型） |
| `AppLogo` | 应用 Logo 统一组件（见 §7.5.7） |
| `InfoStrip` | 信息行（label + 值/插槽控件；设置页表单行、Dashboard/Service 信息网格共用） |
| `ModelMetaCard` | 模型元数据展示（A 类识别摘要 + B/D 类详情**常驻完整展示**，dashed 次级分隔；无收起/展开开关） |
| `DownloadCard` | 下载功能卡片（`mode: 'library' \| 'tasks'` 双模式：URL 解析/搜索/文件选择/任务列表；推荐文件只作徽标/高亮/排序提示、**不自动勾选**，下载由用户主动勾选触发；提交下载走 `enqueueFiles`：Store 去重 + 本地同名检测 + 后端 ID 回填；URL 会话历史存 `useUrlHistory` 模块级单例，跨子标签 `v-if` 重建保留） |
| `ConfirmModal` / `CloseDialog` | 通用确认弹窗 / 退出确认弹窗（`useConfirm` 队列驱动） |
| `FileBrowserModal` | 文件/目录浏览弹窗（`useFilePicker` 队列驱动，dir/file/save 三模式） |
| `PresetsPanel` | 预设管理面板（低摩擦）：智能命名（alias→模型文件名自动同步输入框）+ **自适应保存按钮**（输入名已存在时自动变「覆盖预设」，同一入口完成保存/覆盖）；行内操作（应用/删除 `mini-btn`，删除带确认）+ **双击行直接应用**；列表 `onActivated` 与增删改后自动刷新（无手动刷新按钮）；保留名称↔绑定模型一致性确认（防「应用其他预设切换模型后沿用旧名保存」的错绑） |
| `ParamRow` + 控件 | 参数行容器 + `TextParam`/`IntEntryParam`/`SliderParam`/`CheckboxParam`/`DropdownParam`/`FileParam` 六类控件 |

### 7.5 样式系统（Arco Design Vue）

> `@arco-design/web-vue` 是 UI 的唯一组件与设计 Token 基础。主题由 `stores/settings.ts` 同时写入 `html[data-theme]` 与 `body[arco-theme]`；旧 `--*` 变量仅作为尚未迁移的业务组件兼容层，禁止在新增 UI 中使用。
>
> 新增 UI 必须优先使用 Arco 的 `Button`、`Form`、`Input`、`Select`、`Modal`、`Table`、`Tooltip`、`Tag` 等组件及其 CSS Variables。玻璃拟态、手写按钮体系和自定义浮层已停止加载；以下旧规范仅供剩余业务组件迁移期间参考。

#### 7.5.1 设计 Token（`packages/ui/src/styles/`）

> 2026-09 完全迁移后的现状：`theme.scss` 仅保留 **Electron 布局尺寸、业务语义色与迁移兼容层**，其余一律直接引用 Arco 的 CSS Variables（`--color-text-*` / `--color-fill-*` / `--color-bg-*` / `--color-border-*` / `rgb(var(--primary-6))` / `rgb(var(--success-6))` 等）。旧业务色板（`--accent`、`--bg-*`、`--fg-*`、`--shadow-modal/tooltip`、`--overlay` 等）已全部删除，禁止再引用。

- **强调色**：即 Arco 主色 `rgb(var(--primary-6))`（纯蓝）。交互强调（描边按钮、聚焦边框、选中行、激活 tab）一律用它；hover/选中态用 Arco 组件自带态或 `--color-fill-3`。
- **业务色 token**（`theme.scss`，不随主题切换）：`--btn-h`(30) / `--fs-appname`(16) / `--statusbar-blue`(#007acc) / `--badge-cat-*`、`--badge-quant-*`、`--badge-src-*`（下载分类/量化/来源徽章色板）/ `--console-bg`(#1d2129)、`--console-fg`(#e5e6eb)（控制台/命令预览恒定深底，双主题不变）/ `--primary-fg`(#fff，实底主色上的文字)。`--bg-active` 按主题定义（选中行高亮：浅 #e8f2ff / 深 #094771）。
- **兼容层映射**（迁移完成前）：`--radius-pill/row/control: 4px`、`--fs-xs/sm: 12px`、`--fs-base: 13px`、`--fs-md/lg: 14px`、`--glass-bg*: var(--color-bg-2/3)`、`--glass-blur: 0px`、`--ease-smooth/jelly: ease`、`--dur-fast/med: 0.16s/0.2s`、`--shadow-dropdown: 0 4px 12px rgb(0 0 0 / 12%)`。业务组件只允许消费这些名字或直接用 Arco 变量；新代码优先直接用 Arco 变量。
- **字体**：正文走 Arco 默认栈；`--font-mono` = `'Cascadia Code', 'Cascadia Mono', Consolas, monospace`，数值/路径/命令一律 mono。
- **字号**（语义化，禁止裸 px）：`--fs-xs`(12 徽章/辅助) / `--fs-sm`(12 次要提示/状态栏/chip) / `--fs-base`(13 正文/输入/控制台) / `--fs-md`(14 按钮/列表项) / `--fs-lg`(14 卡片标题/参数名) / `--fs-appname`(16 应用名)。
- **布局度量**：`--topbar-h`(52) / `--sidebar-w`(224) / `--sidebar-w-collapsed`(64) / `--statusbar-h`(28) / `--btn-h`(30)。
- **浮层**：阴影/遮罩走 Arco 组件默认（弹层/下拉自带实底 + 阴影）；业务兼容层仅保留 `--shadow-dropdown`（GeneralPanel 帮助面板等自建浮层用）。
- **硬编码禁令**：组件内禁止裸色值/裸字号/裸间距/裸阴影/裸数值圆角；颜色与阴影必须用 `var(--*)`；`#fff` 仅允许作为实底主色（primary/语义色）上的文字色。

#### 7.5.2 主题

- 主题双写：`stores/settings.ts` 的 `applyTheme` 同时设置 `html[data-theme="dark|light"]`（默认 dark）与 `body[arco-theme]`；自定义 token 按 `data-theme` 切换，Arco 组件按 `arco-theme` 自动切换。
- **基调（2026-09 扁平化后）**：背景一律 Arco 面色——`body { background: var(--color-bg-1) }`，表面/输入/浮层用 `--color-bg-2/3`、`--color-fill-2/3`；文字用 `--color-text-1/2/3`。旧蓝白渐变（`--bg-app-gradient`/`--bg-grad-*`）与玻璃层（`.glass-layer`、`--glass-blur`）已随完全迁移移除。
- **对比度**：文字对比度按 Arco 默认令牌体系（双主题 AA）；业务例外仅控制台/命令预览（恒定深底 `--console-bg` + `--console-fg`）。**文字不用 `opacity` 削弱**。

#### 7.5.3 圆角体系（2026-09 扁平化：全站 4px 对齐 Arco）

- 圆角 token 已扁平化为单一值：`--radius-pill` / `--radius-row` / `--radius-control` 均为 **4px**（迁移兼容层，等同 Arco 默认圆角）。组件内禁止裸数值圆角。
- 组件圆角直接走 Arco 组件默认（输入框/选择器 2px、标签/chip 4px、按钮 4px 等），不要为「恢复旧观感」写覆盖。
- **例外（仅两项）**：`2px` 滑块轨道；`50%` 圆形（状态圆点、开关 knob、滑块 thumb、circle 图标按钮）。
- **边界**：多行文本容器（命令预览 `a-textarea` 等）圆角用 `--radius-row`（4px），禁用胶囊形；粘性表头用不透明背景（`--color-bg-2`）。

#### 7.5.4 间距规范

- **页面**：`padding: 20px 24px 24px`（`PageFrame` 引用 `variables.scss` `$layout-page-padding`）；**分区风格**——`page-frame` / 各页 `.tab-content` 纵向 `gap: 0`，相邻内容区块由实线分隔（Card 底边线、Dashboard `.q-section + .q-section` 顶边线）；区块内元素间距 `gap: 10px` 为默认。
- **间距刻度**（组件内 gap 只允许以下刻度，全库逐项审计一致、无离群值——计数以 `pnpm style:audit` 第 4 条为准，勿在文档写死；**不设 1/2/3px 微间距档**，像素级收紧的紧凑原子内间距也一律取最小刻度 4px）：
  | 刻度 | 语义用途 |
  |---|---|
  | `4px` | 紧凑列表（文件列表项）、状态点与文本 |
  | `5px` | chip 内文本-计数徽章 |
  | `6px` | 卡片头操作/密集按钮组（cat-filter、tasks-actions） |
  | `8px` | **按钮组标准间距**（页面工具栏、行内操作区，§7.5.5） |
  | `10px` | 弹窗按钮组、状态栏元素、卡片内次级组 |
  | `12px` | 大分组（下载任务统计、Dashboard 统计组） |
  | `14px` | 分区体底距与分隔线到内容距离（Card 体 `padding: 10px 0 14px`、顶边分隔线 `padding-top: 14px`） |
- **顶栏条与相邻区块间距**（2026-08-29 统一）：页面顶部的条形容器（tab-strip、status-summary、toolbar、params-status-bar、status-bar、stats-row）与上一/下一区块的间距**一律 8px**——models 由 `.tab-content { margin-top: 8px }`、settings 由 `.status-summary { margin: 8px 0 0 }`（内容间距由 `.tab-content` margin-top 提供）、logs 由 `.toolbar { margin-bottom: 8px }`、params/downloads 由状态条 `margin-bottom: 8px` 提供。
- **分隔线节奏**（分区风格实线分隔，2026-08-29 统一；**线两侧均 14px**）：① **主分隔**（`1px solid var(--border)`，内容区块之间）——Card 底边机制（体 `10px 0 14px`，线下由下一区块 header 的固定高自然留白）；顶边线变体（Dashboard `.q-section + .q-section`、DownloadCard `.tasks-section`）`padding-top: 14px`，**线上方**同样 14px——Dashboard 由 `.q-section { padding-bottom: 14px }` 提供，DownloadCard 由容器 flex gap 8px + `.tasks-section:not(:first-child) { margin-top: 6px }` 补足（任务模式下为首子块，不加）。② **次级分隔**（`1px dashed var(--border)`，块内详情/次要内容，如 ModelMetaCard `.meta-chips.details`）`padding-top: 8px`，上方由 `.meta-body` gap 8px 提供（8/8 对称）。③ **标题下划线**（组标题 `border-bottom`，如 ParamSummaryCard `.summary-group-title`）`padding-bottom: 4px`。④ **表格行分隔**：单元格 `padding: 6px 8px`（§7.5.4 表格）。弹窗内部分区条（FileBrowserModal 头/底 `12px 14px`、路径/保存行 `8px 14px`）为弹窗专属尺寸，不套用。
- **分区体**：`padding: 10px 0 14px`（左右 0，随页边距对齐）；分区头高 38px，无 accent 竖条（2026-09 移除 compact 变体，全应用统一标准标题体例）。
- **组件 padding 约定**（2026-08-29 统一，见 STYLE_TODO #21）：padding 属控件尺寸而非元素间距，不受 gap 刻度表约束，但同类元素必须同值——① `fs-xs` 彩色小徽章统一 `1px 6px`；② `fs-sm` 交互 chip 统一 `3px 8px`；③ 信息展示胶囊（version-badge / 状态栏 clickable）统一 `2px 10px`；④ 非胶囊的行/条纵向微间距（提示条、分页条、帮助热区、标签下划线间距）一律 ≥4px；⑤ 参数行 `padding: 4px 8px`（§7.5.7）；⑥ 固定高筛选控件：级别筛选用 `a-radio-group type="button" size="small"`、类别筛选用 checkable `a-tag`（Arco 默认即 24px 高 / `0 8px` 内距），不要额外写尺寸覆盖；⑦ 独立居中文本空态（`.empty`）统一 `padding: 20px`——其余空态为不同语义变体、各自内部统一（弹窗 `.fb-empty` `24px 14px`、区块内 `.empty-msg`/`.target-recs-empty` `8px`、大图标 LogsPage `.empty-log` `40px 20px`）。保留的光学对齐例外：Card 标题左缩进 `0 0 0 2px`（uppercase 字面补偿）。
- **按钮组**：`display: flex; gap: 8px`（页面工具栏、行内操作区）；弹窗按钮 `gap: 10px`；卡片头操作 `gap: 6px`。
- **常用控件高度**：一律 Arco 组件默认（`a-button size=small` 28 / 输入 `a-input size=small` 28 / 默认 32；自建浮层内按钮 28–32）；仅 TopBar 主操作与 `--btn-h`(30) 为业务约定；win-btn（窗口控制）46 宽为 Electron 专属例外。
- **表格**：`padding: 6px 8px` 单元格；`thead` sticky + `background: var(--bg-card)`；列固定宽度用 `col-*` class。
- **统一控件宽度**：参数控件 `label-col` `flex: 0 1 110px`（min-width 64px，**右对齐** + `padding-right: 8px`，长标签省略号截断）、num-input 100px、下拉触发器 `dropdown-trigger` 宽 100%（下拉面板 fixed 定位）、gguf-hint `flex: 0 1 auto`（min 44px / max 72px）。**标签等列逻辑（2026-08-29 用户决策，替代 #25 的贴文字方向）**：全部"选项行"（`InfoStrip .info-label`）与参数行同配方——`flex: 0 1 110px`（min-width 64px）+ `text-align: right`，标签占等宽列、内容起点跨行对齐；长标签面板级 `:deep(.info-label)` 覆盖（如 AdvancedPanel 140px）。容器过窄省略号截断。
- **值盒标准（内容文本框统一，2026-08-29，见 STYLE_TODO #37）**：展示类内容值盒统一使用 `InfoStrip` 的 **`boxed` 变体**——高 **26px**、`padding: 0 10px`、`bg-input` + 1px 边框、胶囊圆角、行内 flex 填满（同组行左缘/宽跨行对齐）、内容省略截断。适用：状态卡当前模型/API 地址/运行时详情等。禁止同类内容项回退纯文本或自造异形盒（高度/内距各写一套）。

#### 7.5.5 按钮规范（2026-09 全站 `a-button` 化）

旧自定义按钮体系（`btn`/`action-btn`/`mini-btn`/`tab-btn`/`modal-btn`/`dl-btn`/`fb-btn`）已全部删除，按钮一律使用 `a-button` 并按语义取型：

| 场景 | 用法 |
|---|---|
| 页面/卡片主操作（启动、保存、解析） | `a-button type="primary"`（默认尺寸） |
| 行内次级操作（复制、浏览、打开目录） | `a-button size="small"` |
| 危险操作（停止、清空、删除） | `a-button status="danger"`（实底或 `warning`/`danger` 描边按语义） |
| 表格行内/紧凑位 | `a-button size="mini"` |
| 图标钮（参数还原 ✕ 等控件语义） | `a-button type="text" size="mini" shape="circle"`（豁免「文本内联」规则） |
| 页内页签 | `a-tabs`（勿再用按钮拼装） |

- **描边/状态语义**：操作=primary/accent、危险=danger、警告=warning，均优先 Arco 预设；hover 态交给 Arco，不手写背景色。
- **文本内联**：内容区操作按钮一律图标+文案（`#icon` 插槽 + 文本），禁止纯图标操作按钮；豁免：win-btn 窗口控制、输入框 allow-clear ✕、还原 ✕、导航 chevron——控件/导航/披露语义，非操作按钮。
- **按钮组**：`display: flex; gap: 8px`（页面工具栏、行内操作区）；弹窗按钮组 gap 10px；卡片头操作 gap 6px。

#### 7.5.6 浮层（2026-09 玻璃体系移除）

- 玻璃拟态（`--glass-blur`/`.glass-layer`/backdrop-filter）已随完全迁移全部移除：`--glass-*` token 仅作兼容映射（→ Arco 实底面色），**任何新代码不得使用 `backdrop-filter`**。
- 弹窗（`a-modal`）、下拉（`a-dropdown`/`a-select`/`a-trigger`）、工具提示（`a-tooltip`）、Popconfirm 一律 Arco 组件默认：实底面板 + Arco 自带阴影/动画，popup 挂 body。**自建浮层仅剩两处**（GeneralPanel 引擎帮助面板、`--shadow-dropdown` 兼容引用），不再新增。
- 浮层内容排版：面板圆角/边框/背景走 Arco 默认；条目类（`a-doption`）hover 态走 Arco 默认，不手写背景。
- 例外：状态栏深蓝底上的白色半透明 hover（`rgba(255,255,255,.15)`）为**表面着色**而非 elevation；chip 计数底（`color-mix` 半透明底）同类，均不纳入阴影 token。

#### 7.5.7 常用模式

- **参数行**（`ParamRow` 统一承载，控件全部 Arco）：行容器 `padding: 4px 8px` + 圆角 `var(--radius-row)`，默认透明描边；hover 底色 `--color-fill-3` + 边框 `--color-border-2`；**值 ≠ 默认时边框 `rgb(var(--orange-6))`**（与还原按钮同色系）；依赖未满足同色描边 + 底色 + `a-tooltip` 警示图标；文件/目录类型渲染 `a-input-group` 文件选择控件。
- **参数网格**：`param-grid`（参数设置页）`repeat(auto-fit, minmax(340px, 1fr))`、gap `4px 14px`、≤720px 单列；装饰一律 Arco 主色蓝 `rgb(var(--primary-6))`。
- **状态小圆点**：`border-radius: 50%`；StatusBar 状态点 8×8、StatusTag 7×7（两实现尺寸不一，已登记 STYLE_TODO 🔴 待统一）。
- **悬浮提示文本色**：`color-mix(in srgb, rgb(var(--success-6)) 12%, transparent)` 底 + 同色边框/文字（如 PresetsPanel 的 applied-msg）。
- **下载分类徽章**：颜色走 `--badge-*` token，底用 `color-mix(in srgb, var(--badge-*) 14%, transparent)`（legacy/fp32 为 16%）；`cat-other` 用 `--color-text-3` + `--color-fill-3`。徽章色为分类图例语义，两种主题恒定。
- **动效**：`--ease-*` 已归平为 `ease`、时长 `--dur-fast`(0.16s)/`--dur-med`(0.2s)；**只允许动 transform/opacity**，禁布局动画；**按钮按压不做整体缩放**（按压反馈 = 背景/边框色变化）；`prefers-reduced-motion` 下全部关闭。
- **复制按钮统一**（2026-08-29，见 STYLE_TODO #26）：行内复制操作一律 `a-button size="small"` + `#icon`（`Icon name="copy" :size="12"`）+ 文案（复制地址 `copy_url` / 复制模型名 `copy_model` / 复制命令 `copy_cmd`），点击后文案临时切换为"已复制"反馈；不使用纯图标迷你按钮。内容项（值胶囊/URL 条等）配对文字描述标签（样式同 `.info-label` 语义：次级色、贴内容 8px）。状态栏为特例：值即按钮（点击复制 + tooltip + "已复制" tip），不使用按钮形态。
- **模型别名派生**（2026-08-29）：`set(MODEL_KEY)` 时自动派生 `alias` 参数 = 模型文件名去 `.gguf` 后缀（`modelBaseName`，shared），命令构建自动携带 `-a/--alias`（API 侧模型名不带扩展名）；换模型跟随更新、预设携带模型但未存别名时补派生；界面「当前模型」显示（概览状态卡/状态栏）别名优先，回退为去后缀文件名。
- **应用 Logo 统一**（2026-08-29，见 STYLE_TODO #29）：所有出现位置使用 `AppLogo` 组件（`components/common/AppLogo.vue`，`size` prop 指定边长）——同一 svg 资源（`assets/app-icon.svg`，与打包/任务栏图标同源）、统一胶囊圆角（`--radius-pill`）；出现位置：TopBar（20px）、设置-关于品牌头（40px + 应用名 + 版本）、浏览器标签 favicon（index.html `link rel="icon"` 同源）。新增 Logo 出现位置时必须复用该组件，禁止直接 `import app-icon.svg` 或 `<img>` 散写。
- **API 地址语义收敛到 server store 单一来源**（2026-08-31）：界面一切「API 地址」展示/复制只取 `server.apiUrl`，**禁止页面各自从 `server.url`/`host`/`port` 就地派生**。store 内 `apiUrl` 与真实服务状态绑定——`running` 返回 `url`（为空时回退 `http://host:port`）、`starting` 返回推导地址、`stopped` 返回**空串**。原因：`onStatus` 事件只更新 `status` 不刷新 `url`，停止后 `server.url` 仍残留上次启动的地址，页面直接读 `url` 会显示已失效的旧 URL。显示层对空值统一以占位符（`—`/`status_stopped`）呈现，标签位与复制按钮常驻（无值时 `disabled`），保证运行前后行结构零跳动。当前消费方：概览服务状态卡（`ServiceStatusCard`）、状态栏（URL 可点复制，停止后整条消失）、WebUiFrame（iframe src，保留自身 `running` 门控作双保险）。新增任何 API 地址展示点必须复用 `server.apiUrl`。
- **禁止**：组件内 `style="color:#..."` 内联色值（动态状态色如 StatusBar 状态点除外）；非 token 的裸 `rgba(...)` 阴影/背景；逐行/逐列表项 backdrop-filter。

#### 7.5.8 一致性检查清单（改动 UI 前对照）

- [ ] 颜色全部走 Arco CSS Variables 或 `theme.scss` 业务 token（`#fff` 仅限实底主色上的文字）
- [ ] 文字对比度 ≥4.5:1（WCAG AA）；不用 `opacity` 削弱文字（改走色 token）
- [ ] 浮层用 Arco 组件默认阴影/实底；自建浮层阴影引用 `--shadow-dropdown`，无裸 `box-shadow`
- [ ] 字号走 `--fs-*`；行高按 §7.5.1 文字系统（正文 ≥1.3，`1` 仅限图标/单行居中）；字重只取 400/600/700
- [ ] 圆角走 Arco 默认或 `--radius-*`（4px；仅 2px 轨道 / 50% 圆形例外），间距符合 7.5.4（gap 只取 4/5/6/8/10/12/14）
- [ ] 控件一律 Arco 组件（按钮/输入/下拉/开关/弹窗/浮层），不新增自定义交互控件；**内容区操作按钮一律文本内联**（图标+文案；豁免：win-btn 窗口控制、输入框清除 ✕、参数还原 ✕、导航 ↑、披露 chevron——控件/导航/披露语义）
- [ ] 按钮组用 flex + gap（8px 标准）
- [ ] 无任何 `backdrop-filter`（玻璃体系已移除）
- [ ] 动画只动 transform/opacity 且 ≤0.3s，`prefers-reduced-motion` 下关闭
- [ ] 深色/浅色主题都检查一遍（`html[data-theme]` + `body[arco-theme]`；控制台/命令预览恒定深色面）
