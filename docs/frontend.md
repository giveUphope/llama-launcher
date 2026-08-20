# 前端架构

> 范围：前端架构：路由、Pinia stores、页面、通用组件；§7.5 为 UI 风格规范（唯一权威来源）。
> 索引：[README.md](README.md) · 相关：[ipc-channels.md](ipc-channels.md) · [params-system.md](params-system.md) · [style/STYLE_TODO.md](style/STYLE_TODO.md)

### 7.1 路由与功能注册表 (router/index.ts + features/)

路由由**功能注册表**装配：`packages/ui/src/features/` 中每个功能模块声明 `FeatureDef`（`nav` 侧栏导航 + `routes`），`features/index.ts` 汇总为 `navItems`（侧栏渲染）与 `featureRoutes`（路由装配）；`router/index.ts` 仅 `createWebHashHistory` + `featureRoutes`。新增功能 = 注册表加一个条目；`enabled:false` 可停用；`order` 决定侧栏排序；参数页橙点经 `nav.dot()` 在渲染上下文求值保持响应式。

`createWebHashHistory`，共 12 条路由（7 功能页含 `/` 重定向 + 5 条旧路由重定向）：

| 路径 | 说明 |
|------|------|
| `/` | 重定向到 `/models` |
| `/models` | 模型管理 |
| `/download` | 在线下载 |
| `/params` | 参数设置（含 basic/advanced/server/presets/bench 标签页） |
| `/launch` | 控制台 |
| `/settings` | 应用设置（引擎目录/模型目录/镜像源/下载并发/主题/语言统一入口） |
| `/webui` | Web UI 内嵌页（服务运行时 iframe 直接展示 llama-server Web UI，替代跳转外部浏览器） |
| `/basic` | 重定向到 `/params?tab=basic` |
| `/advanced` | 重定向到 `/params?tab=advanced` |
| `/sampling` | 重定向到 `/params?tab=basic` |
| `/server` | 重定向到 `/params?tab=server` |
| `/presets` | 重定向到 `/params?tab=presets` |

### 7.2 Stores (5 个 Pinia store)

| Store | 职责 |
|-------|------|
| `settings.ts` | 加载/保存设置、切换主题（`data-theme`）、切换语言 |
| `i18n.ts` | 以 `settings.language` 为数据源，`watchEffect` 同步 |
| `params.ts` | `values` + `enabled` 双状态，`_enabled` JSON 编码，`groupHasChanges` 用于侧边栏提示，`applyModel` 统一模型切换，依赖联动清理（`syncDependencies`）+ 草稿模型自动检测 |
| `server.ts` | 状态/pid/host/port/url、`runningValues`（最近启动参数快照）、输出数组（上限 5000） |
| `download.ts` | 任务列表、IPC 监听注册（`ensureSubscribed` 仅注册一次） |

### 7.3 页面 (6 个)

| 页面 | 功能 |
|------|------|
| `ModelsPage` | 模型列表、GGUF 信息、建议参数（引擎/目录等应用设置已移至「应用设置」页） |
| `DownloadPage` | 在线下载 |
| `ParamsPage` | 参数设置（基础 / 高级 / 服务端 / 预设 / 性能测试，五标签页合并，`KeepAlive` 缓存各面板） |
| `LaunchPage` | 控制台（命令预览、参数摘要、输出、控制，切回自动滚动到底部） |
| `SettingsPage` | 应用设置统一入口：引擎目录（含 `llama-server.exe` 内联检测）、模型目录、HuggingFace 镜像源、最大并发下载数、主题、语言；全部即时保存 |
| `WebUiPage` | Web UI 路由占位；实际渲染由布局层 `WebUiFrame`（iframe 常驻文档，`v-show` 切换显隐，切页不重载）承担：服务运行时展示 llama-server Web UI，未运行时显示占位提示 |

### 7.4 通用组件

| 组件 | 用途 |
|------|------|
| `Card` | 带标题和 actions 插槽的卡片容器 |
| `Icon` | 内联 SVG 图标库 |
| `ToolTip` | 悬停提示 |
| `NavButton` | 侧边栏导航按钮 |
| `CollapsibleSection` | 可折叠分组（CSS Grid 两列布局，窄屏自动单列） |
| `ModelMetaCard` | 模型元数据展示（主摘要 6 项 + 可折叠详情 28 项） |
| `DownloadCard` | 下载功能卡片 |
| `ParamsPanel` | 参数面板（基础/高级/服务端共用，含快捷保存预设 + 重置） |
| `PresetsPanel` | 预设管理面板 |
| `BenchPanel` | 性能测试面板（动态参数 + 智能启动 + 测试历史表格） |

### 7.5 样式系统（UI 风格规范）

