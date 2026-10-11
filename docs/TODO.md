# 待办与未决事项

本文件是**全项目待办的唯一活归口**（工程 + UI 风格）：CHANGELOG 条目只记已发生的事实，凡「未修 / 待确认 / 备查 / 待裁定」的事项一律登记在此。**本文件只保留未关闭内容（2026-10-10 定版）**：条目关闭时，把关闭结果作为事实记入 `docs/CHANGELOG.md`（当轮 `[Unreleased]`，注明出处版本）并从本文件删除该条——不设「已关闭」区，历史存量已于当日清账（17 条，出处索引见 CHANGELOG 同日条目）。

**已确认方案的条目按 spec 写、实施中主动回写（2026-10-10 起）**：用户确认方案后先把方案按「**做什么 / 怎么做 / 怎么验 / 什么算合格**」四段写进对应 T 条目再动代码，「怎么做」里带可勾选检查点（每步含文件与位置、命令、判据）；**每完成一个检查点就回写该条目**（勾掉 + 附证据），别等用户问、也别攒到收尾；全部完成后把结果记入 CHANGELOG 并从本文件删除该条；方案中途变更先改条目再改代码。关联条目互相指名（如「T17 由 T21 归零」）。

**UI 风格类不一致项自 2026-10-10 起也登记在这里**（归一，不再设第二处登记口）：同样用 T 编号，标题里标注 `style(ui)`，正文写「位置 / 描述 / 建议修复 / 修复效果验证」四段——描述要可复现、验证方式要可执行，禁止静默引入新风格。修复完成后把结果记入 CHANGELOG 并从本文件删除该条，其**详细记录**按既有惯例追加进 [archive/style-todo-resolved.md](archive/style-todo-resolved.md) 的条目明细区，并在「已修复索引」表补一行。原双语清单 `docs/{zh,en}/style/STYLE_TODO.md` 已于 2026-10-10 整段并入该归档并移除（英文镜像是同内容的译文，按「归档不译、单份维护」不再另存副本）；审计复现方式改由 [zh/frontend.md](zh/frontend.md) §7.5.9 承载。

归一当日实测：该清单 63 段条目标题全部 🟢、`## 🔴 修复项` 段内 0 条未修，**没有存量待办需要搬迁**；随后按「内容是否已在别处体现」逐区判定并整段并入归档（明细见 CHANGELOG 同轮条目与 T15）。本文件与 CHANGELOG 同属不译清单，只维护中文单份。

## 开放项

### T36 style(ui) 清理卡两枚按钮的 `#icon` 尺寸比 Arco 的 loading 图标窄 2px ⇒ 检测/清理时按钮宽抖一下

- **位置**：`packages/ui/src/components/settings/TrashCleanCard.vue:141`（`trash-detect-btn`）与 `:169`（`trash-clean-btn`），两处都是 `<template #icon><Icon name="trash" :size="12" /></template>` + `size="small"` + `:loading`。
- **描述（大白话）**：T35 修下载卡时确认了一件事——Arco 按钮的 `:loading` 是在**同一个 `.arco-btn-icon` 槽位**里把图标换成官方转圈图形，换的图形尺寸 = 按钮字号，所以只要常驻图标与字号等宽，切换就完全不改宽度。清理卡这两处不满足那个前提：`es/button/style/index.css:753-756` 实测 `size="small"` 的字号是 **14px**（与 medium 同为 14，只有 mini 是 12），而槽里放的是 `:size="12"` 的垃圾桶图标 ⇒ 点「检测垃圾桶」/「清理已选」那一刻图标从 12 变 14，按钮宽 +2px，卡片头操作区横向抖一点。幅度小（2px）、只持续点击瞬间，但和用户批注过的「换状态改宽」是同一类。
- **建议修复**：两处 `:size="12"` 改 `:size="14"`（与按钮字号对齐），并把 `DownloadCard.vue:691-697` 那段注释里「`:size` 必须等于按钮字号，否则切换仍会抖 2px」的口径引过去；改完顺带复核 `.trash-detect-btn` 的 `min-width: 142px` 是否还需要（该预留是为「换文案」写的，现在文案恒定、只换图标，可能与新口径重复）。
- **修复效果验证**：`e2e/web/layout-stability.spec.ts` 的 ⑤ 判据（chrome 三条腿 + 两态等宽）是**按 `.parse-btn` 写的**，不覆盖清理卡；修法二选一——① 把 measure/judge 参数化成「量某个按钮」，给清理卡两枚按钮各加一条两态等宽判据（需要 mock 侧 `detectTrash`/`cleanTrash` 的可控延迟钩子，同 `__mockParseDelay` 口径）；② 只按 #81 的通用验证方式（浏览器在两态各量一次 `getBoundingClientRect`）并在此登记结论。合格线：切换前后宽差 ≤ 1px。

