# STYLE\_TODO — UI 风格待修复清单

> 目的：登记当前应用中与 **UI 风格规范（../frontend.md §7.5）** 不一致的内容，保证「设计实现前后应用风格一致」。
>
> **登记规则**：发现新的风格不一致项时，在此追加一节（位置 / 描述 / 建议修复 / 修复效果验证），描述要可复现、验证方式要可执行；修复完成后将该项的详细记录移入 [已修复归档](../archive/style-todo-resolved.md)，并在「已修复索引」表登记一行（编号 / 标题 / 日期）。**不要静默引入新风格**。
>
> **状态图例**：`🔴 待修复` · `🟡 待确认（可能是有意设计）` · `🟢 已修复`

***

## 审计方法（如何复现本清单）

```bash
node scripts/style-audit.cjs      # 或 pnpm style:audit
```

10 条检查已固化进 `scripts/style-audit.cjs`，全绿 = 与 frontend.md §7.5 规范一致；❌ 项输出 `文件:行号` 明细并以非零码退出（可接入 CI / pre-commit）。各条说明：

1. 组件内裸颜色（token 禁令；`#fff`/`#1a1a1a` 仅限彩色按钮文字）
2. 组件内裸字号（应走 `--fs-*`）
3. 圆角走 token（`2px` 轨道 / `50%` 圆形 / `0` 例外）
4. 间距刻度（gap ∈ 4/5/6/8/10/12/14，`0` 允许；**不设 1/2/3px 微间距档，一律归一到 4px**，见 #16）
5. 按钮类无 scoped 重复（仅全局收敛的 `action-btn`/`mini-btn`/`tab-btn`；`modal-btn`/`dl-btn`/`fb-btn`/`win-btn` 等组件专属类允许 scoped，见 §7.5.5；`ctrl-btn` 已随「按钮文本内联」移除，见 #27）
6. 阴影/遮罩走 `--shadow-*` / `--overlay`
7. backdrop-filter 使用点清单（输出清单，人工复核是否仅限 §7.5.6 允许的玻璃层 / 弹窗背板；下拉/菜单已实底，见 #41）
8. 动画只动 transform/opacity（布局属性过渡必须带 `var(--dur-*)`）
9. 行高语义化（1 / 1.3 / 1.4 / 1.5 / 1.55 / 1.6；`normal` / `var()` 放行）
10. 字重只取 400 / 600 / 700（`normal`=400 / `bold`=700 等价放行）

***

## 🔴 修复项

### 50. 状态小圆点尺寸两制（StatusBar 8×8 vs StatusTag 7×7）— 🟢 已修复（2026-09-09，随 a-tag 迁移消解）

- **位置**：`packages/ui/src/components/layout/StatusBar.vue` 与 `packages/ui/src/components/common/StatusTag.vue`（原 `.dot` 8×8 / `.status-dot` 7×7）。
- **描述**：同一「状态指示点」语义存在两种尺寸；原 §7.5.5 只写 8×8，与 StatusTag 实现不符（2026-09-04 文档一致性审计发现，规范已暂记双值）。
- **修复**：两组件均已迁移为 Arco `a-tag :color` 状态胶囊（StatusTag loading 态用 `a-spin`），自绘 `.dot`/`.status-dot` 已删除，两制问题随手绘状态点移除而消解，无需再统一尺寸。
- **修复效果验证**：`grep -rn "\.status-dot\|\.dot" StatusTag.vue StatusBar.vue` 无命中；两组件状态均由 Arco `a-tag` 统一承载；`pnpm style:audit` 全绿。

### 51. 浅色 `--fg-muted` 在蓝白渐变「浅蓝角」为 AA-large（3.9–4.3:1，未达 AA-normal 4.5:1）— 🟢 已解决（2026-09-09：前提消失）

