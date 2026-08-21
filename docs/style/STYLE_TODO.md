# STYLE_TODO — UI 风格待修复清单

> 目的：登记当前应用中与 **UI 风格规范（../frontend.md §7.5）** 不一致的内容，保证「设计实现前后应用风格一致」。
>
> **登记规则**：发现新的风格不一致项时，在此追加一节（位置 / 描述 / 建议修复 / 修复效果验证），描述要可复现、验证方式要可执行；修复完成后把该项移到「已修复」并标注修复日期与验证证据。**不要静默引入新风格**。
>
> **状态图例**：`🔴 待修复` · `🟡 待确认（可能是有意设计）` · `🟢 已修复`

---

## 审计方法（如何复现本清单）

```bash
# 1) 组件内硬编码颜色（token 禁令）
grep -rn "#[0-9a-fA-F]\{3,8\}\b" packages/ui/src/components packages/ui/src/pages --include="*.vue" --include="*.scss" | grep -v styles/
# 2) 组件内裸字号（应用 --fs-*）
grep -rn "font-size: [0-9]" packages/ui/src/components packages/ui/src/pages --include="*.vue" | grep -v "var(--fs"
# 3) 圆角分布（对照 §7.5.3 圆角体系）
grep -rhn "border-radius: [0-9]" packages/ui/src/components packages/ui/src/pages --include="*.vue" | grep -v "var(--" | grep -oE "border-radius: [0-9a-z%.]+" | sort | uniq -c | sort -rn
# 4) 按钮组间距（对照 §7.5.4 间距规范）
grep -rhno "gap: [0-9a-z%.]*" packages/ui/src/components packages/ui/src/pages --include="*.vue" | sort | uniq -c | sort -rn
# 5) 同名按钮类尺寸漂移（如 .action-btn 高度）
for f in $(grep -rl "\.action-btn {" packages/ui/src); do echo "$f"; awk '/\.action-btn \{/{f=1} f&&/height:/{print "  " $0; f=0}' "$f"; done
# 6) 组件内裸阴影（应全部 var(--shadow-*) / var(--overlay)）
grep -rn "box-shadow:\|rgba(0, 0, 0, 0\." packages/ui/src/components --include="*.vue" | grep -v "var(--shadow"
# 7) backdrop-filter 预算（2026-08 重构后：仅 .glass-layer + 弹窗背板 + 小型浮层；禁止逐行/滚动容器 blur）
grep -rn "backdrop-filter" packages/ui/src/components packages/ui/src/pages packages/ui/src/styles --include="*.vue" --include="*.scss" | grep -v -webkit | grep -v "^\s*//" | grep -v "//"
# 8) 动画只动 transform/opacity（禁布局动画）
grep -rn "transition:" packages/ui/src/components packages/ui/src/pages --include="*.vue" | grep -vE "var\(--ease-jelly|var\(--dur|0\.1s|0\.12s|0\.3s ease" | grep -E "width|height|margin|padding|top:|left:|right:|bottom:" | head -20
```

---

## 🔴 修复项

（当前无待修复项 —— 初始审计的 4 项已全部修复，见下方「已修复」。）

---

## 🟢 已修复

### 1. `.action-btn` 高度不一致（28px / 30px）— ✅ 2026-08-13

- **修复**：`theme.scss` 新增 `--btn-h: 30px` token；`PresetsPanel.vue` / `ModelsPage.vue`（原 28px）与 `BenchPanel.vue` / `LaunchPage.vue`（原 30px）的 `.action-btn` 全部改为 `height: var(--btn-h)`。
- **修复效果验证**：
  1. `for f in $(grep -rl "\.action-btn {" packages/ui/src); do awk '/\.action-btn \{/{f=1} f&&/height:/{print FILENAME": "$0; f=0}' "$f"; done` → 全部输出 `height: var(--btn-h)`（无 28/30 字面量）；
  2. `pnpm --filter @llama-launcher/ui build` 通过；预设/参数/启动/模型四页按钮高度统一为 30px。

### 2. DownloadCard 徽章/分类调色板未 token 化 — ✅ 2026-08-13

- **修复**：`theme.scss` 新增 13 个 `--badge-*` 语义色 token（cat/quant/src）；`DownloadCard.vue` 的 `.cat-*` / `.quant-*` / `.src-*` 徽章改引用 `var(--badge-*)`，底色用 `color-mix(in srgb, var(--badge-*) 14%, transparent)`（legacy/fp32 为 16%）。
- **修复效果验证**：
  1. `grep -rn "#[0-9a-fA-F]\{6\}" packages/ui/src/components/common/DownloadCard.vue` → 无裸 hex；
  2. `pnpm --filter @llama-launcher/ui build` 通过；下载页深/浅主题下徽章颜色与修复前一致（同色值）；
  3. 新增分类只需在 `theme.scss` 加一个 token。

### 3. elevation 阴影未 token 化（含 .2/.25 漂移）— ✅ 2026-08-13