### T37 a11y 下载卡解析态不再向读屏出声（T35 换写法的有意取舍，无人守护）

- **位置**：`packages/ui/src/components/common/DownloadCard.vue:685-700`。
- **描述**：旧写法解析时文案从「搜索」变「搜索中」，读屏用户至少在按钮文字变化时能感到状态变了；T35 后文案恒定、只换图标，而 Arco 的 `button.js` **不加 `aria-busy`**（全文无 aria 属性），于是解析期对读屏没有任何播报。属本轮有意取舍（视觉侧的收益更大），但记下来避免被当成「已无障碍」。
- **建议修复**：给按钮补 `:aria-busy="parsing"`（一行），并考虑把「正在搜索」这句放进既有的按需 `a-alert`/加载行（`msg_parsing` 已在文件加载期用着，见 `:803`）——先确认解析期界面上是否已有可见的加载提示，避免补了视觉没有的静音播报。
- **修复效果验证**：`e2e/web/a11y.spec.ts` 目前不覆盖下载卡（无 url/下载/library 相关用例），补判据须在该文件加一条「点搜索后 `.parse-btn` 的 `aria-busy` 转 true、完成后转 false」；mock 侧靠 `globalThis.__mockParseDelay` 停在解析态。

### T23 目录选择器的原生「浏览…」入口——已实施，2026-10-11 按用户裁定**整条回退**，本条回到「待触发」状态

