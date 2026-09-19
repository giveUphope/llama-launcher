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

13 条检查已固化进 `scripts/style-audit.cjs`，全绿 = 与 frontend.md §7.5 规范一致；❌ 项输出 `文件:行号` 明细并以非零码退出（可接入 CI / pre-commit）。各条说明：

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
11. 非 scoped 样式块（`<style>` 无 `scoped`）的顶层选择器必须含至少一个组件私有类——禁止只由 Arco 全局类名构成，防 popup 传送 body 后全局命中他处（§7.5.6）
12. 不覆写 Arco 内部态类（`.arco-*-checked` / `-active` / `-selected` / `-disabled` / `-current` / `-dragging` / `-expanded`）——随 Arco 版本升级易碎，选中态改用 Arco 自带态或 `color` prop
13. `a-progress` 的 `:percent` 必须传 **0–1 比值**——Arco `line.js` 按 `width: percent * 100 %` 渲染，传百分数（含 `* 100` 或 `Pct` 命名）会把进度条钉满，实测即「下载进度条与实际进度不一致」（#71）

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

### 56. 模型表格选中行 hover 掉色（Arco 行 hover 规则压过选中态底色）— 🟢 已修复（2026-09-13）

- **位置**：`packages/ui/src/components/models/LocalModelsPanel.vue`（`.models-table` 的 `:deep(.arco-table-tr.row-selected > td)`）。
- **描述**：选中行底色 `rgb(var(--primary-1))` 只以 (0,4,1) 特异性落位，被 Arco 行 hover 规则 `.arco-table-hover:not(…) .arco-table-tr:not(…):hover .arco-table-td:not(…)`（(0,9,0)）在悬停瞬间覆盖为中性 `--color-fill-1`——鼠标移到选中行上时选中态视觉消失，与全站「选中态恒色」（DownloadCard `.checked` / FileBrowserModal `.checked` 悬停不回落）不一致。审查结论：STYLE_TODO「保留（业务/工程例外）」清单与组件内注释均未豁免该处，非有意设计。
- **修复**：同一 `primary-1` token，按 Arco hover 规则同构叠加 `.row-selected`（行/单元格 `:not()` 链拉高特异性至 (0,11,0)，压过 Arco 的 (0,9,0)；`arco-table-hover` 与 `.models-table` 是同一元素，不能作为后代前缀复刻），悬停中选中行保持选中色；未引入任何新颜色，色差整体不变。
- **修复效果验证**：`pnpm style:audit` 全绿；mock 页（`127.0.0.1:5173/#/models`）深浅两主题下 hover 选中行，`td` 计算底色保持 `rgb(var(--primary-1))`（深色 `rgb(0,13,77)` / 浅色 `rgb(232,243,255)`），不再回落 `--color-fill-1`。

### 57. 深色主题选中行底色过深（primary-1 深色取值为近黑藏青，整行铺满观感差）— 🟢 已修复（2026-09-13）

- **位置**：`theme.scss`（新增 `--row-selected-bg`）；三处选中态消费点：`LocalModelsPanel.vue`（`.row-selected` 两规则，含 #56 的 hover 保色规则）、`DownloadCard.vue`（`.active`/`.checked`）、`FileBrowserModal.vue`（`.is-selected`）。
- **描述**：选中态统一用 `rgb(var(--primary-1))`（93665ab 收敛），但该 token 在深色主题取值 `rgb(0,13,77)`——比底色 `#17171a` 更暗的藏青块，整行铺满时选中感沉重、文字发闷（用户反馈「深色模式下也不应使用深色选中效果」）。审查结论：无例外注释豁免，属 token 跨主题语义落差，非有意设计。
- **修复**：theme.scss 新增业务语义 token `--row-selected-bg`：浅色 = `rgb(var(--primary-1))`（不变）；深色 = `rgba(var(--primary-6), 0.2)` 半透明蓝染（亮于底面、与 hover 白 4% 明显区分，深色下 primary-6 为亮蓝 60,126,255）。三处选中态统一改引该 token，浅色观感零变化。
- **修复效果验证**：`pnpm style:audit` 全绿；mock 页深色下选中行 `td` 计算底色 ≈ `rgb(30,44,72)`（primary-6 20% 叠 bg-1），浅色下保持 `rgb(232,243,255)`；hover 选中行不掉色（#56 机制不变）。

### 58. 状态标签 a-tag 传入 Arco 不识别的语义色名（success/warning/danger/processing）— 🟢 已修复（2026-09-13）

- **位置**：`StatusTag.vue`（`arcoStatus` 映射）、`StatusBar.vue`（`statusColor` 映射 + 「已复制」反馈标签 ×2）。
- **描述**：Arco 2.58 的 a-tag 预设色仅 13 个物理色名（red/orange/green/…/gray），`success`/`warning`/`danger`/`processing` 语义名不被识别、落入 custom-color 分支——inline `backgroundColor: 'success'` 非法被浏览器丢弃，标签只剩兜底底色（浅色 fill-2 #F2F3F5 / 深色白 8%）+ 状态栏继承白字，深浅色下均不可读（用户反馈「深浅色模式下查看效果过差」）。问题随 #50 的 a-tag 状态胶囊迁移引入。
- **修复**：映射改为预设物理色：`success→green` / `warning→orange` / `danger→red` / `processing→arcoblue`（`gray` 本就合法）。Arco 预设色标签自带深浅主题适配（浅色 = 浅底深字胶囊，深色 = 半透明色底亮字）。
- **修复效果验证**：浏览器实测状态栏「运行中」：浅色 = `arco-tag-green`（底 `rgb(232,255,234)` / 字 `rgb(0,180,42)`），深色 = 底 `rgba(39,195,70,0.2)` / 字 `rgb(39,195,70)`；`grep` 全库确认无其余语义色名传 a-tag（LocalModelsPanel tagColor/fitColor 已用物理色，DownloadCard statusColor 为纯文本色合法 CSS）。

### 59. 状态栏标签芯片深色主题下叠蓝铬面对比不足（gray ≈ 1.4:1 不可读）— 🟢 已修复（2026-09-13）

- **位置**：`theme.scss`（新增 `.statusbar .arco-tag` 铬面芯片固定取值规则）。
- **描述**：状态栏为恒定品牌蓝铬面（业务例外，不随主题），但状态标签预设芯片随主题取值——深色下 `arco-tag-gray` 为 `rgba(146,146,147,.2)` 底 + `#929293` 字，叠蓝条后对比仅 ~1.4:1，不可读（用户反馈「可读性差问题又回归旧样式」；实为 gray 预设深色取值问题，此前 7516254 修复的是 custom-color 兜底的运行态，未覆盖 gray 深色取值）。
- **修复**：芯片与铬面同样恒定——`.statusbar .arco-tag.arco-tag-checked.<preset>` 统一按 Arco light 色板固定呈现（gray/green/orange/red/arcoblue，取值实测自浅色预设），不随主题切换；gray 文字用 text-2 `#4e5969`（5.5:1 达 AA）而非 stock `gray-6`（2.9:1）。
- **修复效果验证**：浏览器实测深色/浅色下状态栏标签计算样式一致（gray：`rgb(242,243,245)` 底 / `rgb(78,89,105)` 字）；green/orange/red/arcoblue 合成元素同验；`pnpm style:audit` 全绿。

***

### 60. 下载卡片徽章体系未 Arco 化（5 类手绘 `<span>` 徽章）+ 计数徽章 opacity 削弱文字 — 🟢 已修复（2026-09-18）

- **位置**：`packages/ui/src/components/common/DownloadCard.vue`（`.info-tag` / `.source-badge` / `.quant-badge` / `.file-cat` / `.rec-badge`；`.chip-count`）。
- **描述**：全库其余徽章/胶囊早已迁 `a-tag`（`ModelMetaCard .meta-chip`、`LocalModelsPanel` tagColor/fitColor、`ParamSummaryCard .summary-chip`、`PresetsPanel .active-badge`、`StatusTag`、`StatusBar`），唯下载卡片 5 类徽章仍是手绘 `<span>` 胶囊（`padding` / `border-radius` / `letter-spacing` 各写一遍）；全库 `grep -s "badge"` 仅 DownloadCard 定义 `-badge` 类。另 `.chip-count` 以 `opacity: 0.75/0.85` 削弱计数文字，违反 §7.5.2「文字不用 opacity 削弱」。
- **修复**：5 类徽章改 `a-tag size="small"` 承载（保留 §7.5.4 ① 的 `1px 6px` 内距与 `--radius-pill` 圆角，视觉零变化；删除 `display: inline-block` 让 Arco 的 inline-flex 生效；`.rec-badge` 的 `#fff` 改 `var(--primary-fg)`）；`.chip-count` 去 opacity，改 `--color-text-2` + `color-mix(in srgb, currentColor 12%, transparent)` 底（随选中态与主题自动同源，删除按状态分列的第二条规则）。
- **修复效果验证**：`grep` 确认 DownloadCard 已无 `<span class="…badge">`、无 `opacity`；`pnpm style:audit` 12/12 全绿；`vue-tsc --noEmit` + `vitest run`（66 tests）+ `vite build` 全通过。

### 61. 下载卡片覆写 Arco 内部态类 `.arco-tag-checked`（且注释引用已失效规范）— 🟢 已修复（2026-09-18）