- **修复**：`theme.scss` 新增 `--shadow-tooltip` / `--shadow-dropdown` / `--shadow-modal` / `--shadow-control` / `--overlay`；`ToolTip`、`TopBar` 下拉、`DropdownParam`、`DownloadCard` 并发下拉、`ConfirmModal` / `FileBrowserModal`（含遮罩）、`CheckboxParam` 全部改引用 token；DownloadCard 下拉阴影 `.25` 统一为 `var(--shadow-dropdown)`（消除漂移）。
- **修复效果验证**：
  1. `grep -rn "box-shadow:" packages/ui/src/components --include="*.vue" | grep -v "var(--shadow"` → 无裸 `box-shadow`；
  2. `grep -rn "rgba(0, 0, 0, 0.4\|rgba(0,0,0,0.4" packages/ui/src/components` → 无裸弹窗阴影/遮罩；
  3. `pnpm --filter @llama-launcher/ui build` 通过；浮层视觉与修复前一致；改 token 值所有同类浮层同步变化。

### 4. 深色主题下 hover 背景反馈弱（`--bg-input` == `--bg-hover`）— ✅ 2026-08-13

- **修复**：`theme.scss` 深色主题 `--bg-hover: #3c3c3c` → `#464646`（比 `--bg-input` 亮一档），深色主题下「输入底 + hover」元素出现可见背景反馈；浅色主题不变。
- **影响面（已核对）**：`--bg-hover` 被 DownloadCard 若干元素（`.info-tag`、`.checked` 态等）用作基础背景，亮化后其基础底色由 #3c3c3c 变为 #464646（轻微提亮，视觉上更接近「次级浮起面」），属预期改动。
- **修复效果验证**：
  1. 深色主题 hover 页面按钮/表格行/参数行/下拉项：背景出现可辨识亮度变化（#3c3c3c → #464646）；
  2. 浅色主题 hover 行为不变（#fff → #eaeaea）；
  3. `pnpm --filter @llama-launcher/ui build` 通过。

### 历史修复

- `2026-08-13` — BenchPanel 测试历史「应用」按钮由默认灰色改为 accent 描边变体（`mini-btn.accent`），与应用内 accent 描边按钮一致；验证：vue-tsc + vite build 通过。
- `2026-08-15` — **重构后体验异常修复（三部分改造）**：① 命令预览多行文本框 `--radius-pill` 改 `--radius-row`（80px 高 + 999px 圆角成蛋形）；② 粘性表头半透明 `--glass-bg` 改不透明 `--bg-card`（ModelsPage/BenchPanel/PresetsPanel 三处，行透出表头可读性问题）；③ `.btn-restart:hover` warn 黄底白字改 `#1a1a1a`（对齐 §7.5.1）；④ 浅色主题玻璃不透明度 0.55→0.72（深色文字对比度）；⑤ `:focus-visible` 使用 `--border-focus`、滚动条 thumb accent 着色、状态栏主色→accent 微妙渐变；⑥ 页面切换/分区折叠/侧边栏折叠动画补齐（transform/opacity，折叠宽度为单次用户触发例外）；⑦ 应用图标彩虹渐变；⑧ 清理未引用组件（PageNav/PageHeader）与未使用 `.glass`/`.glass-strong` 工具类。验证：`pnpm lint` + `pnpm test` + UI build 全绿；审计命令 1/2/3/5/6 通过。

---

## 🟢 已确认设计决策（原「待确认」项，无需修改）

- **mini-btn 默认文字色 `--fg-secondary`**：行内小按钮使用次级文字色（区别于 `action-btn` 的 `--fg-primary`），符合「mini = 行内次级操作」语义层级，已确认保留（frontend.md §7.5.5）。
- **DownloadCard 筛选 chip 圆角 12px（胶囊）与 Card 8px 并存**：胶囊形属于筛选标签语义（区别于容器卡片），已确认保留并写入 frontend.md §7.5.3 圆角体系。
- **2026-08-15 UI 全面重构（胶囊 + 单层毛玻璃 + 果冻动画 + 点缀式彩虹）**：用户确认属「完整重构新 UI 风格」，非增量引入新风格。设计决策：① 交互元素全部胶囊化（`--radius-pill`），容器/弹窗/行分设 `--radius-card/modal/row` token；② 毛玻璃采用**单玻璃层**架构（`surface.scss .glass-layer` 全视口 1 层 blur + 表面半透明），性能预算核算见 `docs/experiments/plan-kv-split-cli-test.md` 同期的性能核算（blur 层数 18→1，稳态开销 ≈0-3% 帧时间）；③ 果冻动效只动 transform/opacity，`prefers-reduced-motion` 关闭；④ 彩虹仅点缀（CTA 按钮 `--rainbow-grad` + 下载进度条 + 分区 `--hue` 循环装饰条），交互语义色不变；⑤ 新增 `data-fx='glass|off'` 视觉效果开关（Settings 可切，off = 实底性能模式，回退 = 一个属性）。验证：`pnpm lint`（含 check-docs-links）+ `pnpm test` 全绿；审计命令 1/2/3/5/6 通过，7/8 为本重构新增。详见 frontend.md §7.5。

---

## 备注

- 本清单的「修复效果验证」强调**可执行、可复现**（grep 断言 + 双主题肉眼检查 + 截图对比），避免「修了但看不出效果」。
- 修改涉及 UI 风格时，请同步阅读 `../frontend.md §7.5` 与 `AGENTS.md` 风格条目，保证「设计实现前后的应用风格一致」。