- **位置**：原 `theme.scss` light 块 `--bg-grad-1 #DCE9FB` / `--bg-grad-3 #E9F1FC` × `--fg-muted #6B7280`；文字直接衬于 body 渐变（卡片/内容区透明，分区风格）。
- **描述**：2026-09 蓝白渐变改造把 `--fg-muted` 提升到 AA，但渐变蓝角上 muted 文字未达 AA-normal，属「可见蓝调 vs muted 层级」取舍，暂不修复。
- **解决**：蓝白渐变与 `--bg-grad-*`/`--fg-muted` 均已随 Arco 全站实底迁移移除（body 现为 `--color-bg-1` 实底，文字直衬 Arco 底面色），对比度问题前提已不存在。
- **修复效果验证**：`grep -rn "bg-grad\|fg-muted" packages/ui/src` 无命中。

### 54. Sidebar 版本号裸字号 12px — 🟢 已修复（2026-09-07）

- **位置**：`packages/ui/src/components/layout/Sidebar.vue:70`（`.version { font-size: 12px }`）。
- **描述**：Arco 全站迁移后 `pnpm style:audit` 第 2 条（裸字号）的唯一残留命中点（2026-09-07 收尾二批跑审计时发现，系迁移提交带入的存量问题，非该批引入）；12px 对应语义 token `--fs-sm`（§7.5.1）。
- **修复**：`font-size: 12px` → `var(--fs-sm)`（同为 12px，纯 token 化无视觉变化）。
- **修复效果验证**：`pnpm style:audit` 第 2 条全绿（10/10）。

### 55. 设计 token 文档漂移：theme.scss 已扁平化为「纯 Arco 默认」，§7.5.3/§7.5.6 与 AGENTS.md 仍描述旧胶囊/玻璃体系 — 🟢 已修复（2026-09-07，方向确认：完全迁移至 Arco）

- **位置**：`packages/ui/src/styles/theme.scss:29-48`（注释「迁移兼容层：业务组件替换前，将旧语义映射到 Arco token」）对照 `docs/frontend.md` §7.5.3（圆角体系：pill 999/20/10/8）、§7.5.6（glassmorphism）、AGENTS.md「UI 风格规范」条目。
- **描述**：迁移提交（e07e465 等）将圆角三 token 统一为 4px、`--glass-blur: 0px`、`--ease-jelly/smooth: ease`、字号刻度收敛、字体栈改为 Cascadia Code mono——运行时真实体系已是「Arco 默认 + 业务色」，而规范文档仍按旧胶囊/玻璃体系描述。
- **修复**：用户确认方向为「完全迁移至 Arco」→ 文档回写：frontend.md §7.5.1/7.5.2/7.5.3/7.5.5/7.5.6/7.5.7/7.5.8 按「Arco 默认 + 业务 token」现状重写；AGENTS.md 风格条目同步。
- **修复效果验证**：`pnpm docs:check` 通过；`pnpm style:audit` 全绿；抽查组件计算样式与文档描述一致（cat-chip 圆角 4px、InfoStrip 值盒 26px、按钮 Arco 默认态）。

***

## 🟢 已修复索引

完整的问题描述 / 修复方案 / 验证证据见 [已修复归档](../archive/style-todo-resolved.md)（只读留档）；修复后的规范落点见 [frontend.md §7.5](../frontend.md)。