- **位置**：`DownloadCard.vue` `.cat-chip`（原 `&.arco-tag-checked { background: rgb(var(--primary-6)); … }` 与 `&:hover:not(.arco-tag-checked)`）。
- **描述**：类别筛选 chip 覆写 Arco 内部态类做「实底主色」选中态，是组件层唯一覆写 `arco-tag-checked` 的地方（`theme.scss` 状态栏芯片属业务例外）；且注释称「§7.5.1 筛选 chip 选中 = `--primary-*` 黑白高对比」——§7.5.1 现行文本为「hover/选中态用 Arco 组件自带态或 `--color-fill-3`」，该注释引用的是已被「主题色改蓝」取代的旧黑白基调，属历史遗漏；覆写 Arco 内部态类还随 Arco 版本升级易碎（审计新增第 12 条）。
- **修复**：删除全部 hover/选中态覆写（含冗余 `cursor: pointer`，Arco `.arco-tag-checkable` 自带），改 `color="arcoblue"` 由 Arco 原生渲染——选中底 = `rgb(var(--arcoblue-1))`（即 `rgb(var(--primary-1))` = 浅色 `--row-selected-bg`）/ 深色 `rgba(var(--arcoblue-6), .2)`（= 深色 `--row-selected-bg`），与全站选中态同源；保留筛选标签语义的 `--radius-pill` 圆角（已确认设计决策）与文本-计数间距。
- **修复效果验证**：`grep -r "arco-tag-checked" packages/ui/src` 仅剩说明性注释；`pnpm style:audit` 第 12 条 ✅；选中/未选中/悬停三态由 Arco 接管，深浅主题自适应。

### 62. 下载卡片非 scoped 样式块裸写 Arco 全局类名（全局外泄）— 🟢 已修复（2026-09-18）

- **位置**：`DownloadCard.vue` 非 scoped `<style lang="scss">` 块（原 `.arco-dropdown-group-title { … }`、`.url-history-icon`、`.url-history-text`）。
- **描述**：URL 历史下拉的 popup 由 `a-dropdown` 传送 body，需非 scoped 样式；但块内直接写裸 `.arco-dropdown-group-title`——全应用任何 `a-dgroup` 标题都会被改成下载卡片的排版（`padding: 4px 10px 6px` / uppercase / 0.5px 字距）。同类全局块均有命名空间（ParamsPage `.target-menu …`、GeneralPanel `.exe-help-panel …`），此处为唯一裸写。
- **修复**：全部选择器以本下拉私有类圈定——标题用 `.arco-dropdown-list:has(> .url-history-item) .arco-dropdown-group-title`（`a-dgroup` 渲染为 Fragment、标题 `li` 无法挂私有类，故用 `:has()` 反查，同 ParamsPage 范式），条目/图标/文本统一挂到 `.arco-dropdown-option.url-history-item` 下；块上方注释同步。
- **修复效果验证**：`pnpm style:audit` 新增第 11 条 ✅（全库 42 文件）；`grep -r "arco-dropdown-group-title" packages/ui/src` 仅命中带 `:has()` 作用域的选择器与注释。

### 63. 下载卡片布局/体例离群（Grid 任务项、列表覆写面、私有标题体例、间距与冗余）— 🟢 已修复（2026-09-18）

- **位置**：`DownloadCard.vue` `.task-item` / `.task-main` / `.task-actions`、`.result-list` / `.file-list`、`.section-title` / `.group-title`、`.cat-filter`、`.url-row`、`.file-item.recommended`。
- **描述**：① 任务项用 `display: grid`（3 行 × 2 列）——全库 grid 仅两处，另一处是 §7.5.7 明文规范的 `param-grid`，属布局范式离群；② 两个列表 `:deep(.arco-list-item) { padding: 0; border-bottom: none; background: none }`——`border-bottom` 覆写可用 `:split` prop 原生替代、`background` 本就为空（`.arco-list` / `.arco-list-item` 均无背景色），覆写面过大（PresetsPanel 已明确「对齐 Arco 原生列表样式、不再覆盖」）；③ `.section-title` 为全库唯一私有标题体例且字号 `--fs-base` 与组标题 `--fs-sm` 不一致，独立组标题缺 §7.5.4 ③ 下划线；④ `.cat-filter` gap 4px 与 §7.5.4 刻度表标注的 6px 不符（注释引用的 `level-chips` 已随迁移改 `a-radio-group`，属历史遗漏），`.task-actions` gap 4px 与同语义 `LocalModelsPanel .row-actions`（6px）不一致；⑤ `.url-row` 过渡声明含从不变化的 `transform`（死声明）；⑥ `.file-item.recommended` 用裸 `box-shadow: inset 3px 0 0` 画装饰竖条（§7.5.8 禁裸 box-shadow；审计第 6 条因「行内含 `var(--` 即放行」漏过）。
- **修复**：① 改 flex（`.task-item` flex + 新增 `.task-main` 纵向承载信息/进度/统计，几何等价）；② 两个 `a-list` 加 `:split="false"`，覆写收敛为仅 `padding: 0`（行容器自带卡片内距），并删冗余 `background: none`；③ `.section-title` 字号归 `--fs-sm`，独立组标题改用新增 `.group-title`（§7.5.4 ③ 体例）；④ `.cat-filter` gap → 6px、`.task-actions` gap → 6px；⑤ 删除 `transform` 过渡声明；⑥ 改 `border-left-width: 3px`（同一 token 色）。
- **修复效果验证**：`grep` 确认 DownloadCard 已无 `display: grid` / `box-shadow` / `display: inline-block` / `#fff` / `transform var(--dur`；`pnpm style:audit` 12/12 全绿（含第 4 条间距刻度）；`vue-tsc --noEmit` + `vitest run` + `vite build` 全通过。

### 64. 规范文档漂移：§7.5.3「标签/chip 4px」与 Arco a-tag 默认 2px 不符；徽章承载/列表行/筛选选中态未登记 — 🟢 已修复（2026-09-18）

- **位置**：`docs/frontend.md` §7.5.3 / §7.5.4 ①③ / §7.5.6 / §7.5.7 / §7.5.8。
- **描述**：① §7.5.3 称「组件圆角直接走 Arco 组件默认（…标签/chip 4px…）」，实测 Arco 2.58 `--border-radius-small: 2px`（`.arco-tag` 默认圆角 2px），描述与实现不符；② 彩色小徽章的承载方式（`a-tag`）与盒模型（`1px 6px` + `--radius-pill`）未写入规范；③ 独立组标题/卡片内小节标题两档体例、筛选 chip 选中态实现、列表行两种既定变体、布局范式（内容区 flex、grid 仅限 `param-grid`）均未登记，导致下载卡片自成一套。
- **修复**：§7.5.3 修正为「a-tag 2px；筛选 chip 与彩色小徽章按业务约定显式取 `--radius-pill` 4px」；§7.5.4 ① 补「一律 `a-tag size="small"` 承载、禁自绘 `<span>` 胶囊」；§7.5.4 ③ 补 `.group-title` 与 `.section-title` 两档；§7.5.6 补「非 scoped 块顶层选择器必须含组件私有类」；§7.5.7 补「下载分类徽章 a-tag 承载」「筛选 chip 选中态走 Arco 自带态 + `color` prop」「列表行两种变体（原生行 / 紧凑可选中行）」「内容区一律 flex」；§7.5.8 清单补 3 条（非 scoped 命名空间、禁覆写 Arco 内部态类、徽章与列表行约束）。
- **修复效果验证**：`pnpm docs:check`（文档链接校验）通过；`pnpm style:audit` 12/12 全绿；文档描述与 DownloadCard 实现一致（a-tag 承载、`--radius-pill`、6px 筛选组间距、flex 任务项）。

***

### 65. 真机渲染核对发现的样式缺陷（深色单类徽章被 Arco 压掉 / 列表行内距归零失效 / demo-mock 数据漂移）— 🟢 已修复（2026-09-18）

- **位置**：`DownloadCard.vue`（`.info-tag` / `.rec-badge` / `.result-list` / `.file-list` 的 `:deep(.arco-list-item)`）、`packages/ui/src/dev/demo-mock.ts`（`download.listFiles`）。
- **描述（真机渲染实测发现；静态审计 12 条与单测均无法覆盖）**：
  ① **深色主题单类徽章被 Arco 压掉**——`.info-tag` / `.rec-badge` 是单类选择器（特异性 (0,2,0)），而 Arco 的 `body[arco-theme='dark'] .arco-tag(-checked)` 为 (0,2,1)：深色下 `.info-tag` 的 `rgb(var(--primary-6))` 蓝字被替换为 `--color-text-1`（实测 `rgba(255,255,255,0.9)`）、`.rec-badge` 的 `var(--primary-fg)` 同被替换（浅色下两者均正常）。`.source-badge` / `.file-cat` / `.quant-badge` 因带第二个类（(0,3,0)）不受影响。
  ② **列表行内距归零从未生效**——`.file-list :deep(.arco-list-item) { padding: 0 }` 特异性 (0,3,0)，低于 Arco `size="small"` 的 `.arco-list-small .arco-list-content-wrapper .arco-list-content > .arco-list-item`（(0,4,0)）：真机实测行内距为 `9px 20px`，行容器 `.file-item` / `.result-item` 自带的 `padding: 6px 10px` / `8px 10px` 同样被压掉（与 `.arco-list-item` 是同一元素），「紧凑可选中行」实际从未紧凑（**存量缺陷**，非本次样式收敛引入；同一原因也使 `.result-item` 的间距从未生效）。
  ③ **demo-mock 数据与真后端漂移**——`download.listFiles` 手写 `quantization.family: 'k'`，与 shared `parseQuantization` 的 `QuantizationFamily`（`k-quants` / `i-quants` / `legacy` / `fp8` / `bf16` / `fp16` / `fp32` / `int`）不符：渲染 class 为 `quant-k`，`.quant-k-quants` 等样式类全部失配，量化徽章退化为 Arco 默认灰底；同时缺 `sizeStr`（真后端 `core/huggingface-client.ts:239`、`core/modelscope-client.ts:182` 均产出），浏览器预览下文件大小列为空白。
