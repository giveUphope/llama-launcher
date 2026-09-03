# 前端架构

> 范围：前端架构：路由、Pinia stores、页面、通用组件；§7.5 为 UI 风格规范（唯一权威来源）。
> 索引：[README.md](../README.md) · 相关：[ipc-channels.md](ipc-channels.md) · [params-system.md](params-system.md) · [style/STYLE_TODO.md](style/STYLE_TODO.md)

### 7.1 路由与功能注册表 (router/index.ts + features/)

路由由**功能注册表**装配：`packages/ui/src/features/` 中每个功能模块声明 `FeatureDef`（`nav` 侧栏导航 + `routes`），`features/index.ts` 汇总为 `navItems`（侧栏渲染）与 `featureRoutes`（路由装配）；`router/index.ts` 仅 `createWebHashHistory` + `featureRoutes`。新增功能 = 注册表加一个条目；`enabled:false` 可停用；`order` 决定侧栏排序；参数页橙点经 `nav.dot()` 在渲染上下文求值保持响应式。**侧栏子树**：一级项可声明 `children[]`（子标签），子项不占独立路由，点击写入 `query.tab` 由页内读取切换内容；一级项在 `Sidebar` 中可展开/收起（手动切换优先，激活项自动展开），子项激活 = path 命中 + `query.tab` 精确匹配（无 query 时默认项高亮）；**侧栏收起时子树仍渲染为 icon-only 行**（`.nav-sub.compact` 去缩进），调整提示橙点以**图标右上角标**呈现（不被 56px 导轨 overflow 裁切），全部导航按钮带 `title`/`aria-label`。**启动顺序**（main.ts）：`settings.load()` 与 `last_tab` 页签恢复在 `app.mount()` **之前**完成——首帧即为目标页签，启动期不存在第二次导航（挂载后的恢复重定向会在首屏中途注入导航，表现为路由已切换而视图停留在旧页）；设置加载带 **3s 超时兜底**（`Promise.race`，加载异常时按当前 URL 直接进入，不阻塞启动）。**页面切换**（PageHost）为**结构化直接替换**：`keep-alive` 直接替换激活组件（结构上不存在双页同框窗口），路由 `watch` 后对内容区做 90ms 容器淡入（WAAPI，opacity 0.55→1，`prefers-reduced-motion` 跳过）；**不用 `<transition>`**——KeepAlive 失活移除时序下 JS 钩子 `done()`/`transitionend` 可能永不触发，快速导航时出现短暂双页同框（旧方案已废弃，见 STYLE_TODO #40）。**浏览器预览**（无 Electron preload 的环境）：`main.ts` 注入 `dev/demo-mock.ts` 的 `createDemoApi()` 演示数据，其中 `buildDemoPreviewCommand` 按 core `buildCommand` 同规则动态构建命令预览。

`createWebHashHistory`，共 15 条路由（7 个功能页 + 1 条根重定向 + 7 条旧路由重定向）：