- **做什么**：把 `fs:pickDir` 通道与目录弹窗工具栏的「浏览…」按钮整条撤掉，通道数回到 56、i18n 键回到 400；自绘目录弹窗既有能力一律保留（手输路径回车直达 / 不存在则创建 / 逐级向上 / file 与 save 模式的扩展名过滤）。
- **为什么回退（2026-10-11 用户裁定「整条回退」）**：实施完复核发现**净收益窄于长期成本**，三条理由——① 主进程 `dialog.showOpenDialog` 的 `properties` 写死 `openDirectory`，于是**文件模式下它只能把用户送到目录，选不了文件本身**：本弹窗服务四处入口，其中 `mmproj`（多模态投影）与 `spec_draft_model`（草稿模型）是 file 型参数（`packages/shared/src/params/definitions.ts:124,174`），恰好最需要「一步选到那只 .gguf」，而点完原生对话框仍要回自绘列表再找一遍；② 目录模式（设置页模型/引擎目录）早有可手输的路径栏（回车直达、切盘符、UNC 都支持），原生入口的净收益只剩「路径记不全、要在系统里翻」这一窄场景；③ 本条自己的立项纪律是「三条触发条件满足其一再立项」（见下方调研补充），实施时一条都没满足。成本端却是长期的：多一条 IPC 通道 ⇒ 代码 + 生成物 + preload 包装 + 双语文档 + 五处计数声明，且每轮都要真机复核一次。
- **上一轮账目的更正**：本条目原检查点写的「☑ lint 七道绿」其实是**红的**——`pnpm lint | tail` 的退出码属于 `tail`，恒为 0，把 `verify-ipc-sync` 报的三处「声明 23，实际 57」吞掉了一轮（正则把待办编号「T23 通道轮」当成了通道数声明）。已由 `f3b759d` 修正则 + 在 AGENTS.md 补记「看真实退出码」的纪律。
- **怎么做（回退检查点，逐项勾并附证据）**：
  - ☑ 代码/生成物/文档逐文件还原到 T23 之前：`git checkout 260f930 --` 那两笔提交（`93bc979` feat、`bdf362e` test）碰过、且此后无人再改的 27 个文件（`shared/src/types/ipc.ts`、`ipc/system.ts`、`preload/index.cjs`、`preload/ipc-constants.cjs`、`FileBrowserModal.vue`、`i18n/{zh,en}.ts`、`demo-mock.ts` + `demo-mock.test.ts`、`env.d.ts`、`e2e/web/file-browser.spec.ts`、双语 `ipc-channels`/`architecture`/`core-modules`/`data-persistence`/`desktop-main`/`workflow`/`testing` + README 双语）（实测 27 个文件还原完毕，`git status` 除 AGENTS.md / CHANGELOG / TODO 三处手改外全为还原项）
  - ☑ `pnpm generate:ipc` 重生成 56 通道产物（输出 `[generate-preload] up to date (56 channels)`）
  - ☑ `AGENTS.md` 手改：通道数声明与中英句式示例回到 56（该文件此后被 `f3b759d` 改过，不能整文件还原）（实改四处：lint 段英文句式、Conventions「当前 56 个通道」、双语规则「IPC 通道数（56）」与 `"56 channels"` 示例；另把测试面计数行 234 改回 233）
  - ☑ `docs/CHANGELOG.md`：删除 [Unreleased] 里的 T23 落地条目（该功能不再进入任何发布版本，留着等于凭空多一条对外承诺），回退事实由新条目承载；三段调研结论不撤销，留档在本条目（已删，回退事实由同段 `revert(ui,desktop)` 条承载）
  - ☑ 全绿判据：`pnpm lint`（**`set -o pipefail` 或直接看退出码**）+ `pnpm test` + `pnpm e2e:web`（91 → 89，file-browser 的「浏览…写回」判据随按钮撤除）+ `pnpm style:audit`（实测退出码全 0：`verify-ipc-sync` 报「文档通道数声明与实测一致（56）」、i18n 各 400 键、`pnpm lint` / `pnpm test`（core 41 文件 566 + ui 22 文件 233）/ `pnpm e2e:web`（89 passed）/ `pnpm style:audit`；源码与双语文档 grep `FS_PICK_DIR|fs:pickDir|picker_browse|fb-browse` 零命中；mock 页 `?fresh=1#/settings` 目测弹窗工具栏只剩 Up + 路径栏，「浏览…」不再出现，手输 / Up / 不存在则创建照旧）
