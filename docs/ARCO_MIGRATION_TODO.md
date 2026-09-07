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
- [ ] 重构 `DashboardPage.vue`、`ServicePage.vue`、`LogsPage.vue`、`SettingsPage.vue`：优先替换统计、告警、筛选器、标签页、日志工具栏和表单控件。
- [ ] 重构 `components/service/*`、`components/settings/*`：将手写卡片、按钮、状态展示收敛到 Arco `Card`、`Descriptions`、`Statistic`、`Alert`、`Form`。
- [ ] 重构 `StatusBar.vue`、`WebUiFrame.vue`：使用 Arco `Typography`、`Tag`、`Button`、`Result`，保留状态订阅和 iframe 生命周期。

## 清理与工程化

- [ ] 移除不再使用的 `styles/variables.scss`、`styles/buttons.scss`、`styles/surface.scss`，并从仓库中清理其遗留引用。
- [ ] 清除 `theme.scss` 中的旧 `--*` 兼容变量；每清理一个业务组件，同步移除仅被该组件使用的变量。
- [ ] 删除被 Arco 替代的 `NavButton.vue` 等自定义基础组件，并更新所有导入。
- [ ] 评估并实施 Arco 组件与图标的按需导入，降低当前全量 CSS 和入口包体积。
- [ ] 增加 `happy-dom` 或 `jsdom` 组件测试环境，覆盖 Arco 主题切换、确认队列、参数控件映射与关键弹窗行为。
- [ ] 更新 `docs/frontend.md` 的旧样式章节，删除玻璃拟态、旧按钮分类和兼容层说明；同步更新 `docs/style/STYLE_TODO.md`。

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

- [ ] 若后续追求「少维护自定义 CSS」：将 InfoStrip 值盒迁移到 `a-descriptions`（保留 26px 高胶囊覆盖）、meta-chip 迁移到 `a-tag`（key=val 走插槽）、失败提示迁移到 `a-alert`。
- [ ] 可选：把 theme.scss 的映射层（`--fg-*/--bg-*` 等）在业务组件全部 Arco 化后删除，直接引用 `--color-text-*` 等原始令牌，收敛为单一 token 体系。

## 每批验收

- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] 在 Electron 开发模式验证浅色/深色主题、键盘导航、窗口控制、参数保存恢复、模型下载和服务启停。
- [ ] 执行 `pnpm dist`，确认打包应用可加载 UI 且静态资源路径正常。
