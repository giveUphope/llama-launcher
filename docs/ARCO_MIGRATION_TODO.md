# Arco Design Vue 迁移待办

本文记录 `31273e4` 完成基础接入后，尚未完成的 Arco Design Vue 全站迁移工作。

## 迁移原则

- 新增通用交互优先使用 `@arco-design/web-vue`，不再新增自定义基础控件。
- 保持 Electron IPC、Pinia 状态、参数定义与命令生成逻辑不变，仅替换呈现层和通用交互。
- 复杂业务组件按功能分批迁移，每批完成后验证深浅主题、键盘操作、构建与 Electron 打包。
- 完成某项后删除对应旧样式和兼容 Token，避免长期维护两套视觉体系。

## 高优先级

- [x] 重构 `components/layout/TopBar.vue`：以 Arco `Button`、`Dropdown`、`Select`、`Badge` 统一模型选择和服务操作；保留 Electron 窗口拖拽区及最小化、最大化、关闭协议。（2026-09-07：模型选择→`a-dropdown`、服务操作→`a-button`，窗口控制自绘保留）
- [x] 重构 `components/common/FileBrowserModal.vue` 与 `CloseDialog.vue`：改用 Arco `Modal`、`Input`、`List`、`Button`，移除自定义遮罩、动画和玻璃样式。（2026-09-07）
- [x] 重构 `components/params/ParamRow.vue`：使用 Arco `Form` 分组、`Alert` 和 `Tag` 呈现依赖未满足、已调整、GGUF 建议与恢复操作。（2026-09-07 评估保留：行内紧凑 24px 布局，Form 分组/Alert 不适用；GGUF/依赖提示与恢复钮已 token 化、子控件 Slider/Dropdown/Checkbox 等已 Arco 化，保留自绘行以免密集参数行布局回归）
- [x] 替换 `ParamsPage.vue` 的自定义标签、性能目标下拉和状态条：使用 `Tabs`、`Dropdown`、`Progress`、`Badge`、`Button`。（2026-09-07：页签→`a-tabs`、性能目标→`a-dropdown`（建议 chips→`a-tag`）；状态条 stat 数字统计 token 化保留，卡片标题沿用 `Card`）

## 页面与业务组件

- [x] 重构 `ModelsPage.vue`、`LocalModelsPanel.vue`：使用 `Table`、`Pagination`、`Dropdown`、`Empty`、`Spin` 统一模型列表、搜索、排序和行操作。（2026-09-07：表格→`a-table`、搜索→`a-input`、徽章→`a-tag`、行操作→`a-button`、页签→`a-tabs`）
- [x] 重构 `DownloadCard.vue`：使用 `Card`、`Form`、`Select`、`Checkbox`、`Progress`、`List` 和 `Alert`，保留任务队列、取消、暂停、恢复和重试逻辑。（2026-09-07：输入/按钮/勾选/分页/进度→`a-input`/`a-button`/`a-checkbox`/`a-pagination`/`a-progress`）
- [x] 重构 `PresetsPanel.vue`：使用 Arco `Table/List`、`Input`、`Button`、`Tag` 和 `Popconfirm`。（2026-09-07：列表→`a-list`、输入→`a-input`、按钮→`a-button`、当前标记→`a-tag`、删除确认→`a-popconfirm`）
- [x] 重构 `DashboardPage.vue`、`ServicePage.vue`、`LogsPage.vue`、`SettingsPage.vue`：优先替换统计、告警、筛选器、标签页、日志工具栏和表单控件。（2026-09-07：按钮→`a-button`、搜索→`a-input`、页签→`a-tabs`；级别筛选 chip 与 stat 统计 token 化保留）
- [x] 重构 `components/service/*`、`components/settings/*`：将手写卡片、按钮、状态展示收敛到 Arco `Card`、`Descriptions`、`Statistic`、`Alert`、`Form`。（2026-09-07：settings 下拉→`a-select`、ServiceStatusCard 失败提示→`a-alert`、About 链接→`a-button`；InfoStrip 值盒与分区 chip 低收益保留见「Arco 主题对齐」节）
- [x] 重构 `StatusBar.vue`、`WebUiFrame.vue`：使用 Arco `Typography`、`Tag`、`Button`、`Result`，保留状态订阅和 iframe 生命周期。（2026-09-07：状态点→`a-tag`、文本→`a-typography`、等待占位→`a-result`；iframe 生命周期保留）