> 本文是 UI 风格的**唯一权威来源**（single source of truth）。新增/修改 UI 时必须遵循以下规范，并保持与既有页面一致；发现不一致项请登记到仓库根目录 `style/STYLE_TODO.md`（含修复效果验证方式），不要静默引入新风格。

#### 7.5.1 设计 Token（`packages/ui/src/styles/`）

- **强调色**：`--accent`(#4a9eff) / `--accent-hover` / `--accent-pressed` / `--accent-soft` / `--accent-dim`。accent 是唯一的交互强调色（主按钮、选中态、链接、聚焦边框、激活行）。
- **状态色**：`--success`(#27ae60) / `--danger`(#e74c3c) / `--warn`(#f39c12) / `--info`(#007acc) / `--statusbar-blue`(#007acc，VS Code 风格状态栏蓝)。
- **语义色板**（`theme.scss`，按 `data-theme` 切换）：`--bg-app` / `--bg-sidebar` / `--bg-topbar` / `--bg-card` / `--bg-input` / `--bg-hover` / `--bg-active` / `--fg-primary` / `--fg-secondary` / `--fg-muted` / `--border` / `--border-focus` / `--switch-track` / `--switch-btn`。
- **恒定深色表面**（两种主题下都不变）：控制台 `--console-bg`(#1e1e1e)/`--console-fg`、侧边栏 `--sidebar-*`、工具提示 `--tooltip-bg`(#1e1e1e)/`--tooltip-fg`(#fff)。
- **字体**：`--font-family`（system-ui + `Segoe UI Variable` + CJK 回退栈）、`--font-mono`（Cascadia Code/Mono、JetBrains Mono、Consolas）。数值/路径/命令一律 `--font-mono`。
- **字号**（语义化，禁止裸 px；2026-08 整体上调 1px 改善桌面可读性）：`--fs-xs`(11 徽章/辅助) / `--fs-sm`(12 次要提示/状态栏/summary chip) / `--fs-base`(13 正文/输入/控制台) / `--fs-md`(14 按钮/列表项) / `--fs-lg`(15 卡片标题/参数名/导航项) / `--fs-appname`(16 应用名) / `--fs-xl`(20 页面标题)。
- **布局度量**：`--topbar-h`(52) / `--sidebar-w`(210) / `--sidebar-w-collapsed`(56) / `--statusbar-h`(28) / `--btn-h`(30，页面级主操作按钮高度)。
- **浮层阴影/遮罩**：`--shadow-tooltip`(0 2px 8px rgba(0,0,0,.3)) / `--shadow-dropdown`(0 4px 16px rgba(0,0,0,.2)) / `--shadow-modal`(0 12px 40px rgba(0,0,0,.4)) / `--shadow-control`(0 1px 2px rgba(0,0,0,.25)) / `--overlay`(rgba(0,0,0,.45))。
- **玻璃表面**（2026-08 重构新增）：`--glass-bg`（普通表面半透明底）/ `--glass-bg-strong`（浮层/弹窗）/ `--glass-border`（容器细边框）/ `--glass-highlight`（内侧高光）/ `--glass-blur`(12px) / `--glass-saturate`(140%)；侧边栏恒深色玻璃 `--glass-sidebar`。`data-fx='off'` 时全部回落实底（`--glass-bg` → `var(--bg-card)`）。
- **圆角 token**（2026-08 重构新增，取代散值）：`--radius-pill`(999 胶囊) / `--radius-card`(16) / `--radius-modal`(20) / `--radius-row`(10) / `--radius-control`(8)。组件内禁止裸数值圆角（仅滑块轨道 2px、圆形 50% 例外）。
- **动效 token**（2026-08 重构新增）：`--ease-jelly`（`cubic-bezier(0.34,1.56,0.64,1)` 果冻回弹）/ `--dur-fast`(0.12s) / `--dur-med`(0.22s)。**只允许动 transform/opacity**，禁布局动画；`prefers-reduced-motion` 全关。
- **彩虹点缀**（2026-08 重构新增）：`--rainbow-grad`（静态渐变）。**使用边界**：彩虹只允许出现在① CTA 按钮的**边框**（border-box 层，内部为玻璃表面，禁止高亮底色填充）；② 下载进度条填充；③ 应用图标/分区 `--hue` 装饰条。交互语义色（`--accent`/danger/warn/success）不变。
- **徽章语义色**（下载分类/量化/来源，两种主题恒定）：`--badge-cat-gguf` / `--badge-cat-safetensors` / `--badge-cat-bin` / `--badge-quant-k` / `--badge-quant-i` / `--badge-quant-legacy` / `--badge-quant-fp8` / `--badge-quant-bf16` / `--badge-quant-fp16` / `--badge-quant-fp32` / `--badge-quant-int` / `--badge-src-modelscope` / `--badge-src-huggingface`。
- **硬编码禁令**：组件内禁止裸色值/裸字号/裸间距/裸阴影/裸数值圆角；颜色与阴影必须用 `var(--*)`，`#fff`/`#1a1a1a` 仅允许作为**彩色按钮上的文字色**（accent/danger/success 底 → `#fff`，warn 黄底 → `#1a1a1a`）。

#### 7.5.2 主题与视觉效果开关

- 主题挂在 `<html data-theme="dark|light">`（默认 dark），由 `stores/settings.ts` 的 `applyTheme` 切换。
- 视觉效果挂在 `<html data-fx="glass|off">`（默认 glass），由 `settings.applyFx`/`setFx` 切换（Settings「外观与语言」→ 视觉效果）。`off` = 实底回退 + 动效全关（性能模式 / 回退开关）。
- `body` 背景/前景在主题切换时有 `0.12s` 过渡；新增组件不要破坏该过渡。

#### 7.5.3 圆角体系（2026-08 胶囊化重构）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-pill` | 999px | **交互元素**：按钮（btn/action/mini/head/tab/modal/dl/fb/icon）、输入框、下拉项、chip、徽章、tab、开关、导航项 |
| `--radius-card` | 16px | **卡片容器**（`Card.vue`） |
| `--radius-modal` | 20px | 模态弹窗面板 |
| `--radius-row` | 10px | 参数行、表格单元、下拉面板、summary chip、控制台容器 |
| `--radius-control` | 8px | 小控件过渡值（窗口按钮等） |
| 2px | — | 滑块轨道（唯一例外） |
| 50% | — | 状态圆点、开关 knob、滑块 thumb、圆形图标按钮 |

组件内禁止裸数值圆角；仅 2px（滑块轨道）与 50%（圆形）允许例外。
**边界**：多行文本容器（命令预览框等 `resize` 可变高元素）**禁用 `--radius-pill`**（高 80px+ 时成蛋形），用 `--radius-row`；粘性表头用不透明 `--bg-card`（半透明玻璃会让滚动的行透出表头，且滚动容器禁 blur）。

#### 7.5.4 间距规范

- **页面**：`padding: 18px 20px 24px`；卡片间距 `gap: 14px`。
- **卡片体**：`padding: 14px 16px`；卡片头高 38px，左侧 3px accent 竖条。
- **按钮组**：`display: flex; gap: 8px`（页面工具栏、行内操作区）；弹窗按钮 `gap: 10px`；卡片头操作 `gap: 6px`。
- **常用控件高度**：mini-btn 20 / head-btn 24 / 输入框 26–28 / action-btn `var(--btn-h)`(30) / TopBar btn 30 / tab-btn 30 / modal-btn 32 / icon-btn 32×32 / win-btn 46 宽。
- **表格**：`padding: 6px 8px` 单元格；`thead` sticky + `background: var(--bg-card)`；列固定宽度用 `col-*` class。
- **统一控件宽度**：label-col `flex: 0 1 140px`（min-width 80px，长标签省略号截断）、num-input 100px、select-trigger 220px、gguf-hint `flex: 0 1 auto`（min 50px / max 90px）。

#### 7.5.5 按钮类型学（taxonomy）

| 类 | 尺寸 | 变体 | 场景 |
|---|---|---|---|
| `btn`（TopBar） | 高 30 | `btn-start`(彩虹**边框** + 玻璃底，内部无高亮底色) / `btn-stop`(danger 描边) / `btn-restart`(warn 描边) / `btn-web`(accent 描边) | 顶栏主操作 |
| `action-btn` | 高 `var(--btn-h)`(30) | 默认(输入底+边框) / `primary`(accent 实底) / `danger`(danger 描边) | 页面/卡片内主要操作 |
| `mini-btn` | 高 20 | 默认 / `accent`(accent 描边) / `danger`(danger 描边) | 表格行内、卡片头小操作 |
| `icon-btn` | 32×32 | `btn-toggle` | 语言/主题切换 |
| `win-btn` | 46 宽 | `win-close`(danger hover) | 自定义标题栏 |
| `head-btn` | 高 24 | 默认 | 卡片头操作 |
| `tab-btn` | 高 30 | `active`(卡片底+accent 字) | 页内标签页 |
| `modal-btn` | 高 32 | `primary` / `ghost` / warning/danger 配色 | 弹窗确认 |
| `dl-btn` / `fb-btn` | 高 24 | small / primary / danger / ghost | 下载、文件浏览器 |

**描边变体规律**：操作=accent 描边、危险=danger 描边、警告=warn 描边，均不实底；hover 用 `background: var(--bg-hover)`（accent 变体可用 `color-mix(in srgb, var(--accent) 10%, var(--bg-input))`）。

#### 7.5.6 浮层、阴影与毛玻璃（glassmorphism）

- 阴影统一引用 token（组件内禁止裸 `box-shadow`/遮罩）：tooltip `var(--shadow-tooltip)`、下拉/菜单 `var(--shadow-dropdown)`、弹窗 `var(--shadow-modal)`、控件小阴影 `var(--shadow-control)`、遮罩 `var(--overlay)`。
- **单玻璃层（性能约定）**：全应用 `backdrop-filter` 只允许出现在：① `surface.scss` 的 `.glass-layer`（全视口固定一层，模糊装饰背景斑块，背景静态 ⇒ blur 缓存）；② 弹窗背板（`blur(var(--glass-blur))` + `var(--overlay)`）；③ 小型瞬时浮层（下拉面板/工具提示，面积小且生命周期短）。**列表行、表格行、参数行、控制台行、滚动容器一律不得加 backdrop-filter**（只走半透明 `--glass-bg`）。
- 表面背景统一 `var(--glass-bg)` / 浮层 `var(--glass-bg-strong)`，容器边框 `var(--glass-border)`；输入框保持 `var(--bg-input)` 不透明保证可读性。`@supports not (backdrop-filter: ...)` 或 `data-fx='off'` 时回落实底。
- 下拉面板统一：`position: fixed`（`DropdownParam` 用 `<Teleport to="body">`）、`border-radius: var(--radius-row)`、`background: var(--glass-bg-strong)`、`max-height` 内滚动、`z-index` 高于卡片。
- 工具提示恒为深色底（两种主题下对比度一致）。
- 例外：状态栏深蓝底上的白色半透明 hover（`rgba(255,255,255,.15)`）与 chip-count 文字底色为**表面着色**而非 elevation，不纳入阴影 token。

#### 7.5.7 常用模式

- **参数行/调优行**：`border: 1px solid var(--border)` + `padding: 4px 8px` + 圆角 `var(--radius-row)`，hover 边框 `--accent`。
- **两列网格**：`grid-template-columns: repeat(2, minmax(0, 1fr))`（`CollapsibleSection`/`tune-grid`）；参数分区容器加 `hue-cycle` 使各分区装饰条循环彩虹取色。
- **状态小圆点**：8×8 `border-radius: 50%`。
- **悬浮提示文本色**：`color-mix(in srgb, var(--success) 12%, transparent)` 底 + `var(--success)` 边框/文字（如 PresetsPanel/BenchPanel 的 applied-msg）。
- **下载分类徽章**：颜色走 `--badge-*` token，底用 `color-mix(in srgb, var(--badge-*) 14%, transparent)`（legacy/fp32 为 16%）；`cat-other` 用 `--fg-muted` + `--bg-hover`。徽章色为分类图例语义，两种主题恒定。
- **果冻动效**：按钮/开关/浮层进入一律 `var(--ease-jelly)` + 只动 `transform/opacity`（按压缩放 `scale(0.96)`、浮层 `translateY+scale` 弹簧进入）；禁止 width/height/margin 等布局动画；`prefers-reduced-motion` 下全部关闭。**例外**：用户主动触发的单次布局过渡（如侧边栏折叠宽度 `transition: width`）允许，禁止用于滚动/高频重绘场景。
- **禁止**：组件内 `style="color:#..."` 内联色值（动态状态色如 StatusBar 状态点除外）；非 token 的裸 `rgba(...)` 阴影/背景；逐行/逐列表项 backdrop-filter。

#### 7.5.8 一致性检查清单（改动 UI 前对照）

- [ ] 颜色全部走 `var(--*)`（`#fff`/`#1a1a1a` 仅限彩色按钮文字）
- [ ] 浮层阴影/遮罩走 `--shadow-*`/`--overlay`，无裸 `box-shadow`/`rgba(...)` 遮罩
- [ ] 字号走 `--fs-*`；圆角走 `--radius-*` token（仅 2px 轨道 / 50% 圆形例外），间距符合 7.5.4
- [ ] 按钮复用既有类（`action-btn`/`mini-btn`/`head-btn`…），不另造同义类
- [ ] 按钮组用 flex + gap（8px 标准）
- [ ] `backdrop-filter` 仅限玻璃层 / 弹窗背板 / 小型浮层，无逐行 blur
- [ ] 动画只动 transform/opacity 且 ≤0.3s，`prefers-reduced-motion` 下关闭
- [ ] 深色/浅色主题都检查一遍（含控制台/侧边栏/提示等恒定深色面）；`data-fx='off'` 下实底回退正常