| # | 条目 | 修复日期 |
| --- | --- | --- |
| 53 | 文字可读性专项：弹窗 panel 文字脱离 backdrop-filter 发虚（blur 移 ::before 叶子层）、StatusBar 白字去 opacity（0.65→~2.6:1 升满不透明 4.5:1）、新增 --success/warn/danger-text 自适应变体使浅色面语义文字由 2.2–3.8:1 升至 ≥4.5:1（控制台/日志保留亮色）、hint 去 opacity | 2026-09-04 |
| 52 | 跨页面间距一致性统一（全量间距审查）：筛选 chip 水平内距 `0 9px`→`0 8px`（DownloadCard 对齐 level-chip）、fs-sm `.rec-chip` `2px 8px`→`3px 8px`、`.empty` 空态 `16px`→`20px`（BenchPanel 对齐 Presets/LocalModels）；标准固化 §7.5.4 ⑥⑦ | 2026-09-04 |
| 49 | 概览「最近问题」空态占位 `line-height: 72px` 违反行高语义化清单（style-audit #9 ❌）→ flex 居中 + `min-height: 60px` | 2026-09-04 |
| 48 | 性能目标下拉面板 `.target-panel` 玻璃浮层违反「下拉/菜单实底」（#41 同型回潮）+ 引用未定义 `--radius-dropdown` → 实底 `--bg-card` + `--radius-row` | 2026-09-04 |
| 47 | 概览页内容占位组件补强（Q1 空值 dash / Q4 空态占位行） | 2026-09-01 |
| 46 | 概览页（Dashboard）跳动审计：Q4 问题区高度随行数变化 | 2026-09-01 |
| 45 | 核心特点组合推广：增强状态机下沉至 server store（Dashboard Q1 / StatusBar 同步失败/崩溃态） | 2026-09-01 |
| 44 | 防跳动机制推广：其他页面的可重复插入行（Dashboard Q4 操作行 / 预设 / 性能测试提示条） | 2026-09-01 |
| 43 | 应用图标蓝化遗漏：窗口/任务栏图标仍为彩虹渐变 | 2026-09-01 |
| 42 | 隐藏组件导致的页面布局跳动（预留位置方案） | 2026-08-31 |
| 41 | 浮层菜单表面统一实底（可读性） | 2026-08-31 |
| 40 | 页面切换闪出其他页面内容（PageHost 过渡交接窗口根治） | 2026-08-29 |
| 39 | 概览「最近问题」日志链路修正（应用日志问题级）+ 状态指示器移除 | 2026-08-29 |
| 37 | 内容值盒统一（宽度/高度/样式） | 2026-08-29 |
| 36 | 模型信息卡双重展开/收起按钮整合为单一开关 | 2026-08-29 |
| 35 | 日志页操作按钮并入筛选行（同一行） | 2026-08-29 |
| 34 | 日志页提示条移除（按钮独立成行、行数去重） | 2026-08-29 |
| 33 | 模型页统计条精简（移除已选/刷新）+ 检测懒加载 | 2026-08-29 |
| 32 | 按钮点击时文字挤压拉伸（按压缩放全面移除） | 2026-08-29 |
| 31 | 参数还原按钮样式优化（软色调幽灵按钮 + 行悬停渐显） | 2026-08-29 |
| 30 | 选项行标签改为等列布局（对齐参数设置页布局逻辑） | 2026-08-29 |
| 29 | 应用 Logo 呈现统一（AppLogo 组件 + favicon 同源） | 2026-08-29 |
| 28 | 参数摘要模型路径显示为文件名（应为绝对路径） | 2026-08-29 |
| 27 | 按钮全面文本内联 + 服务状态卡单行单内容 | 2026-08-29 |
| 26 | 内容项文本描述缺失 + 复制按钮三种形态并存 | 2026-08-29 |
| 25 | 文本标签与内容间距过大（InfoStrip 固定标签列宽） | 2026-08-29 |
| 24 | 设置页 tab 条与状态摘要 0 间距贴死 + 顶栏条间距全库统一 8px | 2026-08-29 |
| 23 | hover/聚焦过渡颜色过冲闪烁（全组件） | 2026-08-29 |
| 22 | 分隔线间距统一 + 全库未引用内容清理 + 文档规范化 | 2026-08-29 |
| 21 | 组件间距统一：页面 padding 双真相源 + 同类元素 padding 归簇 | 2026-08-29 |
| 20 | 卡片风格 → 实线分隔分区（全局设计变更） | 2026-08-28 |
| 19 | 选项间距统一：卡片行距 / 选项胶囊组间距 | 2026-08-28 |
| 18 | 设置面板 InfoStrip 垂直堆叠粘连 | 2026-08-29 |
| 17 | 状态标识冗余 / emoji 功能图标 / 未使用图标清理 / 下载模块职责拆分 / tab-btn 收敛全局 | 2026-08-28 |
| 16 | 微间距归一 4px + 审计脚本三处误报修正 + 审计方法改脚本入口 | 2026-08-28 |
| 15 | 规范文档漂移修复 + 文字系统/间距刻度补充 | 2026-08-28 |
| 14 | DownloadCard 硬编码颜色与裸过渡 token 化 | 2026-08-28 |
| 13 | 侧边栏激活项深色模式对比不足 + 设置页重复提示文本 | 2026-08-28 |
| 12 | 侧边栏跟随深浅主题 + 设置摘要真实环境检测 | 2026-08-26 |
| 11 | 主题三选按钮组 / 侧边栏折叠容错 / 设置摘要检测逻辑 | 2026-08-26 |
| 10 | 主题黑白基调：深色白底黑字主按钮 / 浅色黑底白字主按钮 | 2026-08-26 |
| 9 | 指示器贴近标题 + 图标语义修正 + 主题色改蓝 | 2026-08-26 |
| 8 | 移除彩虹装饰，统一蓝色系 + 概览页字段/状态整理 | 2026-08-26 |
| 7 | 第三轮收尾审计（浮层组件 / 图标规范 / 死组件） | 2026-08-26 |
| 6 | 第二轮审计修复（显示内容 / 链路 / 死代码） | 2026-08-26 |
| 5 | 按钮类 scoped 重复定义（action-btn ×7 / ctrl-btn ×4 / mini-btn ×3 各表漂移） | 2026-08-26 |
| 1 | `.action-btn` 高度不一致（28px / 30px） | 2026-08-13 |
| 2 | DownloadCard 徽章/分类调色板未 token 化 | 2026-08-13 |
| 3 | elevation 阴影未 token 化（含 .2/.25 漂移） | 2026-08-13 |
| 4 | 深色主题下 hover 背景反馈弱（`--bg-input` == `--bg-hover`） | 2026-08-13 |