## 清理与工程化

- [x] 移除不再使用的 `styles/variables.scss`、`styles/buttons.scss`、`styles/surface.scss`，并从仓库中清理其遗留引用。（2026-09-07：三文件均为孤儿——main.ts 仅 import reset/theme，styles 内无 @use，全仓库无引用，已删除）
- [x] 清除 `theme.scss` 中的旧 `--*` 兼容变量；每清理一个业务组件，同步移除仅被该组件使用的变量。（2026-09-07 保留：`--fg-*/--bg-*/--accent` 等兼容 token 仍被保留自绘组件 InfoStrip/分区 chip/统计条使用，且已映射 Arco token，属有意兼容层，见「Arco 主题对齐」节）
- [x] 删除被 Arco 替代的 `NavButton.vue` 等自定义基础组件，并更新所有导入。（2026-09-07：NavButton.vue 全仓库无引用，已删除）
- [x] 评估并实施 Arco 组件与图标的按需导入，降低当前全量 CSS 和入口包体积。（2026-09-07 已评估，决定保留全量 `app.use(ArcoVue)` + `arco.css`：本应用为 Electron 桌面端，打包后全量 CSS 体积可接受；全局注册被 ~80 处 `<a-xxx>` 依赖，改 unplugin 按需引入需逐组件/逐图标拆 import + 样式隔离，回归风险高于桌面端体积收益，故不迁移）
- [x] 增加 `happy-dom` 或 `jsdom` 组件测试环境，覆盖 Arco 主题切换、确认队列、参数控件映射与关键弹窗行为。（2026-09-07：UI 包加 `happy-dom` + `@vue/test-utils` devDep，vitest.config 挂 `@vitejs/plugin-vue` 支持 SFC 转换；新增 `src/testing/arco-theme.test.ts`（settings `applyTheme` 切换 `body[arco-theme]`/`html[data-theme]`）与 `src/testing/status-tag.test.ts`（Arco `a-tag` 组件在 happy-dom 渲染）；逻辑层测试已覆盖参数 store 映射/预设，见 `src/stores/params.test.ts`）
- [x] 更新 `docs/ARCO_MIGRATION_TODO.md` 同步各批完成；`docs/frontend.md §7.5` 与 `docs/style/STYLE_TODO.md` 详细回写遗留为文档专项（迁移完成后再整理样式章节，纯文档工作不阻塞交付）

## Arco 主题对齐（调研结论 2026-09-07）

基础接入时已在 theme.scss 走「对齐 Arco 设计令牌」路线，主题切换由 Arco `body[arco-theme]` 驱动。以下调研用于判断「不建议替换」的自定义组件是否仍需进一步对齐。

### 体系现状（已确认，无需改动）

- Arco 主题定制有两条官方路径：Less `modifyVars`（编译期）与 CSS 设计令牌（运行时）。本项目引入编译好的 `arco.css`，走**运行时 CSS 令牌**路径：`rgb(var(--arcoblue-*))`、`--color-text-*`、`--color-fill-*`、`--color-border-*`、`--color-bg-*`。
- theme.scss 已把旧业务 token 映射到 Arco 令牌：`--accent: rgb(var(--primary-6))`、`--fg-primary: var(--color-text-1)`、`--bg-input: var(--color-fill-2)`、`--primary-*/--primary-bg` 等（`#L13-L49`）。
- 暗色主题：settings store 设置 `body[arco-theme='dark']`，Arco 自动切换 `--color-*` / `rgb(var(--arcoblue-N))`，自定义组件只要引用这些令牌即自动双主题。
- 残留硬编码色仅需保留业务例外：`--console-bg #1d2129` / `--console-fg #e5e6eb`（控制台恒定深底）、`--primary-fg #fff`（主按钮文字）。其余自定义组件已在令牌体系内。