| 路径 | 说明 |
|------|------|
| `/` | 重定向到 `/dashboard` |
| `/dashboard` | 概览（服务状态卡 + 最近问题） |
| `/models` | 模型管理（3 子标签：本地模型 / 模型库 / 下载任务） |
| `/service` | 服务（命令预览 + 参数摘要 + 配置清理 + 控制台） |
| `/params` | 参数设置（侧边栏子树子标签：参数预设 / 自定义参数 / 性能测试，`query.tab` 切换） |
| `/logs` | 应用日志中心 |
| `/settings` | 应用设置（4 子标签：常规 / 外观 / 高级 / 关于） |
| `/webui` | 内置 Web UI（侧栏一级项；服务运行时 iframe 直接展示 llama-server Web UI，替代跳转外部浏览器） |
| `/download` | 重定向到 `/models?tab=downloads`（旧书签兼容） |
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
| `DashboardPage` | 概览：服务状态卡（`ServiceStatusCard`，自服务页迁入——状态/当前模型/API 地址/主机/端口/PID/运行时长 + 基线徽章，服务状态的唯一页面级展示区）+ 最近问题（应用日志 warn/error 最近 3 条，`.q-section` 分区分隔） |
| `ModelsPage` | 3 子标签：本地模型（`LocalModelsPanel`）/ 模型库（`LibraryPanel`，DownloadCard library 模式）/ 下载任务（`DownloadsPanel`，DownloadCard tasks 模式） |
| `ServicePage` | 命令预览（`CommandPreviewCard`：**双文本框**——「内置参数命令」**只读**展示、随参数实时自动生成（改内置参数走参数设置页控件，无编辑/还原逻辑）；「扩展参数」为唯一可编辑区，绑定 `settings.custom_args` 持久化、原样追加到启动命令末尾；复制 = 内置+扩展合并）、参数摘要（`ParamSummaryCard`）、配置目录清理（`TrashCleanCard`）、控制台输出（上限 5000 行；运行状态卡已迁至概览，本页不再重复展示状态/模型/API 地址） |
| `ParamsPage` | 3 子标签：参数预设（`PresetsPanel`）/ 自定义参数（13 个子分类分区，`param-grid` `repeat(auto-fit, minmax(340px, 1fr))` 响应式网格）/ 性能测试（`BenchPanel`，自服务页迁入，KeepAlive 缓存保留测试历史）；59 参数经 `ParamRow` + 6 类控件渲染（值 ≠ 默认时行 `--warn` 橙描边提示，依赖未满足行加底色与警示图标）；状态条含**硬件占用估算 stat**（`useVramEstimate`：显存占用百分比 + 构成明细 tooltip，超限橙色警示）与**性能目标选择器**（四档联动建议差集 chips + 一键应用）；恢复基线/清除会话入口（无基线徽章，与「已调整」统计去重） |
| `LogsPage` | 应用日志中心：级别筛选 chips、搜索、控制台渲染上限 3000 行、自动滚动 |
| `SettingsPage` | 4 子标签：常规（`GeneralPanel`，引擎/模型目录内联检测）/ 外观（`AppearancePanel`）/ 高级（`AdvancedPanel`）/ 关于（`AboutPanel`）；原 llama.cpp 标签已并入常规；全部即时保存 |
| `WebUiPage` | 内置 Web UI 路由占位（侧栏一级项「内置 Web UI」）；实际渲染由布局层 `WebUiFrame`（iframe 常驻文档，`v-show` 切换显隐，切页不重载）承担：服务运行时展示 llama-server Web UI，未运行时显示占位提示 |

### 7.4 通用组件

| 组件 | 用途 |
|------|------|
| `PageFrame` | 统一页面容器：`padding` 引用 `$layout-page-padding`；分区风格纵向 `gap: 0`，块间距由实线承担 |
| `Card` | 内容分区容器：带标题和 actions 插槽；**分区风格**——透明背景、无圆角/阴影，相邻区块以底边 1px 实线分隔（`:last-child` 无线） |
| `Icon` | 内联 SVG 图标库（字典 36 项，未引用项随清理删除） |
| `ToolTip` | 悬停提示 |
| `NavButton` | 侧边栏导航按钮（一级项/子标签，子项按 `query.tab` 高亮，一级项带展开箭头） |
| `StatusTag` | 状态标签（状态点 + 文字，ok/loading/idle/error 变体） |
| `BaselineBadge` | 参数基线徽章（参数页顶部 + 概览服务状态卡）：按会话基线显示「预设名·已修改 / 自定义参数集 / 临时参数 / 默认参数」，可选恢复基线按钮 |
| `ServiceStatusCard` | 服务状态卡（概览页，页面级唯一展示区）：状态标签 / 当前模型 / API 地址（boxed InfoStrip + 复制按钮）/ 主机·端口·PID·运行时长网格 / 失败 banner（防跳动槽位）/ 快捷操作（打开 Web UI·管理模型）；卡片头挂 `BaselineBadge` |
| `AppLogo` | 应用 Logo 统一组件（见 §7.5.7） |
| `InfoStrip` | 信息行（label + 值/插槽控件；设置页表单行、Dashboard/Service 信息网格共用） |
| `ModelMetaCard` | 模型元数据展示（主摘要 + 可折叠详情，dashed 次级分隔） |
| `DownloadCard` | 下载功能卡片（`mode: 'library' \| 'tasks'` 双模式：URL 解析/搜索/文件选择/任务列表；推荐文件只作徽标/高亮/排序提示、**不自动勾选**，下载由用户主动勾选触发；提交下载走 `enqueueFiles`：Store 去重 + 本地同名检测 + 后端 ID 回填；URL 会话历史存 `useUrlHistory` 模块级单例，跨子标签 `v-if` 重建保留） |
| `ConfirmModal` / `CloseDialog` | 通用确认弹窗 / 退出确认弹窗（`useConfirm` 队列驱动） |
| `FileBrowserModal` | 文件/目录浏览弹窗（`useFilePicker` 队列驱动，dir/file/save 三模式） |
| `PresetsPanel` | 预设管理面板（低摩擦）：智能命名（alias→模型文件名自动同步输入框）+ **自适应保存按钮**（输入名已存在时自动变「覆盖预设」，同一入口完成保存/覆盖）；行内操作（应用/删除 `mini-btn`，删除带确认）+ **双击行直接应用**；列表 `onActivated` 与增删改后自动刷新（无手动刷新按钮）；保留名称↔绑定模型一致性确认（防「应用其他预设切换模型后沿用旧名保存」的错绑） |
| `BenchPanel` | 性能测试面板（动态参数复用 `ParamRow`（与参数设置页同布局同行效果）+ 智能启动 + 测试历史表格） |
| `ParamRow` + 控件 | 参数行容器 + `TextParam`/`IntEntryParam`/`SliderParam`/`CheckboxParam`/`DropdownParam`/`FileParam` 六类控件 |