- **修复**：① `.info-tag` → `.parsed-info .info-tag`、`.rec-badge` → `.file-item .rec-badge`（特异性升至 (0,3,0)，压过 Arco 深色规则）；② 行内距归零改按同构选择器 `:deep(.arco-list-content-wrapper .arco-list-content > .arco-list-item)`（(0,5,0)）并在注释中写明原因；③ demo-mock 改为 `quantization: parseQuantization(<文件名>)` + `sizeStr: formatBytes(<size>)`，直接复用 shared 真实现，从根上杜绝同类漂移。
- **修复效果验证**（Playwright + 真实构建产物 + demo-mock，产物落 `test-results/render-check/`）：行内距 `9px 20px → 0px`；深色 `.info-tag` `rgba(255,255,255,.9) → rgb(60,126,255)`（= 深色 `--primary-6`）、`.rec-badge` → `rgb(255,255,255)`（= `--primary-fg`）；`.quant-badge` class `quant-k → quant-k-quants` 且取 `--badge-quant-*` 色、量化徽章数 `2 → 3`；文件大小列 `'' → '4.56 GB'`；任务行几何零重叠（进度条 right 1230 / 操作区 x 1238）、`scrollWidth - clientWidth = 0`、文档无横向溢出；控制台 0 error / 0 pageerror。`pnpm style:audit` 12/12 全绿；`vue-tsc --noEmit` + `vitest run`（66 tests）+ `vite build` + `oxlint` 全通过。
- **附：本次核对证伪项（记录以免重复排查）**：截图目测曾疑似「下载任务进度条溢出压住右侧暂停/取消按钮」——DOM 矩形实测为误报（`.task-progress-bar` x=300 / right=1230，`.task-actions` x=1238 / right=1364，无交集；`overflowX/Y` 均为 0）。结论：几何类判定以 DOM 实测为准，不采信纯目测。

### 66. FileBrowserModal 行选中/悬停底色规则永不匹配（`.fb-row` 本身即 `.arco-list-item`）— 🟢 已修复（2026-09-18）

- **位置**：`FileBrowserModal.vue` 样式块的 `.fb-row` 与 `.fb-row:hover`。
- **描述**：`.fb-row` 挂在 `a-list-item` 上，该元素的根 class 就是 `.arco-list-item`；而样式写成 `.fb-row.is-selected :deep(.arco-list-item)` 与 `.fb-row:hover :deep(.arco-list-item)`——两者都要求「行元素**内部的后代**列表项」，结构上并不存在，编译产物 `.fb-row.is-selected[data-v-x] .arco-list-item` **永远匹配不到**：文件浏览弹窗的行选中高亮与悬停反馈实际从未生效。真机渲染核对发现；与 #65 ② 的 `:deep(.arco-list-item)` 归零失效同一根因（把行元素自身误当作行的祖先）。
- **修复**：选择器落到行元素本身——`&.is-selected, &.is-selected:hover { background: var(--row-selected-bg) }`、`.fb-row:hover { background: var(--color-fill-3) }`；补 `&.is-selected:hover` 是为在同特异性下压过 `:hover` 规则，保证悬停中的选中行不掉色（同 #56 口径）。
- **修复效果验证**：CSSOM 编译结果由 `.fb-row.is-selected[data-v-x] .arco-list-item` 变为 `.fb-row.is-selected[data-v-x], .fb-row.is-selected[data-v-x]:hover`（不再依赖后代元素）＋ `.fb-row[data-v-x]:hover`；`pnpm style:audit` 12/12 全绿；`vue-tsc --noEmit` + `vitest run`（66）+ `vite build` 通过。⚠️ **像素级验证不可达**：预览环境 `system.listDir` 为空、且文件类参数分组默认收起，核对脚本无法触发弹窗入口——建议真机点一次「浏览」目视确认选中/悬停底色。

### 67. 徽章调色板撞色（来源族与量化族同色）+ 来源标识同区块重复 — 🟢 已修复（2026-09-18）

- **位置**：`theme.scss` 徽章色板（`--badge-src-*` / `--badge-quant-*`）、`DownloadCard.vue`（`.parsed-info .info-tag`、`.files-header .source-badge`、`.source-badge.src-*`）。
- **描述（真机渲染核对发现）**：
  ① **撞色**：`--badge-src-huggingface` 与 `--badge-quant-k` **同为 `#2563eb`**，而这两个徽章在下载任务行**并排出现**（`HF Mirror` + `Q4_K_M`），真机实测两者计算色完全相同（`rgb(37,99,235)`）无法区分。根因是色相预算被占满——类别族 4 值（紫 / 绿 / 琥珀 / 中性）+ 量化族 8 值（蓝 / 紫罗兰 / 灰 / 橙 / 青 / 绿 / 石板 / 红）已用尽可用色相，来源族 2 值无论取哪个彩色都会与某一族相邻或同值。
  ② **来源标识重复**：「模型文件」区块内，解析信息行 `.info-tag`（解析 URL 来源）与文件区标题 `.source-badge`（当前文件列表来源）**紧邻显示同一个来源**——真机截图目测与 DOM 计数均确认同屏 2 处 `HF Mirror`。
- **修复**：
  ① 来源族**不占色相**，改中性配色（`--color-text-2` + `--color-fill-2`），删除 `--badge-src-modelscope` / `--badge-src-huggingface` 两个 token，并在 `theme.scss` 写明「色相预算」规则：来源以文字区分（`HF Mirror` / `ModelScope`），作为次要信息视觉层级退后；中性后与任一彩色属性徽章同行均可区分（对全部组合成立，不再依赖色相预算）。
  ② 解析信息行不再显示来源徽标（只留 `modelId` 与可选 `fileName`），来源标识**只在「模型文件」区标题与下载任务行各出现一次**——保留文件区标题那处，是因为 `currentSource` 可能因用户改选搜索结果而不同于 URL 解析来源，文件列表的来源必须就地可读；随之删除已无引用的 `parseSourceLabel()`。
- **修复效果验证**（Playwright + 真实构建产物 + demo-mock）：`.info-tag` 计数 `1 → 0`、文件区 `.source-badge` 计数 `1`；来源徽标浅色 `rgb(78,89,105)` + `rgb(242,243,245)`（= `--color-text-2` / `--color-fill-2`）、深色 `rgba(255,255,255,.7)` + `rgba(255,255,255,.08)`（= 深色同名 token）；任务行同排「HF Mirror」（中性灰）与「Q4_K_M」（蓝 `rgb(37,99,235)`）实测可区分；`pnpm style:audit` 12/12、`vue-tsc --noEmit`、`vitest run`（66）、`vite build` 全通过，控制台 0 error。

### 68. 紧凑可选中行的 flex 布局被 Arco 插槽包装层吞掉（行内距同时被自家归零规则清零）— 🟢 已修复（2026-09-19）

- **位置**：`DownloadCard.vue` 的 `.file-list` / `.result-list` 与 `.file-item` / `.result-item`（模型文件行、搜索结果行）。
- **描述（用户在 mock 页标注「优化内容间距」后 DOM 实测确认）**：两条缺陷叠加，使「紧凑可选中行」的排版从未生效——
  ① **Arco 插槽包装层吃掉行容器的 flex**：`a-list-item` 会把默认插槽包进 `.arco-list-item-main > .arco-list-item-content`（两者均 `display: block`），于是 `.file-item { display: flex; align-items: center; gap: 8px }` 的 flex 子项只有那一个包装层，复选框 / 文件名 / 三枚徽章 / 大小实际是**行内文本流**排布，相互间隙 = 模板换行折叠出的一个空格（13px 字号下实测 ≈3px）；`.file-name { flex: 1 }` 与徽章的 `flex-shrink: 0` 一并失效（元素为 `display: inline`，`overflow/ellipsis` 同样无效），徽章不会右对齐——实测行宽 812px 而内容止于 x=714。
  ② **行内距被 #65 ② 的归零规则连带清零**：`.file-item` / `.result-item` 与 `.arco-list-item` 是同一个元素，而 #65 为压过 Arco `size="small"` 写的同构选择器 `:deep(.arco-list-content-wrapper .arco-list-content > .arco-list-item) { padding: 0 }`（(0,5,0)）特异性高于行类自身（(0,2,0)），故行自带的 `6px 10px` / `8px 10px` 也被清零——实测 `padding: 0px`、行高 25px（内容 23px + 边框），行贴边无留白。