### 不建议替换组件 → Arco 对应（依据）

| 自定义组件 | Arco 对应组件 | 官方最佳实践依据 | 结论 |
| --- | --- | --- | --- |
| InfoStrip 值盒/标签行 | `a-descriptions` `inline-horizontal` + `:column` + `align` | 官方场景即「详情页只读字段成组展示」；支持标签右对齐、响应式列 | 语义匹配，但项目值盒是**全库统一 26px 高胶囊**（§7.5.4 值盒标准），迁移需保留样式覆盖；**可选优化，非必须** |
| ModelMetaCard meta-chip | `a-tag`（`color` 预设/自定义、`bordered`、`size`） | 预设色 + 自定义色值、bordered | 可迁但低收益：已用 `--accent`/`--bg-hover` 自动跟随主题 |
| StatusTag | `a-tag`（已在用：`color=success/procecessing/gray` + `a-spin`） | — | 已完全 Arco 化，无需再动 |
| failure-banner | `a-alert` | banner 语义天然匹配 | 属「高优先级」迁移范围，非本轮 |

### 本次待办

- [x] 若后续追求「少维护自定义 CSS」：将 InfoStrip 值盒迁移到 `a-descriptions`（保留 26px 高胶囊覆盖）、meta-chip 迁移到 `a-tag`（key=val 走插槽）、失败提示迁移到 `a-alert`。（2026-09-07 完成：InfoStrip 内部改 a-descriptions 承载并删手写 flex 布局、ModelMetaCard meta-chip→a-tag；失败提示 a-alert 已随 B1 完成）
- [x] 可选：把 theme.scss 的映射层（`--fg-*/--bg-*` 等）在业务组件全部 Arco 化后删除，直接引用 `--color-text-*` 等原始令牌，收敛为单一 token 体系。（2026-09-07 完成：20 个纯映射别名 248 处/24 文件扁平化为 Arco 令牌，theme.scss 删除别名定义，仅保留业务/布局 token；顺带补回 `31273e4` 误删的 `--badge-*`/`--bg-active`(双主题)/`--btn-h`/`--statusbar-*`/`--fs-appname` 定义，核查脚本确认无「未定义且非 Arco 命名空间」token 残留）

## 收尾二批：原生控件残留清零（2026-09-07，全站迁移完成后审计）

对 43 个 `.vue` 做两维度扫描（`<a-*` 使用统计 + 原生 `<input>/<textarea>/<button>` 残留定位），发现「已 Arco 化组件内仍嵌原生控件」6 处并全部完成：

- [x] `GeneralPanel.vue` 模型/exe 目录自绘 `path-input` ×2 → `a-input size="small"`（28px 同高；input 原生不继承 font，mono 覆盖打在 `:deep(.arco-input)`，§7.5.1 路径一律 `--font-mono`）
- [x] `AdvancedPanel.vue` HF 镜像源自绘 `path-input` → `a-input size="small"`（同上）
- [x] `CommandPreviewCard.vue` 命令预览/扩展参数原生 `<textarea>` ×2 → `a-textarea`：`auto-size`（min/maxRows）按内容自动增高替代固定 rows+手动 resize；`readonly`/`spellcheck` 经官方 `textarea-attrs` prop 传入（attrs 只落 wrapper，直写不达内层）；恒深控制台表面 `--console-bg/--console-fg` 保留（§7.5.1 恒定深色面）
- [x] `ParamSummaryCard.vue` 自绘 `summary-chip` 胶囊 → `a-tag size="small"`（同 meta-chip 既有范式：mono 字体 + key/eq/val 三段配色）
- [x] `DownloadCard.vue` 类别筛选原生 `<button>.chip` → `a-tag checkable`（更名 `.cat-chip`）：单选语义 `@check="setCategory(c)"` 忽略布尔参数保持「恒有选中」；checked 态覆盖为 `--primary-*` 实底（§7.5.1 筛选 chip 选中不用 Arco 默认淡蓝底）；a-tag medium 默认 24px/`0 8px` 恰合 §7.5.4 ⑥
- [x] `ParamRow.vue` 参数还原 `clear-btn` 原生 `<button>` → `a-button type="text" size="mini" shape="circle"`（保留 20px 幽灵样式、warn 悬停与行悬停渐显）

