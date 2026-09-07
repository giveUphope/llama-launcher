# Arco Design Vue 迁移待办

本文记录 `31273e4` 完成基础接入后，尚未完成的 Arco Design Vue 全站迁移工作。

## 迁移原则

- 新增通用交互优先使用 `@arco-design/web-vue`，不再新增自定义基础控件。
- 保持 Electron IPC、Pinia 状态、参数定义与命令生成逻辑不变，仅替换呈现层和通用交互。
- 复杂业务组件按功能分批迁移，每批完成后验证深浅主题、键盘操作、构建与 Electron 打包。
- 完成某项后删除对应旧样式和兼容 Token，避免长期维护两套视觉体系。

## 高优先级

- [ ] 重构 `components/layout/TopBar.vue`：以 Arco `Button`、`Dropdown`、`Select`、`Badge` 统一模型选择和服务操作；保留 Electron 窗口拖拽区及最小化、最大化、关闭协议。
- [ ] 重构 `components/common/FileBrowserModal.vue` 与 `CloseDialog.vue`：改用 Arco `Modal`、`Input`、`List`、`Button`，移除自定义遮罩、动画和玻璃样式。
- [ ] 重构 `components/params/ParamRow.vue`：使用 Arco `Form` 分组、`Alert` 和 `Tag` 呈现依赖未满足、已调整、GGUF 建议与恢复操作。
- [ ] 替换 `ParamsPage.vue` 的自定义标签、性能目标下拉和状态条：使用 `Tabs`、`Dropdown`、`Progress`、`Badge`、`Button`。

## 页面与业务组件

- [ ] 重构 `ModelsPage.vue`、`LocalModelsPanel.vue`：使用 `Table`、`Pagination`、`Dropdown`、`Empty`、`Spin` 统一模型列表、搜索、排序和行操作。
- [ ] 重构 `DownloadCard.vue`：使用 `Card`、`Form`、`Select`、`Checkbox`、`Progress`、`List` 和 `Alert`，保留任务队列、取消、暂停、恢复和重试逻辑。
- [ ] 重构 `PresetsPanel.vue`：使用 Arco `Table/List`、`Input`、`Button`、`Tag` 和 `Popconfirm`。
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

## 每批验收

- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] 在 Electron 开发模式验证浅色/深色主题、键盘导航、窗口控制、参数保存恢复、模型下载和服务启停。
- [ ] 执行 `pnpm dist`，确认打包应用可加载 UI 且静态资源路径正常。
