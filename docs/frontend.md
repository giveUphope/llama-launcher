# 前端架构

> 范围：前端架构：路由、Pinia stores、页面、通用组件；§7.5 为 UI 风格规范（唯一权威来源）。
> 索引：[README.md](../README.md) · 相关：[ipc-channels.md](ipc-channels.md) · [params-system.md](params-system.md) · [style/STYLE_TODO.md](style/STYLE_TODO.md)

### 7.1 路由与功能注册表 (router/index.ts + features/)

路由由**功能注册表**装配：`packages/ui/src/features/` 中每个功能模块声明 `FeatureDef`（`nav` 侧栏导航 + `routes`），`features/index.ts` 汇总为 `navItems`（侧栏渲染）与 `featureRoutes`（路由装配）；`router/index.ts` 仅 `createWebHashHistory` + `featureRoutes`。新增功能 = 注册表加一个条目；`enabled:false` 可停用；`order` 决定侧栏排序；参数页橙点经 `nav.dot()` 在渲染上下文求值保持响应式。**侧栏子树已移除**（2026-09：`children[]`/展开机制随参数设置回归单页删除）——次级页面统一回归**页内 tab-strip 切换**（参数设置两页签与设置页同一体例，`query.tab` 可深链）；调整提示橙点以**图标右上角标**呈现（侧栏收起态，不被 48px 导轨 overflow 裁切），全部导航按钮带 `title`/`aria-label`。**启动顺序**（main.ts）：`settings.load()` 与 `last_tab` 页签恢复在 `app.mount()` **之前**完成——首帧即为目标页签，启动期不存在第二次导航（挂载后的恢复重定向会在首屏中途注入导航，表现为路由已切换而视图停留在旧页）；设置加载带 **3s 超时兜底**（`Promise.race`，加载异常时按当前 URL 直接进入，不阻塞启动）。**页面切换**（PageHost）为**结构化直接替换**：`keep-alive` 直接替换激活组件（结构上不存在双页同框窗口），路由 `watch` 后对内容区做 90ms 容器淡入（WAAPI，opacity 0.55→1，`prefers-reduced-motion` 跳过）；**不用 `<transition>`**——KeepAlive 失活移除时序下 JS 钩子 `done()`/`transitionend` 可能永不触发，快速导航时出现短暂双页同框（旧方案已废弃，见 STYLE_TODO #40）。**浏览器预览**（无 Electron preload 的环境）：`main.ts` 注入 `dev/demo-mock.ts` 的 `createDemoApi()` 演示数据，其中 `buildDemoPreviewCommand` 按 core `buildCommand` 同规则动态构建命令预览；该注入走 **`await import()` 动态加载**（在 `app.mount()` 前完成，故首帧数据完整）——静态引入会把演示数据压进 244 kB 的入口 chunk，Electron 每次启动都要白读白求值一份永不使用的代码。

**keep-alive 下的资源清理铁律（2026-09-19 性能审查）**：`PageHost` 的 `<keep-alive>` 让页面切换后组件**不卸载**，因此 `onUnmounted` 里的清理**永不执行**——定时器、`window.addEventListener`、`window.api.*.onXxx()` 订阅必须配对写在 `onActivated` / `onDeactivated`（历史缺陷：设置页的非 passive 捕获期 `scroll` 监听、模型页的 2.5s 体检轮询与 `models:onChanged` 整树重扫订阅，访问过一次页面即终身驻留）。同理，页面级"每条数据都重算"的开销在失活后仍在跑：控制台自动滚动这类强制布局操作要用 `pageActive` 门控 + `requestAnimationFrame` 合帧（ServicePage / LogsPage 已按此实现）。列表行的派生值（着色类名、时间戳格式化、量化解析）应在**数据入队时**算一次并随条目携带（`server` store 的 `OutputLine.tone/fail/oom`、`appLog` store 的 `AppLogLine.time/cls/lower`），不得放在 `v-for` 的函数调用里逐行重算。

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
| `ParamsPage` | 页内 tab-strip 两页签（与设置页统一）：参数预设（`PresetsPanel`）/ 自定义参数（13 个子分类分区，`param-grid` `repeat(auto-fill, minmax(418px, 1fr))` 响应式网格，无列数上限）；60 参数经 `ParamRow` + 6 类控件渲染（值 ≠ 默认时行 `--warn` 橙描边提示，依赖未满足行加底色与警示图标）；自定义页签状态条含**硬件占用估算 stat**（`useVramEstimate`：显存占用百分比 + 构成明细 tooltip，超限橙色警示）与**性能目标选择器**（四档联动建议差集 chips + 一键应用）；恢复基线/清除会话入口（无基线徽章，与「已调整」统计去重） |
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
| `StatusTag` | 状态标签（状态点 + 文字，ok/warn/error/idle/loading 变体） |
| `ServiceStatusCard` | 服务状态卡（概览页，页面级唯一展示区）：状态标签 / 当前模型 / API 地址（boxed 值盒 `a-descriptions` + 复制按钮）/ 主机·端口·PID·运行时长网格 / 失败 banner（防跳动槽位）/ 快捷操作（打开 Web UI·管理模型） |
| `AppLogo` | 应用 Logo 统一组件（见 §7.5.7） |
| `ModelMetaCard` | 模型元数据展示（A 类识别摘要 + B/D 类详情**常驻完整展示**，dashed 次级分隔；无收起/展开开关） |
| `DownloadCard` | 下载功能卡片（`mode: 'library' \| 'tasks'` 双模式：URL 解析/搜索/文件选择/任务列表；推荐文件只作徽标/高亮/排序提示、**不自动勾选**，下载由用户主动勾选触发；提交下载走 `enqueueFiles`：Store 去重 + 本地同名检测 + 后端 ID 回填；URL 会话历史存 `useUrlHistory` 模块级单例，跨子标签 `v-if` 重建保留） |
| `ConfirmModal` / `CloseDialog` | 通用确认弹窗 / 退出确认弹窗（`useConfirm` 队列驱动） |
| `FileBrowserModal` | 文件/目录浏览弹窗（`useFilePicker` 队列驱动，dir/file/save 三模式） |
| `PresetsPanel` | 预设管理面板（低摩擦）：智能命名（alias→模型文件名自动同步输入框）+ **自适应保存按钮**（输入名已存在时自动变「覆盖预设」，同一入口完成保存/覆盖）；行内操作（应用/删除 `a-button size="small" class="row-action"`，删除带确认）+ **双击行直接应用**；列表 `onActivated` 与增删改后自动刷新（无手动刷新按钮）；保留名称↔绑定模型一致性确认（防「应用其他预设切换模型后沿用旧名保存」的错绑） |
| `ParamRow` + 控件 | 参数行容器 + `TextParam`/`IntEntryParam`/`SliderParam`/`CheckboxParam`/`DropdownParam`/`FileParam` 六类控件 |