- **修复**：① 两个列表块各加 `:deep(.arco-list-item-main), :deep(.arco-list-item-content) { display: contents }`，让插槽子节点直接成为行的 flex item（Arco 自身对这两层无必需盒模型，行内无 `#extra` 插槽，无副作用）；② 把行内距写进那条同构高特异性规则里（`.file-list` → `6px 10px`、`.result-list` → `8px 10px`），并从 `.file-item` / `.result-item` 移除现已失效的 `padding` 声明，注释写明「行类与 `.arco-list-item` 同一元素、padding 只能落在此处」。
- **修复效果验证**（内置浏览器 + demo-mock，`#/models?tab=library` 解析 `hf-mirror.com/Qwen/Qwen3-8B` 后实测 `Q4_K_M` 行）：行 `padding: 0px → 6px 10px`、行高 `25 → 34px`；`.arco-list-item-main` 矩形归零（`w=0`，证明 `display: contents` 生效）；相邻子项间隙 `≈3px → 8px`（复选框→名 8、名→量化 8、量化→推荐 8、推荐→类别 8、类别→大小 8）；`.file-name` 由 `display: inline` 变 `block` + `flex: 1 1 0%` + `text-overflow: ellipsis` 生效，徽章右对齐（末元素 right 1090 = 行 right 1101 − 内距 10 − 边框 1）。⚠️ `.result-item`（搜索结果行）与 `.file-item` 共用同一规则形状，但 demo-mock 的解析流程直接进入文件列表、`searchResults.length > 1` 分支未触发，**其像素级验证未覆盖**——建议真机走一次「搜索多结果」目视确认。规范落点：[frontend.md §7.5.7](../frontend.md) 列表行变体 ②。

### 69. `a-tag` 无 `.arco-tag-content` 包装层——三处 `:deep(.arco-tag-content)` 死规则使 chip 内 key/=/val 三段实测 0 间距 — 🟢 已修复（2026-09-19）

- **位置**：`ParamSummaryCard.vue` `.summary-chip`（服务页「模型路径 = …」）、`ModelMetaCard.vue` `.meta-chip`、`LocalModelsPanel.vue` `.suggestion-chip`。
- **描述（用户标注「优化内容间距」后 DOM 实测确认）**：三处都写成 `.xxx-chip { :deep(.arco-tag-content) { display: inline-flex; gap: 4px } }`，但当前 Arco（`@arco-design/web-vue` 2.58）的 `a-tag` **不渲染 `.arco-tag-content` 元素**——插槽子节点（`.chip-key` / `.chip-eq` / `.chip-val`）直接挂在 `.arco-tag` 根上，选择器永不匹配。根元素自身 `display: flex` 且无 gap，实测三段首尾相接（key right=326 = eq x=326、eq right=333 = val x=333），界面呈现为 `模型路径=D:/Models/…gguf` 挤成一坨。与 #65/#66 同一类根因：把 Arco 内部结构臆想为存在某个包装层。
- **修复**：gap 落到 a-tag 根元素本身——三处改为 `align-items: center; gap: 5px`（5px 为 §7.5.4 刻度表的「chip 内文本-计数徽章」档，即芯片内部文本间距），删除 `:deep(.arco-tag-content)` 死块并在注释写明「Arco 无该包装层」。
- **修复效果验证**：服务页 `.summary-chip`（模型路径行）实测 `gap: normal → 5px`，几何间隙 key→eq `0 → 5px`、eq→val `0 → 5px`，标签高度 20px 不变（无重排）；`.meta-chip` / `.suggestion-chip` 同规则同组件、未逐一点开触发（概览模型元信息卡与本地模型建议行需选中模型 / 打开面板），真机顺带目视即可。规范落点：[frontend.md §7.5.4 ①](../frontend.md)。

### 70. 页签标题图标与文字 0 间距——theme.scss 的全局修正被 Arco 同特异规则按注入顺序压掉 — 🟢 已修复（2026-09-19）

- **位置**：`styles/theme.scss` 的 `.arco-tabs .arco-tabs-tab-title`（模型页 / 参数页 / 设置页三处页签共用体例）。
- **描述（用户标注「优化图标与文字间距」后真机实测确认）**：该规则本意就是把页签标题的 `Icon + <span>` 改成 `inline-flex` 并给 `gap: 4px`，注释还写着「line 型另有高特异覆盖」——但它自身就是失效的那一个：Arco 的 `.arco-tabs-nav-type-line .arco-tabs-tab-title { display: inline-block }` 与本页选择器**同为 (0,2,0)**，而组件样式由 `unplugin-vue-components` + `ArcoResolver` 在运行时以 `<style>` 注入、顺序排在打包 CSS **之后**，同特异时后写者胜 → 实测计算值 `display: block`、`gap: 4px`（声明在，但 block 盒不认 gap），svg 右边界 277 = span 左边界 277，**图标与文字间距 0**。与 #65 ①（单类徽章被 Arco 深色规则压掉）、#66/#68/#69 同一类根因：对 Arco 的覆写在特异性或结构上不成立。
- **修复**：选择器显式带上 nav 的类型类升到 (0,3,0)——`.arco-tabs .arco-tabs-tab-title, .arco-tabs .arco-tabs-nav-type-line .arco-tabs-tab-title`，并在注释写明「同特异会因运行时注入顺序而输」这一判据；间距取 `6px`，与同族的「图标 + 文本」行（`SettingsPage .summary-item`、状态栏条目）一致，而非孤立的 4px。
- **修复效果验证**（内置浏览器 + demo-mock 实测三处页签）：设置页 常规/外观/高级/关于、参数页 参数预设/自定义参数、模型页 本地模型/模型库——`display: block → flex`、实测图标→文字间隙 **0 → 6px**；页签高度 40px 不变（无重排），图标与文字垂直中心差 0.5px（flex 居中的亚像素，肉眼不可见）；`pnpm style:audit` 12/12、`vite build` 通过，控制台 0 error。规范落点：[frontend.md §7.5.4](../frontend.md)「覆写 Arco 默认样式的两条硬规则」。



### 71. 下载进度条与实际进度不一致——`a-progress` 的 percent 是 0–1 比值而非百分数 — 🟢 已修复（2026-09-19）

- **位置**：`DownloadCard.vue` 的 `progressPct()` 与任务行 `<a-progress :percent>`。
- **描述（用户报「模型下载进度与实际进度不一致」后核 Arco 源码 + 真机实测确认）**：Arco `progress/line.js` 用 `width: ${percent * 100}%` 渲染、文本为 `NP.times(percent, 100) + '%'`，即 **percent 约定是 0–1 小数**；本项目 `progressPct()` 返回 `Math.min(100, downloaded/total*100)`（注释还写着「0-100 数值,供 a-progress 使用」）。结果任何 ≥1% 的进度都会算出 ≥100% 的条宽，被轨道裁满——**下载一开始进度条就是满格**，与真实字节数完全脱钩；又因 `:show-text="false"` 没有百分比数字暴露矛盾，只能靠旁边的「584.1 MB / 4.56 GB」文本察觉。属 §7.5.4 新增「覆写/对接 Arco 必须核源码单位」类缺陷，与 #68/#69/#70 同族（对 Arco 内部实现的主观假设）。
- **修复**：`progressPct` → `progressRatio()`，返回 `Math.min(1, downloaded/total)`，注释写明 Arco 的换算式；同时给 `style-audit.cjs` 加**第 13 条**回归规则——`:percent="…"` 表达式含 `100` 或 `Pct` 即 ❌（自检：旧写法 FLAG、新写法 pass），杜绝同类回潮。
- **修复效果验证**（内置浏览器 + demo-mock 真跑一次下载，模拟按 12.5% 步进）：进度条宽 / 轨道宽实测 **12.5% → 25% → 37.5% → 50%**，与同行「584.1 MB / 1.14 GB / 1.71 GB / 2.28 GB ÷ 4.56 GB」逐级吻合（修复前这些点全部显示满格）；`pnpm style:audit` 13/13、`vue-tsc --noEmit`、`vitest run`（66）、`vite build` 全通过，控制台 0 error。规范落点：[frontend.md §7.5.4](../frontend.md)「数值型组件单位约定」。



### 72. 参数页 60 行控件左右边缘都不齐（标签列按文字宽自适应 + 定宽槽位缺 min-width 被撑破）— 🟢 已修复（2026-09-19）

- **位置**：`ParamRow.vue`（标签列 / GGUF 提示槽）、`IntEntryParam.vue`（数字框宽）、`SliderParam.vue`（滑块行控件列）。
- **描述（用户批注「发现样式不统一，审查是否存在同类问题」+「优化所有输入组件的位置与宽度，要求看起来更整体」后真机实测）**：三处叠加导致参数网格参差——
  ① **标签列按文字宽自适应**：Arco `.arco-form-item-label-col` 原生是 `flex: 0 0 auto`，实测 60 行的标签宽为 28 / 42 / 56 / 59 / 70 / 72 / 84 / 90 / 93px 九种，控件起点 x 因此从 **318 一路漂到 380**（右列 750→815）。而 frontend.md §7.5.4「统一控件宽度」白纸黑字写着参数控件 `label-col` 应为 `flex: 0 1 110px` + 右对齐 + 省略号——**文档与代码漂移，该规则从未落地**（设置面板 GeneralPanel/AppearancePanel/AdvancedPanel 是真通过 `label-col-style` 实现的，实测标签恒 110px、控件起点单值 383，故本项只影响参数页）。
  ② **GGUF 提示挤占控件宽**：提示标签原为 `flex: 0 1 auto; min 44 / max 72` 内联在行内，8/60 带提示行的控件区宽从 400 掉到 **296~352**（五种值），且切换模型时提示出现/消失会让控件当场变宽。
  ③ **定宽槽位被长内容撑破**：改为常驻 72px 槽位后复测，发现「模型别名」行的槽位实际宽 **222px**、控件被挤到 146px、`a-input` 内部宽度 **0px**（值看不见）——根因是 flex 项默认 `min-width: auto`，`flex: 0 0 72px` 并不阻止内容把它撑大；必须同时写 `min-width: 0`（+ 溢出省略），属同类通用陷阱。
  另：`int_entry` 行数字框原固定 100px（`a-space` 按内容排布），与同行输入框/下拉的满宽不一致，右边缘参差。