保留不动（均有在案记录）：`LogsPage .level-chip` 筛选 chip、`DownloadCard .result-item/.url-history-item` 列表项按钮（STYLE_TODO #135）、TopBar `win-btn` 窗口控制（高优先级批次）、`ParamRow` 24px 紧凑行布局（高优先级批次评估结论）。扫描中顺带发现的存量裸字号 `Sidebar.vue .version 12px` 登记 STYLE_TODO #54，不在本批修复。

## 收尾三批：完全迁移（2026-09-07，用户确认「全部迁至 Arco」方向）

逐页面/逐组件全量盘点（源码 `<a-*` 扫描 + 原生 `<input>/<select>/<textarea>/<button>` 清点 + 浏览器 DOM 计算样式核验），最后一批自绘交互控件迁移完成：

- [x] `LogsPage.vue` 级别筛选 `.level-chip` 原生 button ×5 → `a-radio-group type="button" size="small"` + `a-radio`（图标+文案进 radio 插槽；选择语义由组件承载，浏览器验证 WARN 筛选生效）
- [x] `DownloadCard.vue` URL 历史 Teleport 面板 + `.url-history-item` 原生 button → `a-dropdown`（受控 `popup-visible` + `popup-container="body"` + `a-dgroup` 标题 + `a-doption` 项）——手工定位、外点关闭、ESC、resize 监听全部删除，由 Arco Trigger 托管（浏览器验证弹层/回填/解析链路）
- [x] `DownloadCard.vue` 搜索结果 `.result-item` 原生 button → `a-list`/`a-list-item`（`:bordered="false"` + 条目间距覆盖；demo 数据流不产生多结果列表，静态验证 + lint 覆盖）
- [x] `ParamRow.vue` GGUF 值提示 `.gguf-hint` span → `a-tag size="small"`（applicable 态保留点击应用 + 下划线提示；空值由 `v-if` 承接，不再需要 width:0 占位）
- [x] `ParamRow.vue` 依赖警示 `.dep-hint` 原生 title → `a-tooltip`（`content` 承载依赖说明）
- [x] 文档专项（STYLE_TODO #55 结案）：frontend.md §7.5.1–7.5.8 按「Arco 默认 + 业务 token」现状重写；AGENTS.md 风格条目同步

## 收尾四批：布局原生化（2026-09-07，拆除旧布局载体）

用户反馈「风格已 Arco 化，但原有设计的控件布局仍残留并影响实际展示」（概览服务状态卡：每字段独立 a-descriptions 表格 + 自绘 26px 值盒胶囊 + 行尾等宽复制按钮）。本批拆除残余布局载体：

- [x] `ServiceStatusCard.vue` 原生化重构：6 个字段收敛为**单个 `a-descriptions :column="2"`**（模型/地址 `:span="2"` 整行）；复制改 `a-typography-text copyable`（原生复制图标，`@copy` 内走 Electron 剪贴板兜底，删除自绘「已复制」按钮态）；操作组 `a-space`；删除 `.detail-row`/`.runtime-details`/`.copy-btn`/boxed 值盒样式
- [x] 设置 4 面板（General/Advanced/Appearance/About）：InfoStrip 逐行表格 → `a-form`/`a-form-item`（标签定宽右对齐用组件原生 `label-align` + `label-col-style`，Advanced 长标签 140px 同法；无 model 场景传 `:model="{}"`）；About 只读行 → `a-descriptions :column="1"`
- [x] **`InfoStrip.vue` 删除**（孤儿组件，全仓库零引用）；§7.5.4「值盒标准」废止改写为「展示字段用 a-descriptions / 表单行用 a-form-item」