- **怎么验**：`node scripts/verify-ipc-sync.cjs` 实测 56 且文档声明一致；`grep -rn "FS_PICK_DIR\|fs:pickDir\|picker_browse\|fb-browse" packages apps/desktop/src docs/zh docs/en README*` 零命中（`useFilePicker.ts` 导出的 `pickDir(options)` 是弹窗自身的组合入口，与已删通道无关，属正常保留）；mock 页目录弹窗不再出现「浏览…」，手输跳转 / Up / 不存在则创建照旧可用。
- **什么算合格**：通道实测 56、五处声明一致、四套门禁与测试全绿、界面零残留，且**不留下任何指向已删通道的文档、注释或桩**。
- **若将来重做**（触发条件不变：用户回报找目录麻烦 / 目录规模大到弹窗可感知卡顿 / 出现依赖系统选位习惯的新场景）：**必须先解决「按模式分流」**——file 模式走 `openFile` + 与自绘同一份 `filters` 扩展名过滤、选中即把文件路径回填参数值，dir 模式才走 `openDirectory`，否则重蹈「实现了但选不了文件」；想先免掉通道成本，可走下方路线盘点的 ③ 拖拽目录 + ④ 最近目录历史（两条都零新通道）。
- **调研留档（回退不撤销这些结论，2026-10-10）**：
  - **调研补充（2026-10-10，回答「暂不做是否会导致功能问题」）**：**不会**。逐条核对 `FileBrowserModal.vue` 与 `ipc/system.ts` `FS_LIST_DIR` 的实况，功能语义已完整：① 滚动由 v0.0.68 修复且 e2e 判据锁定（真滚轮推 `scrollTop`、末行进入可视区）；② 目录遍历完整——单击进目录、Up 向上、路径失效仍可向上导航（主进程恒算 `parent`）；③ 路径栏可手输回车跳转，含盘符切换（输 `D:\`）与 UNC 网络路径；④ 「不存在则创建」是原生对话框做不到的自绘独有能力；⑤ file/save 模式有扩展名过滤与选中语义。**不做的损失全在效率与习惯层，不在功能层**：深层目录逐层点击（无树形/面包屑/快捷位置下拉）、切盘符靠手输、与系统文件对话框习惯不一致；另有一个真实的潜在风险点——列表**无虚拟化**，主进程全量 `readdir` 一次返回，模型目录若指向数万条目的仓库，`a-list` 全量渲染会明显卡顿（原生对话框自带虚拟化，这是 T23 唯一涉及「功能体验上限」的理由）。**触发条件（满足其一再立项，否则维持不做）**：① 用户实际回报「找目录麻烦 / 层级深」；② 模型目录条目规模大到弹窗可感知卡顿；③ 出现依赖系统选位习惯的新场景。**订正（2026-10-10 实施时复核）**：原「盘符根 Up 按钮原地空转」的说法有误——`FS_LIST_DIR` 已在 `parent === target` 时返回 `null`（`ipc/system.ts`），根目录下 Up 按钮正常禁用（mock 目测 `C:\` 亦证），无需任何修复。
  - **路线盘点（2026-10-10，回答「除自绘外还有别的路线吗」）**：① **原生 `dialog.showOpenDialog`**（本条现方案）——OS 原生 UI，代价 = 新 IPC 通道 + 五处计数声明 + 真机复核；② **`<input type="file" webkitdirectory>`**——同是系统对话框但语义错位（选目录却全量枚举目录树文件，几万条目模型目录会先遍历一遍），且 Electron ≥32 已移除 `File.path`、须经 `webUtils.getPathForFile()` 反推路径，**不推荐**；③ **拖拽目录进窗口**——渲染层 drop 拿 `File` → preload `webUtils.getPathForFile()` 得绝对路径，**零新 IPC 通道**（webUtils 在 preload 同步可用，contextBridge 暴露即可），mock 可造 File 桩；④ **最近目录历史下拉**——settings 记最近 N 个成功目录，输入框旁下拉直达，**零新通道**（纯 settings 存储；注意 T13 教训：新 `AppSettings` 字段必须同轮进 zod schema），把「找目录」变「选上次」；⑤ **自绘树形懒加载**——Arco `a-tree` 异步加载子目录（复用现有 `FS_LIST_DIR`，零通道），解决「逐层点击累」，代价是树样式重排且仍是自绘滚动容器（v0.0.68 那类滚动坑须重新对照 §7.5.8）；⑥ **`shell.showItemInFolder`**——跳资源管理器确认位置，不解决选择、只作辅助。**组合建议**：裁定做本条 → 原生入口（①）为首；想先免掉通道成本 → ③+④（拖拽 + 最近目录）零通道增量先行即可覆盖多数「找目录」场景；⑤ 作自绘中期增强。
  - **主流实现与依赖生态调研（2026-10-10，回答「如何实现、有无成熟依赖」）**：主流做法两分——一次性选择走系统原生对话框（Electron 官方 IPC 文档标准示例即 `ipcMain.handle` + `dialog.showOpenDialog` 返回所选路径）；应用内文件浏览主流**自建**（VS Code 资源管理器基于自家 tree widget、Obsidian 的 vault 浏览同为自建，无可提取复用的现成组件）。依赖生态：npm 无「目录选择器」粒度的成熟依赖——最接近的 `vuefinder` 是 HTTP driver 架构的完整文件管理器（配 PHP/Python 后端库、面向云存储上传/预览/组织），为选目录引入属体量错位；`@wxwzl/vue-virtual-tree` 等第三方虚拟化树与 §7.5「Arco 是唯一 UI 基础、不得引入并行组件体系」冲突。**Arco `a-tree` / `a-tree-select` 官方支持 `:load-more` 异步懒加载**（`isLeaf` 标叶子）——树形懒加载所需能力已在现有依赖树内，零新包。结论加固：原生对话框或 Arco 自绘增强，**不引第三方文件浏览器依赖**。