- **修复**：① 标签列在 `ParamRow` 用 `:deep(.arco-form-item-label-col) { flex: 0 0 110px; min-width: 0; justify-content: flex-end; margin-right: 8px }` + 标签 `text-overflow: ellipsis`。**注意是 `0 0` 而非设置面板那套 `0 1`**：实测 `0 1 110px`（可收缩）在参数网格里会被控件的内在最小宽挤压，标签缩成 64 / 83px 两种、控件起点重新错位（x 346/365/797）——参数行控件（滑块 + 88px 数字框 + 72px 槽）本就占满，收缩只能落在标签上。② GGUF 提示改**常驻定宽槽位** `.gguf-hint-slot`（`flex: 0 0 72px`，提示本身仍 `v-if`），消除行宽差异与切换模型时的宽度跳动（同「槽位常驻防跳动」口径）。③ 槽位与标签都补 `min-width: 0` + 溢出省略。④ `IntEntryParam` 的 `a-space` / `a-input-number` 改 `width: 100%`、首项 `flex: 1`，数字框撑满控件列。
- **修复效果验证**（内置浏览器 demo-mock 逐行量 60 行）：标签宽 `[28…93] 九种 → [110] 一种`；控件起点 `[318…380] → [392, 824]`（每列一个值）；控件宽 `[212…356] → [206, 178]`——唯一残差是「已修改」行内联的还原 ✕（24px + gap 4），该行本身已有橙色描边标示，属瞬时态不预留（预留会在 52/60 行常年留白）。「模型别名」行控件由 146px 恢复到 178px、输入框内部宽度不再为 0。同类问题扫描：全库 `flex: 0 0 <px>` 定宽项复查，仅 topbar/statusbar 两条为列向高度基准（探针误报），`SliderParam` 的 88px 数字项实测未被撑破；设置页 3 行实测已对齐，无需改。`pnpm style:audit` 13/13、`vue-tsc`、`vitest`（66）、`vite build` 全绿。规范落点：[frontend.md §7.5.4](../frontend.md)。
  ⚠️ 本条的 110px / 控件宽 `[206, 178]` 已被 #73 修订为 140px / `[176, 148]`（110px 下 11/60 行标签自然宽超可用 94px 被截断）。

### 73. #72 的两处二次不统一：滑块刻度门控留了「一只例外」+ 定宽标签列截断长标签 — 🟢 已修复（2026-09-19）

- **位置**：`SliderParam.vue`（`show-ticks` 门控）、`ParamRow.vue`（标签列宽）、`shared/src/i18n/labels.ts`（两条参数标签）。
- **描述（用户再批「滑块样式还是没有统一」后实测）**：#72 的修法自身引入两处新的不统一——
  ① **刻度按步数门控 → 同页混排**：`show-ticks` 用 `(max-min)/step ≤ 40` 门控，实测 13 只滑块里只有「温度」(0–2 step 0.05 → 39 格) 画刻度，其余 12 只不画；带刻度圆点的轨道与光轨道同页并排，本身就是样式不统一。而这些量程的刻度在 80–110px 的轨道上全是亚像素噪声，没有识读价值。
  ② **定宽 110px 标签列截断长标签**：用离屏 nowrap 探针量标签自然宽，最长「合成接受长度（基准）」= **140px**，而 110px 列（去掉 `margin-right: 8px` 后实际可用 94px）使十余行中文标签被省略号截断（「草稿模型 GPU 层数」「每槽位统一 KV 上限」「草稿 KV 缓存类型 K/V」…）。对齐不能以牺牲可读性为代价。
- **修复**：① 参数滑块**一律不开 `show-ticks`**（删除 `TICK_LIMIT` 门控与 `showTicks` computed），并在 `SliderParam.vue` 注释与 §7.5.4 / AGENTS.md 写明「不得改回按步数门控」的原因；② 标签列提到 **140px**（与 AdvancedPanel 已有的 140px 同档）；仍被截断的两条「…（基准）」把限定语并入 tooltip——`PARAM_HELP` 原文已含「仅基准测试」，标签去掉冗余括注后信息零损失（`spec_synth_len` / `spec_synth_rates` 两条 zh 文案）。
- **修复效果验证**（内置浏览器 demo-mock 重载后量 60 行）：`.arco-slider-ticks > *` 节点数 `39 → 0`、带刻度滑块 `1/13 → 0/13`，13 只滑块轨道宽全部 80px、数字框全部 88px（`spaceItemWidths = ["110x88"] → ["80x88"]` 单一值）；标签截断行（`scrollWidth > clientWidth`）`11 → 0`，trim 后全页最长标签自然宽 **127px**（「每槽位统一 KV 上限」），列可用宽 132px（140 − 8 margin）恰好容得下；标签列宽恒 `[140]`、右边缘恒两值 `[414, 846]`、控件区起点 `[422, 854]`、控件宽 `[176, 148]`（176 常规 / 148 带 ✕ 的已修改行）。代价：滑块轨道由 110px 降到 80px（140px 标签列挤占），如需更长轨道可缩提示槽 72→56px 或数字框 88→76px，属可再议的观感取舍。`vue-tsc`、`vitest`（66）、`vite build`、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.4](../frontend.md)（新增「参数滑块一律不开 show-ticks」条）。

### 74. 建议值芯片被硬切且值读不到 + 文本参数行 hover 出现两个 ✕ — 🟢 已修复（2026-09-19）

- **位置**：`ParamRow.vue`（`.gguf-hint-slot` / `.gguf-hint`）、`TextParam.vue`（`allow-clear`）、`ToolTip.vue`（内容插槽）。
- **描述（用户两条批注「修复建议值显示样式」「修复还原默认按钮重复出现」，同指「模型别名」行）**：
  ① **建议值读不到**：别名建议是模型文件名（30 字），落在 72px 定宽槽里实测 `scrollWidth 220 / clientWidth 70`；而 `.arco-tag` 是 `inline-flex` 且无内容包装层（#69 同源），**CSS `text-overflow: ellipsis` 根本不生效**——界面显示成被硬切、连省略号都没有的 "Qwen3-32B"。原生 `title` 又只写了「点击应用此建议值」，于是**值本身在界面上任何地方都读不到**（与 §7.5.2「不用 opacity 削弱文字」同类的信息丢失）。
  ② **一行两个 ✕**：`TextParam` 的 `a-input allow-clear` 会渲染 Arco 自带清除按钮（`.arco-input-clear-btn`，平时 `visibility: hidden`、hover 有值时现形），与行级「还原默认」✕ 同屏；且它写入**空串**而非默认值（`host` 清空即触发 `err_invalid_host`），与行级按钮语义冲突。
  ③ 附带发现：`ToolTip` 走 `content` prop，而 `.arco-tooltip-content` 默认 `white-space: normal` → 全站「标签\n帮助」两段浮层实测被折成一行（高 30px）。
- **修复**：① 提示文本改 JS 中间省略（头 5 + `…` + 尾 2；尾部量化后缀/单位才是区分信息），完整值 + 参数名 + 操作提示三段进 `ToolTip`（去掉原生 `title`）；`ToolTip` 改 `#content` 插槽 + 自有 `.tooltip-text { white-space: pre-line }`；芯片横向内距收到 §7.5.4 ① 徽章档 6px（8px 档下 8 字 mono 要 74.7px > 72px 槽，差 2px 切尾字母）。② 去掉 `allow-clear`，参数行还原入口唯一。
- **修复效果验证**（内置浏览器 demo-mock；需先进「模型管理」触发 GGUF 读取，参数页才会出现 8 条建议值）：8/8 芯片 `scrollWidth === clientWidth`（**零裁切**），别名芯片 "Qwen3…_M" 宽 70px ≤ 72px 槽、高仍 20px；浮层实测 3 段 74px 高、文本 `模型别名 / Qwen3-32B-A3B-Instruct-Q4_K_M / 点击应用此建议值`；点芯片仍写入完整值（`45352452 → Qwen3-32B-A3B-Instruct-Q4_K_M`，`ToolTip` 包裹不吞点击）；全页 `.arco-input-clear-btn` 计数 **4 → 0**（4 个非空文本行：监听地址 / 模型别名 / GPU 层数 / 草稿模型 GPU 层数），行级 `.clear-btn` 保持 1。`vue-tsc`、`vitest`（66）、`vite build`、`style:audit` 13/13 全绿。规范落点：[frontend.md §7.5.7](../frontend.md)（「参数行不得开 allow-clear」「GGUF 建议值芯片」两条）+ [§7.5.6](../frontend.md)（多行 tooltip 走 `#content` 插槽）+ §7.5.8 豁免措辞收敛。**同轮追加**：参数行还原 ✕ 的提示也由原生 `title` 改 `ToolTip`（用户指定），`<a-button>` 外包一层后几何实测零变化（按钮 24×24、`.tooltip-host` 同盒、行高 38px），浮层渲染「恢复为默认值」108×30，点击仍生效（别名 → 默认空值、✕ 随之消失）。

### 75. 提示机制两套并存：原生 `title` vs Arco `ToolTip` — 🟢 已修复（2026-09-19）