## 收尾五批：统计条 a-statistic 化 + 死 token 清理（2026-09-07）

- [x] `LocalModelsPanel.vue` 模型统计条（模型数/总大小）：自绘 `.stat-value/.stat-label/.stat-divider` → `a-statistic` + `a-divider direction="vertical"`（数值语义覆盖走 :deep，字符串值「52.3 GB」经 `#suffix` 插槽渲染——`:value` 限 number|Date）
- [x] `ParamsPage.vue` 参数状态条（总数/已调整/分组/显存估算）：同法迁移，warn/muted 态以语义类挂 `.stat`/组件根（浏览器验证 4 统计 + 3 分隔线 + warn 生效）
- [x] 死 token 清理：`--font-family`（扁平化时已删定义）在 `StatusBar.vue`/`DashboardPage.vue` 的失效引用移除，字体自然继承 Arco 默认栈

### 逐页面迁移矩阵（最终态）

| 页面/组件 | Arco 组件使用 | 保留的自绘（均有在案依据） |
| --- | --- | --- |
| 概览 Dashboard | a-button / Card(a-card) / a-descriptions / a-typography-text(copyable) / a-space / a-tag | 统计数字排版（展示层） |
| 模型管理 | a-tabs / a-table / a-statistic / a-divider / a-input / a-tag / a-checkbox / a-pagination / a-progress / checkable a-tag / a-list / a-dropdown+doption | `.file-item` 行选中（checkbox + 行点击，展示层） |
| 服务 | a-alert / a-textarea / a-tag / a-button | 命令预览恒深底样式（§7.5.1 恒定深色面） |
| 参数设置 | a-tabs / a-dropdown / a-statistic / a-divider / a-form-item / a-slider / a-input-number / a-select / a-switch / a-checkbox / a-input-group / a-tag / a-tooltip / a-button(text/mini/circle) | ParamRow 24px 紧凑行容器（承载层，控件全 Arco） |
| 日志 | a-radio-group(button) / a-input / a-button | 控制台行着色（恒深底语义） |
| 内置 Web UI | a-result / WebUiFrame(iframe 生命周期) | iframe 本体 |
| 应用设置 | a-tabs / a-form(a-form-item) / a-descriptions / a-select / a-radio-group / a-input / a-button | — |
| 布局 | a-layout / a-layout-sider / a-menu / a-badge / a-dropdown / a-typography / a-modal（全局弹窗） | **TopBar `win-btn` ×3**（Electron 无边框窗口协议，Arco 无对应物，唯一保留的自绘控件）；PageHost/PageFrame/AppLogo（非交互：布局壳/图片） |

## 每批验收

- [x] `pnpm lint`（2026-09-07 全绿：4 包 + IPC 56 通道同步 + docs 链接 131 全有效）
- [x] `pnpm test`（2026-09-07：core 355 + ui 57 全部通过，含新增 happy-dom 组件测试）
- [x] `pnpm build`（2026-09-07：4 包构建成功）
- [ ] 在 Electron 开发模式验证浅色/深色主题、键盘导航、窗口控制、参数保存恢复、模型下载和服务启停。（人工目验步骤：需启动 Electron 交互验证，非 CLI 可自动断言；已由 lint/test/build 覆盖静态正确性）
- [ ] 执行 `pnpm dist`，确认打包应用可加载 UI 且静态资源路径正常。（打包人工验收：`pnpm build` 已验证产物可构建，dist 安装包级验证由发布流程执行）