***

## 🟢 已确认设计决策（原「待确认」项，无需修改）

- **mini-btn 默认文字色** **`--fg-secondary`**：行内小按钮使用次级文字色（区别于 `action-btn` 的 `--fg-primary`），符合「mini = 行内次级操作」语义层级，已确认保留（frontend.md §7.5.5）。

- **筛选 chip 圆角**：DownloadCard 等筛选 chip 走胶囊 `--radius-pill`（筛选标签语义），已在 frontend.md §7.5.3 圆角体系中固化。注：本条原记录「容器卡片走 `--radius-card`（16px）」已失效——该 token 随 #20 分区风格 / #22 清理移除，分区卡片现为 `border-radius: 0`，圆角仅存 pill/modal/row/control 四 token + 2px 轨道 + 50% 圆形。


***

## 备注

- 本清单的「修复效果验证」强调**可执行、可复现**（grep 断言 + 双主题肉眼检查 + 截图对比），避免「修了但看不出效果」。

- 修改涉及 UI 风格时，请同步阅读 `../frontend.md §7.5` 与 `AGENTS.md` 风格条目，保证「设计实现前后的应用风格一致」。

***

## Arco 全站迁移完成说明（2026-09-07）

自 `31273e4` 接入 Arco Design Vue 后，全站迁移已完成（明细见 `../ARCO_MIGRATION_TODO.md`，各批均已勾选）：