- **位置**：16 个组件/页面，`grep -rn ':title=' packages/ui/src --include=*.vue` 登记时实测 **60 处**（DownloadCard 11 / ParamsPage 9 / LocalModelsPanel 8 / TopBar 8 / ServiceStatusCard 6 / PresetsPanel 4 …），其中 6 处是 `a-dgroup` / `a-statistic` / `iframe` 等**组件 prop**（合法），其余为浏览器原生浮层。
- **描述**：原生 `title` 不受主题控制（深色下仍是系统白底浮层）、有约 1s 延迟、承载不了多段文本，与 §7.5.6 的 Arco 浮层体系（实底 + token 色 + `pre-line` 三段）观感不一致。#74 只统一了参数行三处，其余出现点仍是原生——「参数页一套、别处一套」。
- **修复（先定边界再动，不逐处替换）**：① **页面级/铬面上的固定少量元素**转 `ToolTip`，共 **26 处 / 9 个文件**——TopBar 8（含 3 个 win-btn，`aria-label` 保留）、StatusBar 2、ParamsPage 4（显存统计块 + 性能目标/恢复基线/清除会话）、LogsPage 2、ServicePage 2、DownloadCard 3（HF Mirror / ModelScope / 打开模型目录）、ServiceStatusCard 3（外部实例徽章 + 打开网页 + 管理模型）、GeneralPanel 1、FileBrowserModal 1；② **保留原生的三类**写进 §7.5.6 成硬边界：组件 `title` prop（`a-modal`/`a-popconfirm`/`a-statistic`/`a-dgroup`/`iframe` 无障碍名）、**`v-for` 数据条目上的提示**（模型表格行、下载任务行、预设行、chip 列表——每条目一个 Arco trigger 实例，与 §7.1 热路径铁律相冲）、**截断值提示**（`.mono-val`/`.file-name`/`.task-name`/`.task-error`/`.summary-label`）与 `a-input :title`（外包 host 会动到表单控件盒型）。
- **落地要点（实测）**：① 自带 `v-if` 的元素转 `ToolTip` 时 `v-if` 必须移到 `ToolTip` 上（否则渲染空 host 与空浮层）；DownloadCard 的 HF Mirror/ModelScope 是 `v-if`/`v-else` 成对钮，两条指令要一起移到两个 `ToolTip` 上才保持相邻成对；② **`a-dropdown` 触发器外包 `ToolTip` 不破坏下拉**——Trigger 挂在 host 上、点击由按钮冒泡触发，弹层锚点即 host 盒（实测顶栏模型下拉中心 x=493 = 触发器中心；参数页性能目标 `position="bl"` 弹层 x=723 恒等于触发器 x）；③ 顶栏几何零回归：`.right` 五子项宽 `234/82/82/82/131`、gap 恒 8px、`.model-name` 仍在 180px 处省略（`scrollWidth 279 / clientWidth 180`）、状态栏复制值 109px 未撑破。
- **修复效果验证**：原生浮层 `grep -rn ':title=' packages/ui/src --include=*.vue` 计数 **60 → 33**（另 1 处 `iframe title` 无障碍名 + 6 处组件 prop；用「`:title=` 或 `title="`」合并口径则为 34），转换 26 处 / 9 文件；`<ToolTip` 使用点 **35 处 / 16 文件**；hover 实测顶栏「启动」浮层底 `rgb(29,33,41)` + 白字（Arco token，深色主题下不再是系统白底）、参数行 ✕ 浮层 108×30；`vue-tsc`、`vitest`（66）、`vite build`（index chunk 230.71 → 231.08 kB，+0.37 kB 为 26 处包裹）、`style:audit` 13/13、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.6](../frontend.md)（「提示机制边界」「仍保留原生 `title` 的三类」「交互控件外包 ToolTip 的两条实测注意」三条）。
- **附带观察（已查清根因，决定不修）**：参数页首挂有 **60 条** `[Vue warn] toRefs() expects a reactive object but received a plain one`（一行一条）。根因在 Arco 侧：`form-item` 的 setup 里 `const formCtx = inject(formInjectionKey, {})` 后紧接 `const { autoLabelWidth, layout } = toRefs(formCtx)`（dev 包 `@arco-design_web-vue.js:20096`），而参数行是**刻意**「每行独立 `a-form-item`、无外层 `a-form`」（§7.5.4 记录的设计），注入落到默认值 `{}`（普通对象）→ 触发 dev 警告。**四条确认证据**：① 拦 `console.warn` 取栈，60 条全部落在 `form-item setup`，参数页首挂恰好 60 条 = 60 行；② 设置页三面板有外层 `a-form`，实测 **0 条**；③ 全库 `grep toRefs` 零命中，非我方代码；④ 该警告串在 `packages/ui/dist` 产物中**不存在**（`__DEV__` 门控），且无人依赖由此产生的 `arco-form-item-layout-undefined` 类（grep 零命中）。**不修的三条理由**：套 `a-form` 会启用每行 `setLabelWidth` 的挂载+更新测量并喂给 reactive `labelWidth` + `maxLabelWidth` computed（与 §7.1 热路径铁律相反），还会引入真实 `<form>` 元素与 Enter 提交语义；`provide(formInjectionKey, reactive({}))` 需深路径 import Arco **非公开导出**（`es/form/context.d.ts` 有声明但根 `index.d.ts` 未导出），与审计第 12 条「勿依赖 Arco 内部实现」同一脆弱性家族；纯 dev 噪声、零运行时成本。

### 76. 参数网格 `max-width: 1160px` 硬封顶 3 列 → 宽屏右侧大面积空白 + 中间宽度滑块被压瘪 — 🟢 已修复（2026-09-20）

- **位置**：`ParamsPage.vue` `.param-grid`（`max-width` 与 `grid-template-columns`）。
- **描述（用户批注「硬限制每行 3 个参数项，1920×1080 等常用分辨率右侧大面积空白」后，Playwright 逐视口实测）**：一处封顶同时造成**两个方向**的坏结果——
  ① **宽屏浪费**：`max-width: 1160px` 使网格恒 1160px，而卡片可用宽在 1600 视口已达 1326、1920 为 1646、2560 为 2286 → 右侧空白分别 **166 / 486 / 1126px**（2560 下近半宽度未用）。
  ② **中间宽度反而退化**：1440 视口尚未触及封顶，`minmax(340px, 1fr)` 排成 3 列 × 369px，控件仅剩 145px、**滑块轨道 31px**（拇指几乎占满轨道，0..262144 量程不可用）；同页 1280 两列时轨道却有 142px——同一控件在不同分辨率下尺寸相差 4.6 倍。
- **修复**：删除 `max-width` 上限，最小轨由 340px 提到 **400px**（推导：标签列 140 + 8 + 控件 ≥176〔滑块轨道 80 + 间隙 8 + 数字框 88〕+ 4 + 提示槽 72 ≈ 400），列数交给 `auto-fill` 按容器宽度决定。**400 而非 380 的实测依据**：380 可让 1920 排到 4 列，但滑块轨道压到 **55px**，低于 #73 定的 80px 下限——为凑列数牺牲控件可用性是本末倒置，故取 400 并在 §7.5.7 写明「不得为凑列数下调」。
- **修复效果验证**（Playwright 无头 Chromium，视口 1280/1440/1600/1728/1920/2560，逐档量网格宽/列数/轨道/控件/截断）：`waste`（容器宽 − 已用轨道和）**六档全为 0**；列数 2 / 2 / 3 / 3 / 3 / 5 随宽度单调增长；滑块轨道 **142 / 222 / 84 / 127 / 191 / 102px**（全部 ≥80px 下限）；对齐不变量在各列宽下恒成立——标签列宽 `[140]` 单一值、控件起点每列恰一个值、**0 行标签截断**、0 刻度节点。同类扫描：全库 `grep "max-width: [0-9]"` 复核，其余命中均为元素级截断（TopBar 模型名 180px、DownloadCard 文本 200/480px）或 `max-width: 100%` 伙伴声明，**无第二处内容区硬封顶**。`vue-tsc`、`style:audit` 13/13（42 文件）、`vite build` 全绿。规范落点：[frontend.md §7.5.7](../frontend.md)「参数网格」条重写（含 400px 推导、实测表与「不得为凑列数下调」）。
  ⚠️ 本条的 400px 最小轨与「1600 → 3 列 / 2560 → 5 列」已被 #77 修订为 **450px / 1600 → 2 列 / 2560 → 4 列**（400 少算了行自身的 2px 边框 + 16px 内距，实测 413px 轨道上滑块轨道仅 75px、低于本条自己援引的 80px 下限；#77 为还原 ✕ 增设常驻槽又 +28px）。

### 77. 还原 ✕ 一出现就挤瘪同行控件（建议值槽已常驻但 ✕ 未预留）+ 建议值芯片族三处不同档 — 🟢 已修复（2026-09-20）