### 7.5 样式系统（Arco Design Vue）

> `@arco-design/web-vue` 是 UI 的唯一组件与设计 Token 基础。主题由 `stores/settings.ts` 同时写入 `html[data-theme]` 与 `body[arco-theme]`；旧 `--*` 变量仅作为尚未迁移的业务组件兼容层，禁止在新增 UI 中使用。
>
> 新增 UI 必须优先使用 Arco 的 `Button`、`Form`、`Input`、`Select`、`Modal`、`Table`、`Tooltip`、`Tag` 等组件及其 CSS Variables。玻璃拟态、手写按钮体系和自定义浮层已停止加载；以下旧规范仅供剩余业务组件迁移期间参考。

**组件引入方式（2026-09 按需引入）**：组件由 `unplugin-vue-components` + `ArcoResolver`（`importStyle: 'css'`）在 vite 侧按需解析（`vite.config.ts` 的 Components 插件 `dirs: []`，禁止给本地组件自动注册）——新增 Arco 组件**无需显式 import**，模板 `<a-*>` 与对应样式按需打包；`src/components.d.ts` 为插件生成的**全局组件声明**（已入库，`vue-tsc` 依赖它做类型检查），删除组件/依赖后须验证其同步更新。`main.ts` 已移除 `app.use(ArcoVue)` 与全量 `arco.css`，仅保留全局 base CSS（`@arco-design/web-vue/es/style/index.css`）以维持主题变量。

#### 7.5.1 设计 Token（`packages/ui/src/styles/`）

> 2026-09 完全迁移后的现状：`theme.scss` 仅保留 **Electron 布局尺寸、业务语义色与迁移兼容层**，其余一律直接引用 Arco 的 CSS Variables（`--color-text-*` / `--color-fill-*` / `--color-bg-*` / `--color-border-*` / `rgb(var(--primary-6))` / `rgb(var(--success-6))` 等）。旧业务色板（`--accent`、`--bg-*`、`--fg-*`、`--shadow-modal/tooltip`、`--overlay` 等）已全部删除，禁止再引用。