- 迁移：手写控件 → `a-button/a-input/a-select/a-table/a-list/a-tag/a-tag/a-dropdown/a-tabs/a-modal/a-progress/a-alert/a-popconfirm/a-result` 等；自定义遮罩/玻璃层/旧 `action-btn`/`mini-btn`/`tab-btn` 已移除。
- 清理：孤儿 `variables.scss`/`buttons.scss`/`surface.scss` 与未用 `NavButton.vue` 已删除；`InfoStrip.vue` 亦已删除（零引用）；`theme.scss` 兼容 token 已进一步收敛——`--bg-active`/`--glass-*` 于 2026-09-09 移除（选中行改 `rgb(var(--primary-1))`、TopBar 直用 `--color-bg-2`/`--color-border-2`），现仅剩圆角/字号/动效映射（`--radius-*`/`--fs-*`/`--dur-*`/`--ease-*`）与业务语义色（徽章/控制台/状态栏）。
- 保留（业务/工程例外）：`CommandPreviewCard` 命令框（控制台深底）、TopBar 窗口控制（Electron 拖拽/协议）、StatusBar 铬样式（品牌蓝底）。
- 工程：UI 包加 happy-dom 组件测试环境（`arco-theme`/`status-tag` 测试）；**Arco 按需引入已于 2026-09-08 落地**（`unplugin-vue-components` + `ArcoResolver`，移除全量引入，产物 -27%，见 CHANGELOG v0.0.28 与 AGENTS.md）。
- 本清单历史修复项（#1–#53）继续有效；新增或回归的手写样式应先对照 §7.5 与上述迁移边界。
- 2026-09-07 补充：残留 `action-btn`/`mini-btn`/`tab-btn`/`theme-opt` 按钮已全部迁移到 `a-button`/`a-tabs`/`a-radio-group`（这些类原先依赖已删除的 `buttons.scss`，迁移前为无样式裸元素）；仅保留窗口控制 `win-btn`、列表项类按钮（`.result-item`/`.url-history-item`）与带 scoped 样式的筛选 chip（`.level-chip`）。
- 2026-09-07 收尾二批（迁移后原生控件残留审计，明细见 `../ARCO_MIGRATION_TODO.md` 同名节）：`path-input` ×3 → `a-input`、`cmd-preview` 原生 textarea ×2 → `a-textarea`、`summary-chip` → `a-tag`、DownloadCard 类别筛选 `.chip` → checkable `a-tag`（更名 `.cat-chip`）、`ParamRow .clear-btn` → `a-button text/mini/circle`；§7.5.4 ⑥ 的 DownloadCard chip 类名引用同步更名。
- 2026-09-07 收尾三批（完全迁移，用户确认方向）：最后一批自绘交互控件清零——`LogsPage .level-chip` 筛选 chip → `a-radio-group type="button"`、`DownloadCard .url-history-item` → `a-dropdown` + `a-doption`（含 `.arco-dropdown-group-title` 标题）、`.result-item` → `a-list`/`a-list-item`、`ParamRow .gguf-hint` → `a-tag`、`.dep-hint` → `a-tooltip`。**唯一保留的自绘控件 = TopBar `win-btn` 窗口控制**（Electron 无边框窗口协议，Arco 无对应物）；AppLogo（img）、PageHost/PageFrame（布局壳）非交互控件，不属迁移范畴。
- 2026-09-07 收尾六批（窗口控制 a-button 化，用户提出右上角按钮应迁 Arco）：TopBar `win-btn` ×3 原生 `<button>` → `a-button type="text"` 基座 + 窗口铬覆盖（46×52 贴边热区、4px 圆角、关闭钮红色 hover），点击仍走 Electron 窗口协议——至此全应用交互控件 100% Arco 组件承载，原生 `<button>` 清零。
- 2026-09-07 收尾五批（逐页面布局复查）：统计条自绘 `.stat-*` → `a-statistic` + `a-divider`（LocalModelsPanel 模型统计、ParamsPage 参数状态条，字符串值走 `#suffix` 插槽）；清理 `--font-family` 死 token 引用（StatusBar/DashboardPage）。恒深控制台（LogsPage/ServicePage/Dashboard 问题区/命令预览）与 DownloadCard task-stats 行内状态文本为语义性展示，非旧布局残留，保留。
- 2026-09-07 收尾七批（参数行高度回归修复）：迁移引入的 `a-form-item` 默认外距/标签 32px 行高/wrapper 32px 最小高度把参数行撑到 54px（悬浮高亮下方大片空白）——删除 6 控件残留 margin、ParamRow 行内归零（margin/min-height/line-height 1.3）、控件统一 size=small；行高回归 34/38px。