- **位置**：`ParamRow.vue`（`.gguf-hint-slot` / `.clear-btn` / `.gguf-hint` 内距）、`ParamsPage.vue`（`.param-grid` 最小轨、`.rec-chip`、`.target-rec-chips`）。
- **描述（用户三条批注：「调研所有建议值组件样式是否统一」/「调研建议值组件出现后挤压左侧组件宽度导致变形的问题」/「优化建议值、还原按钮均固定占用宽度，变化时控制可见不再挤压其他组件变形」，真机逐行量 60 行）**：
  ① **批注②的前提需订正**：挤压**不来自建议值**。`.gguf-hint-slot` 自 #72 起就是常驻定宽槽，实测带提示行与不带提示行的控件宽同为 171（提示出现/消失零影响）。真正的残源是**行尾还原 ✕**——它按 `v-if="hasChange"` 直接内联在 `.param-row-wrapper` 里，出现即吃掉 `24 + gap 4 = 28px`：同一列里「已修改」行控件宽 **171 → 143**（滑块轨道跌到 **47px**，远低于 #73 的 80px 下限），且提示槽整体左移（芯片 x **597 → 569**，同列右边缘不齐）。#72/#73 当时把这条判为「瞬时态不预留」（登记为控件宽 `[176, 148]` 两值），本轮由用户明确否决：**装饰元素的 presence 不得改变其它元素的几何**。
  ② **批注①：建议值芯片族实测三处不同档**（全库 `<a-tag` 23 个使用点清点 + 在架者逐个数计算值）：`.gguf-hint`（参数行）h20 / 内距 **`0 6px`**（#74 为挤进 72px 旧槽写的覆写）；`.suggestion-chip`（模型页建议参数）h20 / `0 8px`；`.rec-chip`（性能目标联动建议）**h24 / 缺 `size="small"`**，且内容为纯文本 `key = value`、无同族三段配色，另带一条与 a-tag 原生同值的死声明 `color: --color-text-1`。同一语义（「模型/目标建议值」）出现两种高度、两种内距。
  ③ 附带：`.gguf-hint` 的 `font-size` 未显式声明（继承 a-tag small 的 12px），与其余三族的 `font-size: var(--fs-sm)` 写法不一致（计算值相同，但 Arco 一改即分叉）。
- **修复**：① `.clear-btn` 外包**常驻定宽槽 `.clear-slot`（`flex: 0 0 24px` + `min-width: 0`）**，`v-if` 留在 `ToolTip` 上（避免空 host + 空浮层，§7.5.6），与提示槽同构；提示槽随内距回归 Arco 原生 `0 8px` 由 72 → **76px**（8 字 mono 74.3px ≤ 76）。② 网格最小轨 400 → **450**（新槽 +28 与旧值漏算的 18 一并计入，使「控件 ≥176 / 轨道 ≥80」这条既有不变量真正成立）。③ `.rec-chip` 补 `size="small"` + 三段配色 + `gap: 5px`、删死声明；`.gguf-hint` 删 `padding-inline: 6px` 覆写、补 `font-size: var(--fs-sm)`。**不预留** `.dep-hint`（4+14px）：`syncDependencies` 只保留 `file`/`dir` 型依赖参数的路径，而 11 条 `dependsOn` 中 file 型仅 `spec_draft_model` → 该态最多命中 1/60 行，为它预留会把最小轨推到 468（1728 视口少一列）。
- **修复效果验证**（Playwright 无头 Chromium 逐视口 1156/1280/1440/1600/1728/1920/2560 + 内置浏览器交互实测，均需先进「模型管理」点模型行触发 GGUF 读取，参数页才出现 8 条建议值）：
  ① **对齐收敛**：控件宽 distinct 取值 **`[171, 143]` 两值 → 每列恰一个值**（1156 单列 `[566]`、1280 `[206]`、1920 `[254.7]`）；提示槽 x 与 ✕ 槽 x 每列各一个值（1156 恒 `992 / 1072`，改前带 ✕ 行的芯片在 x=569 与 597 间跳）；滑块轨道 **94.7–480px 全部 ≥80**；标签截断 0、刻度节点 0、`waste` 0。
  ② **交互零回归**：点「Top-K」芯片 `40 → 20`（✕ 随之出现）后控件宽仍 566、槽 x 仍 992/1072；点 ✕ 还原 `20 → 40`（✕ 消失）后同三个值仍不变——**presence 切换不再改变任何几何**。
  ③ **芯片族同档**：`.gguf-hint` / `.suggestion-chip` / `.rec-chip` 三族实测 `offsetHeight` 全 **20**（`.rec-chip` 改前 24）、内距全 **`0 8px`**、字号 12px mono、`gap 5px`、key 段 `rgb(22,93,255)`；8/8 芯片 `scrollWidth ≤ clientWidth` 零裁切（最长别名 "Qwen3…_M" 74.3px ≤ 76 槽）。
  ④ **列数代价（如实记录）**：1600 由 3 列退为 2 列（轨道 84 → 270）、2560 由 5 列退为 4 列（102 → 183）、≤1210 视口退为单列；1920 仍 3 列（轨道 158.7）。`vue-tsc`、`vitest`（core 359 + ui 66）、`style:audit` 13/13、`vite build`、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.4](../frontend.md)「统一控件宽度」（两槽常驻 + `.dep-hint` 不预留的量化理由）、[§7.5.7](../frontend.md)「建议值芯片族统一」「参数网格」450px 推导与复测表、§7.5.8 两条检查项。
- **同类扫描**：全库 `grep "<a-tag"` 共 24 个使用点复核尺寸档——实测在架的 `.summary-chip` / `.meta-chip` / `.suggestion-chip` / `.gguf-hint` / `StatusTag` 全部 `offsetHeight 20`（`size="small"`）。两处无 `size`：① DownloadCard `.cat-chip`（类别筛选，mock 未展开文件列表故本机未量，按 §7.5.4 ⑥ 明文「筛选项走 a-tag 默认 24px 交互档」为**有意档位**）；② **`ServiceStatusCard:187` 外部实例徽章**（仅在检测到外部 llama-server 时渲染，mock 无该态故未实测；按 `.rec-chip` 改前实测推定 h24，与同排 `StatusTag`（实测 h20）混排——属状态徽章族而非建议值族，是否收档待定）。





## 🟢 已修复索引

完整的问题描述 / 修复方案 / 验证证据见 [已修复归档](../archive/style-todo-resolved.md)（只读留档）；修复后的规范落点见 [frontend.md §7.5](../frontend.md)。

| # | 条目 | 修复日期 |
| --- | --- | --- |
| 77 | 行尾还原 ✕ 内联在 `v-if` 里，出现即挤掉同行控件 28px（控件宽 `[171,143]` 两值、芯片 x 569↔597）+ 建议值芯片族两种高度两种内距（`.rec-chip` 缺 `size="small"`、`.gguf-hint` 6px 内距覆写）→ 两槽常驻 + 芯片同档 + 最小轨 400→450 | 2026-09-20 |
| 76 | 参数网格 `max-width:1160px` 硬封顶 3 列：1920 右侧空 486px / 2560 空 1126px，且 1440 未封顶时排 3 列把滑块轨道压到 31px（改为无上限 + 最小轨 400px） | 2026-09-20 |
| 75 | 提示机制两套并存（原生 `title` vs Arco `ToolTip`）：26 处页面级/铬面控件转 ToolTip，并立「组件 prop / v-for 条目 / 截断值」三类保留边界 | 2026-09-19 |
| 74 | 建议值芯片被硬切成 "Qwen3-32B" 且浮层不带值（a-tag inline-flex 下 CSS 省略号不生效）+ 文本参数行 hover 两个 ✕（allow-clear 与行级还原冲突） | 2026-09-19 |
| 73 | #72 二次不统一：滑块刻度门控只剩一只例外 + 110px 标签列截断长标签（改一律无刻度 + 140px，两条「（基准）」限定语移入 tooltip） | 2026-09-19 |
| 72 | 参数页 60 行控件左右边缘都不齐（标签列按文字宽自适应 + 定宽槽位缺 min-width 被撑破；§7.5.4 文档与代码漂移） | 2026-09-19 |
| 71 | 下载进度条与实际进度不一致（`a-progress` percent 是 0–1 比值，曾按 0–100 传值致满格） | 2026-09-19 |
| 70 | 页签标题图标与文字 0 间距（theme.scss 全局修正被 Arco 同特异规则按运行时注入顺序压掉） | 2026-09-19 |
| 68 | 紧凑可选中行的 flex 被 Arco 插槽包装层（`.arco-list-item-main/-content`）吞掉 + 行内距被自家归零规则连带清零 | 2026-09-19 |
| 69 | `a-tag` 无 `.arco-tag-content` 包装层，三处 `:deep(.arco-tag-content)` 死规则致 chip 内 0 间距 | 2026-09-19 |
| 67 | 徽章调色板撞色（来源族与量化族同为 #2563eb）+ 来源标识同区块重复 | 2026-09-18 |
| 66 | FileBrowserModal 行选中/悬停底色选择器永不匹配（`.fb-row` 即 `.arco-list-item`） | 2026-09-18 |
| 65 | 真机渲染核对发现的样式缺陷（深色单类徽章被 Arco 压掉 / 列表行内距归零特异性失效 / demo-mock 量化 family 与 sizeStr 漂移） | 2026-09-18 |
| 60 | 下载卡片徽章体系未 Arco 化（5 类手绘 span 徽章）+ 计数徽章 opacity 削弱文字 | 2026-09-18 |
| 61 | 下载卡片覆写 Arco 内部态类 `.arco-tag-checked`（注释引用已失效规范） | 2026-09-18 |
| 62 | 下载卡片非 scoped 样式块裸写 Arco 全局类名（全局外泄） | 2026-09-18 |
| 63 | 下载卡片布局/体例离群（Grid 任务项、列表覆写面、私有标题体例、间距与冗余） | 2026-09-18 |
| 64 | 规范文档漂移：§7.5.3 标签圆角 4px/2px、徽章承载与列表行未登记 | 2026-09-18 |
| 54 | Sidebar 版本号裸字号 12px | 2026-09-07 |
| 55 | 设计 token 文档漂移：theme.scss 已扁平化为「纯 Arco 默认」，§7.5.3/§7.5.6 与 AGENTS.md 仍描述旧胶囊/玻璃体系 | 2026-09-07 |
| 56 | 模型表格选中行 hover 掉色（Arco 行 hover 规则压过选中态底色） | 2026-09-13 |
| 57 | 深色主题选中行底色过深（primary-1 深色取值为近黑藏青，整行铺满观感差） | 2026-09-13 |
| 58 | 状态标签 a-tag 传入 Arco 不识别的语义色名（success/warning/danger/processing） | 2026-09-13 |
| 59 | 状态栏标签芯片深色主题下叠蓝铬面对比不足（gray ≈ 1.4:1 不可读） | 2026-09-13 |
| 53 | 文字可读性专项：弹窗 panel 文字脱离 backdrop-filter 发虚（blur 移 ::before 叶子层）、StatusBar 白字去 opacity（0.65→~2.6:1 升满不透明 4.5:1）、新增 --success/warn/danger-text 自适应变体使浅色面语义文字由 2.2–3.8:1 升至 ≥4.5:1（控制台/日志保留亮色）、hint 去 opacity | 2026-09-04 |
| 52 | 跨页面间距一致性统一（全量间距审查）：筛选 chip 水平内距 `0 9px`→`0 8px`（DownloadCard 对齐 level-chip）、fs-sm `.rec-chip` `2px 8px`→`3px 8px`、`.empty` 空态 `16px`→`20px`（BenchPanel 对齐 Presets/LocalModels）；标准固化 §7.5.4 ⑥⑦ | 2026-09-04 |
| 51 | 浅色 `--fg-muted` 在蓝白渐变「浅蓝角」仅 AA-large（3.9–4.3:1）——2026-09-09 玻璃渐变底随迁移删除，前提消失，`--fg-muted` 归 Arco `--color-text-3` | 2026-09-09 |
| 50 | 状态小圆点尺寸两制（StatusBar 8×8 vs StatusTag 7×7）——随 a-tag 迁移消解，自绘圆点已不存在（§7.5.7「状态指示」条同步订正） | 2026-09-09 |
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

