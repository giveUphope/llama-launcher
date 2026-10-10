# 待办与未决事项

本文件是**全项目待办的唯一活归口**（工程 + UI 风格）：CHANGELOG 条目只记已发生的事实，凡「未修 / 待确认 / 备查 / 待裁定」的事项一律登记在此。**本文件只保留未关闭内容（2026-10-10 定版）**：条目关闭时，把关闭结果作为事实记入 `docs/CHANGELOG.md`（当轮 `[Unreleased]`，注明出处版本）并从本文件删除该条——不设「已关闭」区，历史存量已于当日清账（17 条，出处索引见 CHANGELOG 同日条目）。

**已确认方案的条目按 spec 写、实施中主动回写（2026-10-10 起）**：用户确认方案后先把方案按「**做什么 / 怎么做 / 怎么验 / 什么算合格**」四段写进对应 T 条目再动代码，「怎么做」里带可勾选检查点（每步含文件与位置、命令、判据）；**每完成一个检查点就回写该条目**（勾掉 + 附证据），别等用户问、也别攒到收尾；全部完成后把结果记入 CHANGELOG 并从本文件删除该条；方案中途变更先改条目再改代码。关联条目互相指名（如「T17 由 T21 归零」）。

**UI 风格类不一致项自 2026-10-10 起也登记在这里**（归一，不再设第二处登记口）：同样用 T 编号，标题里标注 `style(ui)`，正文写「位置 / 描述 / 建议修复 / 修复效果验证」四段——描述要可复现、验证方式要可执行，禁止静默引入新风格。修复完成后把结果记入 CHANGELOG 并从本文件删除该条，其**详细记录**按既有惯例追加进 [archive/style-todo-resolved.md](archive/style-todo-resolved.md) 的条目明细区，并在「已修复索引」表补一行。原双语清单 `docs/{zh,en}/style/STYLE_TODO.md` 已于 2026-10-10 整段并入该归档并移除（英文镜像是同内容的译文，按「归档不译、单份维护」不再另存副本）；审计复现方式改由 [zh/frontend.md](zh/frontend.md) §7.5.9 承载。

归一当日实测：该清单 63 段条目标题全部 🟢、`## 🔴 修复项` 段内 0 条未修，**没有存量待办需要搬迁**；随后按「内容是否已在别处体现」逐区判定并整段并入归档（明细见 CHANGELOG 同轮条目与 T15）。本文件与 CHANGELOG 同属不译清单，只维护中文单份。

## 开放项

### T20 命令预览告警补「去应用设置」CTA（2026-10-10 登记，源自首次使用调研）

- **做什么**：未配引擎 / 引擎文件不存在时的预览告警里加一只按钮，一键跳到应用设置页。现在只说「请在应用设置页配置…」——差最后一步动作（微软错误消息指南与 Ant Design 空状态规范都要求「问题 + 原因 + 一个可执行动作」）。
- **怎么做**：
  - `packages/shared/src/i18n/{zh,en}.ts` 加 `act_goto_settings`（短句、无插值槽）。
  - `packages/ui/src/components/service/CommandPreviewCard.vue`：`.cmd-alert` 内加 `a-button size="mini"`（范式抄 `ServiceStatusCard.vue` 的 `oom-act`），点击 `useRouter().push('/settings')`。**只在 `exe_not_configured` / `exe_missing` 两态给按钮**——unknown 那一态说不清原因，给跳转是误导。
  - 检查点：☐ 双字典键落地且 `verify-i18n-usage` 绿；☐ `CommandPreviewCard.test.ts` 加一条（两态出现按钮且点击触发 push、unknown 不出现）；☐ mock `?fresh=1#/service` 目测；☐ `pnpm lint` + `pnpm style:audit` 绿。
- **怎么验**：`pnpm --filter @llama-launcher/ui test`、`node scripts/verify-i18n-usage.cjs`、mock 目测（vite 常驻 5173）。
- **什么算合格**：未配引擎时预览区是「一句指路文案 + 一只按钮」，点按钮落在设置页；unknown 态无按钮；按钮必须是 `a-button`（无自定义控件、无新 token）。

### T23 目录选择器增加原生「浏览…」快捷入口（2026-10-10 登记，**待用户裁定是否做**）

- **做什么**：应用内目录浏览弹窗的工具栏加一只「浏览…」按钮，调主进程的 `dialog.showOpenDialog({ properties: ['openDirectory'] })` 作系统原生快速通道；自绘列表保留，负责原生对话框做不到的「手输路径 / 不存在则创建」。
- **为什么**：调研结论——VS Code / 思源笔记等走原生对话框，零滚动容器风险且符合系统习惯；自绘是 web 架构的被迫选择（SillyTavern/ComfyUI），但保留了路径可编辑这一优势；两者并存各自覆盖对方短板。
- **代价（必须先说清）**：需要新 IPC 通道（通道数从 56 增到 57）⇒ 连带 `packages/shared/src/types/ipc.ts` + `pnpm generate:ipc` + `apps/desktop/src/preload/index.cjs` 包装 + `docs/{zh,en}/ipc-channels.md` + AGENTS.md 与文档里的通道数声明（中英两种句式都要改，漏一处 `verify-ipc-sync` 就红）。
  - 检查点：☐ 用户裁定；☐ 通道注册 + 生成物 + preload 包装；☐ 双语文档与计数声明同步；☐ mock 的 `listDir` 与原生通道二选一的分支在预览环境可目测（mock 无 dialog，按钮在预览态隐藏或走 `__mock*` 钩子，需先定）；☐ lint 七道绿；☐ Electron 真机由用户 `pnpm dev` 复核。
- **怎么验**：`pnpm generate:ipc` 后跑 `node scripts/verify-ipc-sync.cjs`；`pnpm lint` 全绿；用户真机点一次。
- **什么算合格**：真机能弹出系统目录对话框并把选中路径写回当前输入框；自绘路径不受影响；通道计数在代码、生成物、双语文档、AGENTS.md 五处一致。

### T25 v0.0.68 CHANGELOG 段「待用户在 Electron 里复核」整段重复（2026-10-10 清账时发现，备查）

- **位置**：`docs/CHANGELOG.md` [0.0.68] 段 fix(ui,core,desktop) 条目末尾——同一段连排两遍，第二遍是去掉了「没有 desktop 测试 harness 可补」括注的短版，疑为该轮编辑残留。
- **判定（不修）**：属已公开发布的版本记录，按「已公开发布的记录不回改」纪律保持原样（T16 先例：连日期差错都不回改）；重复无害，仅阅读冗余。
- **下一步**：无需动作。若日后确需勘误发布记录，先裁定改法与留痕方式再动。