- **强调色**：即 Arco 主色 `rgb(var(--primary-6))`（纯蓝）。交互强调（描边按钮、聚焦边框、选中行、激活 tab）一律用它；hover/选中态用 Arco 组件自带态或 `--color-fill-3`。
- **业务色 token**（`theme.scss`，不随主题切换）：`--btn-h`(30) / `--fs-appname`(16) / `--statusbar-blue`(#007acc) / `--badge-cat-*`、`--badge-quant-*`（下载分类/量化徽章色板；来源徽标不占色相，走中性 `--color-text-2` + `--color-fill-2`，见 §7.5.7）/ `--console-bg`(#1d2129)、`--console-fg`(#e5e6eb)（控制台/命令预览恒定深底，双主题不变）/ `--primary-fg`(#fff，实底主色上的文字)。
- **选中项底色** `--row-selected-bg`（`theme.scss`，随主题切换，2026-09-13 起）：浅色 = `rgb(var(--primary-1))`；深色 = `rgba(var(--primary-6), 0.2)` 半透明蓝染——深色下 `primary-1` 为比底色更暗的近黑藏青，整行铺满观感过重，故深色不用深色色块。三处选中态同源引用：模型表格选中行（含 hover 保色规则）、DownloadCard `.active`/`.checked`、FileBrowserModal `.is-selected`。
- **兼容层映射**（迁移完成前）：`--radius-pill/row/control: 4px`、`--fs-xs/sm: 12px`、`--fs-base: 13px`、`--fs-md/lg: 14px`、`--ease-smooth/jelly: ease`、`--dur-fast/med: 0.16s/0.2s`、`--shadow-dropdown: 0 4px 12px rgb(0 0 0 / 12%)`。业务组件只允许消费这些名字或直接用 Arco 变量；新代码优先直接用 Arco 变量。
- **字体**：正文走 Arco 默认栈；`--font-mono` = `'Cascadia Code', 'Cascadia Mono', Consolas, monospace`，数值/路径/命令一律 mono。
- **字号**（语义化，禁止裸 px）：`--fs-xs`(12 徽章/辅助) / `--fs-sm`(12 次要提示/状态栏/chip) / `--fs-base`(13 正文/输入/控制台) / `--fs-md`(14 按钮/列表项) / `--fs-lg`(14 卡片标题/参数名) / `--fs-appname`(16 应用名)。
- **布局度量**：`--topbar-h`(52) / `--sidebar-w`(224) / `--sidebar-w-collapsed`(48，与 Arco sider/a-menu 默认折叠宽一致，勿改 64) / `--statusbar-h`(28) / `--btn-h`(30)。
- **浮层**：阴影/遮罩走 Arco 组件默认（弹层/下拉自带实底 + 阴影）；业务兼容层仅保留 `--shadow-dropdown`（GeneralPanel 帮助面板等自建浮层用）。
- **硬编码禁令**：组件内禁止裸色值/裸字号/裸间距/裸阴影/裸数值圆角；颜色与阴影必须用 `var(--*)`；`#fff` 仅允许作为实底主色（primary/语义色）上的文字色。

#### 7.5.2 主题

- 主题双写：`stores/settings.ts` 的 `applyTheme` 同时设置 `html[data-theme="dark|light"]`（默认 light，2026-09-13 起；index.html 引导属性同源，深色/跟随系统需在「应用设置 → 外观」显式选择）与 `body[arco-theme]`；自定义 token 按 `data-theme` 切换，Arco 组件按 `arco-theme` 自动切换。
- **基调（2026-09 扁平化后）**：背景一律 Arco 面色——`body { background: var(--color-bg-1) }`，表面/输入/浮层用 `--color-bg-2/3`、`--color-fill-2/3`；文字用 `--color-text-1/2/3`。旧蓝白渐变（`--bg-app-gradient`/`--bg-grad-*`）与玻璃层（`.glass-layer`、`--glass-blur`）已随完全迁移移除。
- **对比度**：文字对比度按 Arco 默认令牌体系（双主题 AA）；业务例外仅控制台/命令预览（恒定深底 `--console-bg` + `--console-fg`）。**文字不用 `opacity` 削弱**。

#### 7.5.3 圆角体系（2026-09 扁平化：全站 4px 对齐 Arco）

- 圆角 token 已扁平化为单一值：`--radius-pill` / `--radius-row` / `--radius-control` 均为 **4px**（迁移兼容层，等同 Arco 默认圆角）。组件内禁止裸数值圆角。
- 组件圆角直接走 Arco 组件默认（输入框/选择器 2px、**a-tag 2px**（`--border-radius-small`）、按钮 4px 等），不要为「恢复旧观感」写覆盖；**例外**是筛选 chip 与彩色小徽章——按业务约定显式取 `--radius-pill`（4px，筛选标签/徽章语义，见 §7.5.4 ① 与 §7.5.7），DownloadCard 的 `.cat-chip` 与 `.source-badge` / `.quant-badge` / `.file-cat` / `.rec-badge` 均属此列。
- **例外（仅两项）**：`2px` 滑块轨道；`50%` 圆形（状态圆点、开关 knob、滑块 thumb、circle 图标按钮）。
- **边界**：多行文本容器（命令预览 `a-textarea` 等）圆角用 `--radius-row`（4px），禁用胶囊形；粘性表头用不透明背景（`--color-bg-2`）。

#### 7.5.4 间距规范

- **页面**：`padding: 20px 24px 24px`（`PageFrame.vue` 内联；`variables.scss` 已随迁移删除）；**分区风格**——`page-frame` / 各页 `.tab-content` 纵向 `gap: 0`，相邻内容区块由实线分隔（Card 底边线、Dashboard `.q-section + .q-section` 顶边线）；区块内元素间距 `gap: 10px` 为默认。
- **间距刻度**（组件内 gap 只允许以下刻度，全库逐项审计一致、无离群值——计数以 `pnpm style:audit` 第 4 条为准，勿在文档写死；**不设 1/2/3px 微间距档**，像素级收紧的紧凑原子内间距也一律取最小刻度 4px）：
  | 刻度 | 语义用途 |
  |---|---|
  | `4px` | 紧凑列表（文件列表项）、状态点与文本 |
  | `5px` | chip 内文本-计数徽章 |
  | `6px` | 卡片头操作/密集按钮组（cat-filter、tasks-actions） |
  | `8px` | **按钮组标准间距**（页面工具栏、行内操作区，§7.5.5） |
  | `10px` | 弹窗按钮组、状态栏元素、卡片内次级组 |
  | `12px` | 大分组（下载任务统计、Dashboard 统计组） |
  | `14px` | 卡片内**分组分隔线到内容**距离（`DownloadCard` / `DashboardPage` 的 `padding-top: 14px`；卡片之间的间距另有下条 16px） |
- **覆写 Arco 默认样式的两条硬规则（#65 ① / #68 / #70 三起实测教训）**：① 特异性必须**严格高于** Arco 的对应规则——**同特异会输**，因为组件样式由 `unplugin-vue-components` + `ArcoResolver` 在运行时以 `<style>` 注入、顺序排在打包 CSS 之后（页签标题即因此长期失效：`.arco-tabs .arco-tabs-tab-title` (0,2,0) 对上 Arco `.arco-tabs-nav-type-line .arco-tabs-tab-title` (0,2,0)）；② `gap` 只在 flex/grid 盒生效——给 Arco 元素加 `gap` 必须同时确认（必要时一并声明）它的 `display`。判据统一为「改完到真机读计算值 + 量几何间隙」，不看 CSS 写了什么。
- **图标 + 文本行**：同一行内的图标与其文字标签间距取 **6px**（页内页签标题、`SettingsPage .summary-item`、状态栏条目同规）。
- **数值型组件单位约定（对接 Arco 前必须核源码，STYLE_TODO #71）**：`a-progress` 的 `percent` 是 **0–1 小数比值**（`line.js`：`width = percent × 100%`、文本 `percent × 100 + '%'`）——传百分数会让进度条从第一步就钉满，与真实字节数脱钩；`a-slider` 走 `min`/`max`/`step` 原值；`a-switch`/`a-checkbox` 走布尔 `model-value`。`style:audit` 第 13 条对 `:percent` 绑定做静态拦截（含 `100` / `Pct` 即 ❌）。
- **顶栏条与相邻区块间距**（2026-08-29 统一）：页面顶部的条形容器（tab-strip、status-summary、toolbar、params-status-bar、status-bar、stats-row）与上一/下一区块的间距**一律 8px**——models 由 `.tab-content { margin-top: 8px }`、settings 由 `.status-summary { margin: 8px 0 0 }`（内容间距由 `.tab-content` margin-top 提供）、logs 由 `.toolbar { margin-bottom: 8px }`、params/downloads 由状态条 `margin-bottom: 8px` 提供。
- **分隔线节奏**（分区风格实线分隔，2026-08-29 统一；**线两侧均 14px**）：① **主分隔**（`1px solid var(--border)`，内容区块之间）——Card 底边机制（体 `10px 0 14px`，线下由下一区块 header 的固定高自然留白）；顶边线变体（Dashboard `.q-section + .q-section`、DownloadCard `.tasks-section`）`padding-top: 14px`，**线上方**同样 14px——Dashboard 由 `.q-section { padding-bottom: 14px }` 提供，DownloadCard 由容器 flex gap 8px + `.tasks-section:not(:first-child) { margin-top: 6px }` 补足（任务模式下为首子块，不加）。② **次级分隔**（`1px dashed var(--border)`，块内详情/次要内容，如 ModelMetaCard `.meta-chips.details`）`padding-top: 8px`，上方由 `.meta-body` gap 8px 提供（8/8 对称）。③ **标题下划线**（组标题 `border-bottom`，如 ParamSummaryCard `.summary-group-title`、DownloadCard `.group-title`）`padding-bottom: 4px`；同族体例的**卡片内小节标题**（DownloadCard `.section-title`，行头左侧标题 + 右侧操作）字号字重字距与组标题同规（`--fs-sm` / 600 / `--color-text-2` / uppercase / `letter-spacing: .5px`）但不加下划线。④ **表格行分隔**：单元格 `padding: 6px 8px`（§7.5.4 表格）。弹窗内部分区条（FileBrowserModal 头/底 `12px 14px`、路径/保存行 `8px 14px`）为弹窗专属尺寸，不套用。
- **分区体（`Card.vue`）**：`a-card :bordered="true"` **原生内距**（不再自定义 `padding: 10px 0 14px`——该写法随 Arco 迁移已删，代码里 0 命中），卡片之间间距由 `.section-card { margin-bottom: 16px }` 承担；标题走 `#title` 插槽（`a-space` 承载标题与 `title-extra`），操作区走 `#extra` + `a-space :size="6"`（见 STYLE_TODO #21 与本节「卡片操作区」约定）；无 accent 竖条（2026-09 移除 compact 变体，全应用统一标准标题体例）。
- **组件 padding 约定**（2026-08-29 统一，见 STYLE_TODO #21）：padding 属控件尺寸而非元素间距，不受 gap 刻度表约束，但同类元素必须同值——① `fs-xs` 彩色小徽章统一 `1px 6px`，且**一律用 `a-tag size="small"` 承载**（禁止自绘 `<span>` 胶囊；色走 `--badge-*` token + `color-mix` 半透明底，见 §7.5.7）；**a-tag 不渲染 `.arco-tag-content` 包装层**（插槽子节点直接挂在 `.arco-tag` 根上），因此芯片内部各段（key / `=` / value、文本 / 计数）的 `gap`、`align-items` 一律写在 a-tag 根类上，内部文本间距取刻度 `5px`——写成 `:deep(.arco-tag-content)` 是匹配不到的死规则（STYLE_TODO #69）；② `fs-sm` 交互 chip 统一 `3px 8px`；③ 信息展示胶囊（状态栏 clickable 值；旧 `version-badge` 类已随 Arco 迁移删除，侧栏版本号为 `a-typography-text.version`）统一 `2px 10px`；④ 非胶囊的行/条纵向微间距（提示条、分页条、帮助热区、标签下划线间距）一律 ≥4px；⑤ 参数行 `padding: 4px 8px`（§7.5.7）；⑥ 固定高筛选控件：级别筛选用 `a-radio-group type="button" size="small"`、类别筛选用 checkable `a-tag`（Arco 默认即 24px 高 / `0 8px` 内距），不要额外写尺寸覆盖；⑦ 独立居中文本空态（`.empty`）统一 `padding: 20px`——其余空态为不同语义变体、各自内部统一（弹窗 `.fb-empty` `24px 14px`、区块内 `.empty-msg`/`.target-recs-empty` `8px`、大图标 LogsPage `.empty-log` `40px 20px`）。保留的光学对齐例外：Card 标题左缩进 `0 0 0 2px`（uppercase 字面补偿）。
- **按钮组**：`display: flex; gap: 8px`（页面工具栏、行内操作区）；弹窗按钮 `gap: 10px`；卡片头操作 `gap: 6px`。
- **常用控件高度**：一律 Arco 组件默认（`a-button size=small` 28 / 输入 `a-input size=small` 28 / 默认 32；自建浮层内按钮 28–32）；仅 TopBar 主操作与 `--btn-h`(30) 为业务约定；win-btn（窗口控制）46 宽为 Electron 专属例外。
- **表格**：一律 `a-table`（`size="small"` 单元格内距由 Arco 承担，实测 `5px 16px`）；**不自定义 sticky 表头与背景**（`position: sticky` / `--bg-card` 在 `packages/ui/src` 全 0 命中——旧自绘表格时代的规则，Arco 迁移时已删，勿再补写）。`col-*` 类名是 `PresetsPanel` **列表行**的列宽约定（`.col-name` / `.col-time` / `.col-model`），与表格无关。
- **统一控件宽度**：参数控件 `label-col` **定宽 124px + 右内距归零**（**必须 `flex: 0 0 124px` + `min-width: 0` + `padding-right: 0`**，**右对齐** + `margin-right: 8px`，长标签省略号截断）。取值依据（STYLE_TODO #72/#73/#78 实测）：离屏探针（**必须用标签真实字体** `14px Inter/PingFang` 栈，13px 会低估 7%）量 60 行标签自然宽，最长「每槽位统一 KV 上限」= **122.8px** → 可用 124 只剩 1.2px 余量，**这一列不能再降**。⚠️ **Arco `.arco-form-item-label-col` 自带 `padding: 0 16px 0 0`**：旧写法「定宽 140 + `margin-right: 8`」的实际可用是 `140 − 16 = 124`（不是文档曾写的 132），而标签与控件之间实际空 `16 + 8 = 24px`——**§7.5.4 一直写的 8px 从未为真**。归零右内距后「列宽 = 可用宽」，同一可用值省 16px 行宽、间距回到规范值（#78）。两条硬判据：① Arco 原生 `flex: 0 0 auto` 让标签按文字宽自适应（实测 28–93px 九种），同列控件起点逐行漂移（x 318→380）；② **不能用设置面板那套 `0 1`（可收缩）**——参数行控件（滑块 + 76px 数字框 + 72px 提示槽 + 24px 还原槽）占满行，收缩只会落在标签上（实测缩成 64/83px，控件重新错位）。落点：`ParamRow.vue` 以 `:deep(.arco-form-item-label-col)` 统一施加（每行自带独立 `a-form-item`、无外层 `a-form`，故不走 `label-col-style`）；设置面板三面板仍走组件原生 `label-col-style`（110 / AdvancedPanel 140px）。控件列内：`num-input` 撑满（`IntEntryParam` 的 `a-space` / `a-input-number` `width: 100%`）、下拉触发器 `dropdown-trigger` 宽 100%、滑块项 `flex: 1` + 数字项固定 **76px**（6 位值 `262144` 实测 `scrollWidth ≤ clientWidth`，13/13 只滑块零溢出；旧 88 是拍的档）、**行尾两个装饰一律常驻定宽槽**：`.gguf-hint-slot`（`flex: 0 0 72px`）承载建议值芯片、`.clear-slot`（`flex: 0 0 24px`）承载还原 ✕，**芯片/按钮本身 `v-if`（`v-if` 挂在 `ToolTip` 上以免渲染空 host），槽位恒在**——判据是「同一列 60 行的控件宽与槽位 x 各只有一个值」（#72 曾把 ✕ 判为「瞬时态不预留」，实测残留 `控件宽 [176, 148]` 两值 + 提示槽 x 被左移 28px，用户 2026-09-20 批注后改为预留，见 STYLE_TODO #77）。**唯一不预留的是 `.dep-hint` 警示图标**（4+14px）：`syncDependencies` 会把依赖不满足的参数重置回默认，只有 `file`/`dir` 型保留路径（`resetDep` 早退），而 11 条 `dependsOn` 中 `file` 型仅 `spec_draft_model` 一条 → 该状态最多命中 1/60 行，为它常年预留 18px 会把网格最小轨从 418 推到 436（1156 视口因此少一列），不划算。**定宽 flex 槽位一律配 `min-width: 0`**（默认 `min-width: auto` 会被长内容撑破：实测 72px 槽被 30 字别名提示撑到 222px，控件反而缩到 146px、输入框内部宽 0px）。
- **参数滑块一律不开 `show-ticks`**：Arco 刻度按 `step` 逐格建 `<div>`（`slider-ticks.js: floor((max-min)/step)`）且 `isActive` 依赖 value → 拖拽时每帧重算，「缓存重用大小」(0..262144 step 32) 单只 8195 节点、占参数页 DOM 84%。**不得改成按步数门控**（`(max-min)/step ≤ 40` 才画）——实测那样 13 只滑块只有「温度」有刻度，同页混排即样式不统一（#73）。
- **展示字段与表单行（2026-09-07 原生化，值盒标准废止）**：只读字段区用 `a-descriptions`（多列 `:column` + `:span` 整行字段；可复制值用 `a-typography-text copyable`，`@copy` 内走 Electron 剪贴板兜底）；设置表单行用 `a-form`/`a-form-item`（标签定宽右对齐走组件原生 `label-align` + `label-col-style`，行距 4px）。旧 boxed 值盒（26px 胶囊）与 InfoStrip 组件已删除，禁止复刻同类自绘布局。

#### 7.5.5 按钮规范（2026-09 全站 `a-button` 化）

旧自定义按钮体系（`btn`/`action-btn`/`mini-btn`/`tab-btn`/`modal-btn`/`dl-btn`/`fb-btn`）已全部删除，按钮一律使用 `a-button` 并按语义取型：

| 场景 | 用法 |
|---|---|
| 页面/卡片主操作（启动、保存、解析） | `a-button type="primary"`（默认尺寸） |
| 行内次级操作（复制、浏览、打开目录） | `a-button size="small"` |
| 危险操作（停止、清空、删除） | `a-button status="danger"`（实底或 `warning`/`danger` 描边按语义） |
| 表格行内/紧凑位 | `a-button size="mini"` |
| 图标钮（参数还原 ✕ 等控件语义） | `a-button type="text" size="mini" shape="circle"`（豁免「文本内联」规则） |
| TopBar 窗口控制（最小化/最大化/关闭） | `a-button type="text"` + `.win-btn` 窗口铬覆盖：46×52 贴边热区、`--radius-control` 圆角、关闭钮红色 hover；点击走 Electron 窗口协议（Arco 无窗口控制组件） |
| 页内页签 | `a-tabs`（勿再用按钮拼装） |

- **描边/状态语义**：操作=primary/accent、危险=danger、警告=warning，均优先 Arco 预设；hover 态交给 Arco，不手写背景色。
- **文本内联**：内容区操作按钮一律图标+文案（`#icon` 插槽 + 文本），禁止纯图标操作按钮；豁免：win-btn 窗口控制、输入框 allow-clear ✕、还原 ✕、导航 chevron——控件/导航/披露语义，非操作按钮。
- **按钮组**：`display: flex; gap: 8px`（页面工具栏、行内操作区）；弹窗按钮组 gap 10px；卡片头操作 gap 6px。

#### 7.5.6 浮层（2026-09 玻璃体系移除）

- 玻璃拟态已随完全迁移**彻底删除**：`--glass-*` token、`.glass-layer` 类、`backdrop-filter` 在 `packages/ui/src` 全 0 命中（连兼容映射都不再保留，2026-09-19 核对），**任何新代码不得使用 `backdrop-filter`**。
- 弹窗（`a-modal`）、下拉（`a-dropdown`/`a-select`/`a-trigger`）、工具提示（`a-tooltip`）、Popconfirm 一律 Arco 组件默认：实底面板 + Arco 自带阴影/动画，popup 挂 body。**自建浮层仅剩两处**（GeneralPanel 引擎帮助面板、`--shadow-dropdown` 兼容引用），不再新增。
- 浮层内容排版：面板圆角/边框/背景走 Arco 默认；条目类（`a-doption`）hover 态走 Arco 默认，不手写背景。
- **多行 tooltip 必须走 `#content` 插槽**：`a-tooltip` 的 `content` prop 渲染出的 `.arco-tooltip-content` 是 `white-space: normal`，传 `label\nhelp` 这类多段文本会被折成一行（实测高 30px）。`ToolTip.vue` 已改为插槽 + 自有 `.tooltip-text { white-space: pre-line }`（popup 虽传送 body，scoped 属性仍随元素走，故样式生效；实测三段文本高 74px）。新增多行浮层一律复用 `ToolTip` 组件，不要退回 `content` prop。
- **提示机制边界（STYLE_TODO #74/#75，2026-09-19 收敛）**：**页面级与铬面上的固定少量元素一律 `ToolTip`**——顶栏 8 钮（含 win-btn）、状态栏 2 个复制钮、卡片头/工具栏操作钮、参数状态条统计块与三个操作钮、设置面板按钮、文件浏览弹窗「上级」、下载卡片的站点/目录按钮、服务状态卡的状态徽章与按钮、参数行三处（标签 / 建议值芯片 / 还原 ✕）。原生 `title` 不受主题控制（深色下仍是系统白底）、约 1s 延迟、承载不了多段文本，一律禁用。
- **仍保留原生 `title` 的三类（明确边界，勿顺手改）**：① Arco 组件的 `title` **prop**（`a-modal` / `a-popconfirm` / `a-statistic` / `a-dgroup`）与 `iframe title`（无障碍名）——不是浮层；② **`v-for` 数据条目上的提示**（模型表格行、下载任务行、预设行、`ParamSummaryCard` / `targetRecs` 的 chip）——每条目挂一个 Arco trigger 实例与 §7.1 热路径铁律相冲；③ **截断值提示**（`.mono-val` / `.file-name` / `.task-name` / `.task-error` / `.summary-label` 等长路径与长 URL）与 `a-input :title`（外包 host 会动到表单控件盒型）。实测全站原生浮层由 **60 处降到 33 处 `:title=`**（另有 1 处 `iframe title` 无障碍名与 6 处组件 prop，合计 34/40 视 grep 口径），转换 26 处 / 9 文件；`<ToolTip` 使用点 **35 处 / 16 文件**。
- **交互控件外包 `ToolTip` 的两条实测注意**：① `<a-button>` 包一层后几何零变化（host 与按钮同盒；`ParamRow` 还原 ✕ 仍 24×24、行高 38px），但元素自带 `v-if` 时**必须把 `v-if` 移到 `ToolTip` 上**（否则渲染空 host 与空浮层；`v-if`/`v-else` 成对的要一起移到两个 `ToolTip` 上以保持指令链相邻）；② **`a-dropdown` 的触发器包 `ToolTip` 仍可用**——Trigger 事件挂在 host 上、点击由按钮冒泡触发，弹层锚点即 host 盒（实测顶栏模型下拉中心 x=493 与触发器中心一致、参数页性能目标下拉 `position="bl"` 弹层 x 恒等于触发器 x=723）。
- **非 scoped 样式块的命名空间**（popup 传送 body 时必需）：块内**每个顶层选择器都必须含至少一个组件私有类**，禁止只由 Arco 全局类名构成（否则会全局命中其他使用点）。范式：ParamsPage `.target-menu …`、GeneralPanel `.exe-help-panel …`、DownloadCard `.arco-dropdown-list:has(> .url-history-item) .arco-dropdown-group-title`（`a-dgroup` 渲染为 Fragment、标题 `li` 无法挂私有类，故用 `:has()` 反查）。审计第 11 条固化。
- 例外：状态栏深蓝底上的白色半透明 hover（`rgba(255,255,255,.15)`）为**表面着色**而非 elevation；chip 计数底（`color-mix` 半透明底）同类，均不纳入阴影 token。

#### 7.5.7 常用模式

- **参数行**（`ParamRow` 统一承载，控件全部 Arco）：行容器 `padding: 4px 8px` + 圆角 `var(--radius-row)`，默认透明描边；hover 底色 `--color-fill-3` + 边框 `--color-border-2`；**值 ≠ 默认时边框 `rgb(var(--orange-6))`**（与还原按钮同色系）；依赖未满足同色描边 + 底色 + `a-tooltip` 警示图标；文件/目录类型渲染 `a-input-group` 文件选择控件。
- **参数行不得开 `allow-clear`**（STYLE_TODO #74）：Arco 输入框自带清除 ✕（`.arco-input-clear-btn`，平时 `visibility: hidden`、hover 有值时现形），会与行级「还原默认」✕ 同屏 = 一行两个 ✕；且它写入**空串**而非参数默认值（`host` 清空即触发 `err_invalid_host`），与行级按钮语义冲突。参数行的还原入口唯一——行级 `.clear-btn`。
- **建议值芯片族统一**（`.gguf-hint` 参数行 / `.suggestion-chip` 模型页「建议参数」/ `.rec-chip` 性能目标联动建议，实测全档同值）：`a-tag size="small"`（h20 / 圆角 2px / 内距 `0 8px`）+ `font-family: var(--font-mono)` + `font-size: var(--fs-sm)`；承载 `key = value` 的两族再配 `gap: 5px` + `.chip-key`（`rgb(var(--primary-6))` 600）/`.chip-eq`（`--color-text-3`）/`.chip-val`（`--color-text-1`）三段配色（Arco 不渲染 `.arco-tag-content`，故 gap/align 写在 a-tag 根类上，§7.5.4 ① / #69）。数值一律 `v.toLocaleString()`（三族 formatter 同写法，实测「32,768」不是离群值；当前挂在参数行上的数值字段最大 7 位（`context_length` ≤ 262,144），千分位不会吃掉 7 字省略预算，**若将来挂上 ≥7 位字段需重新核**）。
  - **配色与光标只有一条规则**：`color="arcoblue"` 蓝底 + `cursor: pointer` = **芯片自身可点击应用**；灰底 + `cursor: help` = **只展示、悬浮看说明**。只读档的来由在后端：`buildSuggestions` 刻意不为纯参考信息（`context_length` 训练上限、`rope.freq_base` 等）产生建议——`-c` 默认 0 即从模型加载，逐项建议反成混淆源（`core/src/gguf-meta.ts` 注释），所以参数行会出现「模型自带值」灰芯片（实测 8 条中 2 条：上下文长度 / 聊天模板）。**灰档不得留 `cursor: auto`**——与蓝档只差底色、悬停零反馈，会被读成「坏掉的建议芯片」（#77 追加）。同一词汇表也用于 `.dep-hint` 警示图标。
- **GGUF 建议值芯片**（`.gguf-hint`，定宽 **72px** 常驻槽 `.gguf-hint-slot` 内）：长值**必须由 JS 做中间省略**（头 4 + `…` + 尾 2，**7 字**为实测上限：mono 12px ≈ 7.03px/字 → 7 字 49.2 + Arco 原生 `0 8px` 内距 + 1px 边框 ×2 = 67.2 ≤ 72，留 4.8px 字体回落余量），不能指望 CSS `text-overflow: ellipsis`——`a-tag` 是 `inline-flex` 且无内容包装层（§7.5.4 ① / #69 同源），CSS 省略号根本不生效，30 字别名建议会被硬切成无提示的 "Qwen3-32B"。尾部保留是因量化后缀/单位才是区分信息；**完整值 + 参数名 + 操作提示三段进 `ToolTip`**（禁原生 `title`，它承载不了多段文本）。
- **参数网格**：`param-grid`（参数设置页）`repeat(auto-fill, minmax(418px, 1fr))`，**不设 `max-width` 上限**（2026-09-20 起，见 STYLE_TODO #76）、gap `4px 14px`、≤720px 单列；装饰一律 Arco 主色蓝 `rgb(var(--primary-6))`。
  - **最小轨 418px 的推导**：一行参数的最小舒适宽 = 边框 2 + 行内距 16 + 标签列 124 + 8 + 控件 ≥164（滑块轨道 80 + 间隙 8 + 数字框 76）+ 4 + 提示槽 72 + 4 + 还原 ✕ 槽 24 = **418**（等价式：`控件宽 = 轨宽 − 254`）。演进：#76 写 400 时少算了行的 2px 边框与 16px 内距（实测 413px 轨道上控件只剩 171、轨道 75px，低于 #73 的 80px 下限）；#77 为还原 ✕ 增设常驻槽 +28 → 450；**#78 回收两处虚胖**——标签列里 Arco 自带的 16px 右内距（归零，可用宽不变）+ 数字框 88 → 76（6 位值实测零溢出）+ 提示槽 76 → 72（省略预算 8 → 7 字）= −32。**不得为凑列数下调轨道下限（80px）**：380px 时 1920 虽能排到 4 列，但轨道被压到 **55px**；340px 时 1440 排 3 列、轨道仅 **31px**。
  - **不设上限的理由（实测）**：旧 `max-width: 1160px` 硬封顶 3 列，卡片可用宽 ≥1326px 后全部变成右侧空白——1920 空 **486px**、2560 空 **1126px**（近半宽度未用）。现列数随宽度单调增长且 `waste=0`（下表为 #78 紧凑化后逐视口复测；对照 #77 的 450：1600 由 2 列回到 3 列、2560 由 4 列回到 5 列）：

    | 视口 | 网格宽 | 列数 × 轨宽 | 控件宽 | 滑块轨道 | 标签截断 |
    |---|---|---|---|---|---|
    | 1156 | 840–850 | **1 × 840**（无 12px 内容滚动条时 2 × 418） | 586 | 502 | 0 |
    | 1280 | 974 | 2 × 480 | 226 | 142 | 0 |
    | 1440 | 1134 | 2 × 560 | 306 | 222 | 0 |
    | 1600 | 1294 | 3 × 422 | 168 | 84 | 0 |
    | 1728 | 1422 | 3 × 465 | 210.7 | 126.7 | 0 |
    | 1920 | 1614 | 3 × 529 | 274.7 | 190.7 | 0 |
    | 2560 | 2254 | 5 × 440 | 185.6 | 101.6 | 0 |

    ⚠️ **列数阈值是算术，不是感觉**：`n` 列成立 ⇔ `网格宽 ≥ n × 418 + (n−1) × 14`，而 `网格宽 = 视口 − 侧栏 224 − 页面内距 48 − 卡片内距 32 − 内容滚动条 ~12`。故**两列需视口 ≥ ~1170**、三列 ≥ ~1590、四列 ≥ ~2010。1156 那一行两种读数都出现过（内置浏览器带 12px 内容滚动条 → 840 → 单列；无头 Chromium 无该滚动条 → 850 → 两列），**报列数必须先量当次网格宽**，别拿一个环境的读数当结论。要把 1156 也稳进两列需最小轨 ≤413，代价是滑块轨道跌到 75px（低于 80 下限）——按 #76「控件可用性优先于列数」不取。

  - 各列宽下对齐不变量恒成立（Playwright 逐视口实测 60 行）：标签列宽 `[124]` 单一值、**控件宽每列恰一个值（不再是 `[176, 148]` 两值）**、提示槽 x 与 ✕ 槽 x 每列各一个值（出现/消失不再平移）、0 行标签截切（判据用文本承载元素的 `scrollWidth > clientWidth`，不是 label 自身——Arco 把文字包在 `.tooltip-host` 里，只比 label 会漏判）、0 刻度节点、芯片 0 裁切、滑块数字框 0 溢出。
- **筛选 chip 选中态**：`checkable a-tag` 的 hover/选中态**一律走 Arco 自带态**，不覆写 `.arco-tag-checked` 等 Arco 内部态类（审计第 12 条）；需可见选中底时用 Arco `color` prop（DownloadCard 类别筛选取 `color="arcoblue"`，选中底 = `rgb(var(--arcoblue-1))` / 深色 `rgba(var(--arcoblue-6), .2)`，与 `--row-selected-bg` 同源）。筛选组间距 6px（§7.5.4 刻度表）。
- **列表行两种既定变体**（禁止第三种）：① **原生行**——`a-list` 默认（`split` 分隔线 + `size` 内距），如 PresetsPanel；② **紧凑可选中行**——`a-list :split="false"` + 行容器自带 `border` / `--radius-row` / `--color-fill-2` 底与内距（行内距归零须对齐 Arco 特异性：`:deep(.arco-list-content-wrapper .arco-list-content > .arco-list-item) { padding: 0 }`——普通 `:deep(.arco-list-item)` 会被 `size="small"` 规则压掉、实际不生效，真机实测为 9px 20px），承载整行点选、`--row-selected-bg` 选中态与行内徽章，如 DownloadCard `.file-item` / `.result-item`、FileBrowserModal `.fb-row`。除 `padding: 0` 外不得覆写 `a-list` 内部样式（分隔线用 `:split` prop；`.arco-list` / `.arco-list-item` 本身无背景色，无需覆写背景）。**两条落地要点（STYLE_TODO #68 实测）**：① Arco 会把默认插槽包进 `.arco-list-item-main > .arco-list-item-content`（均 `display: block`），行容器自带的 `display: flex` + `gap` 因此全部落空——必须对这两层写 `display: contents`，插槽子节点才会成为行的 flex item（`flex: 1` 撑开、`gap` 生效、徽章右对齐、文本省略号可用）；② 行类与 `.arco-list-item` 是**同一元素**，为压过 Arco `size="small"` 而写的同构选择器特异性更高，行的 `padding` 只能写进那条规则里（写在行类上会被自己清零）。
- **布局范式**：内容区一律 flex（`display: flex` + gap 刻度）；`display: grid` 仅限本节的 `param-grid`。
- **状态指示**：自绘状态小圆点已随 Arco 迁移删除（`width: 7px/8px` + `border-radius: 50%` 圆点在 `packages/ui/src` 0 命中）——`StatusTag` 用 `a-tag` + `a-spin` 承载，状态栏用 `a-tag` 色胶囊；`border-radius: 50%` 仅保留给开关 knob / 滑块 thumb / circle 图标按钮等 Arco 原生形态（STYLE_TODO #50 🟢 已修复，2026-09-09）。
- **悬浮提示文本色**：`color-mix(in srgb, rgb(var(--success-6)) 12%, transparent)` 底 + 同色边框/文字（如 PresetsPanel 的 applied-msg）。
- **下载徽章体系**（`a-tag size="small"` 原生承载，禁止自绘 `<span>`；盒模型按 §7.5.4 ①：`1px 6px` + `--radius-pill`；两种主题恒定）：① **类别族** `.file-cat`——色走 `--badge-cat-*`，底 `color-mix(in srgb, var(--badge-cat-*) 14%, transparent)`，`cat-other` 用 `--color-text-3` + `--color-fill-3`；② **量化族** `.quant-badge`——按 `parseQuantization` 的 family 取 `--badge-quant-*`（14%，legacy/fp32 为 16%）；③ **来源族** `.source-badge`——**中性配色**（`--color-text-2` + `--color-fill-2`），不占色相、以文字区分（色相预算已被 ①② 占满，取彩色必与同行属性徽章撞色）；④ `.rec-badge` 实底主色 + `--primary-fg`。**来源标识在「模型文件」区标题与下载任务行各出现一次**，解析信息行不重复显示。
- **动效**：`--ease-*` 已归平为 `ease`、时长 `--dur-fast`(0.16s)/`--dur-med`(0.2s)；**只允许动 transform/opacity**，禁布局动画；**按钮按压不做整体缩放**（按压反馈 = 背景/边框色变化）；`prefers-reduced-motion` 下全部关闭。
- **复制按钮统一**（2026-08-29，见 STYLE_TODO #26）：行内复制操作一律 `a-button size="small"` + `#icon`（`Icon name="copy" :size="12"`）+ 文案（复制地址 `copy_url` / 复制模型名 `copy_model` / 复制命令 `copy_cmd`），点击后文案临时切换为"已复制"反馈；不使用纯图标迷你按钮。内容项（值胶囊/URL 条等）配对文字描述标签（样式同 `.info-label` 语义：次级色、贴内容 8px）。**状态栏为特例**：值即按钮——`a-button type="text" size="mini"` 基座 + 状态栏铬覆盖（胶囊/白字/`--statusbar-hover` 表面着色），点击复制 + tooltip + "已复制" tag。
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
- [ ] 控件一律 Arco 组件（按钮/输入/下拉/开关/弹窗/浮层），不新增自定义交互控件；**内容区操作按钮一律文本内联**（图标+文案；豁免：win-btn 窗口控制、搜索框清除 ✕（**参数行不得开 `allow-clear`**，见 §7.5.7）、参数还原 ✕、导航 ↑、披露 chevron——控件/导航/披露语义）
- [ ] 按钮组用 flex + gap（8px 标准）
- [ ] 无任何 `backdrop-filter`（玻璃体系已移除）
- [ ] 非 scoped 样式块的每个顶层选择器都含组件私有类（禁裸 Arco 全局类名，§7.5.6）
- [ ] 未覆写 Arco 内部态类（`.arco-*-checked` / `-active` / `-selected` / `-disabled` 等）；筛选/选中态走 Arco 自带态或 `color` prop
- [ ] 徽章/胶囊一律 `a-tag` 承载，不自绘 `<span>` 胶囊；徽章按 §7.5.7 三族取色（来源族中性、不占色相）；**同族芯片同档**（建议值三族 = `size="small"` + mono + `--fs-sm` + Arco 原生 `0 8px` 内距，禁尺寸/内距覆写；蓝底只留给「芯片本身可点击」，§7.5.7）；列表行只用 §7.5.7 的两种变体，布局不用 grid（`param-grid` 除外）
- [ ] 行/条内的**装饰元素一律常驻定宽槽**（槽恒在、内容 `v-if`）：出现/消失不得改变同列其它元素的宽度或起点（判据＝同列 distinct 取值收敛为 1，§7.5.4「统一控件宽度」/ STYLE_TODO #77）
- [ ] 动画只动 transform/opacity 且 ≤0.3s，`prefers-reduced-motion` 下关闭
- [ ] 深色/浅色主题都检查一遍（`html[data-theme]` + `body[arco-theme]`；控制台/命令预览恒定深色面）