- ~~**mini-btn 默认文字色** **`--fg-secondary`**：行内小按钮使用次级文字色（区别于 `action-btn` 的 `--fg-primary`），符合「mini = 行内次级操作」语义层级，已确认保留（frontend.md §7.5.5）。~~ **【2026-09-20 核对已失效】**：`mini-btn` 与 `--fg-secondary` 在 `packages/ui/src` 均 0 命中——全站按钮已 a-button 化后该自定义类删除（§7.5.5），此条仅作历史决策留档。

- **筛选 chip 圆角**：DownloadCard 等筛选 chip 走胶囊 `--radius-pill`（筛选标签语义），已在 frontend.md §7.5.3 圆角体系中固化。**注（2026-09-18）**：该圆角是业务约定、非 Arco 默认（a-tag 默认 `--border-radius-small` 为 2px）；chip 的 hover/选中态自 2026-09-18 起一律交回 Arco 自带态（`color="arcoblue"`），不再覆写 `.arco-tag-checked`。注：本条原记录「容器卡片走 `--radius-card`（16px）」已失效——该 token 随 #20 分区风格 / #22 清理移除，分区卡片现为 `border-radius: 0`，圆角仅存 **pill / row / control 三 token**（`theme.scss:33-35`，均 4px；`--radius-modal` 已不存在）+ 2px 轨道 + 50% 圆形。

- **彩色小徽章盒模型**：下载卡片的 `--badge-*` 彩色小徽章统一 `a-tag size="small"` 承载 + `1px 6px` 内距 + `--radius-pill` 圆角（§7.5.4 ①）。

- **列表行两种变体**：原生行（`a-list` 默认，如 PresetsPanel）与紧凑可选中行（`:split="false"` + 行容器自带边框/内距/选中底色，如 DownloadCard、FileBrowserModal）并存，**禁止第三种**（§7.5.7）。
- **徽章调色板色相预算**：下载徽章分三族——类别族（4 值彩色）、量化族（8 值彩色）、来源族（**中性**，不占色相）。色相预算已被前两族占满，来源族若取彩色必然与同行属性徽章撞色（原 `--badge-src-huggingface` 与 `--badge-quant-k` 同为 `#2563eb`），故来源一律中性 + 文字区分；类别族与量化族之间存在色相相邻（如 `cat-gguf` 紫 ↔ `quant-i` 紫罗兰、`cat-safetensors` 绿 ↔ `quant-fp16` 绿），因两族徽章位置固定且**必带文字标签**（`GGUF` vs `Q4_K_M`），判为可接受，不追求色相正交。


***

## 备注

- 本清单的「修复效果验证」强调**可执行、可复现**（grep 断言 + 双主题肉眼检查 + 截图对比），避免「修了但看不出效果」。

- 修改涉及 UI 风格时，请同步阅读 `../frontend.md §7.5` 与 `AGENTS.md` 风格条目，保证「设计实现前后的应用风格一致」。

***

## Arco 全站迁移完成说明（2026-09-07）

自 `31273e4` 接入 Arco Design Vue 后，全站迁移已完成（明细见 `../archive/ARCO_MIGRATION_TODO.md`，各批均已勾选）：

- 迁移：手写控件 → `a-button/a-input/a-select/a-table/a-list/a-tag/a-tag/a-dropdown/a-tabs/a-modal/a-progress/a-alert/a-popconfirm/a-result` 等；自定义遮罩/玻璃层/旧 `action-btn`/`mini-btn`/`tab-btn` 已移除。
- 清理：孤儿 `variables.scss`/`buttons.scss`/`surface.scss` 与未用 `NavButton.vue` 已删除；`InfoStrip.vue` 亦已删除（零引用）；`theme.scss` 兼容 token 已进一步收敛——`--bg-active`/`--glass-*` 于 2026-09-09 移除（选中行改 `rgb(var(--primary-1))`、TopBar 直用 `--color-bg-2`/`--color-border-2`），现仅剩圆角/字号/动效映射（`--radius-*`/`--fs-*`/`--dur-*`/`--ease-*`）与业务语义色（徽章/控制台/状态栏）。
- 保留（业务/工程例外）：`CommandPreviewCard` 命令框（控制台深底）、TopBar 窗口控制（Electron 拖拽/协议）、StatusBar 铬样式（品牌蓝底）。
- 工程：UI 包加 happy-dom 组件测试环境（`arco-theme`/`status-tag` 测试）；**Arco 按需引入已于 2026-09-08 落地**（`unplugin-vue-components` + `ArcoResolver`，移除全量引入，产物 -27%，见 CHANGELOG v0.0.28 与 AGENTS.md）。
- 本清单历史修复项（#1–#53）继续有效；新增或回归的手写样式应先对照 §7.5 与上述迁移边界。
- 2026-09-07 补充：残留 `action-btn`/`mini-btn`/`tab-btn`/`theme-opt` 按钮已全部迁移到 `a-button`/`a-tabs`/`a-radio-group`（这些类原先依赖已删除的 `buttons.scss`，迁移前为无样式裸元素）；仅保留窗口控制 `win-btn`、列表项类按钮（`.result-item`/`.url-history-item`）与带 scoped 样式的筛选 chip（`.level-chip`）。
- 2026-09-07 收尾二批（迁移后原生控件残留审计，明细见 `../archive/ARCO_MIGRATION_TODO.md` 同名节）：`path-input` ×3 → `a-input`、`cmd-preview` 原生 textarea ×2 → `a-textarea`、`summary-chip` → `a-tag`、DownloadCard 类别筛选 `.chip` → checkable `a-tag`（更名 `.cat-chip`）、`ParamRow .clear-btn` → `a-button text/mini/circle`；§7.5.4 ⑥ 的 DownloadCard chip 类名引用同步更名。
- 2026-09-07 收尾三批（完全迁移，用户确认方向）：最后一批自绘交互控件清零——`LogsPage .level-chip` 筛选 chip → `a-radio-group type="button"`、`DownloadCard .url-history-item` → `a-dropdown` + `a-doption`（含 `.arco-dropdown-group-title` 标题）、`.result-item` → `a-list`/`a-list-item`、`ParamRow .gguf-hint` → `a-tag`、`.dep-hint` → `a-tooltip`。**唯一保留的自绘控件 = TopBar `win-btn` 窗口控制**（Electron 无边框窗口协议，Arco 无对应物）；AppLogo（img）、PageHost/PageFrame（布局壳）非交互控件，不属迁移范畴。
- 2026-09-07 收尾六批（窗口控制 a-button 化，用户提出右上角按钮应迁 Arco）：TopBar `win-btn` ×3 原生 `<button>` → `a-button type="text"` 基座 + 窗口铬覆盖（46×52 贴边热区、4px 圆角、关闭钮红色 hover），点击仍走 Electron 窗口协议——至此全应用交互控件 100% Arco 组件承载，原生 `<button>` 清零。
- 2026-09-07 收尾五批（逐页面布局复查）：统计条自绘 `.stat-*` → `a-statistic` + `a-divider`（LocalModelsPanel 模型统计、ParamsPage 参数状态条，字符串值走 `#suffix` 插槽）；清理 `--font-family` 死 token 引用（StatusBar/DashboardPage）。恒深控制台（LogsPage/ServicePage/Dashboard 问题区/命令预览）与 DownloadCard task-stats 行内状态文本为语义性展示，非旧布局残留，保留。
- 2026-09-07 收尾七批（参数行高度回归修复）：迁移引入的 `a-form-item` 默认外距/标签 32px 行高/wrapper 32px 最小高度把参数行撑到 54px（悬浮高亮下方大片空白）——删除 6 控件残留 margin、ParamRow 行内归零（margin/min-height/line-height 1.3）、控件统一 size=small；行高回归 34/38px。