### 7.5 样式系统（UI 风格规范）

> 本文是 UI 风格的**唯一权威来源**（single source of truth）。新增/修改 UI 时必须遵循以下规范，并保持与既有页面一致；发现不一致项请登记到仓库根目录 `style/STYLE_TODO.md`（含修复效果验证方式），不要静默引入新风格。

#### 7.5.1 设计 Token（`packages/ui/src/styles/`）

- **强调色**（蓝色系列，2026-08-26 由蓝紫 #6c50e7 调整为纯蓝）：`--accent`(#2563eb)。accent 是交互强调色（描边按钮、链接、聚焦边框、选中行、开关/进度条等状态控件）；hover/选中态由 `--bg-hover`/`--bg-active`/`--border-focus`/`color-mix` 派生（原 `--accent-hover/pressed/soft/dim` 变体 token 已随主按钮主题化删除，见 STYLE_TODO #22）。
- **主题主按钮**（黑白高对比 CTA，2026-08-26 新增）：`--primary-bg`/`--primary-fg`/`--primary-hover`/`--primary-pressed`；**深色主题=白底黑字**（#F3F4F6/#111827），**浅色主题=黑底白字**（#17181F/#FFFFFF）。实底主按钮（`action-btn.primary`、TopBar `btn-start`、`modal-btn/fb-btn/dl-btn.primary`、选中 tab 与筛选 chip 的实底态）一律引用该 token，不使用 accent 实底。
- **状态色**：`--success`(#27ae60) / `--danger`(#e74c3c) / `--warn`(#f39c12) / `--info`(#007acc) / `--statusbar-blue`(#007acc，VS Code 风格状态栏蓝)。
- **语义色板**（`theme.scss`，按 `data-theme` 切换）：`--bg-app` / `--bg-sidebar` / `--bg-card` / `--bg-input` / `--bg-hover` / `--bg-active` / `--fg-primary` / `--fg-secondary` / `--fg-muted` / `--border` / `--border-focus` / `--switch-track` / `--switch-btn`。
- **恒定深色表面**（两种主题下都不变）：控制台 `--console-bg`(#0B1120)/`--console-fg`、工具提示 `--tooltip-bg`(#1e1e1e)/`--tooltip-fg`(#fff)。（侧边栏**随主题切换**：浅色主题为浅底 + 黑灰字 + accent 蓝激活项，见下条玻璃 token。）
- **字体**：`--font-family`（Inter + `SF Pro Display` + `Segoe UI Variable` + CJK 回退栈）、`--font-mono`（JetBrains Mono、Fira Code、Cascadia Code、Consolas）。数值/路径/命令一律 `--font-mono`。
- **字号**（语义化，禁止裸 px；2026-08 整体上调 1px 改善桌面可读性）：`--fs-xs`(11 徽章/辅助) / `--fs-sm`(12 次要提示/状态栏/summary chip) / `--fs-base`(13 正文/输入/控制台) / `--fs-md`(14 按钮/列表项) / `--fs-lg`(15 卡片标题/参数名/导航项) / `--fs-appname`(16 应用名，TopBar 最大字号)。
- **行高**（语义化，禁止裸数值行高；按内容密度选择）：
  | 行高 | 用途 |
  |---|---|
  | `1.6` | 多行描述/空态说明/弹窗正文（ConfirmModal/CloseDialog 正文、WebUiFrame 错误页） |
  | `1.5` | 正文与单行描述（控制台、命令预览、设置段说明、Dashboard 摘要） |
  | `1.55` | 日志正文（LogsPage，多行日志易读） |
  | `1.4` | 紧凑多行（tooltip、下拉项、summary chip、PresetsPanel 摘要、DownloadCard 卡片条目文本） |
  | `1.3` | 表格/统计/参数行等单行紧凑内容 |
  | `1` | 图标元素与单行居中控件（icon、按钮内单行文本、状态提示） |
  约定：多行正文不得使用 `<1.3` 的行高；`line-height: 1` 仅限图标/单行居中元素。
- **字重**（语义化，禁裸字重）：`400` 默认正文（不写） / `600` 区块标题、字段标签、卡片标题下的次级强调、导航激活态（最常用） / `700` 强强调（卡片大标题、应用名、弹窗正文关键词、文件/模型名）。交互元素 hover 不加字重跳变（用 `--dur-fast` 过渡代替）。
- **布局度量**：`--topbar-h`(52) / `--sidebar-w`(210) / `--sidebar-w-collapsed`(56) / `--statusbar-h`(28) / `--btn-h`(30，页面级主操作按钮高度)。
- **浮层阴影/遮罩**：`--shadow-tooltip`(0 2px 8px rgba(0,0,0,.3)) / `--shadow-dropdown`(0 4px 16px rgba(0,0,0,.2)) / `--shadow-modal`(0 12px 40px rgba(0,0,0,.4)) / `--shadow-control`(0 1px 2px rgba(0,0,0,.25)) / `--overlay`(rgba(0,0,0,.45))。
- **玻璃表面**（2026-08 重构新增）：`--glass-bg`（普通表面半透明底）/ `--glass-bg-strong`（浮层/弹窗）/ `--glass-border`（容器细边框）/ `--glass-blur`(12px) / `--glass-saturate`(140%)；侧边栏玻璃 `--glass-sidebar` **随主题**（深色深底玻璃 / 浅色 rgba(255,255,255,0.82)）。
- **圆角 token**（2026-08 重构新增，取代散值）：`--radius-pill`(999 胶囊) / `--radius-modal`(20) / `--radius-row`(10) / `--radius-control`(8)。组件内禁止裸数值圆角（仅滑块轨道 2px、圆形 50% 例外）。
- **动效 token**（2026-08 重构新增）：`--ease-jelly`（`cubic-bezier(0.34,1.56,0.64,1)` 果冻回弹，**仅限 transform 过渡**）/ `--ease-smooth`（`cubic-bezier(0.33,1,0.68,1)` 无过冲 easeOutCubic，**background/color/border-color/box-shadow/opacity/width 等颜色与值类过渡专用**——过冲缓动用于颜色插值会先冲过目标再弹回，呈现为 hover 闪烁，见 STYLE_TODO #23）/ `--dur-fast`(0.16s，hover/focus/press，≥0.16s 避免玻璃表面切换背景闪烁) / `--dur-med`(0.22s，浮层进入/开关)。**只允许动 transform/opacity**，禁布局动画；`prefers-reduced-motion` 全关。
- **统一蓝色系**（原「彩虹点缀」，2026-08-26 移除）：装饰一律使用蓝色主色 `--accent`，**不使用彩虹渐变与色相循环**（`--rainbow-grad` / `--hue` / `.hue-cycle` 已删除）。应用范围：① 分区装饰条/推荐竖条/进度填充/徽章等装饰为 `--accent`；② 应用图标为蓝色系渐变。实底主按钮走 `--primary-*`（黑白），不使用 accent 实底。交互语义色（danger/warn/success/info）与下载分类徽章语义色（`--badge-*`）不变。
- **徽章语义色**（下载分类/量化/来源，两种主题恒定）：`--badge-cat-gguf` / `--badge-cat-safetensors` / `--badge-cat-bin` / `--badge-quant-k` / `--badge-quant-i` / `--badge-quant-legacy` / `--badge-quant-fp8` / `--badge-quant-bf16` / `--badge-quant-fp16` / `--badge-quant-fp32` / `--badge-quant-int` / `--badge-src-modelscope` / `--badge-src-huggingface`。
- **硬编码禁令**：组件内禁止裸色值/裸字号/裸间距/裸阴影/裸数值圆角；颜色与阴影必须用 `var(--*)`，`#fff`/`#1a1a1a` 仅允许作为**彩色按钮上的文字色**（accent/danger/success 底 → `#fff`，warn 黄底 → `#1a1a1a`）。

#### 7.5.2 主题

- 主题挂在 `<html data-theme="dark|light">`（默认 dark），由 `stores/settings.ts` 的 `applyTheme` 切换。
- **主题基调**（2026-08-26 调整）：**深色 = 中性深灰底（`--bg-app` #101216）+ 白字；浅色 = 白底（#FFFFFF）+ 黑/灰字**；主按钮随主题反色（深色白底黑字 / 浅色黑底白字，见 `--primary-*`）。accent 蓝保留为交互强调色，下载分类徽章与状态语义色不变。
- 视觉效果固定为默认玻璃形态（毛玻璃/果冻动效/蓝色点缀）；原「视觉效果」开关（`data-fx` / `fx_mode`，off = 实底性能模式）已于 2026-08-31 移除，无用户侧回退开关（OS 级 `prefers-reduced-motion` 仍生效，见 §7.5.7）。

#### 7.5.3 圆角体系（2026-08 胶囊化重构）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-pill` | 999px | **交互元素**：按钮（btn/action/mini/tab/modal/dl/fb）、输入框、下拉项、chip、徽章、tab、开关、导航项 |
| `--radius-modal` | 20px | 模态弹窗面板 |
| `--radius-row` | 10px | 参数行、表格单元、下拉面板、summary chip、控制台容器 |
| `--radius-control` | 8px | 小控件过渡值（窗口按钮等） |
| 2px | — | 滑块轨道（唯一例外） |
| 50% | — | 状态圆点、开关 knob、滑块 thumb、圆形图标按钮 |

组件内禁止裸数值圆角；仅 2px（滑块轨道）与 50%（圆形）允许例外。
**边界**：多行文本容器（命令预览框等 `resize` 可变高元素）**禁用 `--radius-pill`**（高 80px+ 时成蛋形），用 `--radius-row`；粘性表头用不透明 `--bg-card`（半透明玻璃会让滚动的行透出表头，且滚动容器禁 blur）。

#### 7.5.4 间距规范

- **页面**：`padding: 20px 24px 24px`（`PageFrame` 引用 `variables.scss` `$layout-page-padding`）；**分区风格**——`page-frame` / 各页 `.tab-content` 纵向 `gap: 0`，相邻内容区块由实线分隔（Card 底边线、Dashboard `.q-section + .q-section` 顶边线）；区块内元素间距 `gap: 10px` 为默认。
- **间距刻度**（组件内 gap 只允许以下刻度，全库 157 处审计一致、无离群值；**不设 1/2/3px 微间距档**，像素级收紧的紧凑原子内间距也一律取最小刻度 4px）：
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
- **组件 padding 约定**（2026-08-29 统一，见 STYLE_TODO #21）：padding 属控件尺寸而非元素间距，不受 gap 刻度表约束，但同类元素必须同值——① `fs-xs` 彩色小徽章统一 `1px 6px`；② `fs-sm` 交互 chip 统一 `3px 8px`；③ 信息展示胶囊（runtime-model / version-badge / 状态栏 clickable）统一 `2px 10px`；④ 非胶囊的行/条纵向微间距（提示条、分页条、帮助热区、标签下划线间距）一律 ≥4px；⑤ 参数行/调优行 `padding: 4px 8px`（§7.5.7）。保留的光学对齐例外：Card 标题左缩进 `0 0 0 2px`（uppercase 字面补偿）。
- **按钮组**：`display: flex; gap: 8px`（页面工具栏、行内操作区）；弹窗按钮 `gap: 10px`；卡片头操作 `gap: 6px`。
- **常用控件高度**：mini-btn 20 / 输入框 26–28 / action-btn `var(--btn-h)`(30) / TopBar btn 30 / tab-btn 28 / modal-btn 32 / win-btn 46 宽。
- **表格**：`padding: 6px 8px` 单元格；`thead` sticky + `background: var(--bg-card)`；列固定宽度用 `col-*` class。
- **统一控件宽度**：参数控件 `label-col` `flex: 0 1 110px`（min-width 64px，**右对齐** + `padding-right: 8px`，长标签省略号截断）、num-input 100px、下拉触发器 `dropdown-trigger` 宽 100%（下拉面板 fixed 定位）、gguf-hint `flex: 0 1 auto`（min 50px / max 90px）。**标签等列逻辑（2026-08-29 用户决策，替代 #25 的贴文字方向）**：全部"选项行"（`InfoStrip .info-label`、`.tune-label`）与参数行同配方——`flex: 0 1 110px`（min-width 64px）+ `text-align: right`，标签占等宽列、内容起点跨行对齐；长标签面板级 `:deep(.info-label)` 覆盖（如 AdvancedPanel 140px）。容器过窄省略号截断。
- **值盒标准（内容文本框统一，2026-08-29，见 STYLE_TODO #37）**：展示类内容值盒统一使用 `InfoStrip` 的 **`boxed` 变体**——高 **26px**、`padding: 0 10px`、`bg-input` + 1px 边框、胶囊圆角、行内 flex 填满（同组行左缘/宽跨行对齐）、内容省略截断。适用：状态卡当前模型/API 地址/运行时详情等；仪表盘 `.val-box` 同规格。禁止同类内容项回退纯文本或自造异形盒（高度/内距各写一套）。

#### 7.5.5 按钮类型学（taxonomy）

| 类 | 尺寸 | 变体 | 场景 |
|---|---|---|---|
| `btn`（TopBar） | 高 30 | `btn-start`(主题化 primary 实底，黑白高对比) / `btn-stop`(danger 描边) / `btn-restart`(warn 描边) / `btn-web`(accent 描边) | 顶栏主操作 |
| `action-btn` | 高 `var(--btn-h)`(30) | 默认(输入底+边框) / `primary`(主题化实底，黑白高对比) / `accent`(accent 描边) / `warn`(warn 描边) / `danger`(danger 描边) | 页面/卡片内主要操作 |
| `mini-btn` | 高 20 | 默认 / `accent`(accent 描边) / `danger`(danger 描边) | 表格行内、卡片头小操作 |
| `win-btn` | 46 宽 | `win-close`(danger hover) | 自定义标题栏 |
| `tab-btn` | 高 28 | `active`(主题化 primary 胶囊实底) | 页内标签页（Models/Settings 页共享，buttons.scss 全局定义） |
| `modal-btn` | 高 32 | `primary` / `ghost` / warning/danger 配色 | 弹窗确认 |
| `dl-btn` / `fb-btn` | 高 30 / 32（`dl-btn.small` 24） | small / primary / danger / ghost | 下载、文件浏览器 |

**描边变体规律**：操作=accent 描边、危险=danger 描边、警告=warn 描边，均不实底；hover 用 `background: var(--bg-hover)`（accent 变体可用 `color-mix(in srgb, var(--accent) 10%, var(--bg-input))`）。

#### 7.5.6 浮层、阴影与毛玻璃（glassmorphism）

- 阴影统一引用 token（组件内禁止裸 `box-shadow`/遮罩）：tooltip `var(--shadow-tooltip)`、下拉/菜单 `var(--shadow-dropdown)`、弹窗 `var(--shadow-modal)`、控件小阴影 `var(--shadow-control)`、遮罩 `var(--overlay)`。
- **单玻璃层（性能约定）**：全应用 `backdrop-filter` 只允许出现在：① `surface.scss` 的 `.glass-layer`（全视口固定一层，模糊装饰背景斑块，背景静态 ⇒ blur 缓存）；② 弹窗背板（`blur(var(--glass-blur))` + `var(--overlay)`）；③ 工具提示（面积小且生命周期短）。**下拉/菜单面板不得用 backdrop-filter**（2026-08-31 起改实底，见 STYLE_TODO #41）；**列表行、表格行、参数行、控制台行、滚动容器一律不得加 backdrop-filter**（只走半透明 `--glass-bg`）。
- 表面背景统一 `var(--glass-bg)` / 弹窗 `var(--glass-bg-strong)`，容器边框 `var(--glass-border)`；输入框保持 `var(--bg-input)` 不透明保证可读性。`@supports not (backdrop-filter: ...)` 时回落实底。
- **下拉面板统一（实底可读）**：`position: fixed`（`DropdownParam` 用 `<Teleport to="body">`）、`border-radius: var(--radius-row)`、**背景 `var(--bg-card)` 实底 + 边框 `var(--border)`**（半透明底会让面板下方内容透出削弱对比度，backdrop-filter 合成层使文字失去亚像素抗锯齿发虚——功能菜单可读性优先，与 fx-off 回退形态一致，见 STYLE_TODO #41）、`max-height` 内滚动、`z-index` 高于卡片；选中行底色用 `color-mix(in srgb, var(--accent) 14%, transparent)` + `--accent` 文字（勿用 `--bg-active` 暗蓝底叠蓝字，深色主题对比度不足，STYLE_TODO #13 同型问题）。
- 工具提示恒为深色底（两种主题下对比度一致）。
- 例外：状态栏深蓝底上的白色半透明 hover（`rgba(255,255,255,.15)`）为**表面着色**而非 elevation，不纳入阴影 token；chip-count 计数底（`color-mix(in srgb, var(--fg-secondary) 12%, transparent)` / 激活态 `var(--primary-fg) 22%`）同类。

#### 7.5.7 常用模式

- **参数行**（`ParamRow` 统一承载，参数设置页与性能测试调优区共用同一组件）：`padding: 4px 8px` + 圆角 `var(--radius-row)`，默认透明描边；hover 底色 `--bg-hover` + 边框 `--border`；**值 ≠ 默认时边框 `--warn`**（与还原按钮同色系）；依赖未满足 `--warn` 边框 + 底色 + 警示图标；文件/目录类型渲染文件选择控件。
- **参数网格**：`param-grid`（参数设置页）与 `tune-grid`（性能测试调优区）同配方 `repeat(auto-fit, minmax(340px, 1fr))`、gap `4px 14px`、≤720px 单列；卡片/分区装饰条统一 `--accent` 蓝（2026-08-26 起不使用 hue-cycle 循环取色）。
- **状态小圆点**：8×8 `border-radius: 50%`。
- **悬浮提示文本色**：`color-mix(in srgb, var(--success) 12%, transparent)` 底 + `var(--success)` 边框/文字（如 PresetsPanel/BenchPanel 的 applied-msg）。
- **下载分类徽章**：颜色走 `--badge-*` token，底用 `color-mix(in srgb, var(--badge-*) 14%, transparent)`（legacy/fp32 为 16%）；`cat-other` 用 `--fg-muted` + `--bg-hover`。徽章色为分类图例语义，两种主题恒定。
- **果冻动效**：浮层/开关进入的 **transform 过渡**用 `var(--ease-jelly)` 弹簧（浮层 `translateY+scale` 进入）；**颜色/阴影类过渡（background/color/border-color/box-shadow/opacity）一律 `var(--ease-smooth)`**（无过冲，防 hover 闪烁，见 STYLE_TODO #23）；**按钮按压不再整体缩放**（2026-08-29 移除全部 `:active scale`——整体缩放会挤压/拉伸按钮内文字，按压反馈 = 背景/边框色变化，见 STYLE_TODO #32）；禁止 width/height/margin 等布局动画；`prefers-reduced-motion` 下全部关闭。**例外（均不得用于滚动/高频重绘场景）**：① 用户主动触发的单次布局过渡（侧边栏折叠宽度 `transition: width var(--dur-med) var(--ease-smooth)`）；② 进度条填充宽度过渡（DownloadCard `.task-progress-fill`，`transition: width var(--dur-med) var(--ease-smooth)`，作为进度数值的跟随展示）。
- **复制按钮统一**（2026-08-29，见 STYLE_TODO #26）：行内复制操作一律 `action-btn` + `Icon name="copy" :size="12"` + 文案（复制地址 `copy_url` / 复制模型名 `copy_model` / 复制命令 `copy_cmd`），点击后文案临时切换为"已复制"反馈；不使用纯图标迷你按钮。内容项（值胶囊/URL 条等）配对文字描述标签（如 `当前模型`/`API 地址`，样式同 `.info-label` 语义：次级色、贴内容 8px）。状态栏为特例：值即按钮（点击复制 + tooltip + "已复制" tip），不使用按钮形态。
- **模型别名派生**（2026-08-29）：`set(MODEL_KEY)` 时自动派生 `alias` 参数 = 模型文件名去 `.gguf` 后缀（`modelBaseName`，shared），命令构建自动携带 `-a/--alias`（API 侧模型名不带扩展名）；换模型跟随更新、预设携带模型但未存别名时补派生；界面「当前模型」显示（服务页胶囊/状态栏/仪表盘）别名优先，回退为去后缀文件名。
- **应用 Logo 统一**（2026-08-29，见 STYLE_TODO #29）：所有出现位置使用 `AppLogo` 组件（`components/common/AppLogo.vue`，`size` prop 指定边长）——同一 svg 资源（`assets/app-icon.svg`，与打包/任务栏图标同源）、统一胶囊圆角（`--radius-pill`）；出现位置：TopBar（20px）、设置-关于品牌头（40px + 应用名 + 版本）、浏览器标签 favicon（index.html `link rel="icon"` 同源）。新增 Logo 出现位置时必须复用该组件，禁止直接 `import app-icon.svg` 或 `<img>` 散写。
- **API 地址语义收敛到 server store 单一来源**（2026-08-31）：界面一切「API 地址」展示/复制只取 `server.apiUrl`，**禁止页面各自从 `server.url`/`host`/`port` 就地派生**。store 内 `apiUrl` 与真实服务状态绑定——`running` 返回 `url`（为空时回退 `http://host:port`）、`starting` 返回推导地址、`stopped` 返回**空串**。原因：`onStatus` 事件只更新 `status` 不刷新 `url`，停止后 `server.url` 仍残留上次启动的地址，页面直接读 `url` 会显示已失效的旧 URL。显示层对空值统一以占位符（`—`/`status_stopped`）呈现，标签位与复制按钮常驻（无值时 `disabled`），保证运行前后行结构零跳动。当前消费方：仪表盘 Q3、服务页状态卡、状态栏（URL 可点复制，停止后整条消失）、WebUiFrame（iframe src，保留自身 `running` 门控作双保险）。新增任何 API 地址展示点必须复用 `server.apiUrl`。
- **禁止**：组件内 `style="color:#..."` 内联色值（动态状态色如 StatusBar 状态点除外）；非 token 的裸 `rgba(...)` 阴影/背景；逐行/逐列表项 backdrop-filter。

#### 7.5.8 一致性检查清单（改动 UI 前对照）

- [ ] 颜色全部走 `var(--*)`（`#fff`/`#1a1a1a` 仅限彩色按钮文字）
- [ ] 浮层阴影/遮罩走 `--shadow-*`/`--overlay`，无裸 `box-shadow`/`rgba(...)` 遮罩
- [ ] 字号走 `--fs-*`；行高按 §7.5.1 文字系统（正文 ≥1.3，`1` 仅限图标/单行居中）；字重只取 400/600/700
- [ ] 圆角走 `--radius-*` token（仅 2px 轨道 / 50% 圆形例外），间距符合 7.5.4（gap 只取 4/5/6/8/10/12/14）
- [ ] 按钮复用既有类（`action-btn`/`mini-btn`/`tab-btn`…），不另造同义类；**内容区操作按钮一律文本内联**（图标+文案，禁止纯图标操作按钮；豁免：win-btn 窗口控制、输入框清除 ✕、导航 ↑、披露 chevron——控件/导航/披露语义，非操作按钮）
- [ ] 按钮组用 flex + gap（8px 标准）
- [ ] `backdrop-filter` 仅限玻璃层 / 弹窗背板（下拉/菜单实底，STYLE_TODO #41），无逐行 blur
- [ ] 动画只动 transform/opacity 且 ≤0.3s，`prefers-reduced-motion` 下关闭
- [ ] 深色/浅色主题都检查一遍（含控制台/工具提示等恒定深色面，侧边栏随主题）
