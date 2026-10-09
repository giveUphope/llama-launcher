# STYLE_TODO 已修复明细（归档）

> 范围：UI 风格「已修复」各项的完整记录（问题 / 修复 / 验证证据）与已固化进规范的历史设计决策；原活动清单 `docs/{zh,en}/style/STYLE_TODO.md` 已于 2026-10-10 并入本文件（见下方合并说明）后移除。
> **归档只读，不随项目演进更新**；其中描述的页面结构（如概览 Q1–Q4、服务页状态卡、Card compact 变体等）可能已被后续重构调整，仅作决策与验证依据留存。当前风格规范一律以 [frontend.md §7.5](../../docs/zh/frontend.md) 为准。
> **2026-10-10 合并**：原 `docs/{zh,en}/style/STYLE_TODO.md` 双语清单的 #50–#121 条目明细、2026-10-07 Design Review 批次与「已修复索引」表整段并入本文件末尾（纯移动 + 链接深度换算）；该清单不再存在，其英文镜像是同内容的译文，按「归档不译、单份维护」的既有规矩不再另存副本。待办（含 UI 风格类）统一登记在 [docs/TODO.md](../TODO.md)，审计复现方式改由 [docs/zh/frontend.md §7.5.9](../zh/frontend.md) 承载。
> 索引：[README.md](../../README.md) · [归档总表](INDEX.md)

***

## 已修复明细（#1–#49、#52–#53 + 历史修复）


### 53. 文字虚化 / 深浅色看不清专项修复 — ✅ 2026-09-04

- **问题（可读性专项审查）**：① **虚化**——3 个弹窗（ConfirmModal/CloseDialog/FileBrowserModal）的 `.modal-panel`（含标题/正文/按钮文字）是 `.modal-backdrop` 的 flex 子元素，而 backdrop 挂 `backdrop-filter: blur()`，panel 文字落入 blur 合成层失去亚像素抗锯齿发虚（#41 同型，当时只修了下拉）。② **低对比**——StatusBar 蓝底白字用 opacity 0.85/0.65 削弱（实测降到 3.7:1 / 2.6:1）；ServicePage/LogsPage 的 scroll-hint/show-limit 在 --fg-muted 上再叠 opacity 0.7–0.8。③ **语义色作文字**——warn/success/danger 亮色作文字落在浅色面仅 2.2/2.9/3.8:1（<AA），遍布状态徽章/消息/outline 按钮/依赖提示等。
- **修复**：① overlay+blur 移到 `.modal-backdrop::before` 独立叶子层，panel 置 `position:relative; z-index:1` 脱离 blur 层（视觉不变、文字恢复锐利）。② StatusBar 去 opacity（纯白满不透明 4.5:1，层级改由 font-weight 承担）；hint 去 opacity 直接用 --fg-muted。③ 新增随主题自适应的 `--success-text`(#0f7b3f)/`--warn-text`(#a85209)/`--danger-text`(#c0392b)（深色主题=原亮色），浅色面语义文字/描边全部切到 -text（≥4.5:1），控制台/日志（恒深底）与实底按钮背景/圆点保留亮色。规范固化 §7.5.1（-text 变体+用途划分+禁 opacity 削弱文字）/§7.5.6（弹窗 blur 挂 ::before）/§7.5.8（对比度清单项）。
- **修复效果验证**：WCAG 脚本核算全部达标（浅色 -text 5.0–5.4:1、StatusBar 白字 4.5:1、深色沿用亮色 4.4–7.7:1、控制台 4.9–8.6:1）；`getComputedStyle` 确认 -text 双主题正确解析（浅深/深亮）；双主题浏览器截图核对；`pnpm build`/`style:audit`/`lint` 全绿。

### 52. 跨页面间距一致性统一（筛选 chip / rec-chip / 空态 .empty）— ✅ 2026-09-04

- **问题（全量间距审查发现，同类元素跨页面取值漂移）**：① 固定高 24px 筛选 chip 水平内距不一致——LogsPage `.level-chip` `0 8px` 而 DownloadCard `.chip` `0 9px`（后者注释自称“与 level-chip 一致”，实为离群）；② fs-sm chip 内距——5 处 `3px 8px`，唯 ParamsPage `.rec-chip` `2px 8px`；③ 独立居中文本空态 `.empty`——PresetsPanel/LocalModelsPanel `20px`，唯 BenchPanel `16px`。
- **修复**：三处分别统一为 `0 8px` / `3px 8px` / `20px`；标准固化进 frontend.md §7.5.4「组件 padding 约定」⑥（筛选 chip `0 8px`）⑦（空态 `.empty` `20px`），并明确其余空态为不同语义变体（弹窗 `.fb-empty`、区块内 `.empty-msg`/`.target-recs-empty`、大图标 `.empty-log`）各自统一。
- **修复效果验证**：全量间距脚本复查 `padding: 0 9px`/`2px 8px` 归零、`.empty` 均 `20px`；GAP 全库 0 违规（均在 0/4/5/6/8/10/12/14）；`pnpm build`/`style:audit`/`lint` 全绿。

### 49. 概览「最近问题」空态占位行高违反语义化清单（style-audit #9 ❌）— ✅ 2026-09-04

- **问题（文档一致性审计发现）**：`DashboardPage.vue` `.empty-text` 以 `line-height: 72px` 撑满父级预留区——① `72px` 不在行高语义化清单（1/1.3/1.4/1.5/1.55/1.6，§7.5.1）内，`pnpm style:audit` 第 9 条实际为 ❌（STYLE_TODO「当前无待修复项」与规范不符）；② 全局 `box-sizing: border-box` 下父级 `.issues-console` 的 `min-height: 72px` 已含 12px 上下 padding，子元素 72px 行高实际把空态撑到 84px，与 3 行内容态（72px）高度并不恒定。
- **修复**：`.empty-text` 改 `display: flex; align-items: center; justify-content: center; min-height: 60px`（72 − 12），垂直居中占满预留区；空态/1–3 行条目高度严格恒等于 72px。
- **修复效果验证**：`pnpm style:audit` 第 9 条 ✅（退出码 0）；双主题概览空态 ↔ 注入 1/3 条 warn 日志高度零位移；`pnpm lint` + `pnpm test` 全绿。

### 48. 性能目标下拉面板 `.target-panel` 玻璃浮层回潮 + 未定义圆角 token — ✅ 2026-09-04

- **问题（文档一致性审计发现，style:audit 第 7 条清单项）**：ParamsPage 性能目标选择器面板为 2026-09 新增功能，未按 #41（2026-08-31「下拉/菜单统一实底」）实施——`--glass-bg-strong` + `backdrop-filter`，且 `border-radius: var(--radius-dropdown)` 引用了全仓**不存在**的 token（圆角仅 pill/modal/row/control 四 token），声明实际无效。半透明底 + blur 合成层会削弱面板文字可读性（#41 原始动机）。
- **修复**：`.target-panel` 背景 `--bg-card` 实底、边框 `--border`、圆角 `--radius-row`（与 DropdownParam 面板同规格），删除 `backdrop-filter`。面板保持绝对定位锚定触发按钮（区别于 DropdownParam 的 fixed/Teleport 形态，小面板无遮挡需求）。
- **修复效果验证**：`pnpm style:audit` 第 7 条清单不再出现 ParamsPage；双主题打开目标下拉核对实底可读 + 与参数行/控制台同圆角档位；`pnpm lint` 全绿。

### 47. 概览页内容占位组件补强（Q1 空值 dash / Q4 空态占位行）— ✅ 2026-09-01

- **问题（防跳动专审补充）**：#46 已固化 Q4 问题区 `min-height: 72px`，但概览页仍有两处弱占位：① Q1 host/port 值盒在 settings 加载前显示**空白**（与服务页状态卡 `—` 占位语义不一致）；② Q4 空态 `.empty-text` 采用 `padding: 12px 0` 的居中文本，空态视觉"一行文字 + 空白"，占位感弱且不贴合行高。

- **修复（内容占位组件化）**：① Q1 两个值盒空值统一 `—` 占位（`server.host || '—'`，与服务页 InfoStrip boxed 一致）；② Q4 空态改为行高对齐的占位行：`line-height: 72px; padding: 0`——空态文本垂直居中占满整个 72px 预留区，空态 ↔ 1–3 行内容高度严格零变化。

- **评估豁免项（概览页其余区复核）**：Q1/Q2 StatusTag 二选一、Q2 值盒 `msg_no_model_selected`、Q3 api-url `status_stopped` 均已是替换式占位；Q3 复制按钮文案切换（同宽级，flex 豁免）；Q4 操作行槽位（#44 已做）。

- **修复效果验证**：`pnpm --filter @llama-launcher/ui lint`（vue-tsc）与 build 通过；Q1 空白加载期显示 `—`，Q4 空态为等 72px 占位行，问题出现/消失时 Q1/Q4 及下方内容零位移。

### 46. 概览页（Dashboard）跳动审计：Q4 问题区高度随行数变化 — ✅ 2026-09-01

- **问题（防跳动专审）**：对概览页 4 区逐项审计——Q1 状态徽章/主机端口、Q2 模型、Q3 API 地址均已是**替换式文案或常驻值盒**（§7.5.4），无插入/删除行；唯一候选为 **Q4 最近问题区** **`.issues-console`** **高度随内容行数变化**：空态 1 行（\~28px）↔ 最多 3 行（\~78px，`recentIssues.slice(-3)`），50px 高度差导致 Q4 区块及下方操作行随问题出现/消失上下移动。

- **修复（预留位置模式）**：`.issues-console` 增加 `min-height: 72px`（= padding 6×2 + 3 × fs-base 行高 1.5），空态/1–3 行高度恒定；超过 3 行不可能（上限切片），`max-height: 160px` 保留兜底滚动。

- **评估豁免项**：① Q1/Q2 状态徽章二选一（同位置替换，非插入）；② 复制/打开 Web UI 按钮文案切换（同宽级变化，flex 内无位移）——均记录为可接受。

- **修复效果验证**：`pnpm lint` 4 包全绿（vue-tsc）、`pnpm style:audit` 10 项全绿（`min-height` 为布局预留，与 #42/#44 的 slot 一致，不属间距刻度检查）、`pnpm build` 成功；问题出现/消失时 Q4 高度恒定。

### 45. 核心特点组合推广：增强状态机下沉至 server store（Dashboard Q1 / StatusBar 同步失败/崩溃态）— ✅ 2026-09-01

- **问题**：服务页状态卡确立的「6 态增强状态机」（`effectiveStatus`：running+失败→crashed、starting+失败→failed、stopped+残留失败→failed，FAIL\_RE 尾窗检测）只存在于 ServicePage，Dashboard Q1 与底部 StatusBar 仍只看原始 4 态——启动失败/运行崩溃在主页与状态栏不可见、无错误色。其余核心特点（值盒统一 §7.5.4、防跳动 #42/#44、数据源分层、响应式、规范性）已全局贯彻（`style:audit` 10/10 全绿）。

- **修复（单一事实源下沉）**：`stores/server.ts` 新增 `outputTail`（最近 80 行）与 `effectiveStatus`（增强判定，导出 `EffectiveStatus` 类型），三处消费方统一改用：ServicePage（保留 UI 临时态 stopping 覆盖，删除本地 FAIL\_RE/recentTail/effectiveStatus 与死常量 `READY_RE`）、Dashboard Q1（新增 failed/crashed → error 徽章）、StatusBar（failed/crashed → `svc_status_failed/crashed` 文案 + `--danger` 色）。判定逻辑零拷贝。

- **运行时长不推广（记录为可接受）**：Dashboard Q1 语义为「是否运行 + 监听地址」（Q3 承载完整 API 地址），运行时长属服务详情场景，由服务页状态卡承载，不在仪表盘重复布局。

- **修复效果验证**：`pnpm lint` 4 包全绿（vue-tsc）、`pnpm build` 成功、`pnpm test` core 300 + ui 48 全过（验收时点）；demo-mock 注入失败输出时，Dashboard Q1 徽章与状态栏同步显示失败态（error/danger 色）。

### 44. 防跳动机制推广：其他页面的可重复插入行（Dashboard Q4 操作行 / 预设 / 性能测试提示条）— ✅ 2026-09-01

- **问题（#42 模式推广）**：#42 只覆盖了服务页与日志页 3 处。全 UI 扫描其余页面/组件的 `v-if` 后，确认另 3 处**可重复出现/消失的插入行**会把下方内容瞬间下推：① 仪表盘 Q4「是否有问题」的错误操作行（`.issues-actions`，出错出现/消除后消失）；② 预设列表 Card 的 `applied-msg`（应用/覆盖/删除后 2s 提示，位于按钮行与表格之间）；③ 性能测试历史 Card 的 `applied-msg`（运行后提示，位于标题与历史表之间）。

- **修复（统一预留位置模式，与 #42 相同）**：三处改为**外层常驻槽位** + 内容 `v-if` 保留——槽位 `min-height` 与内容渲染高度恒等（按钮行 = `--btn-h`；提示行 = `padding 6×2 + fs-base 13 × 1.5 ≈ 32px`），`margin` 归一到槽位上，`:not(.has-*)` 时 `visibility: hidden` 隐藏但占满高度。出现/消失时下方表格/内容零位移。

- **评估豁免项（记录为可接受，与 #42 判定准则一致）**：① 子面板 tab 切换（Models/Settings/Params 的 `activeTab` 替代）与仪表盘 Q2 状态标签二选一 = 导航/内容替换；② 空态（日志/表格空行、`empty-text`）与控制台 `new-logs` 槽位 = 已处理或内容态替换；③ 状态栏 PID/URL/模型项随运行出现 = 信息带内容流动（底栏 28px 恒定，无固定元素被推）；④ 下载统计 `errorCount` 插入 / DownloadCard 渐进披露区 / 模型详情卡片组 / 折叠详情 = 数据流或用户主动展开，非被动挤压；⑤ Modal/工具提示/帮助浮层 = fixed/absolute 不参与布局。

- **修复效果验证**：`pnpm lint` 4 包全绿（vue-tsc）、`pnpm build` 生产构建成功；安装/重新运行出现提示时下方表格不再位移（槽位高度恒定）。

### 43. 应用图标蓝化遗漏：窗口/任务栏图标仍为彩虹渐变 — ✅ 2026-09-01

- **问题**：2026-08-26「移除彩虹、统一蓝色系」（#8）只蓝化了 UI 侧（`app-icon.svg`/favicon/`--accent` 等），`scripts/icon-gen/gen-icon.cjs` 仍以四色 `RAINBOW` 渐变渲染窗口/任务栏/托盘/打包 exe 图标（`apps/desktop/resources/*`），与 UI 品牌图标不一致（目视确认为彩虹多色）。

- **修复**：`gen-icon.cjs` 渐变数据替换为与 `packages/ui/src/assets/app-icon.svg` 的 `#appTile` 完全同色的品牌蓝（`#60a5fa`→`#2563eb`→`#1d4ed8`，x 方向），同步更新注释与命名（`RAINBOW`/`rainbowAt` → `BLUE`/`blueAt`）；重跑 `pnpm --filter @llama-launcher/desktop gen:icon` 重新生成 7 尺寸 PNG + `icon.ico` + `icon.png`。

- **修复效果验证**：目视 `apps/desktop/resources/icon-256.png` 为纯蓝渐变（左浅蓝→右深蓝，无彩虹/紫/粉等杂色相）；与 `app-icon.svg` 蓝系一致；下次打包注入 `icon.ico` 即生效（`inject-icon.cjs`）。

### 42. 隐藏组件导致的页面布局跳动（预留位置方案）— ✅ 2026-08-31

- **问题（用户审查要求）**：各页面用 `v-if` 条件渲染隐藏组件，出现/消失时造成内容垂直/水平跳动。审查全部 7 页 + 组件后确认 3 处真实跳动（均属「可重复出现/消失」的场景，非启动一次性出现）：
  ① **服务页状态卡「失败/异常退出」提示条**（`.failure-banner`）——`v-if` 出现时把下方命令预览/参数摘要/清理三张卡片整体下推、消失时上移；
  ② **服务页控制台头部「有新日志」胶囊**（`.new-logs`）——`.console-header` 用 `justify-content: space-between`，无新日志时 `scroll-hint` 是唯一子项居左，胶囊出现后变两子项、`scroll-hint` 跳到右缘；
  ③ **日志页「有新日志」胶囊**（`.new-logs-bar`）——flex 列中位于 `flex:1` 控制台之上，出现时把控制台上下挤压。

- **判定为可接受（未改）**：顶栏模型下拉（`hasModels` 首次扫描后一次性出现并保持）、下载面板失败统计（错误出现后保持至清除）属**启动/事件一次性出现**，预留永久空位反而损害无模型/无错误空态；仪表盘 Q2 行内切换、`detail-row`/`InfoStrip` 常驻标签+`—` 占位本已无跳动。

- **修复（统一预留位置模式）**：三处改为外层**常驻槽位** + `min-height` 预留与内容等高的固定高度，槽位 `:not(.has-x)` 时 `visibility: hidden` 隐藏但占满高度；内容仍用 `v-if` 条件渲染。出现/消失时槽位高度恒等，下方卡片列 / 控制台高度 / 右侧提示位置完全稳定，零跳动。

- **修复效果验证**：`pnpm lint` 4 包全绿（vue-tsc 通过）、`style-audit` 10/10（新增槽位未引入裸值，`min-height` 为纯布局预留非常规间距档，未落入第 4 条间距刻度）、`pnpm test` core+ui 全过、UI 生产构建成功（ServicePage/LogsPage CSS 正常产出）。

### 41. 浮层菜单表面统一实底（可读性）— ✅ 2026-08-31

- **问题（用户反馈）**：顶栏模型下拉「文本被遮罩影响显示效果，文字查看效果不佳」。根因两条：① 半透明玻璃底（`--glass-bg-strong` 8\~6% 透出）让面板下方的页面/控制台内容透印，削弱文字对比度；② `backdrop-filter` 使面板进入独立合成层，层内文字失去亚像素抗锯齿、观感发虚。功能菜单可读性优先于玻璃观感。

- **修复（全量迁移）**：四处浮层菜单统一改实底配方 `--bg-card` + `--border` + `--shadow-dropdown`、移除 backdrop-filter——① 顶栏 `.model-dropdown`；② `DropdownParam` 参数下拉菜单；③ `GeneralPanel` 引擎目录帮助浮层；④ `DownloadCard` URL 历史面板。同时修选中行：`--bg-active` 暗蓝底叠 accent 蓝字（深色主题对比度不足，#13 同型「文字被吞」）→ `color-mix(--accent 14%)` 淡底 + accent 文字（顶栏与参数下拉两处）。规范同步更新 §7.5.6（下拉/菜单禁 backdrop-filter 与半透明底，backdrop-filter 白名单收敛为玻璃层/弹窗背板/工具提示）。

- **修复效果验证**：深浅主题下把菜单悬停在控制台/参数密集区上方对比——文字边缘锐利、无底层内容透印；`pnpm style:audit` 第 7 条 backdrop-filter 使用点清单不再包含上述四处；`pnpm lint`/`pnpm test` 全绿。

### 40. 页面切换闪出其他页面内容（PageHost 过渡交接窗口根治）— ✅ 2026-08-29

- **问题（用户审查要求）**：侧边栏点击切换页面时，右侧内容区短暂闪出其他页面的内容。

- **根因定位（逐帧采样 + DOM 归因）**：`PageHost` 的 `<transition mode="out-in" :css="false">` + JS 钩子 + KeepAlive 组合存在交接窗口——leave 的异步 `done()`（`setTimeout(0)`）与 KeepAlive 失活移除的时序交错下，快速导航时 DOM 中短暂出现**新旧两个页面根同时存在**（150ms 连点压测实测 30+ 个双帧窗口，每个 \~150ms），用户可见为旧页内容"闪一下"。boot 恢复竞态（#39 前的启动重定向）会放大该现象。

- **修复（结构化根治）**：`PageHost` 移除 `<transition>` 交接机制——`keep-alive` 直接替换激活组件（单激活实例，**结构上不存在双页同框**）；切换反馈改为路由 watch 后对内容区整体 WAAPI 淡入 90ms（0.55→1，`reduced-motion` 跳过）。同时清理 LocalModelsPanel 遗留死样式。

- **修复效果验证**（生产构建 + rAF 逐帧采样 + 合成指针点击）：① 人类速度（400–700ms）四连切及往返：每次切换 6–15ms 内视图签名即正确、零异常帧；② 150ms 极限连点 ×8：切换序列全部正确、无异页内容（修复前同场景出现 30+ 双帧窗口）；③ 切换瞬间截图目视确认画面即目标页。**检测方法备注**：`.page-frame` 计数不能作为双页指标——PageFrame 组件存在嵌套使用（如 models 页 tab-content 内层），计数含合法嵌套。

- **关联**：boot `last_tab` 恢复重定向竞态已由会话优先启动链（main.ts 挂载前恢复）根治。

### 39. 概览「最近问题」日志链路修正（应用日志问题级）+ 状态指示器移除 — ✅ 2026-08-29

- **问题（用户审查要求）**：① 概览「最近问题」直接展示后端 stdout 最后 3 行——标题语义是"问题"，内容却多为推理/加载信息行（llama\_model\_loader 等），信息与问题混杂；② 区域头部的「运行中」状态指示器与 Q1 运行状态重复。

- **分析决策**：数据源改用**应用日志（appLog）的问题级条目**——应用日志是结构化分级记录（INFO/SUCCESS/WARN/ERROR，服务启动失败、下载错误等真实问题），WARN/ERROR 语义与「最近问题」精确匹配；后端 stdout 为无分级原始推理输出，按"问题"语义过滤只能靠正则启发式（不可靠且必然混入信息行）。后端完整输出保留在「服务」页控制台，概览只做问题摘要。

- **修复**：① 数据源 `server.outputs.slice(-3)` → `appLog.entries` 中 **kind 为 warn/error 的最近 3 条**（ts 时间序）；② 移除头部 3 个状态指示器（StatusTag，与 Q1 重复）；③ 正则启发式分类（ERROR\_RE/WARN\_RE/SUCCESS\_RE）删除（改用应用日志原生 kind）；空态文案改 `msg_no_issues`（暂无问题），孤儿键 `msg_no_recent_logs` 清理；④ appLog 订阅与滚动源同步。

- **修复效果验证**（生产构建 DOM 实测，demo 5 条应用日志 info/success/info/warn/info）：问题区仅渲染 1 条 warn（`Download paused: d1`），info/success 全部过滤；状态指示器 0 残留；空态显示「暂无问题」。`pnpm lint` 4 包全绿、测试 281+40 全过、style-audit 9 项 ✅、UI build 通过。

- **关联**：后端输出的完整视图在「服务」页控制台；应用日志完整视图在「日志」页——概览只做问题摘要，三处职责不再混杂。

### 38. 性能测试调优区组件样式按参数设置页统一 — ✅ 2026-08-29

- **问题（用户 DOM 审查发现）**：性能测试「性能参数调整」卡为每个参数控件套 `.tune-row` 外框（边框 + padding 4×8 + accent 悬停边），且固定两列网格（`repeat(2, minmax(0,1fr))`、gap 8×16）、非 compact 卡头——与参数设置页的呈现（`param-grid` auto-fit minmax(340px,1fr)、gap 4×14、compact 分组卡、控件直接铺网格无外框）不一致。

- **修复**：① 移除 `.tune-row` 外框（控件直接铺网格，与参数页同构）；② `.tune-grid` 改参数页 `.param-grid` 同配方（auto-fit minmax 340、gap 4×14、≤720px 单列）；③ 调优卡改 `compact`（卡头 30px，与参数分组卡一致）。

- **修复效果验证**（生产构建 DOM 实测）：`tune-row` 0 残留；网格 auto-fit（列宽随内容自适应，gap 4/14）、compact 卡头 30px；控件行与参数页同构（label-col 等列 110 右对齐 + 控件列）。`pnpm lint` 4 包全绿、UI build 通过。

- **后续（2026-08-31）**：参数行级效果（值 ≠ 默认橙 `--warn` 描边、行 hover、还原按钮、GGUF/依赖提示）统一由 `ParamRow` 承载后，「控件直接铺网格」方案已失效——调优区改为逐行复用 `ParamRow` 组件（`tune-grid` 网格配方不变），与参数页从"样式复制"升级为"组件同源"，参数页行效果后续变更自动跟随。

### 37. 内容值盒统一（宽度/高度/样式）— ✅ 2026-08-29

- **问题（用户审查要求）**：服务状态卡内同卡三种值展示形态——当前模型胶囊（padding 2×10、高 \~28）、API 地址条（高 32、padding 0×14）、主机/端口/PID 纯文本（无盒）——宽高样式互不一致。

- **修复**：`InfoStrip` 新增 **`box`** **值盒变体**（高 26px、padding 0 10、bg-input + 1px 边框、胶囊圆角、内容省略），服务状态卡五个内容项（当前模型/API 地址/主机/端口/PID/运行时长）全部改用 boxed InfoStrip——标签等列 110 右对齐、值盒行内 flex 填满（左缘/宽度对齐）；移除旧 `.runtime-model`/`.api-url` 专属样式；复制按钮 `min-width: 112`（跨行等宽）。

- **修复效果验证**（生产构建 DOM 实测）：5 个 `.info-value.boxed` 高度统一 26px、圆角统一 999px、背景统一 bg-input、边框统一 1px solid；当前模型/API 地址行左缘 352 等列，运行时详情网格 3 列各自列内对齐；复制按钮 114/112（min-width 生效）。

- **规范**：§7.5.4 新增「值盒标准」条目；仪表盘 `.val-box` 同规格（高 26 胶囊盒）。

### 36. 模型信息卡双重展开/收起按钮整合为单一开关 — ✅ 2026-08-29

- **问题（用户 DOM 审查发现）**：模型内置信息卡有两个同类展开/收起控件——头部 chevron（`meta-toggle`，收起到只显示模型名）与正文「展开详细信息 (N)」（`details-toggle`，展开详情 chips）——嵌套两层展开控件，用途重复。

- **修复**：移除头部收起层（`collapsed` 状态 + `meta-toggle` 按钮及样式）——卡片本身紧凑、收起到只剩模型名节省空间有限；**`details-toggle`** **成为唯一展开/收起开关**，文案随状态切换（展开详细信息 ↔ 收起详细信息，新增 i18n 键 `gguf_details_collapse`）。

- **修复效果验证**（生产构建 DOM 实测）：`meta-toggle` 0 残留；摘要 chips 恒显（4 项）；单开关往返——展开后详情 chip 1 项 + 文案「收起详细信息 (1)」，收起后文案回「展开详细信息 (1)」；`pnpm lint` 4 包全绿、UI build 通过。

- **备注**：验证中一次白屏为 preview 服务进程掉线（非代码问题），重启后复验通过。

### 35. 日志页操作按钮并入筛选行（同一行）— ✅ 2026-08-29

- **问题（用户审查要求）**：上一条（#34）移除提示条后，复制输出/清空控制台按钮独占一行、级别筛选+搜索另一行——两行内容都偏空。

- **修复**：删除独立 `.toolbar` 行，两个操作按钮并入 `.filter-row` 尾部（`.toolbar-right` 加 `margin-left: auto` 右对齐）——单行布局 = 级别筛选 chips + 搜索框 + 操作按钮。

- **修复效果验证**（生产构建 DOM 实测）：`.filter-row` 单行（行高 30px）容纳 level-chips（234–585）/ search-box（595–975）/ 操作按钮（1034–1256 右对齐）；独立 toolbar 块 0 残留。`pnpm lint` 4 包全绿、UI build 通过。

### 34. 日志页提示条移除（按钮独立成行、行数去重）— ✅ 2026-08-29

- **问题（用户审查要求）**：日志页顶部提示条（容器底+边框）含三类冗余——① 页名「应用日志」与侧栏导航重复；② 行数「5 / 5 行」与控制台下方状态条（自动滚动 + 行数）重复；③ 提示条容器形态本身多余。

- **修复**：移除提示条容器（bg/边框/圆角全去，改透明右对齐行）与页名、顶部行数（`.page-title`/`.log-count` 及 `totalLines` 计算属性、死键 `page_app_logs` 一并清理）；**复制输出/清空控制台保留为独立按钮**（右对齐）。底部状态条（自动滚动 + 行数）为行数唯一来源。

- **修复效果验证**（DOM 实测）：`.toolbar` 透明无边框、`justify-content: flex-end`；按钮 = 复制输出/清空控制台；页名与顶部行数 0 残留；底部状态条完整。`pnpm lint` 4 包全绿、测试 281+40 全过、UI build 通过。

### 33. 模型页统计条精简（移除已选/刷新）+ 检测懒加载 — ✅ 2026-08-29

- **问题（用户审查要求）**：① 统计条「已选」统计冗余（选中态已由当前模型胶囊表达）；② 刷新按钮多余——应用已有文件系统监听自动维护模型列表；③ 检测机制重复占用资源——每次进入模型页都会全量重扫模型目录 + 重新读取 GGUF 元数据（`reattachModelRuntime` 无守卫）。

- **修复**：

  1. 统计条移除「已选」stat 与「刷新」按钮（含 `.stats-right` 样式；Ctrl+R 快捷键与文件监听保留为手动兜底）；死键 `btn_refresh` 清理（`lbl_selected` 仍被 DownloadCard 使用保留）；
  2. **懒加载**：挂载扫描仅在列表为空时执行（`models_dir` 变化由既有 watch 重扫、运行期由文件监听维护）；store `loadGguf` 增加缓存守卫——同一模型已加载时跳过重复读取（`reattachModelRuntime` 因此近似零开销；换模型自然重读）。

- **修复效果验证**（生产构建 DOM 实测）：统计条仅剩 `模型总数 / 总大小`，无刷新按钮与 stats-right；往返导航后 GGUF 元数据保留、元数据卡正常渲染（守卫跳过重复读取）。`pnpm lint` 4 包全绿、测试 281+40 全过、UI build 通过。

### 32. 按钮点击时文字挤压拉伸（按压缩放全面移除）— ✅ 2026-08-29

- **问题（用户审查要求）**：点击按钮时按钮内文字出现挤压/拉伸变形——全库 **20 处按钮** **`:active { transform: scale(0.9~0.98) }`** **按压缩放**（action-btn/mini-btn/tab-btn/nav-btn/model-btn/dropdown 项/各控件按钮/还原按钮等），整体缩放把文字一起压扁，配合过冲缓动回弹观感为"闪一下的变形"。

- **修复**：

  1. codemod 移除全部文本按钮 `:active` 单属性缩放块（含 `:not(:disabled)` 变体与单行形式）——buttons.scss（action-btn/mini-btn/tab-btn 三主力）+ 12 个组件文件；
  2. 按压反馈 = 背景/边框色变化（model-btn 的 `:active` 改为 `background: var(--bg-hover)`，其余由既有 hover 色覆盖承担）；
  3. **保留清单**（无文字或浮层语义，缩放无文本变形问题）：浮层 enter/leave 弹簧缩放（CloseDialog/ConfirmModal/FileBrowserModal 面板、ToolTip）、CheckboxParam 开关轨道按压、win-btn 窗口控制；
  4. §7.5.7 果冻动效同步：果冻回弹仅存于浮层进入与开关，按钮按压反馈 = 色彩变化。

- **修复效果验证**：`scale(0.9x)` 全库仅剩 6 处（全部为上述保留项）；`pnpm lint` 4 包全绿、UI build 通过。按压反馈改为色彩变化后按钮内文字不再变形。

- **备注**：transition 声明中的 transform 项保留（无害）；win-btn/开关若需按压缩放反馈可后续单独评估。

### 31. 参数还原按钮样式优化（软色调幽灵按钮 + 行悬停渐显）— ✅ 2026-08-29

- **问题（用户审查要求）**：参数行还原按钮（✕ 恢复默认值）为 18px 圆 + 10px 图标，悬停变**实心 warn 黄色圆**——密集参数页中逐行黄点视觉突兀，与全库幽灵图标按钮语言不符。

- **修复**（ParamRow `.clear-btn`）：20×20 胶囊（`--radius-pill`）+ 图标 10→12；默认 `opacity: 0.55` 弱化、**行悬停渐显至 1**（密集页降噪）；悬停改软 warn 色调（`color-mix` warn 14% 底 + warn 文字，替代实心黄底深字）；`:focus-visible` 保可见；`:active scale(0.9)` 保留。

- **豁免说明**：该按钮属「输入行内清除/还原 affordance」（#27 豁免清单），保持图标形态，不加文字。

- **修复效果验证**（DOM 实测 + 合成指针悬停）：基态 20×20/999px/opacity 0.55/透明底；悬停态 warn 14% 色调底 + warn 文字 + opacity 1；`pnpm lint` 4 包全绿、style-audit 9 项 ✅、UI build 通过。

### 30. 选项行标签改为等列布局（对齐参数设置页布局逻辑）— ✅ 2026-08-29

- **问题（用户审查要求，方向调整）**：#25 将 `InfoStrip .info-label`/`.tune-label` 改为"贴文字自适应"后，同组各行标签宽度不一 → **内容（输入框/值）起点参差不齐**，视觉上不成为等列。用户要求所有界面选项参考参数设置页参数行的布局逻辑：文本与输入框视觉等列。

- **修复（对齐参数行** **`label-col`** **配方）**：`InfoStrip .info-label` 与 BenchPanel `.tune-label` 改 `flex: 0 1 110px`（min-width 64px）+ `text-align: right`——标签占等宽列、右对齐，内容起点跨行对齐；容器过窄省略号截断。长标签面板级覆盖：AdvancedPanel `:deep(.info-label) { flex-basis: 140px }`（'HuggingFace 镜像源' 完整展示）。

- **注意**：scoped 样式无法命中子组件内部元素，覆盖 InfoStrip 内部标签须用 `:deep()`（此前 `.info-label` 覆盖未生效即此原因）。

- **修复效果验证**（生产构建 DOM 实测）：设置常规 模型目录/引擎目录/关闭窗口时 标签盒均 110px、text-align right、值起点统一 x=352；仪表盘 主机/端口/当前模型 值起点对齐（各网格列内）；高级面板 标签 140px、无截断；bench 调优行 110px 右对齐、输入框起点 352 与 InfoStrip 完全一致。`pnpm lint` 4 包全绿、style-audit 9 项 ✅。

- **关联**：本条调整 #25 的"贴文字"方向（用户决策：等列对齐优先于紧凑）；label→content 间距仍为 gap 8px。

### 29. 应用 Logo 呈现统一（AppLogo 组件 + favicon 同源）— ✅ 2026-08-29

- **问题（用户审查要求）**：应用 Logo 仅 TopBar 一处以散写 `<img>` + scoped 样式出现；关于页无品牌标识；index.html 无 favicon（浏览器标签为默认图标）。无统一样式来源，新增位置易漂移。

- **修复**：

  1. 新增 `components/common/AppLogo.vue`：唯一呈现组件（`size` prop、统一 svg 资源、胶囊圆角 `--radius-pill`、禁拖拽/选中）；
  2. TopBar 散写 `<img class="app-icon">` + scoped 样式替换为 `<AppLogo :size="20" />`（视觉不变）；
  3. 设置-关于新增品牌头：`AppLogo 40px` + 应用名（700 字重）+ 版本号（mono 次级色），底边实线分隔；
  4. index.html 补 `<link rel="icon" type="image/svg+xml" href="/src/assets/app-icon.svg">`（浏览器标签图标与资源同源）。

- **修复效果验证**（DOM 实测）：关于页品牌头 Logo 40px / 圆角 999px / 名称 "llama Launcher" / 版本 v0.0.9；TopBar Logo 20px / 圆角 999px——两处同源同圆角；favicon link `image/svg+xml` 指向 app-icon.svg；`pnpm lint` 4 包全绿、UI build 通过。

- **关联**：任务栏/EXE 图标由打包链（inject-icon.cjs）注入同一资源，不在前端范围。

### 28. 参数摘要模型路径显示为文件名（应为绝对路径）— ✅ 2026-08-29

- **问题（用户 DOM 审查发现）**：参数摘要「模型路径」chip 显示 `Qwen3-...gguf`（纯文件名）——`ParamSummaryCard` 在 `formatValue` 与模型行两处故意 `split(/[\\/]/).pop()` 截短路径。摘要用途是"启动前核对配置"，截短后无法核对实际加载的文件位置；store 值本身是绝对路径（纯显示层问题）。

- **修复**：移除两处 basename 截短——`formatParamValue` 对路径类参数（model/mmproj/spec\_draft\_model）与模型行均显示完整绝对路径。

- **修复效果验证**（DOM 实测）：摘要 chip = `模型路径 = D:/Models/Qwen3-32B-A3B-Instruct/Qwen3-32B-A3B-Instruct-Q4_K_M.gguf`（`isAbsolute: true`，与 store 值一致）；同组别名 chip `-a` 显示无后缀别名。

### 27. 按钮全面文本内联 + 服务状态卡单行单内容 — ✅ 2026-08-29

- **问题（用户审查要求）**：① 内容区仍存 7 处图标-only 操作按钮（服务控制台 复制/清空、日志工具栏 复制/清空、模型 刷新、下载 清除已完成——功能仅 tooltip 可知，违反「按钮文本内联」统一）；② 服务状态卡 `status-row` 单行混杂三类内容（运行状态标签 + 当前模型组 + 运行时长胶囊）。

- **修复**：

  1. 7 处图标-only 按钮全部转 `action-btn` 文本内联（icon 12 + 文案）：服务控制台 复制输出/清空控制台、日志 复制输出/清空控制台、模型 刷新、下载 清除已完成；
  2. 服务状态卡拆分为单行单内容四行：① 运行状态（StatusTag）② 当前模型（标签+胶囊+复制按钮）③ API 地址（标签+URL+复制按钮）④ 运行时详情网格——**运行时长**从状态行胶囊迁入详情网格（`lbl_run_duration` i18n 键恢复使用，此前清理时因无引用删除）；
  3. `ctrl-btn` 全局类移除（组件层零使用）：buttons.scss 定义删除、审计脚本检查 5 正则与注释同步、§7.5.8 清单更新。**豁免清单**（非操作按钮，保留图标形态）：win-btn 窗口控制、输入框清除 ✕、文件浏览 ↑ 导航、ModelMetaCard 折叠 chevron——控件/导航/披露语义。

- **修复效果验证**（DOM 实测）：服务页四行 contents 分别为 `[status-tag]` / `[detail-label, runtime-model, action-btn]` / `[detail-label, api-url, action-btn]` / `[info-strip ×3+]`——单行单内容；页面内全部按钮含文字（allBtnsHaveText true）；日志 复制输出/清空控制台、模型 刷新、下载 清除已完成 均 `action-btn` 带文字；`ctrl-btn` 代码引用仅剩 buttons.scss 移除说明注释。`pnpm lint` 4 包全绿、style-audit 9 项 ✅、UI build 通过。

### 26. 内容项文本描述缺失 + 复制按钮三种形态并存 — ✅ 2026-08-29

- **问题（用户 DOM 审查发现）**：服务页运行状态卡中「当前模型」胶囊与「API 地址」条**没有文字标签**（对比运行时详情的主机/端口/PID 均有 InfoStrip 标签）；复制按钮三种形态并存——① 胶囊内纯图标 `mini-copy`（复制模型名仅 tooltip 可知）② `action-btn` 图标+文案（复制地址/复制命令）③ 状态栏可点击文本。

- **修复**：

  1. 服务页运行状态卡内容项补文字标签（`当前模型` `lbl_dash_model` / `API 地址` `card_dash_api`，样式 `.detail-label` = `.info-label` 语义：次级色、贴内容 8px）；
  2. 复制按钮统一为 **`action-btn`** **+** **`Icon copy :size=12`** **+ 文案**：胶囊内 `mini-copy` 移除 → 独立「复制模型名」按钮（结构对齐仪表盘 Q2「标签+胶囊+按钮」）；复制地址/复制命令不变，图标尺寸统一 12（仪表盘 13→12）；
  3. 状态栏保留"值即按钮"特例（点击复制 + tooltip + 已复制 tip，无按钮形态），已在 §7.5.7 注明。

- **修复效果验证**（DOM 实测）：服务页 labels = `['当前模型','API 地址']`；复制按钮 = 复制模型名/复制地址/复制命令 全部 `action-btn` + icon 12 + 文案；`mini-copy` 全库 0 残留；`pnpm lint` 4 包全绿、UI build 通过。

### 25. 文本标签与内容间距过大（InfoStrip 固定标签列宽）— ✅ 2026-08-29

- **问题（用户 DOM 审查发现）**：仪表盘"端口"标签文字距值内容约 **96px**——`InfoStrip .info-label` 固定 `flex-basis: 110px`（labelWidth prop，调用方各自手调 44/110/160px）+ 行 gap 12px：短标签（2 字 ≈26px）在 110px 列内留下大片空白。同类：BenchPanel `.tune-label` 固定 `width: 110px`（"测试提示词" 后空白 40px+）。

- **修复（"文本描述优先"：标签贴文字自适应，内容紧跟其后）**：

  1. `InfoStrip`：删除 `labelWidth` prop 与内联 flexBasis；`.info-label` 改 `flex: 0 1 auto` + `min-width: 0`（盒宽 = 文字宽，容器过窄省略号截断）；行 `gap: 12px → 8px`（对齐 §7.5.4 标准行距）；
  2. 清理全部 `label-width` 调用方（ServicePage ×3 的 44px、AdvancedPanel ×2 的 160px）——自适应后长标签（'HuggingFace 镜像源'）完整展示，无需手动加宽；
  3. `.tune-label` `width: 110px` → `flex: 0 1 auto` + `min-width: 0`。
     不改动参数控件 `.label-col`（右对齐 + padding-right 8px，标签与内容实际间距已是 8px，不属于本问题模式）。

- **修复效果验证**（DOM Range 文字级测量）：仪表盘 主机/端口 标签盒 110→26px、文字→值 **8px**；当前模型 52px/8px；设置页 目录路径/引擎目录/关闭窗口时 52\~65px/**8px**；bench 调优行 70/86px/**8px**。§7.5.4 统一控件宽度行同步（并修正 label-col 文档漂移 140px→实际 110px）。

- **关联**：长标签对齐场景如需列对齐，由使用方以 grid 布局实现，不恢复固定列宽 prop。

### 24. 设置页 tab 条与状态摘要 0 间距贴死 + 顶栏条间距全库统一 8px — ✅ 2026-08-29

- **问题（用户 DOM 审查发现）**：设置页 `.tab-strip` 与 `.status-summary` 两个容器**0 间距贴死**（status-summary 无 margin-top），而模型页 tab-strip→内容为 8px、§7.5.4/#20 亦规定"与 tab 条间保留 8px"；连带 `status-summary→tab-content` 12px 由 margin 4+8 叠加凑出；日志页 `.toolbar` margin-bottom 10px 为孤值。根因：顶栏条与相邻区块的间距此前**无规范条目覆盖**（#20 只规定了 tab-strip→tab-content 一处），各页面各自实现（0 / 4 / 8 / 10 混杂）。

- **修复（确立"顶栏条与相邻区块间距一律 8px"标准，规范固化至 §7.5.4）**：`.status-summary { margin: 8px 0 0 }`（下方间距由 `.tab-content` margin-top 8 单一来源提供，消除叠加）；`.toolbar { margin-bottom: 10px → 8px }`；models/params/downloads 已是 8px 不动。

- **修复效果验证**（生产构建 vite preview + 点击导航实测）：设置页 `tab-strip→status-summary→tab-content` gaps **8/8**；日志页 `toolbar→filter-row→console-wrap` gaps **8/8**；参数页 `params-status-bar→params-content` gap 8。

- **关联**：顶栏条容器（tab-strip/status-summary/toolbar 等）为四边边框容器，其底边不属分隔线语义（见 #22），本条规范的是容器间距。

### 23. hover/聚焦过渡颜色过冲闪烁（全组件）— ✅ 2026-08-29

- **问题**：鼠标悬停侧边栏任意项（及其他全部 hover 组件）时出现"亮一下再弹回"的闪烁焦点效果。

- **根因（rAF 逐帧采样实证）**：颜色类过渡（background/color/border-color 等）使用了为 **transform 弹性设计**的过冲缓动 `--ease-jelly`（`cubic-bezier(0.34, 1.56, 0.64, 1)`，y 峰值 ≈1.1）。颜色插值被过冲推超目标值再弹回——实测侧边栏 hover 背景：`rgb(40,45,54) → rgb(42,46,56)（峰值超目标 rgb(38,42,51) +4）→ rgb(38,42,51)`，文字颜色同步过冲（245→251→245）。深色表面上全宽 38px 条形亮斑闪一次，非常显眼；全库 47 个 transition 声明块、92 个颜色属性受影响。违反规范本意（§7.5.7 果冻动效只限 transform）。

- **修复**：

  1. 新增无过冲缓动 token：`$ease-smooth`/`--ease-smooth` = `cubic-bezier(0.33, 1, 0.68, 1)`（easeOutCubic）；
  2. codemod 按属性粒度重写全部 transition 声明：**颜色/阴影/值类属性（background/color/border-color/box-shadow/opacity/width）→** **`--ease-smooth`（92 处）**；**transform 保留** **`--ease-jelly`（35 处）**；keyframes 动画（3 处）不动；
  3. 规范同步：§7.5.1 动效 token 增补 `--ease-smooth` 及分工；§7.5.7 果冻动效改为"transform 过渡用 jelly、颜色/阴影类过渡一律 smooth"，侧边栏折叠/进度条 width 例外同步改 smooth（width 过冲同类闪烁）。

- **保留**：transform 过渡的果冻回弹（按压/浮层进入）不变——过冲是弹性动效的设计意图，几何过冲无颜色 clamp 问题。

- **修复效果验证**：

  1. 逐属性解析复核：transition 中非 transform 属性使用 jelly = **0 处**；transform 使用 jelly = 35 处；`--ease-smooth` 引用 93 处；
  2. IAB 页内合成悬停 + rAF 逐帧采样复测：背景轨迹自透明**单调**爬升至目标 `rgb(38,42,51)`，`overshootBeyondTarget: null`（修复前峰值超目标 +4）；
  3. `node scripts/style-audit.cjs` 9 项 ✅、`pnpm lint` 4 包 + IPC + 文档链接全绿、UI build 通过。

### 22. 分隔线间距统一 + 全库未引用内容清理 + 文档规范化 — ✅ 2026-08-29

- **问题**：

  1. **分隔线到内容距离三种值**：Card 分区体 `10px 0 14px` 为基准，但顶边线分隔 Dashboard `.q-section + .q-section` `padding-top: 16px`、DownloadCard `.tasks-section` `padding-top: 12px`；次级 dashed 分隔（ModelMetaCard `.meta-chips.details`）`padding-top: 6px` 无标准。
  2. **未引用内容（脚本化清查：组件/图标/i18n/SCSS token/CSS 类五类全扫）**：死组件 `CollapsibleSection`/`Drawer`/`EmptyState`/`Progress`/`Toast`（无任何 import/模板引用；其中 Drawer/Toast 的 backdrop-filter 审计项随之消失）；死图标 `chevron_up`/`warn`（warn 唯一使用方是死组件 Toast）；76 个死 i18n 键（104 候选排除三组动态键族：`cat_*` 4 个经 ``i18n.t(`cat_${c}`)``、`subcat_*` 13 个经 ``title-key="`subcat_${sub.key}`"``、`dl_err_*` 11 个经 `i18n.t('dl_err_' + task.errorType)` 拼接使用——字符串拼接式动态键曾漏检，靠二次排查找回）；死 SCSS/CSS token 11 个（`$layout-page-gap`/`$layout-card-gap` 死变量、`--accent-hover/pressed/soft/dim`（主按钮主题化后无引用）、`--fs-xl`、`--radius-card`（#20 保留兼容后始终无引用，本次正式删除）、`--bg-topbar`/`--status-fg`/`--glass-highlight`）；`reset.scss` 过渡选择器组中死类 `icon-btn`。composables 导出（`toPlain`/`invokeOk`/`confirm`/`presetNameCandidates` 等）逐一核查均在用；core 采用 `export *` 公共 API 面不动。
  3. **文档与现状脱节**：frontend.md §7.1–7.4 仍是重构前路由/页面/组件清单（列着已删除的 `LaunchPage`/`DownloadPage`/`ParamsPanel`/`CollapsibleSection`，缺 Dashboard/Service/Logs 页与新组件）；ipc-channels.md 缺 Logs 3 通道（48→51）；architecture.md 结构图（46 通道、6 页面、desktop 版本 0.0.04、缺 app-log.ts/新脚本）；AGENTS.md「4 pages」「48 IPC」；README/desktop-main 通道数与分类。

- **修复**：

  1. 分隔线统一：Dashboard/DownloadCard 顶边线 `padding-top` → **14px**（与 Card 体底距一致）；dashed 次级分隔 → **8px**；节奏固化进 frontend.md §7.5.4 新增「分隔线节奏」条目（主分隔 14 / 次级 dashed 8 / 标题下划线 4 / 表格 6×8；弹窗内部分区为专属尺寸不套用）。
     1b. **分隔线"上贴下离"修复 + 全页面 DOM 审查（2026-08-29）**：Dashboard `.q-section` 的 padding-bottom/margin-bottom 全为 0，3 条分隔线上方间距实测 **0px**（下方 15px）——内容直接贴线；DownloadCard `.tasks-section` 上方仅 8px（容器 flex gap）。修复：`.q-section { padding-bottom: 14px }`；`.tasks-section:not(:first-child) { margin-top: 6px }`（8+6=14，任务模式首子块不加）。复测：Dashboard 3 条分隔线均 14/15（1px 边框宽度计入），ModelMetaCard dashed 8/8 对称。**全页面审查**（9 页 + 3 子标签、以文字到线的可读距离测量）：所有单侧结构分隔线全部符合 §7.5.4 节奏——概览 3 条顶边线 19~~20.5/15~~16（14px padding + 文字空隙）；Card 底线服务 18~~27/9、参数紧凑卡 19~~21/6.5、预设 20/23；标题下划线 5/7；表格行线 6.5。顺带统一 stats-row 容器 `margin-bottom` 4→8px（对齐 status-bar/params-status-bar）。注意：`.tab-strip`/`.stats-row`/`.status-bar`/`.params-status-bar` 等为**四边边框容器**，其底边不是分隔线语义，不计入本规范。
  2. 删除全部未引用内容（清单见上）；zh/en i18n 同步为 352 键并清理孤立分区注释。
  3. 文档：frontend.md §7.1 路由表（15 条）、§7.2 stores（+appLog）、§7.3 页面（7 页）、§7.4 组件清单重写；§7.5.1 token 清单、§7.5.3 圆角表、§7.5.5 按钮类型学（删不存在的 `head-btn`/`icon-btn`）同步；ipc-channels.md 51 通道 + Logs 节；architecture.md/AGENTS.md/README/desktop-main 全部对齐。

- **保留项**：STYLE\_TODO 历史条目与 CHANGELOG 中的旧组件名（历史记录不改写）；`tmp/`（设计稿/审查脚本工作区）；`2px 10px` 信息胶囊等 #21 已登记项。

- **修复效果验证**：

  1. `node scripts/style-audit.cjs` → 9 项 ✅（检查 7 backdrop 清单已无 Drawer/Toast）；`node tmp/token-sweep.cjs` / `tmp/class-sweep.cjs` 复扫 → 零死 token/死类；
  2. `pnpm lint`（4 包 + IPC 51 通道 + 27 文档 120 链接）/ `pnpm test` / `pnpm build` 全绿；产物 CSS grep 死 token → 0 命中；
  3. IAB 浏览器实测：#/dashboard `.q-section + .q-section` `padding-top: 14px`；`--accent-hover`/`--fs-xl` 计算值为空（已删）；#/params 13 个分组标题中文渲染正常（`subcat_*` 动态键无裸键名泄漏），0 rawKeyLeaks。

### 21. 组件间距统一：页面 padding 双真相源 + 同类元素 padding 归簇 — ✅ 2026-08-29

- **问题**（全库 1/2/3px padding 与页面 padding 审计，#16 只归一了 gap，padding 未覆盖）：

  1. **页面 padding 双真相源（实 bug）**：`PageFrame.vue` 写 `padding: var(--page-padding, 18px 24px 24px)`，但 `--page-padding` CSS 变量全库未定义，实际生效 fallback **18px 24px 24px**；`variables.scss` `$layout-page-padding: 20px 24px 24px`（设计意图值，phase1-handoff「页面 padding → 20/24/24」）为死 token 无人引用；文档三处互相矛盾（frontend.md §7.5.4 写 18px 24px 24px、AGENTS.md 写旧页面的 18px 20px 24px、#15 记录实际 20/24/24）。
  2. **参数行 vs 调优行同类不同距**：`ParamRow` `padding: 3px 6px` vs `BenchPanel .tune-row` `4px 8px`，且 §7.5.7 明文「参数行/调优行 padding: 4px 8px」——ParamRow 漂移。
  3. **fs-xs 小徽章横距三种**：`1px 5px`（DownloadCard rec/file-cat/quant/source ×4）、`1px 6px`（info-tag / active-badge / model-tag ×3）、`1px 8px`（copied-tip）。
  4. **「有新日志」提示两页不同**：ServicePage `.new-logs` `2px 8px` vs LogsPage `.new-logs-bar` `3px 10px`，且与 fs-sm chip 标准 `3px 8px`（summary-chip / suggestion-chip / meta-chip）不一致。
  5. **非胶囊行/条纵向微间距**：DownloadCard `.warn-msg` / `.pager` `2px 0`、LogsPage `.scroll-hint-bar` `2px 4px`、GeneralPanel `.card-help-icon` `2px`、ModelMetaCard `.details-toggle` `2px 4px`、ParamSummaryCard `.summary-group-title` `padding-bottom: 2px`、GeneralPanel `.exe-help-step` `padding: 3px 0` 与 `margin-top: 4px` 双机制叠加。

- **修复（确立 padding 约定，规范已固化至 frontend.md §7.5.4「组件 padding 约定」）**：

  1. `PageFrame.vue` 改 `@use '../../styles/variables'` + `padding: $layout-page-padding`（单一真相源 20px 24px 24px，死变量激活）；§7.5.4 与 AGENTS.md 页面 padding 同步为 `20px 24px 24px`。
  2. `ParamRow` `3px 6px` → `4px 8px`（对齐 tune-row 与 §7.5.7）。
  3. fs-xs 徽章统一 `1px 6px`（DownloadCard ×4 与 copied-tip 8px→6px；全库 8 处同值）。
  4. fs-sm chip 统一 `3px 8px`（ServicePage `.new-logs` 2px→3px、LogsPage `.new-logs-bar` 10px→8px；全库 5 处同值）。
  5. 行/条微间距归 4px：`.warn-msg` / `.pager` → `4px 0`、`.scroll-hint-bar` → `4px`、`.card-help-icon` / `.details-toggle` → `4px`（热区 20→24px）、`.summary-group-title` → `padding-bottom: 4px`、`.exe-help-step` 删 `padding: 3px 0` 仅留 `margin-top: 4px` 单机制。

- **保留项（有意设计，登记防误改）**：`2px 10px` ×3（runtime-model / version-badge / 状态栏 `.clickable`，信息展示胶囊跨文件一致标准，clickable 的 `margin: -2px -6px` 为配对 hit-area 技巧）；`.gguf-hint` `0 5px`（0 纵向合法，5px 在刻度上）；`Card .card-title` `0 0 0 2px`（uppercase 字面光学补偿，非元素间距）；`.exe-help-step-num` `margin-top: 1px`（18px 圆与 1.5 行高光学对齐）；弹窗体 `18px 20px 16px`、`margin-top: 18px`（弹窗专属尺寸）。

- **修复效果验证**：

  1. `node scripts/style-audit.cjs` → 1–6/8–10 全 ✅（检查 4 gap 刻度不回归）；
  2. `grep -rEn "padding.*(:| )[123]px" packages/ui/src` 复扫 → 仅剩上述保留项四簇（`1px 6px` ×8 / `3px 8px` ×5 / `2px 10px` ×3 / 光学 `0 0 0 2px` ×2），无散点；
  3. `pnpm --filter @llama-launcher/ui build` 产物 CSS 含 `padding:20px 24px 24px`、无 `18px 24px 24px` 残留（@use 变量注入生效）；
  4. `pnpm lint`（4 包 typecheck + IPC 51 通道 + 27 文档 120 链接）全绿；
  5. IAB 浏览器实测（vite dev + computedStyle）：`.page-frame` padding `20px 24px 24px`（原 18px 24px 24px）；#/params 49 个 `.param-row-wrapper` 全部 `4px 8px`；#/service `.summary-chip` `3px 8px`；`.card-title` 光学缩进 `0 0 0 2px` 按约定保留。tune-row（源码级 4px 8px 未动）与下载徽章（需解析结果数据场景）建议维护者在真实模型数据下肉眼复核。

### 20. 卡片风格 → 实线分隔分区（全局设计变更）— ✅ 2026-08-28

- **变更**：所有页面内容从「玻璃卡片」改为「实线分隔分区」。原则：不同区域内容之间一律用 1px 实线（`var(--border)`）分隔，不再使用圆角卡片容器/背景/阴影。

- **落实**：

  1. `Card.vue` 分区化：透明背景、无圆角/阴影、无 accent 竖条；相邻区块以底边 `1px solid var(--border)` 分隔，`:last-child` 无线；分区体 `padding: 10px 0 14px`（左右随页边距），分区头高 38（compact 30）；
  2. `PageFrame` 纵向 `gap: 0`（分隔线承担间距）；Settings / Models `.tab-content` 同（与 tab 条间保留 8px 间距）；Params `.params-content` `gap: 0`；Dashboard `.q-section + .q-section` 改用顶边实线分隔；
  3. 浮层（弹窗/下拉/悬浮帮助/Toast）与工具条（tab-strip、筛选条、控制台）不属于内容分区，保持原有形态。

- **修复效果验证**：

  1. \#/dashboard、#/service、#/params、#/settings、#/models 六页浏览器实测：相邻区块均出现 `1px solid` 实线，区块 `background` 透明、`border-radius: 0`、无阴影；
  2. \#/params 13 组分区间实线、末组无线；#/service 前 7 区块 `borderBottom: 1px solid`、末位「测试历史」无线；
  3. `node scripts/style-audit.cjs` + `pnpm lint` 通过；frontend.md §7.4 / §7.5 卡片描述同步为分区规范，`--radius-card` 标记为保留兼容。

- **影响范围**：`Card.vue` / `PageFrame.vue` / `SettingsPage` / `ModelsPage` / `ParamsPage` / `DashboardPage` / `frontend.md` / 本文件。

### 19. 选项间距统一：卡片行距 / 选项胶囊组间距 — ✅ 2026-08-28

- **问题**：各页面"选项"类间距不一致——① 设置页「外观 / 高级 / 关于」面板用 `:deep(.card-body){ gap: 8px; flex column }` 覆盖卡内选项行距为 8px，而「常规」面板继承 InfoStrip 全局 `.card-body > .info-strip + .info-strip { margin-top: 4px }` 规则为 4px（且 flex gap 与 margin 叠加，实际观感更乱）；② 主题三选一 `.theme-picker` 容器 `padding: 3px`，属 #16 已禁用的 1/2/3px 微间距档；③ 下载页类别筛选 `.cat-filter` 组间距 `gap: 6px`、胶囊内 `gap: 5px`，与日志页 `.level-chips` `gap: 4px` 同类控件不一致。

- **修复（统一标准 = 设置页 tab 按钮界面）**：

  1. 删除 AppearancePanel / AdvancedPanel / AboutPanel 的 `:deep(.card-body){gap:8px}` 覆盖 → 四张设置卡片选项行距统一走 InfoStrip 全局 4px 规则；
  2. `.theme-picker` padding 3 → **4px**（与 `.tab-strip` 胶囊条一致）；
  3. `.cat-filter` gap 6 → **4px**、`.chip` 内 gap 5 → **4px**（对齐 `.level-chips` / `.tab-strip`）。

- **统一后标准**：选项胶囊组内间距恒为 4px（tab-strip / theme-picker / level-chips / cat-filter）；胶囊内 icon-文本间距 4px（chip 级）或 6px（按钮级：action-btn / tab-btn / link-btn）；设置卡片内选项行距恒为 4px。

- **修复效果验证**：

  1. 设置页四选项卡（常规/外观/高级/关于）内 InfoStrip 行距均为 4px，无 8px 脱节；
  2. 外观选项卡主题三段式胶囊与设置页顶部 tab 条同节奏（gap 4 / padding 4）；
  3. 日志页级别筛选、下载页类别筛选、模型页 tab 条三处筛选 chip 组观感一致；
  4. `grep -rn ":deep(\\.card-body)" packages/ui/src/components/settings/` → 无残留；`grep -rn "gap: [235]px" packages/ui/src` → 仅非选项类场景或已归一；`node scripts/style-audit.cjs` + `pnpm lint` 通过。

### 18. 设置面板 InfoStrip 垂直堆叠粘连 — ✅ 2026-08-29

- **问题**：设置页「常规 / 外观 / 高级 / 关于」多行 InfoStrip 直接堆叠在 `.card-body` 内，行间无垂直间距，28px 高胶囊控件（路径输入行 `.path-row`、下拉 `.settings-select`）上下贴合「粘连」。

- **修复**：InfoStrip.vue 新增非 scoped `<style>` 区块（scoped 无法跨组件实例命中兄弟节点），规则为 `.card-body > .info-strip + .info-strip { margin-top: 4px }`——仅作用于「卡片内垂直堆叠」场景。**取 4px 而非 12px 的依据（用户决策）**：与参数设置页 `.param-grid` 行距（`gap: 4px 14px`）一致；InfoStrip 与 ParamRow 同为 24px 紧凑表单行高（§7.5.1 行高 1.4），行距对齐形成同一表单节奏。DashboardPage `.q-grid`、ServicePage `.api-row` / `.runtime-details` 网格/行内布局中 InfoStrip 非 `.card-body` 直接子节点，不受影响。

- **修复效果验证**：

  1. 设置-常规：目录路径行与「关闭窗口时」下拉胶囊行距 4px，与参数页参数行一致不粘连；
  2. 外观（主题/语言/交互动效）、高级（HF 镜像/并发下拉）、关于（版本/仓库/Release）各行垂直节奏一致；
  3. 仪表盘 `.q-grid` 主机/端口、服务页 host/port/PID 网格对齐不变；
  4. `grep -n "margin-top: 4px\|gap: 4px 14px" packages/ui/src/pages/ParamsPage.vue packages/ui/src/components/common/InfoStrip.vue` → 行距两处一致；`node scripts/style-audit.cjs`（margin 非 gap 不受检查 4 约束）+ `pnpm lint` 通过。

### 17. 状态标识冗余 / emoji 功能图标 / 未使用图标清理 / 下载模块职责拆分 / tab-btn 收敛全局 — ✅ 2026-08-28

- **修复**：

  1. **StatusTag 三重标识冗余**：原「状态点 + 图标 + 文字」三重标识（ServicePage/DashboardPage 传 `icon="check"`），点颜色已承载状态语义 → 移除 `icon` prop 与 Icon 渲染，仅保留「状态点 + 文字」；SettingsPage 版本号展示已改 `<span class="version">`（非状态、不应用 StatusTag），顺带移除该页无用 StatusTag import。
  2. **emoji 功能图标 → Icon 组件**（§7「不使用 Emoji 作为正式功能图标」）：ConfirmModal `ℹ/⚠/⛔` → `Icon info/alert/error`（.modal-icon 由字号改 flex 居中）；ParamRow 依赖未足警告 `⚠` → `Icon alert`、清除按钮 `✕` → `Icon close`。
  3. **Icon 库清理**：删除 8 个全库无引用的图标（`gauge` / `basic` / `advanced` / `sampling` / `menu` / `sun` / `moon` / `plus`），保留 30 个在用图标。注：`✓/✗` 布尔文本符号（gguf-hint / ModelMetaCard / ParamSummaryCard）为**数据值表示**而非装饰图标，保留（与 mono 数值芯片同风格）。
  4. **下载功能重复 → mode 拆分**：DownloadCard 新增 `mode: 'library' | 'tasks'`——`library`（默认）模型库模式保留 URL 解析/搜索/文件列表 + 任务区；`tasks` 任务列表模式隐藏 URL 输入/历史/解析/搜索/文件区，仅渲染任务区（Card 标题切 `lbl_download_tasks`，隐藏区段重复标题，`.tasks-actions` 加 `margin-left: auto` 保持右对齐）。DownloadsPanel 传 `mode="tasks"`，LibraryPanel 用默认 library。
  5. **tab-btn 收敛全局 + 文档偏移修正**：`.tab-strip` / `.tab-btn` 由 SettingsPage / ModelsPage 两处完全相同的 scoped 副本收敛为 `styles/buttons.scss` 全局定义（§7.5.5 按钮类型学已列该类，消除同义类重复）；frontend.md §7.5.5 修正漂移——tab-btn 高 30 → **28**、active「卡片底+accent 字」→「主题化 primary 胶囊实底」（与 2026-08-26 #10 `--primary-*` 决策一致），控件高度清单同步 28。
  6. **审计脚本同步**：style-audit.cjs 检查 5 的正则与注释同步纳入 `tab-btn`（全局收敛类增为四类，该正则原只覆盖三类），STYLE\_TODO 审计方法清单同步。

- **修复效果验证**：

  1. `node scripts/style-audit.cjs` → 1–6 / 8–10 全 ✅，退出码 0；第 7 条 backdrop 清单仍仅限玻璃层/弹窗背板；
  2. `grep -rn "gauge\|menu\|sun\|moon\|plus\|sampling" packages/ui/src/components packages/ui/src/pages --include="*.vue"` → 仅匹配无关文本测试断言路径（basic/advanced 为 param group 名），无 Icon 引用；
  3. `grep -rn "ℹ\|⚠\|⛔\|✕" packages/ui/src/components --include="*.vue"` → 无 emoji 残留（✓/✗ 数据符号除外）；
  4. `.tab-btn {` 仅存在于 `styles/buttons.scss`（页内无 scoped 重复）；`StatusTag icon` prop 已无引用方；
  5. `pnpm lint`（turbo 4 包 + IPC 48 频道 + 120 文档链接）全绿。

### 16. 微间距归一 4px + 审计脚本三处误报修正 + 审计方法改脚本入口 — ✅ 2026-08-28

- **需求澄清（用户决策）**：全库 10 处 1/2/3px 微间距与 §7.5.4 刻度表冲突——用户选择「严格执行刻度表、不设微间距档」→ 全部归一到 4px。

- **修复**：

  1. **10 处 1/2/3px gap → 4px**：ServicePage `.mini-copy`、ParamsPage `.stat-body`/`.mini-nav-btn`、ParamSummaryCard `.summary-chip`、LocalModelsPanel `.stat-body`/`.suggestion-chip`、DownloadsPanel `.stat-body`、Sidebar 导航列表、DownloadCard `.result-item`、ModelMetaCard `.meta-chip`。像素级收紧（数值/单位堆叠、title/副标题、chip 内 icon-文本）一律取最小刻度 4px。
  2. **脚本检查 5 规则过宽修正**：`modal-btn`/`dl-btn`/`fb-btn`/`win-btn` 按 §7.5.5 本就是**组件内专属类**（各自定义各自尺寸），允许 scoped；正则收窄为仅检查全局收敛三类 `action-btn`/`mini-btn`/`ctrl-btn`。
  3. **脚本检查 9 行高误报修正**：原双循环首轮 `LH_RE` 负向断言存在 bug（实测对合法值 `1`/`1.4`/`1.6` 等全部误判命中，23 处全报）；删除该轮，仅保留数值成员精确校验（1/1.3/1.4/1.5/1.55/1.6，`normal`/`var()` 放行）。
  4. **审计方法入口改脚本**：「审计方法」由 10 条裸 grep 命令改为 `node scripts/style-audit.cjs`（`pnpm style:audit`），10 条检查固化进脚本；frontend.md §7.5.4「间距刻度」断言同步为真实计数（157 处）、并写明不设微间距档。

- **修复效果验证**：

  1. `node scripts/style-audit.cjs` → 1–10 全 ✅，退出码 0；
  2. `grep -rn "gap: [123]px" packages/ui/src/components packages/ui/src/pages --include="*.vue"` → 无残留；
  3. `pnpm lint`（含 check-docs-links）通过。

### 15. 规范文档漂移修复 + 文字系统/间距刻度补充 — ✅ 2026-08-28

- **修复**：

  1. **文档漂移**（frontend.md §7.5 与实现不一致）：`--dur-fast` 记录 `0.12s` → 实际 `0.16s`（variables.scss，注释已写明 ≥0.16s 避免玻璃表面背景切换闪烁）；页面 `padding: 18px 20px 24px` → 实际 `20px 24px 24px`（PageFrame.vue / `$layout-page-padding`）。
  2. **细粒度补充**：§7.5.1 新增「行高」体系（正文 1.5 / 日志 1.55 / 多行描述 1.6 / 紧凑多行 1.4 / 表格统计 1.3 / 图标单行 1，全库 23 处审计零离群）与「字重」规范（400 默认 / 600 区块标题与标签主力 / 700 强强调）；§7.5.4 新增间距刻度表（gap 只取 4/5/6/8/10/12/14，全库 105 处审计零离群）；§7.5.7 明文允许进度条填充宽度过渡例外（Progress.vue / DownloadCard `.task-progress-fill`）；§7.5.8 清单增加行高/字重/gap 刻度检查项。

- **修复效果验证**：

  1. `grep` 全库 `line-height: <数值>` 23 处均在规范集合内、`font-weight` 47 处均在 400/600/700；
  2. `pnpm lint`（含 check-docs-links，frontend.md 锚点改动无断链）通过。

### 14. DownloadCard 硬编码颜色与裸过渡 token 化 — ✅ 2026-08-28

- **修复**：

  1. `.chip-count` 裸 `rgba(0,0,0,.12)` → `color-mix(in srgb, var(--fg-secondary) 12%, transparent)`（跟随 chip 文本色相的半透明计数底）；
  2. `.chip.active .chip-count` 裸 `rgba(255,255,255,.22)` → `color-mix(in srgb, var(--primary-fg) 22%, transparent)`（激活态为 `--primary-bg`，主按钮文字色保证双主题可见；原白 22% 在深色主题白底激活 chip 上近乎不可见，属 2026-08-26 主按钮黑白反转后的遗留）；
  3. `.task-progress-fill` 裸 `transition: width 0.3s ease` → `transition: width var(--dur-med) var(--ease-jelly)`（与 Progress.vue 进度填充一致）。

- **修复效果验证**：

  1. `grep -rn "rgba(0, 0, 0, 0\.12)\|rgba(255, 255, 255, 0\.22)\|transition: width 0\.3s" packages/ui/src/components` → 无残留；
  2. DOM 双主题：未激活 chip 计数徽章为浅灰底可读；激活 chip（深色白底/浅色黑底）计数徽章跟随 primary-fg 呈反色底；
  3. `pnpm lint` 通过。

### 13. 侧边栏激活项深色模式对比不足 + 设置页重复提示文本 — ✅ 2026-08-28

- **修复**：

  1. **激活项对比不足**：`.nav-btn.active` 原为 `--sidebar-bg-active`（深色 `#26308F` 暗蓝底）+ `color: var(--accent)`（`#2563eb` 蓝字）——两种蓝色亮度相近，文字被"吞"进玻璃侧栏，视觉上像被遮罩遮挡。新增主题化 token `--sidebar-fg-active`：深色 = accent 实底蓝 `#2563eb` + 白字 `#FFFFFF`；浅色 = 浅蓝底 `#DBEAFE` + accent 蓝字 `#2563eb`。NavButton 一级/二级激活项均改引用 `--sidebar-fg-active`。
  2. **重复提示文本**：GeneralPanel 两处「即时生效」（`msg_effective_immediately`）重复且冗余 → 移除 `<span class="field-hint">` 与其 `.field-hint` scoped 样式；i18n 键 `msg_effective_immediately`（zh/en）与组件注释同步清理。

- **修复效果验证**：

  1. DOM 深色主题：`.nav-btn.active` 计算背景 rgb(37,99,235)（#2563eb）、文字 #FFFFFF，白字清晰穿透玻璃层；
  2. DOM 浅色主题：激活项背景 #DBEAFE、文字 #2563eb；
  3. `grep -rn "msg_effective_immediately" packages/` → 无代码引用；
  4. `pnpm --filter @llama-launcher/ui lint`（vue-tsc）通过；设置页「常规」无「即时生效」残留。

### 12. 侧边栏跟随深浅主题 + 设置摘要真实环境检测 — ✅ 2026-08-26

- **修复**：

  1. **侧边栏跟随深浅主题**：theme.scss 浅色块取消「侧边栏恒深色」——浅色主题下侧栏改白/浅底 + 黑灰字（`--glass-sidebar` rgba(255,255,255,.82)、`--sidebar-fg-primary` #111827 / hover #EDEEF1 / active #DBEAFE、`--glass-sidebar-border` 黑 8%）；深色主题保持深灰底白字。
  2. **设置页摘要真实环境检测**（SettingsPage）：引擎/模型目录由「字符串非空」判断升级为 `system:fileExists` 真实检测，三态（idle/checking/ok/missing），`watch(server_exe)/(models_dir)` 随配置变化实时重检；展示状态化文案（检测中/引擎就绪/文件缺失/模型目录就绪/未配置/目录不存在），路径进 tooltip；i18n 新增 `lbl_dir_not_exist`。

- **验证说明**：DOM 精密测量确认 `.nav-btn` 文字色随主题切换（dark #BBBFC9 / light #4B5563），此前「未跟随」系 0.16s 颜色过渡动画采样中间值（#A2A7B2）误判；激活项恒为 accent 蓝为有意的高亮语义。

- **修复效果验证**：

  1. DOM：浅色主题下 `.sidebar` backgroundColor rgba(255,255,255,.82)、`.version` color #4B5563；深色主题下 rgba(21,24,30,.82) + #BBBFC9；
  2. mock 下状态摘要显示「模型目录未配置 / 请在应用设置页配置 llama.cpp 引擎目录」idle 态、无「检测中」残留；
  3. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 11. 主题三选按钮组 / 侧边栏折叠容错 / 设置摘要检测逻辑 — ✅ 2026-08-26

- **修复**：

  1. **主题下拉 → 按钮组 + 跟随系统**：AppearancePanel 主题 `<select>` 改为三段式按钮组（深色/浅色/跟随系统，`.theme-picker`/`.theme-opt`，radiogroup 语义）；`ThemeMode` 增加 `system`（shared 类型 + core settings-store 校验白名单）；`applyTheme` 对 system 用 `matchMedia('(prefers-color-scheme: dark)')` 解析并注册 change 监听实时跟随 OS；i18n 新增 `opt_theme_system`。
  2. **侧边栏收起展开**：折叠状态改为本地 ref + settings 双向同步（原写法在 settings 未加载/预览环境点击无效）；footer 折叠按钮/版本号文字从 `--sidebar-fg-muted` 提亮为 `--sidebar-fg-secondary`（灰底白字语义），hover 提白，补 aria-label。
  3. **设置页状态摘要**：引擎就绪改为按 `server_exe` 非空判断（原按 llama\_dir 目录非空，目录配了但无 llama-server 会误报就绪）；模型目录按 `models_dir`；显示状态化文案（`lbl_exe_state_ready`/`msg_no_exe_hint`、`lbl_model_dir_ready/missing`）并给路径 tooltip。

- **文档同步**：docs/frontend.md §7.5.2（主题基调补充 system）。

- **修复效果验证**：

  1. DOM：主题行 3 个按钮、无 select；点「浅色」→ data-theme=light、激活按钮黑底白字；点「跟随系统」→ data-theme 与 `prefers-color-scheme` 解析一致；侧栏 210px↔56px 折叠/展开双向通过且版本号随动；摘要显示「模型目录未配置 / 请在应用设置页配置...」预期态；
  2. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 10. 主题黑白基调：深色白底黑字主按钮 / 浅色黑底白字主按钮 — ✅ 2026-08-26

- **修复**：

  1. 新增主题化主按钮 token（theme.scss）：`--primary-bg/fg/hover/pressed`——**深色主题 = 白底黑字**（#F3F4F6/#111827，hover #FFF / pressed #D1D5DB），**浅色主题 = 黑底白字**（#17181F/#FFF，hover #000 / pressed #3F3F46）。
  2. 全部实底主按钮/选中实底态改引用 `--primary-*`（不再 accent 实底）：`buttons.scss .action-btn.primary`、TopBar `btn-start`、`modal-btn.primary`（Confirm/CloseDialog）、`fb-btn.primary`、`dl-btn.primary`、日志筛选 `level-chip.active`、模型/设置页 `tab-btn.active`、下载类别筛选 chip `.active`。
  3. 主题基调调整：深色 = 中性深灰底（--bg-app #101216 / 卡片 #1A1D23 / 输入 #23262D / 边框 #2F3340）+ 白灰字；浅色 = 纯白底（--bg-app #FFFFFF / 输入 #F3F4F6）+ 黑灰字；玻璃与侧栏色同步。

- **决策**：accent 蓝保留为交互强调色（描边按钮、链接、focus 环、选中行 nav/tab、开关、滑块、进度条、推荐徽章、帮助编号等状态/装饰控件）；danger/warn/success/info 状态语义色与下载分类徽章不变。

- **文档同步**：docs/frontend.md §7.5.1/7.5.2/7.5.5/统一蓝色系。

- **修复效果验证**：

  1. DOM 深色主题：启动按钮背景 rgb(243,244,246)（白）、文字 rgb(17,24,39)（黑）；`.action-btn.primary` 同。
  2. DOM 浅色主题（HTML 切 data-theme=light）：启动按钮背景 rgb(23,24,31)（黑）、文字 #fff（白）。
  3. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 9. 指示器贴近标题 + 图标语义修正 + 主题色改蓝 — ✅ 2026-08-26

- **修复**：

  1. **指示器贴近标题**：DashboardPage `.q-header` 由 `justify-content: space-between`（状态标签被拉到卡片右缘）改 `flex-start`，运行状态/当前模型/最近问题卡片的状态标签紧跟标题文本。
  2. **图标语义修正**：服务导航与「跳转服务」按钮 `config`（星形，语义不符）→ `server`（服务器机架）；设置「常规」页签 `config` → `settings`（齿轮）；状态摘要即时保存提示 `config` → `save`（磁盘）；本地模型「模型总数」统计 `info` → `models`；日志筛选 STDOUT `info` → `console`（终端输出流）；删除 Icon 字典中已无引用的 `config` 条目。
  3. **主题色改蓝**：`--accent` 由蓝紫 `#6c50e7` 调整为纯蓝系列（`#2563eb` / hover `#3b82f6` / pressed `#1d4ed8` / soft `#dbeafe` / dim `#93c5fd`）；深色 `--bg-active`/`--sidebar-bg-active` `#2A2478` → `#26308F`（蓝暗调）、浅色 `--bg-active` `#EDE9FF` → `#DBEAFE`；app-icon.svg 渐变改纯蓝（`#60a5fa → #2563eb → #1d4ed8`）。

- **决策**：状态语义色（danger/warn/success/info）与下载分类徽章保留原色（语义数据，非主题色）。

- **文档同步**：docs/frontend.md §7.5.1。

- **修复效果验证**：

  1. `grep -rn "config" packages/ui/src`（Icon 名引用）→ 无残留；`grep -rn "#6c50e7|#8068f0|#efeafd|#b8acff|#2A2478|#EDE9FF" packages/ui/src` → 无代码引用；
  2. DOM：概览卡片状态标签与标题相邻（同一行起始位置）；服务导航/设置页签图标渲染为 server/settings/save；启动按钮计算背景 = rgb(37,99,235)（#2563eb）；
  3. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 8. 移除彩虹装饰，统一蓝色系 + 概览页字段/状态整理 — ✅ 2026-08-26

- **修复**：

  1. **移除彩虹/多彩**：删除 `$rainbow-grad`（variables.scss）、`--rainbow-grad`/`--hue`（theme.scss）、`.hue-cycle` 12 色相循环（surface.scss）；TopBar `btn-start` 彩虹边框 → accent 实底主按钮；下载进度条与推荐文件竖条彩虹填充 → `--accent`；Card/CollapsibleSection 分区装饰条 `hsl(var(--hue,...))` → `--accent`；ParamsPage 分组卡 `--hue` 注入移除；app-icon.svg 彩虹渐变 → 蓝紫渐变底。
  2. **概览页字段文本框**：DashboardPage Q1 主机/端口、Q2 模型的值由纯文本改 `.val-box`（输入底+边框+胶囊，与输入框同视觉）；移除 `.q-value` 死样式。
  3. **移除概览 API 地址状态指示器**：`card_dash_api` 标题右侧 StatusTag 删除（Q1 状态卡仍保留唯一状态指示器）。

- **决策**：状态语义色（danger/warn/success/info）与下载分类徽章 `--badge-*`（分类图例语义）保留，不属 UI 装饰。

- **文档同步**：docs/frontend.md §7.5.1/7.5.5/7.5.7、README.md（仓库根）。

- **修复效果验证**：

  1. `grep -rn "rainbow|--hue|hue-cycle|hsl(" packages/ui/src --include="*.{vue,scss,svg}"` → 无代码引用（仅注释文字）；
  2. DOM：TopBar 启动按钮计算背景 = accent；概览 API 地址卡无 status-tag；主机/端口/模型值为带边框文本框；
  3. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 7. 第三轮收尾审计（浮层组件 / 图标规范 / 死组件）— ✅ 2026-08-26

- **修复**：

  1. 删除 unused 死组件 `ActionStrip.vue` / `ActionStripBtn.vue`（无任何使用方；其 `.action-strip-btn.warn` hover 为黄底白字，违反 §7.5.1「warn 底 → #1a1a1a」——直接删除而非修样式的重复实现）；
  2. `FileBrowserModal` 文件/目录行 emoji 图标（📁/📄，违反 §7「不使用 Emoji 作为正式功能图标」）→ `Icon folder/file`；
  3. `Drawer` 关闭按钮 `title` 硬编码英文 `'Cancel'` → i18n `dlg_cancel`；
  4. `DashboardPage` 未使用的 `EmptyState` import 移除。

- **修复效果验证**：

  1. 复跑 STYLE\_TODO 审计命令 1/2/3/6：组件内无裸色值/裸字号/裸数值圆角/裸阴影（仅 §7.5 允许的彩色按钮文字 `#fff`/`#1a1a1a`、50% 圆形与 2px 滑块轨道例外；
  2. `grep -rn "import (ActionStrip|Progress|Drawer|Toast|CollapsibleSection)" packages/ui/src` → 均无引用；
  3. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 6. 第二轮审计修复（显示内容 / 链路 / 死代码）— ✅ 2026-08-26

- **修复**：

  1. Ctrl+Shift+C 全局快捷键失效：App.vue 派发 `app:copy-command` 但旧监听方 LaunchPage 已删除 → `CommandPreviewCard` 补监听（复制当前命令预览）；
  2. BenchPanel 测试失败/异常文案 `Error: ...` 英文硬编码 → 新增 i18n `bench_error`；
  3. DownloadCard 解析结果来源徽标直接显示原始 key（`huggingface`/`modelscope`）→ 新增 `parseSourceLabel`（还覆盖 lmstudio/unknown），走 `lbl_source_*`；
  4. TopBar `.icon-btn` scoped 死代码移除（模板未使用）。

- **修复效果验证**：

  1. DOM：`.action-btn`/`.ctrl-btn`/`.mini-btn` 全局规则各恰好 1 处；settings 路径按钮 class=action-btn、计算高度 30px；服务页 log-count「0 行」；
  2. `window.dispatchEvent(new KeyboardEvent('keydown',{ctrlKey,shiftKey,key:'c'}))` 无异常；
  3. 浏览器控制台 0 error/warning；
  4. `pnpm lint` / `pnpm test` / `pnpm build` 全绿。

### 5. 按钮类 scoped 重复定义（action-btn ×7 / ctrl-btn ×4 / mini-btn ×3 各表漂移）— ✅ 2026-08-26

- **修复**：新增全局 `packages/ui/src/styles/buttons.scss`（main.ts 引入），收敛 `frontend.md §7.5.5` 按钮类型学的三组类：

  - `.action-btn`（高 `var(--btn-h)` 30px，含 `primary/danger/warn/accent` 变体 + disabled）：移除 ServicePage / DashboardPage / TrashCleanCard / CommandPreviewCard / PresetsPanel / BenchPanel / LocalModelsPanel 7 处 scoped 重复；

  - `.ctrl-btn`（统一 28×28 带边框图标按钮）：移除 ServicePage（原 26px 无边框，不统一）/ LogsPage / LocalModelsPanel / DownloadsPanel 4 处 scoped 重复；

  - `.mini-btn`（语义 = 表格行内 20px 小操作，含 `accent/danger` 变体）：保留用全局定义；GeneralPanel / LlamaPanel 的设置路径按钮语义是页面级操作，`mini-btn` → `action-btn`（30px）并移除其 scoped 定义。

- **顺带修复**：LocalModelsPanel 刷新按钮 `<Icon name="reload">`（图标库不存在 → 空白按钮）改为 `refresh`；ServicePage 控制台 `{{ logCount }} lines` 硬编码英文改 `i18n.t('col_lines')`；CommandPreviewCard 失败文案 `# Error building preview:` 硬编码英文改 i18n（`msg_cmd_preview_error` 新增）；useStartServer 端口错误硬编码英文改 i18n（复用 `err_invalid_port` + 新增 `msg_port_in_use`，文案遵循设计稿 §13.2「先说明发生了什么，再说明如何解决」）；ParamRow 参数行清除按钮 hover（warn 黄底 + `#fff` 白字）改 `#1a1a1a` 深字 + 裸 `font-size: 12px` 改 `var(--fs-sm)`；LogsPage 时间戳 `zh-CN` 硬编码改 `settings.language`、移除未使用 `formatDateTs`。

- **修复效果验证**：

  1. `grep -rn "\.action-btn {\|\.mini-btn {\|\.ctrl-btn {" packages/ui/src --include="*.vue"` → 无 scoped 重复；
  2. `grep -rn "reload" packages/ui/src/components --include="*.vue"` → 无未定义图标引用；
  3. `pnpm --filter @llama-launcher/shared build && pnpm lint && pnpm test && pnpm build` 全绿；
  4. 四类按钮在双主题 + `data-fx='off'` 下渲染一致（新建 buttons.scss 与移除前同 token，视觉无回归）。

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

***

## 已确认设计决策（已固化进 §7.5 规范，历史留档）

- **2026-08-15 UI 全面重构（胶囊 + 单层毛玻璃 + 果冻动画）**：用户确认属「完整重构新 UI 风格」，非增量引入新风格。设计决策：① 交互元素全部胶囊化（`--radius-pill`），容器/弹窗/行分设 `--radius-card/modal/row` token；② 毛玻璃采用**单玻璃层**架构（`surface.scss .glass-layer` 全视口 1 层 blur + 表面半透明），blur 层数 18→1，稳态开销 ≈0-3% 帧时间；③ 果冻动效只动 transform/opacity，`prefers-reduced-motion` 关闭；④ 新增 `data-fx='glass|off'` 视觉效果开关（Settings 可切，off = 实底性能模式，回退 = 一个属性）。原「点缀式彩虹」装饰（CTA 按钮 `--rainbow-grad` / 下载进度条 / 分区 `--hue` 循环）已由 2026-08-26「统一蓝色系」决策移除（见上方 🟢 已修复 #8/#9），不再属于当前设计。验证：`pnpm lint`（含 check-docs-links）+ `pnpm test` 全绿；详见 frontend.md §7.5。

### 38. 性能测试调优区组件样式按参数设置页统一 — ✅ 2026-09-04（功能随「性能测试」整体移除，tune-grid/调优区不复存在，条目自结）

***

## 已修复条目明细 #50–#121（2026-10-10 由 STYLE_TODO 清单并入）

> 以下三段（条目明细 / 2026-10-07 Design Review 批次 / 已修复索引表）自原 `docs/zh/style/STYLE_TODO.md`（同日移除）整段搬入，**正文一字未改**，只把相对链接的深度从 docs/zh/style/ 换算到 docs/archive/。待办登记口已归一到 [docs/TODO.md](../TODO.md)。
>
> 本节在原清单里叫「🔴 修复项」，并入时 63 段**全部已修复**，段名与内容不符，故改成现在的名字。

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

- **位置**：`packages/ui/src/styles/theme.scss:29-48`（注释「迁移兼容层：业务组件替换前，将旧语义映射到 Arco token」）对照 `docs/zh/frontend.md` §7.5.3（圆角体系：pill 999/20/10/8）、§7.5.6（glassmorphism）、AGENTS.md「UI 风格规范」条目。
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

- **位置**：`docs/zh/frontend.md` §7.5.3 / §7.5.4 ①③ / §7.5.6 / §7.5.7 / §7.5.8。
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
- **修复效果验证**（内置浏览器 + demo-mock，`#/models?tab=library` 解析 `hf-mirror.com/Qwen/Qwen3-8B` 后实测 `Q4_K_M` 行）：行 `padding: 0px → 6px 10px`、行高 `25 → 34px`；`.arco-list-item-main` 矩形归零（`w=0`，证明 `display: contents` 生效）；相邻子项间隙 `≈3px → 8px`（复选框→名 8、名→量化 8、量化→推荐 8、推荐→类别 8、类别→大小 8）；`.file-name` 由 `display: inline` 变 `block` + `flex: 1 1 0%` + `text-overflow: ellipsis` 生效，徽章右对齐（末元素 right 1090 = 行 right 1101 − 内距 10 − 边框 1）。⚠️ `.result-item`（搜索结果行）与 `.file-item` 共用同一规则形状，但 demo-mock 的解析流程直接进入文件列表、`searchResults.length > 1` 分支未触发，**其像素级验证未覆盖**——建议真机走一次「搜索多结果」目视确认。规范落点：[frontend.md §7.5.7](../zh/frontend.md) 列表行变体 ②。

### 69. `a-tag` 无 `.arco-tag-content` 包装层——三处 `:deep(.arco-tag-content)` 死规则使 chip 内 key/=/val 三段实测 0 间距 — 🟢 已修复（2026-09-19）

- **位置**：`ParamSummaryCard.vue` `.summary-chip`（服务页「模型路径 = …」）、`ModelMetaCard.vue` `.meta-chip`、`LocalModelsPanel.vue` `.suggestion-chip`。
- **描述（用户标注「优化内容间距」后 DOM 实测确认）**：三处都写成 `.xxx-chip { :deep(.arco-tag-content) { display: inline-flex; gap: 4px } }`，但当前 Arco（`@arco-design/web-vue` 2.58）的 `a-tag` **不渲染 `.arco-tag-content` 元素**——插槽子节点（`.chip-key` / `.chip-eq` / `.chip-val`）直接挂在 `.arco-tag` 根上，选择器永不匹配。根元素自身 `display: flex` 且无 gap，实测三段首尾相接（key right=326 = eq x=326、eq right=333 = val x=333），界面呈现为 `模型路径=D:/Models/…gguf` 挤成一坨。与 #65/#66 同一类根因：把 Arco 内部结构臆想为存在某个包装层。
- **修复**：gap 落到 a-tag 根元素本身——三处改为 `align-items: center; gap: 5px`（5px 为 §7.5.4 刻度表的「chip 内文本-计数徽章」档，即芯片内部文本间距），删除 `:deep(.arco-tag-content)` 死块并在注释写明「Arco 无该包装层」。
- **修复效果验证**：服务页 `.summary-chip`（模型路径行）实测 `gap: normal → 5px`，几何间隙 key→eq `0 → 5px`、eq→val `0 → 5px`，标签高度 20px 不变（无重排）；`.meta-chip` / `.suggestion-chip` 同规则同组件、未逐一点开触发（概览模型元信息卡与本地模型建议行需选中模型 / 打开面板），真机顺带目视即可。规范落点：[frontend.md §7.5.4 ①](../zh/frontend.md)。

### 70. 页签标题图标与文字 0 间距——theme.scss 的全局修正被 Arco 同特异规则按注入顺序压掉 — 🟢 已修复（2026-09-19）

- **位置**：`styles/theme.scss` 的 `.arco-tabs .arco-tabs-tab-title`（模型页 / 参数页 / 设置页三处页签共用体例）。
- **描述（用户标注「优化图标与文字间距」后真机实测确认）**：该规则本意就是把页签标题的 `Icon + <span>` 改成 `inline-flex` 并给 `gap: 4px`，注释还写着「line 型另有高特异覆盖」——但它自身就是失效的那一个：Arco 的 `.arco-tabs-nav-type-line .arco-tabs-tab-title { display: inline-block }` 与本页选择器**同为 (0,2,0)**，而组件样式由 `unplugin-vue-components` + `ArcoResolver` 在运行时以 `<style>` 注入、顺序排在打包 CSS **之后**，同特异时后写者胜 → 实测计算值 `display: block`、`gap: 4px`（声明在，但 block 盒不认 gap），svg 右边界 277 = span 左边界 277，**图标与文字间距 0**。与 #65 ①（单类徽章被 Arco 深色规则压掉）、#66/#68/#69 同一类根因：对 Arco 的覆写在特异性或结构上不成立。
- **修复**：选择器显式带上 nav 的类型类升到 (0,3,0)——`.arco-tabs .arco-tabs-tab-title, .arco-tabs .arco-tabs-nav-type-line .arco-tabs-tab-title`，并在注释写明「同特异会因运行时注入顺序而输」这一判据；间距取 `6px`，与同族的「图标 + 文本」行（`SettingsPage .summary-item`、状态栏条目）一致，而非孤立的 4px。
- **修复效果验证**（内置浏览器 + demo-mock 实测三处页签）：设置页 常规/外观/高级/关于、参数页 参数预设/自定义参数、模型页 本地模型/模型库——`display: block → flex`、实测图标→文字间隙 **0 → 6px**；页签高度 40px 不变（无重排），图标与文字垂直中心差 0.5px（flex 居中的亚像素，肉眼不可见）；`pnpm style:audit` 12/12、`vite build` 通过，控制台 0 error。规范落点：[frontend.md §7.5.4](../zh/frontend.md)「覆写 Arco 默认样式的两条硬规则」。



### 71. 下载进度条与实际进度不一致——`a-progress` 的 percent 是 0–1 比值而非百分数 — 🟢 已修复（2026-09-19）

- **位置**：`DownloadCard.vue` 的 `progressPct()` 与任务行 `<a-progress :percent>`。
- **描述（用户报「模型下载进度与实际进度不一致」后核 Arco 源码 + 真机实测确认）**：Arco `progress/line.js` 用 `width: ${percent * 100}%` 渲染、文本为 `NP.times(percent, 100) + '%'`，即 **percent 约定是 0–1 小数**；本项目 `progressPct()` 返回 `Math.min(100, downloaded/total*100)`（注释还写着「0-100 数值,供 a-progress 使用」）。结果任何 ≥1% 的进度都会算出 ≥100% 的条宽，被轨道裁满——**下载一开始进度条就是满格**，与真实字节数完全脱钩；又因 `:show-text="false"` 没有百分比数字暴露矛盾，只能靠旁边的「584.1 MB / 4.56 GB」文本察觉。属 §7.5.4 新增「覆写/对接 Arco 必须核源码单位」类缺陷，与 #68/#69/#70 同族（对 Arco 内部实现的主观假设）。
- **修复**：`progressPct` → `progressRatio()`，返回 `Math.min(1, downloaded/total)`，注释写明 Arco 的换算式；同时给 `style-audit.cjs` 加**第 13 条**回归规则——`:percent="…"` 表达式含 `100` 或 `Pct` 即 ❌（自检：旧写法 FLAG、新写法 pass），杜绝同类回潮。
- **修复效果验证**（内置浏览器 + demo-mock 真跑一次下载，模拟按 12.5% 步进）：进度条宽 / 轨道宽实测 **12.5% → 25% → 37.5% → 50%**，与同行「584.1 MB / 1.14 GB / 1.71 GB / 2.28 GB ÷ 4.56 GB」逐级吻合（修复前这些点全部显示满格）；`pnpm style:audit` 13/13、`vue-tsc --noEmit`、`vitest run`（66）、`vite build` 全通过，控制台 0 error。规范落点：[frontend.md §7.5.4](../zh/frontend.md)「数值型组件单位约定」。



### 72. 参数页 60 行控件左右边缘都不齐（标签列按文字宽自适应 + 定宽槽位缺 min-width 被撑破）— 🟢 已修复（2026-09-19）

- **位置**：`ParamRow.vue`（标签列 / GGUF 提示槽）、`IntEntryParam.vue`（数字框宽）、`SliderParam.vue`（滑块行控件列）。
- **描述（用户批注「发现样式不统一，审查是否存在同类问题」+「优化所有输入组件的位置与宽度，要求看起来更整体」后真机实测）**：三处叠加导致参数网格参差——
  ① **标签列按文字宽自适应**：Arco `.arco-form-item-label-col` 原生是 `flex: 0 0 auto`，实测 60 行的标签宽为 28 / 42 / 56 / 59 / 70 / 72 / 84 / 90 / 93px 九种，控件起点 x 因此从 **318 一路漂到 380**（右列 750→815）。而 frontend.md §7.5.4「统一控件宽度」白纸黑字写着参数控件 `label-col` 应为 `flex: 0 1 110px` + 右对齐 + 省略号——**文档与代码漂移，该规则从未落地**（设置面板 GeneralPanel/AppearancePanel/AdvancedPanel 是真通过 `label-col-style` 实现的，实测标签恒 110px、控件起点单值 383，故本项只影响参数页）。
  ② **GGUF 提示挤占控件宽**：提示标签原为 `flex: 0 1 auto; min 44 / max 72` 内联在行内，8/60 带提示行的控件区宽从 400 掉到 **296~352**（五种值），且切换模型时提示出现/消失会让控件当场变宽。
  ③ **定宽槽位被长内容撑破**：改为常驻 72px 槽位后复测，发现「模型别名」行的槽位实际宽 **222px**、控件被挤到 146px、`a-input` 内部宽度 **0px**（值看不见）——根因是 flex 项默认 `min-width: auto`，`flex: 0 0 72px` 并不阻止内容把它撑大；必须同时写 `min-width: 0`（+ 溢出省略），属同类通用陷阱。
  另：`int_entry` 行数字框原固定 100px（`a-space` 按内容排布），与同行输入框/下拉的满宽不一致，右边缘参差。
- **修复**：① 标签列在 `ParamRow` 用 `:deep(.arco-form-item-label-col) { flex: 0 0 110px; min-width: 0; justify-content: flex-end; margin-right: 8px }` + 标签 `text-overflow: ellipsis`。**注意是 `0 0` 而非设置面板那套 `0 1`**：实测 `0 1 110px`（可收缩）在参数网格里会被控件的内在最小宽挤压，标签缩成 64 / 83px 两种、控件起点重新错位（x 346/365/797）——参数行控件（滑块 + 88px 数字框 + 72px 槽）本就占满，收缩只能落在标签上。② GGUF 提示改**常驻定宽槽位** `.gguf-hint-slot`（`flex: 0 0 72px`，提示本身仍 `v-if`），消除行宽差异与切换模型时的宽度跳动（同「槽位常驻防跳动」口径）。③ 槽位与标签都补 `min-width: 0` + 溢出省略。④ `IntEntryParam` 的 `a-space` / `a-input-number` 改 `width: 100%`、首项 `flex: 1`，数字框撑满控件列。
- **修复效果验证**（内置浏览器 demo-mock 逐行量 60 行）：标签宽 `[28…93] 九种 → [110] 一种`；控件起点 `[318…380] → [392, 824]`（每列一个值）；控件宽 `[212…356] → [206, 178]`——唯一残差是「已修改」行内联的还原 ✕（24px + gap 4），该行本身已有橙色描边标示，属瞬时态不预留（预留会在 52/60 行常年留白）。「模型别名」行控件由 146px 恢复到 178px、输入框内部宽度不再为 0。同类问题扫描：全库 `flex: 0 0 <px>` 定宽项复查，仅 topbar/statusbar 两条为列向高度基准（探针误报），`SliderParam` 的 88px 数字项实测未被撑破；设置页 3 行实测已对齐，无需改。`pnpm style:audit` 13/13、`vue-tsc`、`vitest`（66）、`vite build` 全绿。规范落点：[frontend.md §7.5.4](../zh/frontend.md)。
  ⚠️ 本条的 110px / 控件宽 `[206, 178]` 已被 #73 修订为 140px / `[176, 148]`（110px 下 11/60 行标签自然宽超可用 94px 被截断）。

### 73. #72 的两处二次不统一：滑块刻度门控留了「一只例外」+ 定宽标签列截断长标签 — 🟢 已修复（2026-09-19）

- **位置**：`SliderParam.vue`（`show-ticks` 门控）、`ParamRow.vue`（标签列宽）、`shared/src/i18n/labels.ts`（两条参数标签）。
- **描述（用户再批「滑块样式还是没有统一」后实测）**：#72 的修法自身引入两处新的不统一——
  ① **刻度按步数门控 → 同页混排**：`show-ticks` 用 `(max-min)/step ≤ 40` 门控，实测 13 只滑块里只有「温度」(0–2 step 0.05 → 39 格) 画刻度，其余 12 只不画；带刻度圆点的轨道与光轨道同页并排，本身就是样式不统一。而这些量程的刻度在 80–110px 的轨道上全是亚像素噪声，没有识读价值。
  ② **定宽 110px 标签列截断长标签**：用离屏 nowrap 探针量标签自然宽，最长「合成接受长度（基准）」= **140px**，而 110px 列（去掉 `margin-right: 8px` 后实际可用 94px）使十余行中文标签被省略号截断（「草稿模型 GPU 层数」「每槽位统一 KV 上限」「草稿 KV 缓存类型 K/V」…）。对齐不能以牺牲可读性为代价。
- **修复**：① 参数滑块**一律不开 `show-ticks`**（删除 `TICK_LIMIT` 门控与 `showTicks` computed），并在 `SliderParam.vue` 注释与 §7.5.4 / AGENTS.md 写明「不得改回按步数门控」的原因；② 标签列提到 **140px**（与 AdvancedPanel 已有的 140px 同档）；仍被截断的两条「…（基准）」把限定语并入 tooltip——`PARAM_HELP` 原文已含「仅基准测试」，标签去掉冗余括注后信息零损失（`spec_synth_len` / `spec_synth_rates` 两条 zh 文案）。
- **修复效果验证**（内置浏览器 demo-mock 重载后量 60 行）：`.arco-slider-ticks > *` 节点数 `39 → 0`、带刻度滑块 `1/13 → 0/13`，13 只滑块轨道宽全部 80px、数字框全部 88px（`spaceItemWidths = ["110x88"] → ["80x88"]` 单一值）；标签截断行（`scrollWidth > clientWidth`）`11 → 0`，trim 后全页最长标签自然宽 **127px**（「每槽位统一 KV 上限」），列可用宽 132px（140 − 8 margin）恰好容得下；标签列宽恒 `[140]`、右边缘恒两值 `[414, 846]`、控件区起点 `[422, 854]`、控件宽 `[176, 148]`（176 常规 / 148 带 ✕ 的已修改行）。代价：滑块轨道由 110px 降到 80px（140px 标签列挤占），如需更长轨道可缩提示槽 72→56px 或数字框 88→76px，属可再议的观感取舍。`vue-tsc`、`vitest`（66）、`vite build`、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.4](../zh/frontend.md)（新增「参数滑块一律不开 show-ticks」条）。

### 74. 建议值芯片被硬切且值读不到 + 文本参数行 hover 出现两个 ✕ — 🟢 已修复（2026-09-19）

- **位置**：`ParamRow.vue`（`.gguf-hint-slot` / `.gguf-hint`）、`TextParam.vue`（`allow-clear`）、`ToolTip.vue`（内容插槽）。
- **描述（用户两条批注「修复建议值显示样式」「修复还原默认按钮重复出现」，同指「模型别名」行）**：
  ① **建议值读不到**：别名建议是模型文件名（30 字），落在 72px 定宽槽里实测 `scrollWidth 220 / clientWidth 70`；而 `.arco-tag` 是 `inline-flex` 且无内容包装层（#69 同源），**CSS `text-overflow: ellipsis` 根本不生效**——界面显示成被硬切、连省略号都没有的 "Qwen3-32B"。原生 `title` 又只写了「点击应用此建议值」，于是**值本身在界面上任何地方都读不到**（与 §7.5.2「不用 opacity 削弱文字」同类的信息丢失）。
  ② **一行两个 ✕**：`TextParam` 的 `a-input allow-clear` 会渲染 Arco 自带清除按钮（`.arco-input-clear-btn`，平时 `visibility: hidden`、hover 有值时现形），与行级「还原默认」✕ 同屏；且它写入**空串**而非默认值（`host` 清空即触发 `err_invalid_host`），与行级按钮语义冲突。
  ③ 附带发现：`ToolTip` 走 `content` prop，而 `.arco-tooltip-content` 默认 `white-space: normal` → 全站「标签\n帮助」两段浮层实测被折成一行（高 30px）。
- **修复**：① 提示文本改 JS 中间省略（头 5 + `…` + 尾 2；尾部量化后缀/单位才是区分信息），完整值 + 参数名 + 操作提示三段进 `ToolTip`（去掉原生 `title`）；`ToolTip` 改 `#content` 插槽 + 自有 `.tooltip-text { white-space: pre-line }`；芯片横向内距收到 §7.5.4 ① 徽章档 6px（8px 档下 8 字 mono 要 74.7px > 72px 槽，差 2px 切尾字母）。② 去掉 `allow-clear`，参数行还原入口唯一。
- **修复效果验证**（内置浏览器 demo-mock；需先进「模型管理」触发 GGUF 读取，参数页才会出现 8 条建议值）：8/8 芯片 `scrollWidth === clientWidth`（**零裁切**），别名芯片 "Qwen3…_M" 宽 70px ≤ 72px 槽、高仍 20px；浮层实测 3 段 74px 高、文本 `模型别名 / Qwen3-32B-A3B-Instruct-Q4_K_M / 点击应用此建议值`；点芯片仍写入完整值（`45352452 → Qwen3-32B-A3B-Instruct-Q4_K_M`，`ToolTip` 包裹不吞点击）；全页 `.arco-input-clear-btn` 计数 **4 → 0**（4 个非空文本行：监听地址 / 模型别名 / GPU 层数 / 草稿模型 GPU 层数），行级 `.clear-btn` 保持 1。`vue-tsc`、`vitest`（66）、`vite build`、`style:audit` 13/13 全绿。规范落点：[frontend.md §7.5.7](../zh/frontend.md)（「参数行不得开 allow-clear」「GGUF 建议值芯片」两条）+ [§7.5.6](../zh/frontend.md)（多行 tooltip 走 `#content` 插槽）+ §7.5.8 豁免措辞收敛。**同轮追加**：参数行还原 ✕ 的提示也由原生 `title` 改 `ToolTip`（用户指定），`<a-button>` 外包一层后几何实测零变化（按钮 24×24、`.tooltip-host` 同盒、行高 38px），浮层渲染「恢复为默认值」108×30，点击仍生效（别名 → 默认空值、✕ 随之消失）。

### 75. 提示机制两套并存：原生 `title` vs Arco `ToolTip` — 🟢 已修复（2026-09-19）

- **位置**：16 个组件/页面，`grep -rn ':title=' packages/ui/src --include=*.vue` 登记时实测 **60 处**（DownloadCard 11 / ParamsPage 9 / LocalModelsPanel 8 / TopBar 8 / ServiceStatusCard 6 / PresetsPanel 4 …），其中 6 处是 `a-dgroup` / `a-statistic` / `iframe` 等**组件 prop**（合法），其余为浏览器原生浮层。
- **描述**：原生 `title` 不受主题控制（深色下仍是系统白底浮层）、有约 1s 延迟、承载不了多段文本，与 §7.5.6 的 Arco 浮层体系（实底 + token 色 + `pre-line` 三段）观感不一致。#74 只统一了参数行三处，其余出现点仍是原生——「参数页一套、别处一套」。
- **修复（先定边界再动，不逐处替换）**：① **页面级/铬面上的固定少量元素**转 `ToolTip`，共 **26 处 / 9 个文件**——TopBar 8（含 3 个 win-btn，`aria-label` 保留）、StatusBar 2、ParamsPage 4（显存统计块 + 性能目标/恢复基线/清除会话）、LogsPage 2、ServicePage 2、DownloadCard 3（HF Mirror / ModelScope / 打开模型目录）、ServiceStatusCard 3（外部实例徽章 + 打开网页 + 管理模型）、GeneralPanel 1、FileBrowserModal 1；② **保留原生的三类**写进 §7.5.6 成硬边界：组件 `title` prop（`a-modal`/`a-popconfirm`/`a-statistic`/`a-dgroup`/`iframe` 无障碍名）、**`v-for` 数据条目上的提示**（模型表格行、下载任务行、预设行、chip 列表——每条目一个 Arco trigger 实例，与 §7.1 热路径铁律相冲）、**截断值提示**（`.mono-val`/`.file-name`/`.task-name`/`.task-error`/`.summary-label`）与 `a-input :title`（外包 host 会动到表单控件盒型）。
- **落地要点（实测）**：① 自带 `v-if` 的元素转 `ToolTip` 时 `v-if` 必须移到 `ToolTip` 上（否则渲染空 host 与空浮层）；DownloadCard 的 HF Mirror/ModelScope 是 `v-if`/`v-else` 成对钮，两条指令要一起移到两个 `ToolTip` 上才保持相邻成对；② **`a-dropdown` 触发器外包 `ToolTip` 不破坏下拉**——Trigger 挂在 host 上、点击由按钮冒泡触发，弹层锚点即 host 盒（实测顶栏模型下拉中心 x=493 = 触发器中心；参数页性能目标 `position="bl"` 弹层 x=723 恒等于触发器 x）；③ 顶栏几何零回归：`.right` 五子项宽 `234/82/82/82/131`、gap 恒 8px、`.model-name` 仍在 180px 处省略（`scrollWidth 279 / clientWidth 180`）、状态栏复制值 109px 未撑破。
- **修复效果验证**：原生浮层 `grep -rn ':title=' packages/ui/src --include=*.vue` 计数 **60 → 33**（另 1 处 `iframe title` 无障碍名 + 6 处组件 prop；用「`:title=` 或 `title="`」合并口径则为 34），转换 26 处 / 9 文件；`<ToolTip` 使用点 **35 处 / 16 文件**；hover 实测顶栏「启动」浮层底 `rgb(29,33,41)` + 白字（Arco token，深色主题下不再是系统白底）、参数行 ✕ 浮层 108×30；`vue-tsc`、`vitest`（66）、`vite build`（index chunk 230.71 → 231.08 kB，+0.37 kB 为 26 处包裹）、`style:audit` 13/13、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.6](../zh/frontend.md)（「提示机制边界」「仍保留原生 `title` 的三类」「交互控件外包 ToolTip 的两条实测注意」三条）。
- **附带观察（已查清根因，决定不修）**：参数页首挂有 **60 条** `[Vue warn] toRefs() expects a reactive object but received a plain one`（一行一条）。根因在 Arco 侧：`form-item` 的 setup 里 `const formCtx = inject(formInjectionKey, {})` 后紧接 `const { autoLabelWidth, layout } = toRefs(formCtx)`（dev 包 `@arco-design_web-vue.js:20096`），而参数行是**刻意**「每行独立 `a-form-item`、无外层 `a-form`」（§7.5.4 记录的设计），注入落到默认值 `{}`（普通对象）→ 触发 dev 警告。**四条确认证据**：① 拦 `console.warn` 取栈，60 条全部落在 `form-item setup`，参数页首挂恰好 60 条 = 60 行；② 设置页三面板有外层 `a-form`，实测 **0 条**；③ 全库 `grep toRefs` 零命中，非我方代码；④ 该警告串在 `packages/ui/dist` 产物中**不存在**（`__DEV__` 门控），且无人依赖由此产生的 `arco-form-item-layout-undefined` 类（grep 零命中）。**不修的三条理由**：套 `a-form` 会启用每行 `setLabelWidth` 的挂载+更新测量并喂给 reactive `labelWidth` + `maxLabelWidth` computed（与 §7.1 热路径铁律相反），还会引入真实 `<form>` 元素与 Enter 提交语义；`provide(formInjectionKey, reactive({}))` 需深路径 import Arco **非公开导出**（`es/form/context.d.ts` 有声明但根 `index.d.ts` 未导出），与审计第 12 条「勿依赖 Arco 内部实现」同一脆弱性家族；纯 dev 噪声、零运行时成本。

### 76. 参数网格 `max-width: 1160px` 硬封顶 3 列 → 宽屏右侧大面积空白 + 中间宽度滑块被压瘪 — 🟢 已修复（2026-09-20）

- **位置**：`ParamsPage.vue` `.param-grid`（`max-width` 与 `grid-template-columns`）。
- **描述（用户批注「硬限制每行 3 个参数项，1920×1080 等常用分辨率右侧大面积空白」后，Playwright 逐视口实测）**：一处封顶同时造成**两个方向**的坏结果——
  ① **宽屏浪费**：`max-width: 1160px` 使网格恒 1160px，而卡片可用宽在 1600 视口已达 1326、1920 为 1646、2560 为 2286 → 右侧空白分别 **166 / 486 / 1126px**（2560 下近半宽度未用）。
  ② **中间宽度反而退化**：1440 视口尚未触及封顶，`minmax(340px, 1fr)` 排成 3 列 × 369px，控件仅剩 145px、**滑块轨道 31px**（拇指几乎占满轨道，0..262144 量程不可用）；同页 1280 两列时轨道却有 142px——同一控件在不同分辨率下尺寸相差 4.6 倍。
- **修复**：删除 `max-width` 上限，最小轨由 340px 提到 **400px**（推导：标签列 140 + 8 + 控件 ≥176〔滑块轨道 80 + 间隙 8 + 数字框 88〕+ 4 + 提示槽 72 ≈ 400），列数交给 `auto-fill` 按容器宽度决定。**400 而非 380 的实测依据**：380 可让 1920 排到 4 列，但滑块轨道压到 **55px**，低于 #73 定的 80px 下限——为凑列数牺牲控件可用性是本末倒置，故取 400 并在 §7.5.7 写明「不得为凑列数下调」。
- **修复效果验证**（Playwright 无头 Chromium，视口 1280/1440/1600/1728/1920/2560，逐档量网格宽/列数/轨道/控件/截断）：`waste`（容器宽 − 已用轨道和）**六档全为 0**；列数 2 / 2 / 3 / 3 / 3 / 5 随宽度单调增长；滑块轨道 **142 / 222 / 84 / 127 / 191 / 102px**（全部 ≥80px 下限）；对齐不变量在各列宽下恒成立——标签列宽 `[140]` 单一值、控件起点每列恰一个值、**0 行标签截断**、0 刻度节点。同类扫描：全库 `grep "max-width: [0-9]"` 复核，其余命中均为元素级截断（TopBar 模型名 180px、DownloadCard 文本 200/480px）或 `max-width: 100%` 伙伴声明，**无第二处内容区硬封顶**。`vue-tsc`、`style:audit` 13/13（42 文件）、`vite build` 全绿。规范落点：[frontend.md §7.5.7](../zh/frontend.md)「参数网格」条重写（含 400px 推导、实测表与「不得为凑列数下调」）。
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
  ④ **列数代价（如实记录）**：1600 由 3 列退为 2 列（轨道 84 → 270）、2560 由 5 列退为 4 列（102 → 183）、≤1210 视口退为单列；1920 仍 3 列（轨道 158.7）。`vue-tsc`、`vitest`（core 359 + ui 66）、`style:audit` 13/13、`vite build`、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.4](../zh/frontend.md)「统一控件宽度」（两槽常驻 + `.dep-hint` 不预留的量化理由）、[§7.5.7](../zh/frontend.md)「建议值芯片族统一」「参数网格」450px 推导与复测表、§7.5.8 两条检查项。
  ⚠️ 本条的 450px 最小轨与「标签列 140 / 数字框 88 / 提示槽 76」已被 #78 修订为 **418 / 124（右内距归零）/ 76 / 72**——450 里有 32px 属虚胖，回收后不必用列数换对齐（预留的两条不变量不变）。
- **同类扫描**：全库 `grep "<a-tag"` 共 23 个使用点复核尺寸档——实测在架的 `.summary-chip` / `.meta-chip` / `.suggestion-chip` / `.gguf-hint` / `StatusTag` 全部 `offsetHeight 20`（`size="small"`）。两处无 `size`：① DownloadCard `.cat-chip`（类别筛选，mock 未展开文件列表故本机未量，按 §7.5.4 ⑥ 明文「筛选项走 a-tag 默认 24px 交互档」为**有意档位**）；② **`ServiceStatusCard:187` 外部实例徽章**（仅在检测到外部 llama-server 时渲染，mock 无该态故未实测；按 `.rec-chip` 改前实测推定 h24，与同排 `StatusTag`（实测 h20）混排——属状态徽章族而非建议值族，是否收档待定）。
- **追加（用户第四条批注：「审查为什么样式与其他建议值不一致」，指「上下文长度」行的 `32,768` 芯片）**：逐个数计算值把 8 条芯片摆开对——6 条蓝（`arco-tag-arcoblue` + `cursor: pointer`，来自 `ggufSuggestions`）/ 2 条灰（默认底 `rgb(242,243,245)` + **`cursor: auto`**，来自 `p.ggufField` 的模型自带值：上下文长度、聊天模板），`border` 八条全 `1px solid rgba(0,0,0,0)`（截图里看到的方框是批注选区高亮，不是样式）。**灰档本身是对的**：`core/src/gguf-meta.ts` 的 `buildSuggestions` 明文「纯参考信息（context_length 训练上限、rope.freq_base 等）不产生建议——`-c` 默认 0 即从模型加载」，所以这两条没有可应用的动作，蓝底会撒谎。**真缺陷是光标**：只读档留 `cursor: auto`，与可点档只差一个底色、悬停零反馈，于是被读成「坏掉的建议芯片」。修法＝给只读档 `cursor: help`，与 `.rec-chip`（目标建议芯片，`:title` 给理由）和 `.dep-hint` 已有词汇表对齐——「蓝底 + pointer = 点它生效／灰底 + help = 悬停看说明」成为唯一规则。同时排除一条嫌疑：`32,768` 的千分位**不是离群写法**，三族芯片 formatter 同为 `typeof v === 'number' → v.toLocaleString()`（`ParamRow:87` / `ModelMetaCard:69` / `LocalModelsPanel:140`），且当前挂在参数行上的数值字段最大 7 位（`context_length` ≤ 262,144），千分位挤不爆 7 字省略预算（若将来挂 ≥7 位字段需重核）。验证：8/8 芯片光标与档位一致（2 help + 6 pointer），`vue-tsc`、`style:audit` 13/13、`vite build` 全绿。规范落点 §7.5.7「建议值芯片族统一」新增配色与光标条。

### 78. 参数行固定开销里有 32px 是虚胖：Arco label-col 自带 16px 右内距（§7.5.4 写的 8px 从未为真）+ 数字框 88 对 6 位值有 12px 富余 — 🟢 已修复（2026-09-20）

- **位置**：`ParamRow.vue`（标签列 / 提示槽 / `HINT_MAX_CHARS`）、`SliderParam.vue`（数字项定宽）、`ParamsPage.vue`（`.param-grid` 最小轨）。
- **描述（用户批注「当前设计的参数页每列宽度不够紧凑，看看如何优化」；#77 把最小轨从 400 推到 450 后，1156 视口退成单列、1600 只剩 2 列 ×640px 轨道）**：逐视口实测行宽构成，发现 450 里有 **32px 属虚胖**，不必靠牺牲列数来换对齐——
  ① **标签列 140 中藏 16px 内距**：Arco `.arco-form-item-label-col` 原生带 `padding: 0 16px 0 0`，叠加我方 `margin-right: 8px` 后，实际可用是 `140 − 16 = 124`（**不是 §7.5.4 一直写的「140 − 8 = 132」**），标签文字与控件之间实际空 **24px**（16 内距 + 8 外距），而规范写的是 8px——又是一处文档与实现漂移。用真实字体（`14px Inter/PingFang` 栈；13px 探针会低估 7%，据此写出的「最长 127px」也是错值）量得最长标签「每槽位统一 KV 上限」= **122.8px**，即 124 可用只余 1.2px，**列宽不能再降，但那 16px 内距可以归零**。
  ② **滑块数字框 88px 有 12px 富余**：最长值 `262144`（6 位 mono ≈ 42.2px）在 76px 盒内 `input.scrollWidth ≤ clientWidth`，13/13 只滑块实测零溢出（88 是 #72 拍的档，从未按内容复核）。
  ③ **提示槽 76px 的余量**：芯片文本实测 7.03px/字（#74 记的 7.3 偏大），7 字 = 49.2 + 内距 16 + 边框 2 = 67.2 ≤ 72，故省略预算收到 7 字（别名 "Qwen3…_M" → "Qwen…_M"，完整值仍在 tooltip）、槽收到 72px。
- **修复**：标签列 `flex: 0 0 124px` + **`padding-right: 0`**（可用宽与旧值逐像素相同，间距回到规范的 8px）；数字框 `flex: 0 0 76px`；`.gguf-hint-slot` 76 → 72 + `HINT_MAX_CHARS` 8 → 7（头 4 + `…` + 尾 2）；`.param-grid` 最小轨 450 → **418**（= 边框 2 + 行内距 16 + 标签 124 + 8 + 控件 ≥164〔轨道 80 + 间隙 8 + 数字框 76〕+ 4 + 提示槽 72 + 4 + ✕ 槽 24；等价式 `控件宽 = 轨宽 − 254`）。#77 的两条不变量（行尾两槽常驻、轨道 ≥80px）**全部保留**——本次只回收虚胖，不撤销预留。
- **修复效果验证**（Playwright 无头逐视口 1156/1280/1440/1600/1728/1920/2560，量 60 行）：列数 **1600 由 2 → 3 列、2560 由 4 → 5 列**（1280/1440 仍 2 列、1728/1920 仍 3 列；两列阈值由 `2×450+14=914` 降到 `2×418+14=850`，即视口 ≥~1170 即成两列——内置浏览器 1156 因带 12px 内容滚动条、网格只有 840，仍差 10px 落单列，无头环境无该滚动条则读成 850/两列，**同一视口两种读数，报列数前必须先量当次网格宽**）；轨道 80–222px 全部 ≥80（1280 双列时轨道 142，比 #77 的 110 更宽）；标签列宽 `[124]` 单一值、控件宽每列恰一个值、提示槽 x 与 ✕ 槽 x 每列各一个值、`waste=0`；**0 行标签截断**（判据改用文本承载元素 `.tooltip-host > span` 的 `scrollWidth > clientWidth`——只比 label 自身会因 Arco 的内层包装而漏判，第一版探针就把截断报成 0）、8/8 芯片零裁切、13/13 数字框零溢出、0 刻度节点。`vue-tsc`、`vitest`（core 359 + ui 66）、`style:audit` 13/13、`vite build`、`pnpm lint` 全绿。规范落点：[frontend.md §7.5.4](../zh/frontend.md)「统一控件宽度」（124 + 内距归零 + 真实字体探针口径）、[§7.5.7](../zh/frontend.md)「参数网格」418px 推导 + 复测表 + 列数阈值算式、「GGUF 建议值芯片」7 字档。
- **可再议旋钮（本轮未动，附实测代价）**：列间距 `gap 14 → 10` 可让 1600 的三列阈值从 422 放宽到 424.7（当前 418 已过）；行内距 `4px 8px → 4px 6px` 再省 4px；`.dep-hint` 预留 18px 会把最小轨推回 436（1156 又变单列）——均无必要，不动。

### 79. 英文态设置页表单标签压进控件（列宽只按中文量 + Arco 16px 内距使可用宽少 16）— 🟢 已修复（2026-09-21）

- **位置**：`components/settings/{GeneralPanel,AppearancePanel,AdvancedPanel}.vue` 的 `:label-col-style`、`pages/SettingsPage.vue`（省略号兜底）、`e2e/web/app.spec.ts`（几何判定）。
- **描述（用户批注「修复英文状态下组件重叠问题」，附高级面板截图）**：三面板的标签列宽历史上只按中文量（110 / Advanced 140），而 Arco `.arco-form-item-label-col` 自带 `padding: 0 16px 0 0`（#78 已在参数页踩过同一坑），所以**可用宽 = 列宽 − 16**，实际只有 94 / 124。英文标签普遍更长，实测（`14px Inter/PingFang` 真实字体 Range 探针）：
  - Advanced「Max Concurrent Downloads」自然宽 **172** vs 可用 124 → 溢出 48px，文本右缘 437 越过控件左缘 413，**压住下拉框 24px**；
  - General「When Closing Window」**141** vs 可用 94 → **压住 23px**；
  - 其余行（HF Mirror Host 92 / Models Directory 106 / Engine Directory 102 / Theme 42 / Language 61）与中文全部标签（最长 127）不压。
  根因不是缺省略号而是**列宽按单语言拍板**：`label-col` 默认 `overflow: visible` + `nowrap`，列宽不足时既不截断也不省略，直接盖到控件上。
- **修复**：① 三面板统一 `paddingRight: '0'` + `flex: '0 0 <W>px'` + `minWidth: '0'`（列宽 = 可用宽，标签与控件间距回到 §7.5.4 规范的 8px——此前实际 24px；`0 1` 可收缩改 `0 0`，与 #78 参数页同一口径）；② **W 按双语最长标签 + 余量**：General 110 → **145**（en 141）、Advanced 140 → **176**（en 172）、Appearance **保持 110**（双语最长 61，本就放得下，不为凑数改动）；③ `SettingsPage.vue` 加一条 `:deep(.arco-form-item-label){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}` 兜底——将来任一语言出现更长标签，宁可省略号也不许再压控件（三面板共用一处，不各抄一份）。
- **修复效果验证**：新增 `e2e/web/app.spec.ts`「设置页表单标签几何（双语）」——逐面板逐行断言 `控件左缘 − 文本右缘 ≥ 0` 且 `label.scrollWidth − clientWidth ≤ 1`，中/英各一条用例（入口按中文标签点，因每个 test 都是全新 context、mock 初始语言恒 zh）。修复后实测：三面板 × 双语共 7 行，**slack 全部恰为 8px、truncated 全 0**（含 172→176、141→145 两行）。**负测试**：把 Advanced 退回旧值 `0 1 140px` 后重跑，英文用例即点名失败「Advanced 标签『Max Concurrent Downloads』与控件间隙」，还原后 13 例全绿。`pnpm build`/`lint`/`test`（core 359 + ui 66）/`e2e:web` 全绿。规范落点：[frontend.md §7.5.4](../zh/frontend.md)「设置面板标签列」。

### 80. 参数页英文标签 11/60 被省略号截断（列宽 124 只按中文最长标签定）— 🟢 已修复（2026-09-21）

- **位置**：`shared/src/i18n/labels.ts`（`PARAM_LABELS` 的 `en` 字段 11 条）、`e2e/web/app.spec.ts`（几何判定扩到参数页）。
- **描述（#79 的姊妹问题，同一列宽口径的另一半）**：参数页标签列 124px 是 #78 按**中文**最长标签「每槽位统一 KV 上限」122.8px 定的（判据「这一列不能再降」），英文侧当时没逐条量。用页面真实字体（`14px Inter, "Segoe UI Variable", "PingFang SC"…`）canvas 实测：**11 条英文标签自然宽 > 124**，超出 4–45px，被 `overflow: hidden` + `text-overflow: ellipsis` 截断（最长「Budget Exhausted Message」169px，读作 “Budget Exhausted M…”）；其中 8 条超出 ≥ 8px——即该页若没有兜底截断，就会像 #79 一样压进控件。中文态实测 **0/60** 截断（最长恰为 124）。
- **两条路线的取舍（用户选边）**：① 列宽 124 → 176 彻底不截断，但最小轨 418 → 470，**1600 视口由 3 列退 2 列、2560 由 5 列退 4 列**，与 #78「不拿列数换对齐」的结论直接冲突 → 排除；② **缩短英文文案**（零布局代价，完整术语仍在 `PARAM_HELP` 帮助与 tooltip 里）→ 采用。
- **修复**：`labels.ts` 的 `en` 改 11 条（zh 一字未动，diff 即 11 行对换）：`Continuous Batching→Continuous Batch`、`Multimodal Projector→Multimodal Proj.`、`Projector GPU Offload→Proj. GPU Offload`、`Video Timestamp Interval→Video TS Interval`、`Jinja Template Engine→Jinja Engine`、`Draft KV Cache Type K/V→Draft KV Type K/V`、`Synthetic Accept Len→Synth. Accept Len`、`Synthetic Accept Rates→Synth. Accept Rate`（顺带修单复数：zh 为「合成接受率」）、`Reasoning Token Budget→Reasoning Budget`、`Budget Exhausted Message→Budget End Msg`。**改前每条候选都用同一字体实测 ≤122px**（留 2px 余量）；键名逐条 grep 对回 labels.ts 后再改（表上推断的 key 有 4 个不准：`video_timestamp_interval` / `spec_cache_type_k|v` / `spec_synth_rates` / `reasoning_budget_message`）。
- **修复效果验证**：`e2e/web/app.spec.ts` 的几何用例从「设置页三面板」扩到**参数页 60 行**（双语各一条），断言 `控件左缘 ≥ 文本右缘` 且零截断，并加 `expect(行数).toBe(60)` 防「少渲染也算过」。web e2e 13 → **15 例全绿**。**负测试**：把 `Budget End Msg` 退回 `Budget Exhausted Message` → 英文态参数页用例点名失败「参数页 标签『Budget Exhausted Message』与控件间隙」，还原后回到全绿。今后新增参数若英文标签超长，CI 直接拦下，不再依赖人工逐视口复测。规范落点 [frontend.md §7.5.4](../zh/frontend.md)。






### 81. 布局跳变总账：`v-if` 元素未预留占位，数据到位才插入正常流 — 🟢 已修复（2026-10-06 登记并同日落地，实测见下）

- **位置**：见下表（`packages/ui/src/` 下 11 处，均已读到具体行的 `v-if` 与容器布局）。
- **描述（用户视角）**：这些元素在**初次渲染时不存在**（没有默认值 / 没有占位），等数据到位才插进正常流，于是周围内容「跳一下」。判定标准是几何的：自身或兄弟/父容器的位置、尺寸是否因内容到达而改变。锚点是本轮刚修的 `ServicePage` 「有新日志」胶囊——它原先 `v-if` 渲染在日志框上方，出现即把日志框顶下一档，已改绝对定位浮在框内（同文件 `LogsPage` 一并改）。
- **既有正确范式（修法照抄这里，别另创）**：`ServiceStatusCard.vue:397-400` 的 `.failure-banner-slot`（`min-height: 30px` + 无内容时 `visibility: hidden`，注释明写「两种状态高度恒等」）、`ParamRow.vue` 的 `.gguf-hint-slot`（`flex: 0 0 72px`）与 `.clear-slot`（`flex: 0 0 24px`，槽恒在、内容 `v-if`，见 #77）、`DashboardPage.vue:111-165` 的问题框（`min-height: 72px` + `.issues-actions-slot` 常驻）。
- **修法边界（重要）**：不许用「每帧测量再回填」消除跳变——那是把跳变换成性能问题，违反 `../frontend.md` §7.1 铁律③（强制布局操作必须 `pageActive` 门控 + rAF 合帧）。预留必须是**静态 CSS**（`min-height` / `flex: 0 0 Npx` / `visibility` / 绝对定位）。

| 位置 | 触发时机（用户看到它跳的那一刻） | 跳变形态 | 严重度 |
|---|---|---|---|
| `components/layout/TopBar.vue:167`（`v-if="hasModels"`） | 冷启动后模型目录扫描返回那一瞬 | 顶开兄弟：启动/停止/重启/打开网页整簇左移 | 高 |
| `components/layout/TopBar.vue:176`（`.model-name` 只有 `max-width`） | 每次切换模型 | 宽度变化：按钮宽随模型名长短变，同簇横向重排 | 高 |
| `components/common/ModelMetaCard.vue:75`（整卡 `v-if`） | 选模型 / 启动恢复会话后 GGUF 读头返回 | 整块下移：卡片凭空插入，下方内容下沉 100px 以上 | 高 |
| `components/service/CommandPreviewCard.vue:139-168`（5 条提示行） | 服务运行中拖滑块；回读落地；点「复检」 | 提示行插在预览框与扩展参数区之间，整卡长高（两条分支文案长短不同还可能变两行） | 高 |
| `components/models/LocalModelsPanel.vue:482`（行内徽章排） | 扫描完成后 fit 批量计算 / 体检记录回灌 | 名称列下多出第二行 → 每行行高 1 行变 2 行，行数少时表格整块长高顶移下方三张卡 | 高 |
| `components/common/DownloadCard.vue:707-864`（解析结果 / 文件区 / 筛选芯片 / 分页 / 任务区） | 粘 URL 点解析 → 点模型 → 文件到位 → 加第一个任务 | 连续多级整块下移（每一步都往正常流里插东西），四态互换行高各异 | 中高 |
| `components/layout/StatusBar.vue:92,103`（复制反馈胶囊） | 每次点复制（1.2s 出现再消失，最高频） | 宽度变化：胶囊内插标签 → 自身变宽、同行再排两次 | 中高 |
| `components/service/ServiceStatusCard.vue:279`（开放端点提示行） | 进概览且未设 API Key；在参数页改这两项再回来 | 提示行插在字段表与快捷按钮之间，按钮行以下整块下移（英文态可能两行） | 中高 |
| `components/params/ParamRow.vue:147`（`.dep-hint` 无槽） | 改依赖源参数或应用预设后依赖不满足 | 警示图标插在行末 → 控件列当场被挤窄、72px 提示槽整体左移。**这是 #77 同一范式漏掉的第四处**（建议值槽与 ✕ 槽都已常驻，只它没有）；e2e「表单标签几何」只静态断言标签不压控件，抓不到后插入的宽度挤压 | 中 |
| `components/layout/StatusBar.vue:81,82,84`（状态标签 / PID / URL 胶囊） | 每次状态迁移、每次启停服务 | 顶开兄弟：文案长短不一 + `v-if` 增删 flex item | 中 |
| 低档若干：`ServiceStatusCard.vue:317`（OOM 建议行只兜了 banner 的 30px）、`ServiceStatusCard.vue:235`（外部实例徽章横向并排）、`settings/GeneralPanel.vue:222`（引擎胶囊 + `.path-row` 是 `flex-wrap` → 窄窗口折第二行）、`service/ParamSummaryCard.vue:90`（模型 chip 值变长换行）、`presets/PresetsPanel.vue:170`（先「暂无预设」后整块换列表，缺 loading 态）、`LocalModelsPanel.vue:458,478,514-525`（搜索计数插位 / 星标插名称前 / 三张卡整块互换）、`pages/ParamsPage.vue:239-269,295-311`（「已调整」位数变化撑宽统计块；建议弹层无定高）、`pages/SettingsPage.vue:100-120`（三态文案长短不一）、`pages/../TrashCleanCard.vue:112`（按钮换文案变宽） | 各自数据到位时 | 横向挤动为主，个别为纵向长高 | 低～中 |

- **建议落地次序**：① 先做「一行一槽」零风险的三处（`ParamRow` dep-hint 加 `flex: 0 0 16px` 常驻槽、`StatusBar` 复制反馈改绝对定位、`TopBar` `.model-name` 给 `min-width`）；② 再做提示行合并为常驻单行槽的三处（`CommandPreviewCard` 五行合一、`ServiceStatusCard` 端点提示、`ModelMetaCard` 骨架卡）；③ `DownloadCard` 与模型表格行高需要单独设计（改动面大，别和前两档混做）。
- **修复效果验证**：每处修完按「两态等高」判定——用浏览器在**内容到位前后**各量一次目标容器与其后第一个兄弟元素的 `boundingRect`，`top` 差值必须为 0（横向类则兄弟 `left` 差值为 0）；`pnpm style:audit` 与 `pnpm e2e:web` 双语几何用例不回归；改前改后各截一张同视口截图对比。
- **修复（2026-10-06）**：11 处全部改为静态预留（常驻槽 `flex: 0 0 Npx` / `min-height` / `visibility: hidden` / 绝对定位），无一处用逐帧测量。参数网格最小轨因新增依赖警示槽 418 → **434**（算式与列数判据已改写为纯算术不变式：两列 ≥882、三列 ≥1330、五列 ≥2226，旧的「视口→列数」经验串是 418 时代值，已删）。新增 i18n 键 `cmd_props_pending`（中英）与 `msg_no_download_tasks`（中英）。
- **实测结果（mock 页 `getBoundingClientRect`）**：参数页 64 行的三类槽宽度**各自唯一**（提示槽 72 / 依赖槽 12 / 还原槽 24，无一格例外，且依赖槽 64 个全在、当前 0 格有图标——槽常驻即几何不变）；模型表 6 行行高**全部 66px**，而各行徽章数是 1 / 2 / 2 / 3（徽章排不再决定行高）；概览页 `.sec-hint-slot` 36、`.failure-banner-slot` 66（两档）、`.oom-row` 28 且 `visibility: hidden` 零子节点（占位在、内容没有）；服务页 `.cmd-status` 36 常驻并显示「尚未向引擎回读核对（/props）」；下载卡 `.parse-status-slot` 38 与 `.task-empty` 38 均在**空态**下即撑出预留档、`.parse-btn` 宽 132 等于其 `min-width`；设置页 `.summary-label` 132、`.exe-status-slot` 156 均按较宽态锁定。
- **两处补验结果（2026-10-06 同日追量）**：① `PresetsPanel` 的加载档与空态档**等高成立**——注入真实结构的 `.arco-empty` 量得自然高 **88px**，小于 `.list-wrap` / `.list-loading` 的 `min-height: 120px`，故两态都落在 120（余量 32px，代理担心的「a-empty 更高」被排除）；② `DownloadCard` 走完「填 URL → 搜索 → 选中结果」链路，`.files-section` 出现时 `min-height: 194px` 生效（实测 306 为内容超过下限，属正常），筛选行常驻，搜索按钮宽度在点击前后 **132 → 132 不变**。仍留一条未验：`.files-section` **出现那一刻**是否顶动兄弟（要回到解析前状态复测，本轮没做），但结构上它与其内部各行都已是常驻元素，塌陷式跳变已被排除。

### 82. `PageFrame` 不是 flex 列，页面里写的 `flex: 1` 全部失效 → 日志控制台无限长高且内部滚动永不生效 — 🟢 已修复（2026-10-06）

- **位置**：`packages/ui/src/components/common/PageFrame.vue:8-11`（`.page-frame { min-height: 100%; padding: … }`，无 `display: flex`）；受影响消费者 `pages/LogsPage.vue:179-214` 与 `styles 257-264,303-318`（`.console-wrap` / `.console` 都写 `flex: 1; min-height: 0`）。
- **描述（先讲发生了什么）**：日志页的控制台**不会自己滚动**——日志一多，它是把整页撑出外层滚动条，用户以为「自动滚动到底部」在工作，其实那行 `scrollTop = scrollHeight` 永远作用在一个「高度等于内容高度」的盒子上，是空转；「有新日志」胶囊在这一页也因此永远不可能出现（盒子内部根本不存在「没到底」这个状态）。
- **根因（实测，非推断）**：`.page-frame` 计算样式是 `display: block`（Arco `.arco-layout-content` 只给 `flex: 1`，不给 `display: flex`），所以它的子元素写的 `flex: 1` 没有弹性上下文，高度退化为「由内容决定」。浏览器实测（mock 页，视口内 `.app-content` 高 705px）：5 行日志时 `.console` 高 **159px**、`.app-content.scrollHeight` **705**；临时塞进 200 行后 `.console` 高 **4187px**、`.app-content.scrollHeight` **4353**，而 `.console` 自身 `scrollHeight > clientHeight` 恒为 **false**、`scrollTop = 99999` 之后仍是 **0**。
- **修法方向与代价（必须先决策再动手）**：⚠ **只把 `.page-frame` 改成 `display: flex; flex-direction: column` 实测不够**——2026-10-06 试过并复量：`.page-frame` 计算样式确实变成 `flex`，但塞 200 行后 `.console` 仍是 **4187px**、`scrollHeight > clientHeight` 仍为 **false**、`scrollTop` 赋值后仍是 **0**。原因是还缺「确定高度」这一环：`.app-content` 本身是 `display: block`，Arco 给 `.page-frame` 的 `flex: 1` 在它身上同样失效，于是 `.page-frame` 高度仍由内容决定，子元素的 `flex: 1` 没有自由空间可分。正确做法要同时满足两件事：① 给 `.app-content` 或 `.page-frame` 一个**确定高度**（`height: 100%`，父级 `.app-content` 实测有确定高 705px）；② 处理 flex 列默认的 `flex-shrink: 1` —— 长页面（参数页 60 行）的子项若被压缩会**裁切内容而不是溢出滚动**，需要给非弹性子项显式 `flex-shrink: 0`。**代价是全站性的**：块流改 flex 列取消相邻外边距合并，7 个页面纵向间距都可能变；`ModelsPage` 的 `.tab-content { flex: 1 }` 一类「今天失效、改后突然生效」的规则要逐页复核。故必须单独一轮，配 7 页面 × 双语的截图对比，且**必须在其他呈现层改动落地并验证之后再做**（否则基线一直在动）。
- **修复（2026-10-06）**：三层骨架同时补「确定高度」与「弹性上下文」，缺一层就回到上面被证伪的那个状态。① `components/layout/AppLayout.vue` 的 `.app-content`：加 `display: flex; flex-direction: column`，`overflow` 由 `auto` 改 `hidden`（Arco 已给这一层 `flex: 1`，父 `.app-body` 有定高，高度从这里开始可解析）；② `components/layout/PageHost.vue`：加 `flex: 1 1 0%` + flex 列，把定高传下去；③ `components/common/PageFrame.vue`：`min-height: 100%` 换成 `display: flex; flex-direction: column; flex: 1 1 0%; min-height: 0; overflow: auto`，并给**直接子项显式 `flex-shrink: 0`**（`.page-frame > :deep(*)`）——这正是上一条预判的裁切风险，长页面（参数页 69 行控件）的子项被压缩就是内容看不见也滚不到。两个补充判据：`overflow` **两轴都留 auto**，实测写成 `overflow-x: hidden` 会把窄窗口下参数页状态行的按钮簇（`scrollWidth 714 > clientWidth 597`）裁成够不着的内容；原来「失效的」`flex: 1` 有两处改后会突然生效并按一档压缩，已按 `flex: 1 0 auto` 收（只撑满不压缩）——`ModelsPage.vue` 与 `SettingsPage.vue` 的 `.tab-content`。取证配套：`dev/demo-mock.ts` 加了 `globalThis.__mockPushAppLog(n)`（仿既有 `__mockExternalServer` 的范式，判据要造「远多于一屏」的日志，而初始缓冲只有 5 条、真实推送节奏不受控）与 `?lang=en` 启动形态（mock 设置不落盘，走界面切换后一刷新就回中文）。
- **修复效果验证**（实测）：日志页灌 400 条后 `.console` 高 **539px 不随行数增长**、`scrollHeight 6602 > clientHeight 537`、`scrollTop = 99999` 赋值后**稳定停在 6065**（改前是恒 0 的空转）；「有新日志」胶囊在这一页真的出现了（改前该状态在结构上不可能存在），且胶囊出现前后 `.console` 高相等（绝对定位，不跳档）。7 个页面中英各量一遍：横向溢出 **0px**、长页在 `.page-frame` 内滚到到底（参数页 `scrollTop` 可达 3418）、外层 `.app-content` 不再被撑高、内置 Web UI 的 iframe 撑满 661px。判据已钉成 `e2e/web/logs-scroll.spec.ts`（zh/en 各 5 条，含**删除实验**：把骨架退回块流后，控制台随内容长高、内部滚动消失、`scrollTop` 回到 0，三条断言全转红）。`pnpm e2e:web` 40 条全绿。

### 83. `DashboardPage` 读 `scrollHeight` 未做 `pageActive` 门控，与同族两处不一致 — 🟢 已修复（2026-10-06）

- **位置**：`packages/ui/src/pages/DashboardPage.vue:37`（`watch(recentIssues.length)` 回调里读 `scrollHeight`）。
- **描述**：`../frontend.md` §7.1 铁律③要求强制布局操作要 `pageActive` 门控 + rAF 合帧；`LogsPage` 与 `ServicePage` 的同类自滚动都做了门控，唯独概览页没有——页面被 keep-alive 停用后，问题列表一变仍会在后台强制布局。属一致性缺陷（不是跳变），随手登记在此避免丢失。
- **修复**：`scrollToBottom` 改为 `pageActive` 门控 + `scrollScheduled` rAF 合帧（同帧多条只滚一次），`onActivated` 补滚、`onDeactivated` 置 false，写法逐行对齐 `LogsPage` / `ServicePage`；顺带删掉不再需要的 `nextTick` 导入。
- **修复效果验证**：`grep -n "scrollHeight" packages/ui/src/pages/*.vue` 三处命中都带 `pageActive` 门控；切到别的页触发问题列表变化，DevTools Performance 录制里概览页不应再出现 layout 任务。

## 2026-10-07 前端样式审查（Design Review）批次

这一批来自一次覆盖「UI / 动效 / 交互反馈 / 可访问性」的专项审查。取证方式：插件自带的 `audit-*.mjs` 在本机缺 `node_modules`（fast-glob 与 yaml 未装）跑不起来、axe 未安装，因此全部结论出自自写 Playwright 探针在真渲染 DOM 上取数（10 轮），标注为「实测（浏览器口径）」。

### 84. 侧栏 7 项一级导航对键盘与读屏完全不可达，且是两个页面的唯一入口 — 🟢 已修复（2026-10-07）

- **位置**：`packages/ui/src/components/layout/Sidebar.vue:35-42`（`a-menu` 与 `a-menu-item v-for`）。
- **描述**：Arco 2.58 的 `a-menu-item` 渲染成无 `tabindex`、无 `role`、无任何键盘处理的 DIV（`es/menu/item.js` 里 grep keydown 与 role 为 0 命中，也没有 `href` / `to` prop）。实测从文档头连按 40 次 Tab 一次都落不到导航项、对菜单项调 `el.focus()` 被拒绝，无障碍树里 7 项显示为纯 StaticText；而 `grep router.push` 显示 `/params` 与 `/settings` 除侧栏外没有任何入口——纯键盘用户进不去参数设置与应用设置。
- **修复**：`a-menu` 上补 `role="navigation"` + `aria-label`（新键 `a11y_main_nav`），每个 `a-menu-item` 补 `role="link"`、`tabindex="0"`、`:aria-current="item.to===route.path ? 'page' : undefined"` 与 Enter / Space → 走既有 `navigate()`；另补 `:deep(.arco-menu-item:focus-visible)` 焦点环（Arco 只给 `.arco-menu` 根与菜单内的 `a` 画焦点样式，实测补了 tabindex 后自身零差分）。
- **修复效果验证**：Tab 30 次命中 **7/7** 导航项、Enter 后 hash 正确、`aria-current` 只出现在当前页；内置浏览器无障碍树从 `StaticText ×7` 变成 `navigation "主导航" > link ×7`。判据入库见 `e2e/web/a11y.spec.ts`。

### 85. 三个弹窗没有对话框语义，焦点既不进入也不被困住 — 🟢 已修复（2026-10-07）

- **位置**：`components/common/FileBrowserModal.vue:148`、`CloseDialog.vue:41`、`ConfirmModal.vue:16`。
- **描述**：实测打开后容器 `role=∅ aria-modal=∅ aria-label=∅`、`activeElement=BODY`，随后 Tab 12 次有 8 次落在弹窗背后（背景页面照样可操作）。库层事实：`grep -rl aria-modal node_modules/@arco-design/web-vue/es` **0 命中**，`a-modal` 无 autoFocus、无焦点陷阱、无焦点归还——所以只能我方补，不能当「库的问题」放下。
- **修复**：三个容器声明 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`（`ConfirmModal` 从 `:title` prop 改为带 id 的 `#title` 插槽），焦点管理收进新建的 `composables/useDialogFocus.ts`（打开移入首个可聚焦控件、Tab 与 Shift+Tab 在弹窗内循环、关闭归还触发器；监听随 visible 开关配对，不用 `onUnmounted`）。
- **修复效果验证**：可见弹窗（DOM 里同时存在 3 个 dialog 节点，必须按 `getClientRects()` 过滤，否则取到关闭态会得出假结论）实测 `aria-modal=true`、名称解析为「选择模型目录」、打开瞬间焦点在弹窗内、Tab 16 次 **16/16 在弹窗内**、Esc 关闭且焦点回到触发按钮「更改」。

### 86. 参数页 69 个控件与标签零程序性关联，图标按钮无名称 — 🟢 已修复（2026-10-07）

- **位置**：`components/params/ParamRow.vue:124-129` 分发的六类控件、`components/settings/*.vue` 的输入与下拉、`Sidebar.vue:45` 折叠钮、`FileBrowserModal.vue:168`、`ParamsPage.vue` 展开/收起钮。
- **描述**：实测参数页 `.arco-form-item` 69 个 **linked 0 / unlinked 69**，设置页 3 个同样 0 关联——Arco `form-item` 的 props 表里**没有 `for`**，永远不写 `label[for]`，读屏只能念「edit, blank」。另有 4 处仅图标按钮无可用名称（折叠钮在同仓库已有 `aria-label` 先例：`TopBar.vue:230` 的三个 win-btn）。
- **修复**：六类控件统一补 `aria-label`（值取 `i18n.paramLabel(p.key)`），一处规则覆盖 69 行；关键机制是 `a-input` / `a-input-number` 为 `inheritAttrs:false`，直接写 `aria-label` 进不了真 `input`，必须走 `:input-attrs`；`a-select` / `a-switch` / `a-button` 直接写即可。图标按钮复用现有键（`sidebar_collapse` / `sidebar_expand` / `picker_up` / `act_expand_all` / `act_collapse_all` / `msg_clear_param`），未新增 i18n 键。
- **修复效果验证**：参数页「可见且可 Tab 聚焦」的无名称控件 **83 → 0**（中英两态同数），设置页两面板归 0；参数行几何零回归（标签列宽恒 124、控件左缘取值集合改前后逐字节相同）。残留 22 个 `a-input-number` 步进按钮是 Arco 自绘且 `tabindex="-1"`（鼠标专用、无属性钩子），判为不修并在此登记。`style-audit` 第 16b 条把「仅 `#icon` 无 `aria-label`」钉成静态门禁。**登记之后又继续做掉的部分**：复核时另有 18 处「Arco 把名称留在外层、真正可聚焦的内层节点没名」（13 只滑杆句柄 + 5 只 Select 内层 input）被登记为残留，本轮由新建的 `directives/innerAriaLabel.ts` 收口补名（指令必须挂在单根宿主 `a-form-item` 上——Vue 对多根组件的自定义指令静默整体跳过，实测挂 `<a-select>` 毫无痕迹），加上设置页 2 只路径框走 `:input-attrs`、参数页 2 只仅图标钮补 `aria-label`，最终实测参数页 121 只、设置页 28 只可 Tab 控件**无名称数为 0**（中英一致），`e2e/web/a11y.spec.ts` 的残留登记表已清空为 `[]`。

### 87. 「引擎获取指引」浮层只能鼠标悬停打开 — 🟢 已修复（2026-10-07）

- **位置**：`components/settings/GeneralPanel.vue:191`（触发器）与 `:244-256`（`Teleport` 浮层）。
- **描述**：触发器是 `<span class="card-help-icon" @mouseenter>`，实测 `tabindex=null role=null`、`el.focus()` 无效。浮层形态本身是 §7.5.6 明确豁免的（全站仅剩两处自建浮层），**豁免的是形态，不是键盘入口**——而这段文字恰是新用户最需要的那段（怎么去下载 llama.cpp）。
- **修复**：触发器改以 `a-button type="text" size="mini"` 为基座（`.card-help-icon` 的 4px 内距 / pill 圆角 / hover 变色用 class 覆盖保留，实测 21×21 与取色逐项相同、标题区像素零差异），补 `aria-label`（新键 `a11y_exe_help_toggle`）/ `aria-expanded` / `aria-haspopup` / 条件 `aria-controls`，Enter 开 Esc 关并把焦点移进浮层，hover 的 300ms / 150ms 定时器保留为加速径；`z-index: 9999` → `var(--z-overlay)`；并补 `onDeactivated` 关掉浮层（`Teleport` 到 body 的内容不随 keep-alive 页面隐藏）。
- **修复效果验证**：第 29 次 Tab 可达、Enter 展开且 `aria-controls` 解析到真实节点、Esc 收起后节点离开 DOM；切页后 `.exe-help-panel` 不在 DOM。

### 88. 文字对比度系统性不达标（浅色 24.5% / 深色 38.0% 的取样节点） — 🟢 已修复（2026-10-07）

- **位置**：`theme.scss`（状态栏钉色、新增角色档）、`ConsolePanel.vue`、`TopBar.vue`、`DownloadCard.vue`、`LocalModelsPanel.vue`、`ModelMetaCard.vue`、`ParamSummaryCard.vue`、`ServiceStatusCard.vue`、`CommandPreviewCard.vue`、`TrashCleanCard.vue`、`PresetsPanel.vue`、`AboutPanel.vue`、`SettingsPage` 三面板、`ParamsPage.vue`。
- **描述**：`§7.5.8` 写着「文字对比度 ≥4.5:1」，但实现直接用了 Arco 的语义色——实测 `--color-text-3` 压白底只有 **3.24**、压 `--color-fill-2` **2.92**（Arco 把这一档设计给占位符与禁用态），状态色 `*-6` 作文字 warning **2.57** / danger **3.71**，状态栏钉色 `green-6` 压 `green-1` **2.63**，控制台 INFO 蓝压恒深底 **3.11**，深色主题 accent 文字压卡片底 **4.2**。首轮取样：浅色 322 个可见文本节点 **79 个**不达标（24.5%），深色 129 个 **49 个**（38.0%）。
- **修复**：见 [frontend.md §7.5.1](../zh/frontend.md)「文字角色色档」「实底强调色按钮三件配对」「恒深底钉字面量」三条——新增 `--fg-hint` / `--fg-accent` / `--fg-warning-text` / `--fg-danger-text` / `--btn-fill*` / `--console-accent` / `--fg-on-tag-success` / `--log-kind-*`，并把 §7.5.2 那句「文字对比度按 Arco 默认令牌体系（双主题 AA）」改写成被实测否证后的正确陈述。**层级改由字号、字重与大小写承担，颜色只承担可读性**，这是与旧「色板即层级」体系的根本区别。过程中自己造过一次回归：新加的 `.arco-btn-text` 规则把状态栏蓝铬面上的文字按钮从白字带走（14 个节点从 4.51 掉到 2.7），已用 `.statusbar .arco-btn-text { color: inherit }` 修回并写进文档。**随后按用户「优先 Arco 原生样式」的要求整轮重做**：删掉 8 条属性覆写与 6 个自定义 token，改成「换 Arco 读取的色阶变量」——浅色在 `body` 上换 `--warning-6/5/7`、`--danger-6/5/7`、`--green-6`，深色只在按钮 / 文字按钮 / 侧栏 / 蓝标签四个作用域升档，filled 与 outline 两种形态和全部状态仍由 Arco 自己算，**属性覆写归零**；复测按钮六态 浅 5.19 / 7.70 / 5.19、深 6.90 / 10.37 / 6.90，深色文本节点仍 0 处不达标。重做过程还暴露并修掉一条既有缺陷：`DashboardPage` 的 `.issues-console` 只声明了 `background: var(--console-bg)` 而没配前景色，四条级别之外的行继承 body 文字，浅色主题下 `#1d2129` 压在 `#1d2129` 上等于看不见（实测该节点 fg 与 bg 完全相同），现按 `ConsolePanel` 的成对写法补上 `color: var(--console-fg)`。
- **修复效果验证**：同一把尺子复测（本轮取样额外切到「自定义参数」页签，故分母变大）——**深色 152 个节点 0 处不达标**；浅色 433 个节点残留 15 处，**全部**是同一条已登记的装饰例外（芯片里的 `=` 分隔符）。另有两类豁免按规则写明：禁用态（WCAG 豁免，交回 Arco 自己发灰）与 placeholder。

### 89. 控制台自动滚动三份复制实现，且已经抄漂 — 🟢 已修复（2026-10-07）

- **位置**：`pages/LogsPage.vue:79-127`、`pages/ServicePage.vue:38-88`、`pages/DashboardPage.vue:35-62`。
- **描述**：`DashboardPage.vue:33` 的注释自己写着「写法照抄 LogsPage / ServicePage」；#83 就是这类重复的真实代价（同族三处只补了两处）。实测两份 `.console` 已漂移到不同取值：服务页 `padding 8px 10px` / `line-height 19.5px` / 高 **320px 写死**，日志页 `padding 8px 12px` / `line-height 20.15px` / **512px 弹性**；两页的「有新日志」胶囊也是两个长相（日志页有边框 + 2s 脉冲，服务页无边框无动画）。
- **修复**：新建 `composables/useAutoScroll.ts`（`pageActive` 门控、rAF 合帧、停用撤帧、`dist < 60` 阈值全站唯一定义，日志页原先的 80 已统一）与 `components/common/ConsolePanel.vue`（统一外壳、胶囊与级别色；**本体不写高度**，弹性档由页面给 `.console-fill`、定高档给 `.console-fixed`；行渲染仍归各页默认插槽）。概览页迷你列表只接 composable 不接面板，没有为它发明第三种控制台。
- **修复效果验证**：两页面板 17 项计算值逐项相等、胶囊 21 项计算值逐项相等，高度仍分别保持 320 与弹性；`grep -rn "scrollScheduled|dist < 60|scrollTop = el.scrollHeight" packages/ui/src` 三个模式全部只出现在 `useAutoScroll.ts` 一个文件；既有 `e2e/web/logs-scroll.spec.ts` 的判据（含删除实验）逐条复刻复量未转红。

### 90. 动效规范自相矛盾：唯一的时长档表达不了「持续提示」，于是漏出字面值 — 🟢 已修复（2026-10-07）

- **位置**：`components/common/Card.vue:74`、`pages/LogsPage.vue:291`（现移入 `ConsolePanel.vue`）、`components/layout/PageHost.vue:7-27`。
- **描述**：`--dur-*` 只有 `fast(0.16s)` 与 `med(0.2s)` 两档，没有任何一档能表达「状态还在延续」的常驻动效，于是 Card 顺手拍了 `0.15s`（与 token 的 0.16s 同语义两个值）、日志页拍了 `2s ease-in-out infinite`——而 §7.5.8 那条「动画只动 transform/opacity 且 ≤0.3s」是无条件的，2s 无限循环直接不符。第 8 条门禁只在 transition 碰到布局属性时才要求 token，所以两处都没被抓到。
- **修复**：时长拆成「交互反馈（fast / med，≤0.3s）」与「环境提示（新增 `--dur-ambient: 2s`，允许 infinite）」两类并写进 §7.5.7；Card 换 `var(--dur-fast) var(--ease-smooth)`；胶囊换 `var(--dur-ambient) var(--ease-smooth)`；`PageHost` 的 90ms WAAPI 淡入改成 CSS 关键帧（交替 `is-fade-a` / `is-fade-b` 强制重播），reduced-motion 退回 `reset.scss` 一条全局规则，消灭 setup 期 `matchMedia` 快照这条第二机制（它此前在系统偏好中途变化时不生效）。**没有改用 `<transition>` 组件**——#40 记过 KeepAlive 下钩子可能永不触发导致双页同框。
- **修复效果验证**：chevron 计算时长 0.15s → 0.16s、胶囊 2s，`reducedMotion: reduce` 上下文里两者都算成 `1e-05s`；首帧无动画、切页抓到 `CSSAnimation duration 160`；`style-audit` 新增第 14 条（字面时长与 `infinite`）与第 15 条（裸 `z-index`）并做删除实验：Card 退回 `0.15s` ⇒ 14 转红，层级退回裸 `2` ⇒ 15 计数 1→2。

### 91. `style-audit` 的扫描盲区与空转的 allowList — 🟢 已修复（2026-10-07）

- **位置**：`scripts/style-audit.cjs:19`（`SCAN_DIRS`）、`render()` 的 `allowListed` 形参（此前从无调用方传值）。
- **描述**：第 12 条禁止覆写 Arco 内部态类，但 `SCAN_DIRS` 只有 `components` 与 `pages`——唯一真正覆写的 `theme.scss`（状态栏钉色 5 行，STYLE_TODO #59 的有据例外）正好在扫描范围外，「有理由的例外」与「门禁盲区」在文件上长得一模一样。同时 `render()` 的 `allowListed` 参数一直是死代码。另抓到尺子自身的一个假阳性：`isComment()` 只认行首的 `//`、`*`、`/*`，块注释的**续行**不被认出，于是注释里写的「box-shadow: none、outline-style: none」被当成代码命中第 6 条。
- **修复**：`SCAN_DIRS` 纳入 `packages/ui/src/styles`，token 本体层按定义只豁免第 1/2/3/9/10 条（色板、字号、行高正是在此定义），第 17 条专门审计这一层的 Arco 内部态类覆写，并要求 `ARCO_STATE_ALLOW` 登记表**逐条给 marker 与 expect 行数**（数量对不上就红，登记表本身也不会腐烂）；`readLines()` 先把块注释正文抹成空格（保留行号与列位）再交给各条检查。
- **修复效果验证**：`node scripts/style-audit.cjs` 17 条全绿、扫描 45 个文件；删除实验三组——把 `expect` 写成 0 ⇒ 第 17 条红、层级退回裸值 ⇒ 第 15 条计数增加、动效退回字面值 ⇒ 第 14 条红。

### 92. 无标题层级、`main` 地标重复、状态变化不播报 — 🟢 已修复（2026-10-07）

- **位置**：`components/layout/AppLayout.vue:14` 与 `components/common/PageFrame.vue`（两层都是 `a-layout-content`）、七个页面的标题区、`components/service/ServiceStatusCard.vue` 的状态徽章。
- **描述**：实测 7 个页面里只有概览有 1 个 `<h2>`，其余 **0 个标题**——读屏用户无法按标题跳转（WCAG 2.4.6）；`document.querySelectorAll('main,[role=main]')` 每页返回 **2 个**（内置浏览器无障碍树里直接可见 `main > main`，模型页因 `PageFrame` 套了两层而是 **3 个**），地标重复会让「跳到主内容」落点含糊；`[aria-live]` / `[role=status]` 全站仅 1 处（失败横幅），服务从 `starting→running` 或翻成「启动失败」时**没有任何播报**，界面只换个颜色。
- **修复**：① **删层而不遮层**——`PageFrame` 由 `a-layout-content` 改为普通 `div`，全站唯一 `main` 留在外壳 `.app-content`。登记时建议的「内层补 `role="none"`」只是遮罩：它没回答「两个地标里哪个是真的」，读屏的「跳到主内容」仍要在两个候选里猜。Arco 给这一层的声明只有 `flex: 1`，而本盒自己写全 `flex: 1 1 0%`（特异性更高的那条本来就压着它），所以摘掉不缺任何东西，#82 的「确定高度 + 弹性上下文」三层链一字未动。② 每页恰好一个 `<h1>`：由 `components/layout/PageHost.vue` 单点渲染 Arco `a-typography-title :heading="1"`，文本取 `features` 注册表里该路由的 `nav.labelKey`（与侧栏页名同源，七页不再各写一份，新增页结构上漏不掉）。页名只出现在侧栏、页面里没有任何可见大标题，硬塞一个就是改版，所以这是一个 **sr-only 标题**（`position: absolute` + 1×1 + `overflow: hidden` + `clip-path: inset(50%)`，就地写在 `PageHost.vue`，不为此在 `theme.scss` 开全局工具类；`display:none` / `visibility:hidden` 读屏也一并读不到，故不用）。它挂在 `.page-host` **外面**而不是里面：`.page-host > *` 是四份 e2e 共用的「异步页面组件已挂载」就绪门禁，同步渲染的标题插进去会让门禁第一次就命中它而空转。卡片小节标题改成真 `<h2>`（`components/common/Card.vue` 单点：非折叠卡 `<h2>` 承载文字，折叠卡是 `<h2>` 包 `a-button`——WAI-ARIA APG 手风琴的写法，反过来给按钮挂 `role="heading"` 会吃掉按钮语义）；字号字重行高用 `margin: 0; font: inherit` 继承 Arco 卡片头自己的声明（实测 16px / 500 / 1.5715），没有用 `a-typography-title` 的 h2 档——那是 32px，放进 46px 的卡片头就是改版。③ 概览状态卡的状态行 `a-space` 直接透传 `aria-live="polite"`（Arco Space 没关 `inheritAttrs`，属性落进它渲染的那个 `div`），**不新包元素**：包一层就是第二套几何，而卡片高度与槽位常驻是 #81/#82 的硬判据，判据里因此钉住「live 根＝状态行本身」这一条；「启动失败 / 异常退出」的文字本来就随 `ServerStatusEvent.stop` 下发（`stores/server.ts` 的 `effectiveStatus`），播报只是这条状态文字发生变化，**未新开 IPC 通道、未新增渲染层定时器**。规范落点：§7.5.7「文档语义骨架」与 §7.5.8 两条新项。
- **修复效果验证**：新增 `e2e/web/semantics.spec.ts` 共 8 条（中英各 2 条判据 + 6 组删除实验）。实测 7 页 `main` 由改前 2 个（模型页 3 个）收敛为 **1 个**，且那一个就是 `.app-content`；可见标题序列改前是「概览 [2]、其余六页 []」，改后概览 `[1,2,2]`、模型 `[1,2,2,2]`、服务 `[1,2,2,2,2]`、设置 `[1,2]`、日志与内置 Web UI `[1]`（这两页没有卡片标题），参数页自定义页签是 `[1] + 14 个 <h2>`；`<h1>` 文本随路由逐项等于侧栏页名（概览/模型管理/服务/参数设置/日志/内置 Web UI/应用设置，英文态 Overview/Models/Service/Parameters/Logs/Built-in Web UI/Settings）。**删除实验六组全部转红**（并逐组还原转绿）：`.page-frame` 挂回 `role="main"` ⇒ 计数／嵌套／归因三条报警同时亮；注入第二个 `<main>` 节点 ⇒ 计数报警；把 `<h1>` 降级成 `<h2>` ⇒ 「一个 h1 都没有」；拆掉服务页 4 个卡片标题的 `<h2>` ⇒ 「4 张卡片的标题只是文字」；摘掉状态行的 `aria-live` ⇒ 「状态行及其祖先都没有 live 区」；把 live 改成外面包一层 `div` ⇒ 「live 根不是状态行本身」。另两条 mock 钩子（`__mockEngineFileExists`／`__mockStopReason`，沿用既有 `__mockExternalServer` 与 `__mockPushAppLog` 范式）让顶栏「启动」这条路在浏览器里真能走通、并把停止事实换成失败态，实测播报序列 运行中 → 未运行 → 启动中 → 运行中 → 启动失败，状态行高全程恒 20px。**几何零回归**：六页（模型页含嵌套那层）`.page-frame` 的 display／flex／min-height／overflow／padding／box-sizing／背景／文字色／宽高／rect／子项宽，与卡片 rect 清单、`.console` 高宽、状态行 rect，改前后**逐项相等**；卡片另在 5 页 22 张卡上做「新形状 vs 拆掉 `h2` 的旧形状」同页对拍，header / 标题盒 / 卡片体 / 首个内容盒 0 差异；sr-only 标题实测 1×1px、`clip-path: inset(50%)`。既有 `e2e/web/logs-scroll.spec.ts`（#82 骨架判据，zh／en 各 5 条含删除实验）复跑全绿；`pnpm e2e:web` 76 条全绿、`pnpm test` core 442 + ui 100 全绿、`pnpm style:audit` 17 条全绿、`pnpm lint` 全绿。



### 93. 顶栏等十处按钮的 `color` 覆写把 hover 文字色冻住了（用户批注「现在这些按钮配色是否符合 arco 原生」）— 🟢 已修复（2026-10-07）

- **位置**：`components/layout/TopBar.vue`（停止／重启／打开 Web UI 三条）、`pages/LogsPage.vue` 与 `pages/ServicePage.vue`（清空控制台）、`components/models/LocalModelsPanel.vue` 与 `components/presets/PresetsPanel.vue`（行内删除）、`components/common/DownloadCard.vue`（任务取消）、`components/service/TrashCleanCard.vue`（扫描按钮）、`components/settings/AboutPanel.vue`（仓库链接）——共 10 条 `color:` 覆写；另 `LocalModelsPanel.vue` 与 `pages/ParamsPage.vue` 各两条把 Arco `a-statistic` 的原生取值又抄了一遍。
- **描述**：这 10 条是上一轮「角色色档」留下的——当时 Arco 的 `danger-6` 直接作文字只有 3.71，不达标，所以补覆写。后来达标改由**换 Arco 自己读的色阶变量**实现（`--danger-6/5/7`、`--warning-6/5/7` 已在 `body` 上换档），这 10 条的取值就等于库自己算出来的颜色，但它们并没有因此变得无害：scoped 规则编译后带 `[data-v-*]` 属性，特异度 (0,4,0) 高于 Arco 的 `.arco-btn-outline.arco-btn-status-danger:hover` (0,3,0)，于是**悬停时只有描边变深、文字被冻在基色**。真机实测（内置浏览器 `#/logs` 顶栏，鼠标真悬停）：浅色悬停描边 `rgb(161,21,30)` 而文字仍是 `rgb(203,39,45)`；深色悬停描边 `rgb(245,78,78)` 而文字仍是 `rgb(247,105,101)`。静置态两者相等，所以截图上看不出来，只有悬停那一刻状态反馈是假的。
- **修复**：① 10 条覆写全删（默认态颜色零变化），hover／active 的文字色交回 Arco 按 `-5`／`-7` 档走；② 4 条 `a-statistic` 复述声明删除（逐条对照 `node_modules/@arco-design/web-vue/es/statistic/style/index.css`：`title` 原生即 `--color-text-2`、`value` 原生即 `--color-text-1`，与 `--fg-hint`／`text-1` 同值，属纯复述）；③ 新增门禁第 18 条 `BTN_COLOR_ALLOW`，把「按钮配色不覆写」做成可判对象——选择器命中挂在 `<a-button>` 上的 class 或 `.arco-btn*` 且声明 `color`／`background`／`border`／`box-shadow` 即报，例外必须带 `why` 与 `expect` 条数登记。④ **保留边界按「Arco 是否已把该值算出来」划，不按口味划**：按钮侧留 8 条（窗口铬 win-btn 2 + win-close 1、恒深底控制台胶囊 2、状态栏 `color: inherit` 2、弱化帮助图标 1）；Arco 节点上的非按钮覆写留 23 条（下载卡分页/推荐徽标/来源徽标/下拉分组标题/历史图标 5、侧栏焦点环 1、状态栏 `a-typography` 继承 1、模型下拉当前项 2、表格选中行 2 + 表头次级灰 1、命令预览恒深底 4、两处 `a-descriptions` 标签由原生 `text-3` 提到 `text-2` 达标 2、主题单选选中字色 1、参数页警示/占位统计值 + 变更标签 + 当前目标项 4）；`theme.scss` 状态栏 5 行钉色另由第 17 条登记。这些的共同点是 Arco 没有对应状态（当前模型、变更标记、恒深底）或原生取值不达 AA，删掉会改观感或改可读性，因此登记而不是删除。
- **修复效果验证**：`node scripts/style-audit.cjs` 18 条全绿（45 文件）。真机复测（文字＝描边才算原生）：浅色静置 203,39,45 对 203,39,45、浅色悬停 161,21,30 对 161,21,30、深色静置 247,105,101 对 247,105,101、深色悬停 245,78,78 对 245,78,78，「打开 Web UI」浅 22,93,255／深 104,159,255 均由 Arco 自己算出。**删除实验两组**：把一条覆写原样贴回 `TopBar.vue` ⇒ 第 18 条报出该选择器；把 `BTN_COLOR_ALLOW` 里 `.win-btn` 的 `expect` 由 2 写成 3 ⇒ 第 18 条报「例外登记数不符」且退出码 1（两组还原后转绿）。静态清点（scoped 配色规则覆写 Arco 节点）命中由 50 降到 36，减少的 14 条＝10 覆写 + 4 复述。既有 `e2e/web/narrow-viewport.spec.ts` 与 `semantics.spec.ts` 对 `.tb-stop` 只钉几何与可达性、未钉颜色，复跑未转红。规范落点：[frontend.md §7.5.1](../zh/frontend.md)（新增「连只改文字色也不能写」一条）与 §7.5.8 新检查项。




### 94. Arco 官方用法审查：库自带文案不跟界面语言、三处 prop 名写错（其中一处让一行提示从来没渲染过）— 🟢 已修复（2026-10-07）

- **位置**：`packages/ui/src/stores/i18n.ts`（语言切换的唯一落点）、`packages/ui/index.html:2`、`components/layout/WebUiFrame.vue:40`、`components/layout/Sidebar.vue:37`、`components/params/FileParam.vue:57`。
- **描述**：用户要求审查「对 Arco 库的使用是否符合官方最佳实践」，实测四条缺陷：① **Arco 有自己的一套 i18n，本仓库从不调用它**——`addI18nMessages` / `useLocale` / `a-config-provider :locale` 在 `packages/ui/src` 里 0 引用，库默认档是随包注册的 `zh-CN`（`es/locale/index.js` 的 `LOCALE = ref("zh-CN")`），于是英文界面里凡是库自带文案都是中文：删除预设的浮层按钮写着「取消 / 确定」（`popconfirm.js:225,237` 取 `t("popconfirm.cancelText")`），模型表空态写着「暂无数据」（`.arco-empty-description`）。② `index.html` 写死 `lang="zh-CN"` 且无人更新，切英文后实测 `document.documentElement.lang` 仍是 `zh-CN`——读屏按它选发音规则。③ `a-result` 的 prop 名是 `subtitle`（`result.js:41`），我们写的是 `:sub-title`：Vue 的 kebab→camel 归一把它变成 `subTitle`，与 `subtitle` 不相等，于是属性落进 DOM，**内置 Web UI「服务未运行」那一行提示从来没渲染过**。④ `a-menu` 没有 `collapse` 这个 prop（`menu.js` 只声明 `theme` / `mode`，`collapse` 是 BaseMenu 的**事件**名，真 prop 是 `collapsed`），折叠此前只靠 `a-layout-sider` 注入生效；`a-input-group` 在 2.58 **根本没有 props**（`input/input-group.js` 只有 `setup()` 返回 prefixCls），`compact` 是死属性且全库无 `.arco-input-group-compact` 类。
- **修复**：① ② 都落在语言切换的唯一位置 `stores/i18n.ts`：注册英文包 `addI18nMessages({ 'en-US': arcoEnUS })` 并 `useLocale(l === 'en' ? 'en-US' : 'zh-CN')`，同一处把 `html[lang]` 一起切成 `en` / `zh-CN`。③ 改成 `:subtitle`。④ 改成 `:collapsed`（值与注入相同，`base-menu.js:169` 是 `siderCollapsed || propCollapsed` 的或，行为不变），删掉 `compact`。**收回代理的一条错报**：报告说 `theme.scss:130-134` 那 5 行 `.arco-tag-checked` 是死规则——实测不成立，`tag.js:85` 对非 checkable 标签返回 `computedChecked = true`，状态栏「运行中」胶囊确实带 `arco-tag-checked` 且规则生效（实测 `rgb(0,128,38)` 压 `rgb(232,255,234)` = 4.84）。另把一条「ARIA 落在 `.arco-modal-container` 而不是 `.arco-modal`」降级为不是缺陷：`modal.js` 把 `$attrs` 并到容器，而 `role="dialog"` 与 `aria-modal` 落在**同一个节点**上，语义自洽。**登记本轮明确未做（另立工作项）**：`a-list` 自带 `paginationProps` 而我们手写下拉列表旁的分页；`ToolTip` 写死 position 且没用 `contentClass`；`a-form-item` 的 `labelAttrs` 名义上能挂 `for`，但实测 `.arco-form-item-label` 虽是真 `<label>`（69/69），**69 个都没有 `for`**、库也不生成控件 id，所以「官方 label 关联」这条路要自己配 id 才成立——`innerAriaLabel` 指令仍不是可替换项（这条代理报告说它是「官方 API 未用」，按实测不成立）。
- **修复效果验证**：新增 `e2e/web/arco-locale.spec.ts` 2 条（中英各 1）。英文态：浮层按钮无中文且含 `Cancel`、表空态为 `No Data`、七页 Arco 节点自带文案中文残留 **0 处**；中文态是**正对照**——同一批节点必须量到中文（实测 146 处），否则「英文态 0 处」可能只是检测器空转。**删除实验**：摘掉 `useLocale(...)` 一行 ⇒ 英文态浮层按钮立刻回到「取消 / 确定」并转红（还原后 78 条全绿）。真机另测：切英文后 `html[lang] = en`；停掉服务后 `.arco-result-subtitle` 现在读得到那句提示（改前该节点不存在）；侧栏折叠宽度 224 → 48 → 224 与改名前一致。`pnpm style:audit` 18/18、`pnpm test` core 442 + ui 100、`pnpm e2e:web` 78 条、`pnpm lint` 全绿。




### 95. 浅色状态色回退 Arco 官方档，并把四处「库已有的能力我们手写」收口 — 🟢 已修复（2026-10-07）

- **位置**：`packages/ui/src/styles/theme.scss`（`body` 块的状态色阶换档）、`components/common/ToolTip.vue`、`components/common/ConfirmModal.vue` / `CloseDialog.vue` / `FileBrowserModal.vue`、`directives/innerAriaLabel.ts` 的注释、`components/layout/TopBar.vue` 的注释、`scripts/style-audit.cjs`（新增第 19 条）。
- **描述**：用户要求「逐一修正前端仍存在的问题，完整使用 arco 官方最佳实践」。清掉五类：① **浅色在 `body` 上换 Arco 状态色阶**（`--danger-6/5/7`、`--warning-6/5/7`、`--green-6`）——库的状态色是间接层（`--danger-6: var(--red-6)`），组件读的就是 `-6` 槽，换档连带重绘 alert / 表单校验 / tag / badge / progress / switch / steps（实测浅色 125 个元素受影响）；且这几行在深色下**因特异度从未生效**（Arco 的 `body[arco-theme='dark']` 是 0,1,1，我们的是 0,0,1），所以此前是「浅色被改、深色原档」的不对称——这正是「深色可接受、浅色不像库」的成因。② `ToolTip` 在库的内容节点里再包一层 `<span class="tooltip-text">` 承载 `white-space: pre-line`，而 `a-tooltip` 有官方 `contentClass`（`tooltip.js:35`，合并进 `.arco-tooltip-content`）；`position` 写死 top 不可覆盖、`disabled` 没透传。③ 三个弹窗重复声明 `:mask-closable="true"` / `:esc-to-close="true"` / `:closable="true"`——三条都是 Arco 默认值（`modal.vue_vue_type_script_lang.js:63-79`、`:120-123`），读起来像「刻意选择」，实际分不清是选的还是蒙的。④ `FileBrowserModal` 在列表外自包一层 `<a-spin>` 并写 `style="display: block"`，而 `a-list` 自带 `loading`（`list.js:286` 内部就是 Spin）与 `#empty` 槽（`list.js:276`），四个 `v-if/v-else-if` 分支等于把库的两个 prop 重做一遍。⑤ `innerAriaLabel` 的注释自称「一个调用点管住滑杆、下拉与数字框」，实测数字框 / 文本框走的是官方 `input-attrs`（四处调用点），夸大的注释会诱导后人把那些 `input-attrs` 当重复删掉。
- **修复**：① 删浅色全部状态换档，并删深色块里与 Arco 深档同值的 `--green-6` 复述；`--fg-danger-text` / `--fg-warning-text` 改为**直接取色板档** `rgb(var(--red-7))` / `rgb(var(--orange-8))`——角色档是「选档」，改 `-6` 槽是「改库」；新增门禁第 19 条把这条不变量做成可判对象。② `ToolTip` 改 `:content` + `content-class="fc-tooltip-multiline"`，加 `position` / `disabled` 两个可选 prop，非 scoped 块只放这一条私有类规则。③ 删六条默认值声明；`ConfirmModal` 保留 `:closable="false"` + `:footer="false"` 并写明「出口只有 Esc / 遮罩与取消，✕ 是有意去掉」。④ 改成 `<a-list :loading>` + `#empty` 四态，删外层 `a-spin`。⑤ 注释按实测收窄。**两条评估后不采纳（写明理由，不留模糊）**：`a-list` 内建分页不采纳——`list.js:212` 主动 `omit(['current','pageSize',...])` 改用内部状态，接过来会丢掉「换搜索词回到第 1 页」的受控能力，而 DownloadCard 现在用的兄弟 `<a-pagination simple>` 本身就是库组件的受控用法，不是绕行；`a-form-item` 的 `labelAttrs` 不构成 label 关联——实测 `.arco-form-item-label` 是 69/69 个真 `<label>` 但 0 个带 `for`，库也不生成控件 id，所以 `innerAriaLabel` 不是可替换项。
- **修复效果验证**：浅色逐族实测（文字 / 底 → 比值）：描边 danger 按钮 `red-6` 压白 3.71、压 `red-1` 底 3.25、hover `red-5` 3.01；描边 warning `orange-6` 压白 2.57；绿 `a-tag` `green-6` 压 `green-1` 2.63；实底主按钮静置 5.19 达标、hover 3.65。我方角色档全部仍达标：`--fg-hint` 7.10 / `--fg-accent` 5.19 / `--fg-danger-text` 5.43 / `--fg-warning-text` 6.05，半透明底上的引擎状态徽章 4.51。**删除实验三组**：把 `--danger-6: 203,39,45` 贴回 `body` 块 ⇒ 第 19 条点名 `theme.scss:88` 且退出码 1（还原转绿）；`ToolTip` 真机悬停实测 `.arco-tooltip-content` 的 class 含 `fc-tooltip-multiline`、`white-space: pre-line`、内部 `span` 数 0（改前为 1）；`FileBrowserModal` 真机打开实测弹窗可见、列表渲染、空态文案照常出得来，且 `e2e/web/a11y.spec.ts:528,625` 两次真按 Escape 仍能关闭并归还焦点（证明删掉那六条默认值声明没改行为）。`pnpm style:audit` 19/19、`vue-tsc --noEmit` 干净、`pnpm test` core 442 + ui 100、`pnpm e2e:web` 78 条、`pnpm lint` 全绿。规范落点：§7.5.1「浅色主题现在零换档」与 §7.5.2 第三类豁免清单。




### 96. 自建浮层改挂 a-popover、圆角改指官方档、四个零读者 token 删除，并新增门禁第 20 条守住「给 Arco 内部节点写配色」 — 🟢 已修复（2026-10-07）

- **位置**：`packages/ui/src/components/settings/GeneralPanel.vue`（引擎获取指引浮层）、`packages/ui/src/styles/theme.scss`（圆角三别名 + `--dur-med` / `--ease-jelly` / `--shadow-dropdown` / `--z-overlay`）、`scripts/style-audit.cjs`（新增第 20 条、修掉第 8 条的过期例外注释）、`e2e/web/help-popover.spec.ts`（新增）、`docs/{zh,en}/frontend.md`（14 处 token 声明）。
- **描述**：用户要求「进一步审查是否还有哪些前端实现并未使用 arco 原档，全部需要使用官方实现」。审查口径是把「选择器命中 Arco 内部节点、或命中挂在 Arco 组件类上的 class，且声明了配色」的规则全量清点（46 个文件 / 204 条配色规则 / 36 条命中），再逐条问「库有没有对应的 prop 或变量能做这件事」。结果四类：① **引擎获取指引浮层是自建浮层**——`Teleport` 到 body + `getBoundingClientRect` 算位置 + 300/150ms 悬停定时器 + resize/scroll 重定位监听 + 自己的 `z-index: 9999` / 背景 / 边框 / 阴影 / 圆角 / 入场动画，而 `a-popover`（底层就是 `a-trigger`）这六件事全部提供（`trigger.js` 有 `mouseEnterDelay` / `mouseLeaveDelay` / `autoFixPosition` / `clickOutsideToClose` / `popupHoverStay` / `unmountOnClose`）。② 圆角三个别名各自写死 `4px`，而 Arco 有官方档 `--border-radius-medium: 4px`（`es/style/index.css`）——同值但来源不同，库改档我们不跟。③ 四个 token **零读者**：`--dur-med` / `--ease-jelly` / `--shadow-dropdown` / `--z-overlay`（帮助面板改挂库组件后，`--z-overlay` 与 `--shadow-dropdown` 失去最后的消费者），但中英规范里还写着「自建浮层仅剩两处」「层级三档」——死字段配着活声明，读文档的人会以为还有这套体系。④ 其余 23 处「给 Arco 内部节点写配色」确实是有据偏离（库无对应 prop，或原值不达 AA），可它们只写在文档段落里，**没有任何门禁守着**——下一次改动多加一条覆写不会有人报警。
- **修复**：① 浮层改挂 `a-popover`：悬停开关与延迟、定位、视口避让、点击外部关闭、hover-stay、表面样式与层级全部交回库，只留库没给的两条（Esc 关闭——`trigger.js` 无 `escToClose`；键盘打开时把焦点移进浮层、关闭后归还触发器——它不管理焦点），`aria-expanded` / `aria-controls` 仍由我方维护（库不写）；脚本从约 90 行手写浮层机制降到约 35 行，模板删掉 `Teleport` 与 `:style` 定位。② 圆角三别名改指 `var(--border-radius-medium)`，名字只保留语义（胶囊 / 行 / 控件）。③ 删四个零读者 token，中英规范 14 处声明同步改口（批量脚本对每条锚点断言「恰好命中 1 次」，任何一条不中就整批不落盘）。④ 新增门禁第 20 条 `ARCO_COLOR_ALLOW`：17 条登记、共 23 处、每条带理由与 expect 条数；第 8 条那句「允许例外：侧边栏折叠宽度与进度条填充宽度」的注释也已按实测改掉——业务侧现在零布局属性过渡。**评估后不采纳的官方能力（逐条给库层证据，避免下一个人重新评估）**：`a-list` 内建分页（#95 已记：`list.js:212` 主动 omit 掉 `current`/`pageSize`，会丢受控能力）；`a-collapse`（其 header 不是标题元素，采纳会拆掉 #92 刚立的 `<h2>` 结构）；`a-scrollbar`（换滚动容器会拆掉 `useAutoScroll` 与 `logs-scroll.spec.ts` 钉住的 `.console` 几何与 `scrollTop` 判据）；`a-back-top`（语义是回到顶部，控制台要的是滚到底）；`a-input-search`（自带搜索按钮，我们的搜索行是 `a-input` + 官方 `#prefix` 插槽）；`a-link`（渲染 `<a href>`，Electron 里外链必须走 IPC `openExternal`，动作语义用 `a-button` 才对）；`a-form-item` 的 `labelAttrs`（#95 已记：69 个真 `<label>` 零个带 `for`）。
- **修复效果验证**：新增 `e2e/web/help-popover.spec.ts` 3 条，用**真指针与真键盘**钉住四条通道：悬停开 + 离开关（含四步指引都渲染）、Enter 开且 `document.activeElement` 落在 `.exe-help-panel` 内、Esc 关且焦点回到触发器、`aria-expanded` 随开关翻转、表面（底 / 圆角 / 阴影）来自库自己的节点。**一处取证教训**：我第一版用合成 `dispatchEvent(new MouseEvent('mouseleave'))` 量 hover 关闭，得出「离开不关」的结论——合成的 mouseleave 不驱动 Arco 的 hover-stay 状态机，是真判据缺失而不是产品缺陷；改用 Playwright 真指针（`page.hover` + `page.mouse.move`）后四条通道全通。**删除实验两组**：把 `ARCO_COLOR_ALLOW` 里 `.dl-pager` 的 marker 改错 ⇒ 第 20 条同时报「未登记命中 `DownloadCard.vue:1206`」与「登记数不符」并退出码 1（还原转绿）；`--z-overlay` 等四个 token 删除后中英两份规范里对它们的**活引用**归零（残留 14 处全部是「已删的零读者」这句说明本身，脚本按行核对过）。`pnpm style:audit` **20/20**（45 文件）、`pnpm e2e:web` **81** 条、`vue-tsc --noEmit` 干净、`pnpm test` core 442 + ui 100、`pnpm lint` 全绿。规范落点：§7.5.1（圆角取官方档、时长两档与层级两档）、§7.5.6（自建浮层归零）、§7.5.8（浮层一律用库组件那条）。




### 97. 全局图标语义审查：「上一级」长得和「打开目录」一样（一名一图被打破），并把图标名收进类型 — 🟢 已修复（2026-10-07）

- **位置**：`packages/ui/src/components/common/Icon.vue`（字形表已抽出为同目录 `icon-map.ts`）、`components/common/FileBrowserModal.vue:166`（`picker_up`）、`pages/ModelsPage.vue:20`（页签图标）、`components/presets/PresetsPanel.vue:203`（应用预设）、`pages/SettingsPage.vue:95`（「更改即时保存」提示）、`features/types.ts` 与四处 `icon: string` 声明、`scripts/style-audit.cjs`（新增第 21 条）。
- **描述**：用户批注「全局图标审查，是否还有类似的语义偏差图标」，指的是文件浏览器的「上一级」按钮——它用 `folder_open`，而 `folder_open` 与 `folder` **映射到同一个 Arco 字形**（纯文件夹），于是「上一级」「打开目录」「更改目录」三件事共用一个图形，用户批注的那个 28×28 按钮看着就是「又一个文件夹」。全量对账（把每个 `<Icon>` 与它承载的动作文案配到一行：104 处使用 / 28 个字形）另查出四类：① **应用预设借用 `play`**——同一个三角形既表示「启动 llama-server」又表示「把预设应用到参数」，是两个动作；② **设置页「更改即时保存」用软盘 `save`**——软盘暗示「要点它保存」，而这句话的意思是不需要点；③ **`clock` 零读者**——#74 起 bench 已改用烧杯，名字与 import 都还在，等于每个进包的人都要白读一个永不使用的字形；④ **最严重的一类是静默**：`Icon.vue` 的取值是 `icons[name] ?? IconQuestionCircle`，名字不存在就画一个问号，**没有任何报警**。真机扫七页实测命中一处：模型页「本地模型」页签的 `icon: 'folder_open'`——它写在 `TABS` 数组里、由 `:name="t.icon"` 动态绑定，我删掉 `folder_open` 别名的同一刻它就成了问号，而 `vue-tsc`、`pnpm lint`、81 条 e2e 全都没响。
- **修复**：① 新增 `chevron_up: IconUp`（Arco `icon-up`，与已用的 `icon-down/left/right` 同族），「上一级」改用它；四处「打开目录」归到 `folder`；`folder_open` 别名删除。② 应用预设改 `check`。③ 「更改即时保存」改 `check_circle`，`save` 失去最后读者后连同 import 一起删。④ 删 `clock` 与 `IconClockCircle` import。⑤ **把「靠人记」换成「靠编译器和门禁」**：字形表从 `Icon.vue` 抽成 `components/common/icon-map.ts`，`export type IconName = keyof typeof icons`，`Icon.vue` 的 `name` prop 与六处 `icon: string`（`features/types.ts` 的导航表、模型/参数/设置三页的 `TABS`、日志页 `LEVELS`、GeneralPanel 的状态徽章）全部收紧成 `IconName`——错名从此在 `vue-tsc` 阶段就是类型错误，运行期问号只剩动态拼串这一种可能（兜底仍在）。⑥ 新增门禁第 21 条：一个字形挂多个名字即报、语义名零读者即报，并且**自证解析规模**（只解析到 <20 条就报「解析器与文件形状脱节」，防止门禁自己空转）。
- **修复效果验证**：真机逐处复测字形 class：上一级 = `arco-icon-up`、应用预设 = `arco-icon-check`、设置页提示 = `arco-icon-check-circle`、打开目录 = `arco-icon-folder`；七页 `.arco-icon-question-circle` 计数 **0**（改前模型页 1 处，即上面那条静默退化）。`vue-tsc --noEmit` 在 `IconName` 收紧后仍干净（说明全站无错名）。**删除实验两组**：把 `folder_open: IconFolder` 贴回映射表 ⇒ 第 21 条同时报「一个字形挂了 2 个语义名」与「语义名 folder_open 零读者」并退出码 1；把检查里 `entries.length < 20` 的自证门槛当回归用——第一版解析器只匹配到 9 条（`^\s*` 锚点漏掉一行多条的写法），**门槛立刻把它抓了出来**，否则这条门禁会以「零命中=绿」的假象上线。**另记一次自己的取证失误**：我第一版图标对账脚本用 shell 内嵌 node 跑，正则里的引号被吞，得出「41 个名字全部零读者、无一复用」的**双假结论**（真值是 1 零读者 + 1 复用）；改写成落盘文件后才对上——这条已按仓库惯例记在这里。`pnpm style:audit` 21/21、`pnpm test` core 442 + ui 100、`pnpm e2e:web` 81 条、`pnpm lint` 全绿。规范落点：§7.5.8「图标语义对账」一条 + §7.4 组件表 `Icon` 行改写。


### 100. 引擎提示行本体对齐官方组件：自绘警示行换 a-tag closable — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/components/settings/GeneralPanel.vue`（引擎提示行本体）。
- **描述**：用户再次批注「审查提示样式是否符合arco官方档」。#99 后提示行仍剩三处自绘：行布局（flex + 图标 + 文字）、警示色（`--fg-warning-text` 角色档）、忽略钮（a-button ×）。官方对「可关闭提示」的原生答案是 `a-alert`（type / show-icon / closable），实测其结构是横幅——`width: 100%`、14px 字号、`8px 15px` 内距全部硬编码，塞进引擎目录行尾必须覆写内部样式并推翻用户已定的行内形态，**评估后不采纳**（库层证据：三条硬编码与行内场景直接冲突）；内联兼容的官方组件是 `a-tag closable`（官方关闭钮内建 `role="button"` + `aria-label`，与相邻状态胶囊同族）。
- **修复**：提示行本体换 `a-tag closable`（warn=orange / info=gray 官方预设色对，`size="small"` + `nowrap`，图标走 `#icon` 槽），自绘行布局 / 角色色 / 忽略钮全删；忽略指纹逻辑不变（`@close` → 长句全文入 `settings.engine_hint_dismissed`，新消息照常出现）；`btn_dismiss_hint` 键失去读者删除（官方钮的 `aria-label="Close"` 为库内硬编码，非本地化——接受，官方组件行为）。对比度注记：预设对取代 #99 的角色档，是「文字进了官方组件」后采用官方配对，同 StatusTag 先例。
- **修复效果验证**：drift 演示场景实测 tag 314px 官方 `arco-tag-orange` 预设类生效、关闭钮 `role="button"` + `aria-label="Close"` 就位、点关后指纹入库且标签消失；`pnpm style:audit` 全绿、`pnpm e2e:web` 81 条全绿。

### 109. 模型下拉条目补齐图标：与 URL 历史下拉同族对齐 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/components/layout/TopBar.vue`（模型下拉的「管理模型…」动作项与 6 个模型条目）。
- **描述**：用户批注「其他下拉栏存在的图标缺失了」。全站下拉的条目图标约定由 URL 历史下拉确立（每条目前置一枚弱化色图标：link、11px、text-3、不收缩），而模型下拉的「管理模型…」与全部模型条目均无图标——同族组件形态分裂。
- **修复**：① 「管理模型…」前置 `models` 图标（12px，语义 = 指向模型管理页，与侧栏 Models 入口同字形）；② 每个模型条目前置 `file` 图标（12px，语义 = gguf 模型文件）；③ 着色 / 收缩约定照搬 URL 历史下拉（`.dd-icon { flex-shrink: 0; color: var(--color-text-3) }`——弱化色不与正文争抢）。
- **修复效果验证**：`pnpm style:audit` 22/22、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿；drift 场景实测 7 枚图标全部渲染（text-3 弱化色）、管理项与模型行同构。

### 108. 模型下拉顶部动作项回归普通 option 形态：斜体灰自绘层级样式删除 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/components/layout/TopBar.vue`（模型下拉顶部「管理模型…」动作项）、`scripts/style-audit.cjs`（`ARCO_COLOR_ALLOW` 删 `.dd-manage` 死登记）。
- **描述**：用户批注「优化下拉栏顶部（非菜单）的样式，目前实现和其他下拉栏样式存在明显差异」。TopBar 模型下拉的顶部「管理模型…」动作项被手绘成**斜体 + `--color-text-2` 灰**的特殊形态（自绘「层级区分」：与同列表的模型名条目视觉分层），与全站其他下拉的顶部形态（URL 历史下拉 = 官方 `a-dgroup` 组标题 + 普通选项）明显不同。
- **修复**：删 `.dd-manage` 的斜体与特殊配色（宽 360px 共享规则保留）→ 动作项回归普通 option 形态，与同面板模型条目及全站下拉一致；「层级区分」由既有分隔线承担（动作项与模型列表间的 `dd-divider` 本就存在）；`ARCO_COLOR_ALLOW` 删 `.dd-manage` 死登记（账本跟现实）。
- **修复效果验证**：`pnpm style:audit` 22/22（登记数与实测数恢复相等）、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿；drift 场景实测——管理项正体（italic normal）、官方 option 文字色（text-1）、360px 同宽、分隔线保留。

### 107. 日志页卡片化：全站最后一个内容裸页面换官方 Card 基座 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/pages/LogsPage.vue`（筛选行 + 控制台 + 计数条整页内容）。
- **描述**：用户批注「优化卡片化，按arco官方档实现」。概览卡片化（#106）后，日志页成为全站最后一个内容裸在页面上的页面——筛选行 / 提示条 / 控制台 / 计数条直接铺在 page-frame 上，无卡片边框与内距，与其余六页（内容皆在官方 Card 内）范式分裂。
- **修复**：整页内容包进官方 `Card`（**无标题卡**——页级 h1「日志」已存在，加卡标题即与 h1 重复）。弹性链逐环打通：page-frame → 卡（`flex: 1 1 auto; min-height: 0`）→ 卡体（`:deep(.arco-card-body)` 转弹性列 + min-height 0）→ console-wrap → ConsolePanel（console-fill），每环 min-height: 0 缺一环即溢出（#82 骨架链纪律）；筛选行 / 提示条 / 计数条依次排在卡体内，边框 / 底 / 内距交回库。
- **修复效果验证**：`pnpm style:audit` 22/22、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿（logs-scroll 的 `.console` 几何与滚动判据、layout-stability、窄视口判据携新结构通过）、ui 103 / core 442 测试全绿；实测卡高 786px 撑满页面剩余高、控制台在卡体内填充（consoleFills）、无重复 h2。

### 106. 概览应用操作日志换官方 Card 基座：自绘 .q-section 裸标题区删除 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/pages/DashboardPage.vue`（应用操作日志区）。
- **描述**：用户批注「参考其他卡片样式进行优化，注意前端范式」。同页服务状态卡是官方 `Card` 组件（卡片头 / h2 / 边框 / 体边距全由库承载），而应用操作日志区是自绘 `.q-section` + 裸 `.q-title` h2 + 手写间距（padding-top/bottom 14px 手调分隔节奏）——同一页面两种卡片形态。
- **修复**：换官方 `Card title-key="card_dash_applog"` 基座（标题 h2 / 卡片头 / 边框 / 体边距 / 卡间 16px 全交回库）；`.q-section` / `.q-header` / `.q-title` / `.card + .q-section` 四组自绘样式删除；恒深控制台与错误时的「日志 / 服务」跳转按钮原样保留在卡体内（`useAutoScroll` 定高小窗机制不变）。
- **修复效果验证**：`pnpm style:audit` 22/22、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿（semantics 的 h2 计数与卡片标题判据携新结构通过）、ui 103 / core 442 测试全绿；实测 `.section-card` 计数 2（状态卡 + 日志卡）、日志卡 h2 =「应用操作日志」、深底控制台在卡体内。

### 105. 范式纯化裁定：官方组件上的角色色修正层全部回归官方预设配对 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/pages/ParamsPage.vue`（「N 项已改」tag 文字色、已调整 / 显存两个 stat 的值色覆写）、`packages/ui/src/components/models/LocalModelsPanel.vue`（`badge-gray/arcoblue/orange/red` 四条文字覆写）、`scripts/style-audit.cjs`（`ARCO_COLOR_ALLOW` 同步删两条死登记）。
- **描述**：用户对 #104 终态裁定的追问——「那些不建议做的是否是自绘 arco 范式，这也是非预期的」。核实属实：`subcat-changed` / `.warn` 统计值 / `badge-*` 都是**骑在官方组件上的自绘配色层**（为 AA 而生，但形态即非官方）。**范式纯化与 AA 的冲突裁决（用户方向性裁定）**：「跟随库官方观感」豁免（§7.5.2 先例）延伸至 tag 预设配对——预设对的对比度差距（浅色 2.41~4.2）如实登记为已接受的官方观感，角色色修正层全部删除。
- **修复**：① `subcat-changed` 文字覆写删除 → tag 回归纯 orange 预设；② LocalModelsPanel 四条 `badge-*` 删除 → 徽章回归纯预设（`:color` 预设承载全部配色）；③ ParamsPage 两个 stat 的值色覆写删除 → 统计值回归官方配色，显存超限的警示信号改由官方 `a-tag color="orange"`「超限」（新键 `lbl_vram_over`）承载；④ `ARCO_COLOR_ALLOW` 删 `.stat` / `.subcat-changed` 两条死登记（登记数与实测数恢复相等——账本必须跟着现实走）；⑤ 占位态 `muted` 次级灰覆写一并删除。**保留终态（非组件平行，#104 裁定不变）**：ParamRow `--warn` 描边（与 Arco 表单校验同型的边框态）、中性灰提示行（token 着色文字）、TopBar 关闭钮红 hover（a-button 基座 + 官方 token，窗口铬语义）。
- **修复效果验证**：`pnpm style:audit` 22/22（`ARCO_COLOR_ALLOW` 登记数与实测数恢复相等）、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿、ui 103 / core 442 测试全绿；all-ram 等 4 个演示场景均不触发 `fits === false`（演示模型永不超限），超限 tag 的 `v-if` 路径与图标绑定对称、真实超限时自然显示。

### 121. 扩展参数输入框高度裁切三行示例占位 — 🟢 已修复（2026-10-09，用户批注「优化输入框高度，完整展示示例文本」）

- **位置**：`packages/ui/src/components/service/CommandPreviewCard.vue`（`.cmd-extra` 扩展参数框）。
- **描述**：多行示例占位（三行：说明行 + `--no-warmup` + `--special`）需要 3×19.5 行高 + 16px 内距 + 2px 边框 ≈ 77px，而 Arco auto-size 按 3 行给的行内高度是 54px——示例第三行被裁掉，用户看不到「一行一个」的示例形态。
- **修复**：`.cmd-extra :deep(.arco-textarea) { min-height: calc(4.5em + 18px) }`——CSS min-height 恒定胜过 auto-size 写入的行内 height（54px），占位完整可见；有内容时 auto-size 的行内高度照常长大、不再受此下限约束。
- **修复效果验证**：mock 页实测输入框高度 54 → 77px（= 计算所需值），占位三行完整渲染；`pnpm style:audit` / `pnpm lint` 全绿。

### 120. 设置页摘要条预留宽死区（首项静态提示也被 132px 预留）— 🟢 已修复（2026-10-09，用户批注「优化间距」）

- **位置**：`packages/ui/src/pages/SettingsPage.vue`（`.status-summary` 三条摘要项）。
- **描述**：`.summary-label` 全局 `min-width: 132px` 防状态切换抖动，但首项「更改即时保存」是**静态提示**（从不换状态）——132px 预留成了它与下一项之间 ~48px 的死区，实测三项视觉间距 58/44/48 不齐。
- **修复**：**二次修正**——首版把预留收窄到 2/3 项仍不齐：预留箱宽于当前文案时死区落在项间（132px 箱 vs 「模型目录不存在」84px 文案 = 视觉间距 10/44），预留宽与均间距在流式布局里不可兼得；终案**彻底去掉 min-width 预留**，三条 label 全部贴合自然宽度，状态文案切换（检测中 → 就绪/缺失）时末项一次性横移文案宽度差（≤ ~24px），作为代价明示接受。
- **修复效果验证**：mock 页实测三条 label 全自然宽（72/84/72）、文字到图标的视觉 gap = 10/10 完全齐平；`pnpm lint` + `pnpm style:audit` 全绿。

### 119. 下载卡文件行徽章列错位 + 来源徽章混入标题体例 — 🟢 已修复（2026-10-09，用户批注「修复内容错位，并确保该问题不会影响到生产环境」）

- **位置**：`packages/ui/src/components/common/DownloadCard.vue`（`.file-item` 文件行与 `.files-header`）。
- **描述**：① 文件行的量化/类别/推荐徽章位置随文件名长短漂移（实测三行 cat 列 x = 851/820/742，散布 109px）——成因是双重的：`.file-name { flex: 1 }` 被 ToolTip 宿主（`.tooltip-host` flex: 0 1 auto）架空，名字不吸收自由空间；行又继承 Arco list-item 的 `space-between`，把剩余空间均匀摊到徽章上。只有 file-size 因右对齐幸免。② 来源徽章写在 `.section-title` **内部**，继承组标题的 `uppercase` 体例渲染成「MODELSCOPE」，混进标题文本。
- **修复**：① `.file-item` 显式 `justify-content: flex-start`；名字宿主用 `:deep + :has` 反查（`.file-item :deep(.tooltip-host:has(> .file-name))`）赋 `flex: 1 1 auto`——:deep 必需，宿主 span 只带 ToolTip 自己的 scope 属性，本组件 `[data-v]` 落不到它头上（第一版裸 `:has` 选择器即因此全然无效）；推荐徽章移到量化徽章之前，量化/类别/大小右列成列；`.file-size` 定宽 56px 右对齐（KB/GB 文本宽度不同会带漂列）。② 来源徽章移出标题、改为 `.header-main` 分组的兄弟节点（uppercase 不再漏入；组内 gap 8px，与右侧打开页按钮由 space-between 分居）。
- **修复效果验证**：**e2e 新增 ⑥ 判据（中英双语）**：驱动 mock 下载流到文件列表，断言 cat/quant/size 三列右缘跨行一致（容差 2px）+ 来源徽章已移出标题且非 uppercase——e2e 跑在**生产构建**上，判据红即挡在生产之前；删除实验：撤掉 `:has` 宿主规则 ⇒ ⑥ 双语转红，恢复 ⇒ 绿（首轮红牌还抓出恢复脚本把规则插进注释中间致规则失效的次生错误）。`pnpm style:audit` 24 条全绿、`pnpm lint` + ui/core 测试全绿。

### 118. 清理卡失败明细的原生 title 残留（#101 同日新增代码漏网）— 🟢 已修复（2026-10-08，用户裁定「修复，不允许维护两套逻辑」）

- **位置**：`packages/ui/src/components/settings/TrashCleanCard.vue:163`（`<span class="trash-fail-path" :title="f.path">`——清理结果失败明细的截断路径）。
- **描述**：子代理全站审查（2026-10-08，用户要求「审查是否还有交互未迁移 Arco 官方档」）确认的全站唯一残留：超长路径 CSS 截断（ellipsis）后用**原生 `title`** 承载完整值，且处在 `v-for` 数据条目上——恰是 §7.5.6 收窄边界（#101）明令清零的「截断值提示」类。考证 `git show 5829030`：这块失败明细是 #101 迁移提交**同日新写**的代码，迁移扫描漏掉了自己新增的行，提交里「现存 `:title=` 仅 3 处组件 prop + 1 iframe」的声明当场失真（修复前实测 7 处：合规组件 prop 5——DownloadCard a-dgroup 与 4 处 a-statistic + 违规 span 1 + 合规 iframe 1）。`style-audit` 对原生 title 零规则，#101 属一次性人工清扫无门禁兜底，正是残留存活的结构原因。其余类别（裸元素点击/原生表单控件/自绘浮层/手搓选择语义/裸超链接/控制台区交互）经全量正则扫描全部干净。
- **修复**：① span 外包 `ToolTip`（`:text="f.path"`，`.tooltip-host` inline-flex + min-width:0 宿主盒；`.trash-fail-path` 原有 flex 收缩与 ellipsis 不变），删除 `:title`；② **门禁固化**——`style-audit` 新增第 24 条「原生 title 禁令」：模板内 title/`:title` 宿主只允许 `a-*` 组件（官方 title prop）与 iframe，其余一律报错并指认标签名；自证解析规模（合法命中 < 6 即报尺子变形，修复后实测 6 处）；③ frontend.md §7.5.6 与本条计数声明修订为实测值（6 处），并补记 #115 轮漏改的「⑥ 固定高筛选控件仍写分段单选组」一句。
- **修复效果验证**：删除实验——`:title` 贴回 ⇒ 第 24 条红并指认 `TrashCleanCard.vue` 的 `<span>`，撤掉 ⇒ 绿；`pnpm style:audit` 24 条全绿、`pnpm lint` + ui 测试 + e2e 全绿；失败明细行仅在清理出现失败时渲染（mock 恒成功，视觉路径由模板与 ToolTip 既有范式保证，ToolTip 组件的宿主盒几何已有 #99/#101 两轮实测）。

### 117. GGUF 建议芯片的「点击应用」未走官方 checkable 交互 — 🟢 已修复（2026-10-08，用户裁定「偏离完全修复」）

- **位置**：`packages/ui/src/components/params/ParamRow.vue`（`.gguf-hint` 芯片，applicable 档 `@click` 触发 `applyGgufHint`）。
- **描述**：用户要求审查「模型内置值展示是否符合 Arco 官方档」，实测结论分两层。**视觉完全官方**：`color="arcoblue"` 渲染即官方预设原对——浅色底 rgb(232,243,255) / 字 rgb(22,93,255) ≈ 4.6:1，深色底 rgba(104,159,255,.2)（合成底 ≈ rgb(39,50,72)）/ 字 rgb(104,159,255) ≈ 4.9:1，双主题 ≥4.5 达标；DOM 上的 `arco-tag-checked` 是 Arco 给全部非 checkable tag 自挂的类（es/tag/tag.js 非 checkable 分支恒 true），不是手写覆写（#61 那类历史问题不存在）；h20 / 12px / 内距全为官方 `size="small"` 原生；自定义样式仅 mono 字体（§7.5.1 数值 mono）+ ellipsis/nowrap（布局卫生）+ cursor help/pointer（光标词汇），零配色覆写（审计第 1/12/18/20 条全绿）。**交互偏离一档**：可点档承载「点击 = 写入该值」动作却未用官方 `checkable`——悬停无底色反馈（官方 checkable 有 `bg_hover` + transition，非 checkable 分支无任何 ：hover 规则）、span 无 tabindex 键盘不可达；缓解事实：芯片只是快捷路径，旁边参数控件本身键盘完备，无功能排他（规则 16a 合规——点击挂在 Arco 组件上）。
- **修复**（按建议①）：applicable 档挂 `:checkable="hasGgufSuggestion"` + `:checked="hasGgufSuggestion"`——checkable 只挂可点档（`checked` 恒 true 保住 arcoblue 配色，点击语义仍由既有 `@click` 承担、`@check` 不接管），即获官方 `tag-arcoblue-color-bg_hover` 悬停底色与过渡；只读档保持非 checkable（不加 hover 假可供性，`cursor: help` 词汇不变）。键盘缺失维持豁免：Arco Tag 渲染不透传 $attrs（源码 createElementBlock 的 props 无 $attrs 展开，tabindex 挂不上），且芯片是快捷路径非唯一路径。
- **修复效果验证**：`pnpm style:audit` 全绿（无新增配色覆写）、`pnpm lint` + ui 测试 + e2e 81 条全绿；mock 页实测——悬停 applicable 芯片底色变官方 hover 档、移出复原，只读档悬停无反馈（cursor help 不变）、配色几何与修复前逐像素一致，点击应用值链路不变。

### 104. 空态范式统一：五处自绘「图标 + 文案」空态换 a-empty 官方组件 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/pages/LogsPage.vue`（控制台空态）、`pages/DashboardPage.vue`（应用日志小窗空态）、`components/common/DownloadCard.vue`（任务空态，38 档配对槽）、`components/common/FileBrowserModal.vue`（a-list `#empty` 四态）、`components/service/TrashCleanCard.vue`（扫描空结果）、`components/common/icon-map.ts`（`empty` 字形零读者删除）。
- **描述**：用户裁定「项目整体仅保留一套前端范式（arco）」，对历轮评估中「保留」的项要求给出迁移方案并最终迁移。全站空态两套范式并存：PresetsPanel 用官方 `a-empty`，其余五处自绘「图标 + 文案」。
- **修复**：五处全部换 `a-empty` + `:description`。档位适配三式：① 日志页大控制台用默认插图（描述色取官方 gray-5 配对——恒深底实测可读，不另写 Arco 节点配色，规则 20 零登记面）；② 概览小窗压插图至 40px；③ DownloadCard 38 档与 FileBrowserModal 紧凑面板隐藏插图只留描述行（38 档几何由 min-height 保证，layout-stability ④ 判据「两槽同高」不改自明）。错误态（fb-error）保留语义着色于 `#description` 槽内。`empty` 字形失去唯一读者，按 icon-map 规则 ② 连 import 删除（规则 21 自证通过）。
- **探索后不迁移的终态裁定（用户要求的「进一步探索」部分）**：① `badge-orange/red` / ParamsPage 统计与计数标签的角色色文字——它们是**官方组件上的 AA 对比度修正层**（预设对 2.41~4.2 不达 §7.5.8 的 4.5），删除即无障碍倒退，Arco 无高对比文字变体，此层即终态；② ParamRow `--warn` 描边——与 Arco 表单校验（a-form-item 校验态加边框）同一机制模式，已是官方惯例形态；③ 中性灰提示行——Arco 无 Hint 组件，token 着色文字非组件平行，a-typography-text 包装无视觉与语义增益；④ TopBar 关闭钮红 hover——a-button 基座 + 官方 `--danger-6` 调色板 token，已是官方范式（窗口铬语义，Arco 无窗口组件）。
- **修复效果验证**：`pnpm style:audit` 22/22（注释中的「#103」两次被 hex 正则误报为裸色、措辞规避后通过——误报形态已记 #103）、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿（layout-stability ④ 判据携新空态通过）、ui 103 / core 442 测试全绿；日志页清空后 a-empty + 「暂无日志」实测（mock 喂流 2.5s 一行，探窗须在清空后同帧）。

### 103. 同族清扫第二轮：下载任务状态文字换 StatusTag、预设应用提示换 a-alert — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/components/common/DownloadCard.vue`（任务行状态文字）、`packages/ui/src/components/presets/PresetsPanel.vue`（应用提示）。
- **描述**：用户批注「进一步审查是否还有类似的自绘组件」。全站语义色扫描后两处真平行：① 下载任务行的状态文字（`STATUS_COLOR` 映射五档语义色 + 内联 `:style` 上色）——与 ServiceStatusCard 的 StatusTag 完全同族；② 预设应用提示（自绘 success 底/边/字色盒）——官方 `a-alert` 的完整平行实现。
- **修复**：① 任务状态换 `StatusTag`（本仓自己的 a-tag 预设封装）：queued=gray / downloading=loading（arcoblue + 官方转圈）/ paused=warn / completed=ok / error=error，`STATUS_COLOR` 映射与 `statusColor()` 删除；② 应用提示换 `a-alert type="success"`（官方成功横幅，配色 / 圆角 / 内距交回库）。
- **评估后保留（非平行，记边界）**：`FileBrowserModal .fb-error`（a-list `#empty` 官方槽内的空态错误文字）、ParamsPage 显存估算超限警示（数据值警示非状态芯片）、LocalModelsPanel `badge-orange/red`（a-tag 上的对比度修正，#53 一脉）、TopBar 关闭钮红 hover（窗口铬豁免）、中性灰提示行（`.scope-hint` / `.trash-hint` / `.cmd-hint`——灰是文字样式不是状态芯片，#102 已划界）。
- **修复效果验证**：`pnpm style:audit` 22/22（期间规则 1 把注释里的「#103」当十六进制色捕获——错误positive源自审计的 hex 正则，措辞避开后通过）、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿、ui 测试 103 全绿；a-alert 横幅 drift 场景实测（官方绿 + 图标 + 文案）；StatusTag 形态由 ServiceStatusCard 同组件背书。

### 102. 状态卡警示族对齐官方组件：端点提示 / 失败横幅 / OOM 归因行换 a-tag 预设色 — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/components/service/ServiceStatusCard.vue`（端点暴露提示、失败横幅、OOM 归因 / 减负行）、`packages/ui/src/components/service/TrashCleanCard.vue`（清理结果 / 空态 / 检测失败行）。
- **描述**：用户批注「仍存在样式残留，为什么还有额外的组件使用非arco官方档」，点名概览页端点暴露提示（自绘橙字行 + `--fg-warning-text` 角色色）。同一族还有：失败横幅（自绘 danger pill）、OOM 归因 / 减负文案、清理卡状态行——全部是「图标 + 语义色文字」的自绘形态。
- **修复**：全部换 `a-tag` 官方预设色（端点提示 / OOM 归因 / 减负 = orange，失败 = red + 保留 `role="alert"`，清理空态 / 结果 = gray / green / orange），自绘配色 / 圆角 / 字重删除；#81 防跳槽位（36 / 30 / 28px）原样保留——tag 24px 在档内，e2e 的「槽高恒等于 min-height / 两档之和」判据不改自明。**库层新知识（本项目首次登记）**：Arco Tag 把默认插槽包进 `.arco-tag-text`——该包装层是 flex 项且无 `min-width: 0`，min-content 撑住不收缩，长文案 tag 在窄视口必然溢出（英文态 1024 实测 +118.7px，被窄视口 e2e 当场抓获）；解法 = 调用方 `:deep(.arco-tag-text) { min-width: 0; flex: 1; display: flex }` 放开收缩，接通内部省略链（规则 12 / 20 均不涉及：非内部态类、非配色）。`a-alert` 二次评估仍不采纳（横幅硬编码结构与 36/30/28px 档位冲突，#100 已给库层证据）。
- **修复效果验证**：`pnpm style:audit` 22/22（期间它还抓到本侧一处 `gap: 2px` 违反间距刻度，已归一 4px）、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿（含修复后的窄视口英文态）、core 测试 442 全绿。

### 101. 撤销「截断值保留原生 title」边界：剩余 28 处原生 title 全部迁 ToolTip — 🟢 已修复（2026-10-08）

- **位置**：`ServiceStatusCard.vue`（模型路径 / API 地址 / 安全提示 / OOM 文案 / 减负钮）、`SettingsPage.vue`（状态摘要两处）、`ParamsPage.vue`（性能目标建议 chip）、`AdvancedPanel.vue`（镜像输入框）、`ParamSummaryCard.vue`（参数摘要 chip，双层悬浮：键名区=flag、值区=完整值）、`PresetsPanel.vue`（模型列 + 两只行操作钮）、`LocalModelsPanel.vue`（模型名 / 徽章排 / 三只行操作钮）、`DownloadCard.vue`（URL 历史 doption、文件名 / 任务名 / 量化徽章 / 错误文本 / 打开目录钮）。
- **描述**：用户在「两个提示样式对齐官方组件」的延长线上裁定：§7.5 保留原生 `title` 的 ②（v-for 数据条目）③（截断值提示 / `a-input :title`）两类也要一并迁移——观感一致性优先于热路径与盒型顾虑。28 处 `:title=` 全部转换，仅剩 ①（组件 prop 3 处 + iframe title 1 处，本就不是浮层）。
- **修复**：统一模式 = 元素外包 `ToolTip`、删除 `:title`。三条实现要点：① 省略链免改——`.tooltip-host`（inline-flex + min-width 0）收缩时，内部带 overflow 样式的元素作为 host 的 flex 项自动截断（`.mono-val` 的 inline-block / `-webkit-box` 两档 clamp 均实测保持）；② 热路径顾虑解除——a-tooltip trigger 是惰性 hover 实例，弹层 portal 仅悬停时创建；③ 两处特殊形态——`ParamSummaryCard` 用嵌套 ToolTip 精确保留原语义（悬停键名区=flag、悬停值区=完整值），可选悬浮文案（模型徽章 `b.title?`）用 `text ?? ''` + `:disabled` 表达「无内容即禁用」。条件悬浮（状态摘要目录为空时无 tip）同用 `:disabled`。
- **修复效果验证**：现存 `:title=` 仅 3 处组件 prop + 1 iframe title；`<ToolTip` 62 处 / 20 文件；`LocalModelsPanel.test.ts` 的 title 断言改走 ToolTip props（含「伴随文件标签无悬浮文案 → text 空 + disabled」的等价判据）；`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿。规范落点：frontend.md §7.5 边界条目改写（历史两轮数据留档）。

### 99. 设置页两个提示样式对齐 Arco 官方组件：状态胶囊换 a-tag 预设色、提示长文案换 a-tooltip — 🟢 已修复（2026-10-08）

- **位置**：`packages/ui/src/components/settings/GeneralPanel.vue`（引擎状态胶囊、引擎提示）。
- **描述**：用户要求「两个提示样式需要先确认是否符合 arco 官方最佳实践」。审计结论：① 引擎状态胶囊是自绘 chip（图标 + 彩字 + 14% 浅色底 + pill 圆角）——正是官方 `a-tag` 预设色的完整平行实现，违反 §7.5「不得新增并行控件」；② 引擎提示行大部分合规（忽略钮已是 `a-button`、橙色走实测对比度角色档），但长文案挂在**浏览器原生 `title`** 上——裸样式、延迟与外观不受库控制。
- **修复**：① 胶囊换 `a-tag`：官方 `color` 预设（idle=gray / detecting=arcoblue / ok=green / missing·not_found=red）+ `size="small"` + `nowrap`，检测态用官方 `loading` prop（自带旋转动画，替换自绘 spin 图标），图标走 `#icon` 槽；自绘 chip 的全部配色 / 圆角 / 字重样式删除——对 Arco 节点零配色写入，风格审计第 20 条零登记面。② 原生 `title` 换 `ToolTip`（a-tooltip 封装）；省略链随包裹层适配（`.tooltip-host` 允许收缩 + 内层 span 转块级）。橙色保留 `--fg-warning-text` 角色档：官方 `a-typography-text type="warning"` 是裸 warning-6（压白 2.57:1），不达 §7.5.8 的 4.5 纪律——角色档正是为此而生，不换。
- **修复效果验证**：drift 演示场景实测——Tag 尺寸 106×20、官方预设类生效、提示与输入框 / 徽章同行且省略号兜底、忽略钮在位；`pnpm style:audit` 22/22、`pnpm lint` 全绿、`pnpm e2e:web` 81 条全绿。

### 98. 三处日志出口收敛为两处：日志页展示推理框架输出、概览承载应用操作日志 — 🟢 已修复（2026-10-07）

- **位置**：`packages/ui/src/pages/LogsPage.vue`（重写为框架控制台）、`pages/ServicePage.vue`（控制台卡片连脚本与样式一并删除）、`pages/DashboardPage.vue`（「最近问题」改为「应用操作日志」）、`packages/ui/src/dev/demo-mock.ts`（新增 `__mockPushConsole` 钩子）、`e2e/web/logs-scroll.spec.ts`（灌流钩子改指）、`packages/shared/src/i18n/{zh,en}.ts`（删 4 键、增 2 键）。
- **描述**：用户批注「控制台输出出口与当前日志出口应调整到日志界面，只需要输出推理框架日志即可」，并在给出两档方案后选定档 B——日志页展示框架输出、概览页承载应用操作日志，出口由三处减到两处。改前的交叉是：后端输出（llama-server 原始输出）只在「服务」页看得到，而页签名「日志」会让人以为框架在报什么能在日志页看到；反过来日志页的应用日志又与概览「最近问题」卡片同源——那张卡只筛 `error|warn` 两种级别，是同一份数据的第二种切法。排一次启动失败要开两页对时间线，且「日志」这个词在两页指两种东西。
- **修复**：① 日志页改为框架控制台：数据源是 `server` store 的 `outputs`（与「服务」页原控制台同一份），行着色沿用入队时算好的 `tone`（`TONE_CLASS` 映射，渲染期零正则），级别筛选按钮组与数据同值域（all/info/success/warn/error），搜索 / 复制全部 / 清空 / 行数统计沿用原日志页能力，提示条说明本页只承载框架原始输出。② 服务页删掉整个控制台卡片（含脚本与样式），只留命令预览 / 参数摘要 / 清理三卡——后端输出不再有第二个出口。③ 概览「最近问题」改为「应用操作日志」：取最近 24 行**全部级别**（不再只筛错误），时间 / 级别 / 正文三列与日志页同排版，出现 error 时仍给「日志 / 服务」两个去向按钮。④ 滚动与面板复用 #89 的收口（`ConsolePanel` + `useAutoScroll`），唯一新增设施是 mock 的 `__mockPushConsole` 钩子——判据要能往这一页灌「远多于一屏」的框架行。⑤ i18n 随出口搬移：删 `card_dash_issues` / `msg_no_issues` / `card_service_console` / `msg_app_logs_hint`，新增 `card_dash_applog` / `msg_framework_logs_hint`，两字典 395 键对齐（`verify-i18n-usage` 兜住悬空引用）。
- **修复效果验证**：`pnpm e2e:web` **81** 条全绿（含 logs-scroll 10 条）。两处判据随出口换源一起修正，都是「让判据继续测对对象」：① 灌流钩子从 `__mockPushAppLog` 改指 `__mockPushConsole`——沿用旧钩子会让「远多于一屏」的样本进不了本页的 `.console`，判据退化成恒等式；② 同文件「scrollTop 赋值后停在非 0 值」那条的等值断言放宽为「非 0 且不小于首读」——本页现在有 mock 的正常输出流（`startOutputFeed`，1 行 / 2.5s），跟随底部时 scrollTop 只会被推向新的最大值，要求两次读数相等等于把「有正常输出流」判成骨架回归（首跑即 7562 → 7603 全红）；删除实验（骨架退回块流 ⇒ scrollTop 恒 0）仍咬得红，判别力没丢。`verify-i18n-usage` 395/395、`vue-tsc --noEmit` 干净、`pnpm style:audit` 21/21、`pnpm test` core 442 + ui 100、`pnpm lint` 全绿（IPC 57 / 参数 69 / 版本 0.0.51 / 双树配对 15 篇 / oxlint 0 警告）。规范落点：§7.2 路由表、§7.3 三页行与 `ConsolePanel` / `appLog` 行。




## 🟢 已修复索引

本表是索引：每行「条目」列自带当年的修法与判据；更长的历史明细见本文件上方各段（#1–#53 归档原有 + 2026-10-10 并进来的 #50–#121）；修复后的规范落点见 [frontend.md §7.5](../zh/frontend.md)。

| # | 条目 | 修复日期 |
| --- | --- | --- |
| 121 | 扩展参数输入框高度裁切三行示例占位（用户批注「优化输入框高度，完整展示示例文本」）：Arco auto-size 的 3 行行内高度（54px）容不下 3×19.5 行高 + 内距 ≈ 77px，示例第三行被裁——`.cmd-extra` 加 `min-height: calc(4.5em + 18px)` 保底（min-height 恒胜行内 height，有内容时不受限），实测 54→77px 占位完整 | 2026-10-09 |
| 120 | 设置页摘要条间距优化（用户批注「优化间距」→「明显出现摘要间距不同的问题」）：`.summary-label` 全局 132px 防抖预留制造死区（视觉间距 58/44/48）；首版收窄预留到 2/3 项仍不齐（10/44）——终案彻底去掉预留，label 贴合自然宽（gap 10/10 齐平），状态切换时末项一次性横移 ≤24px 作为明示代价 | 2026-10-09 |
| 119 | 下载卡文件行徽章列错位修复 + e2e 列对齐判据（用户批注「修复内容错位，并确保该问题不会影响到生产环境」）：`.file-name` 的 flex:1 被 ToolTip 宿主架空 + 行继承 Arco space-between，徽章列随名字长短漂移（cat 列实测散布 109px）——`.file-item` 显式 flex-start、名字宿主 `:deep + :has` 反查赋弹性（宿主 span 只带 ToolTip scope 属性，裸选择器够不到）、推荐徽章前移、size 定宽右对齐；来源徽章移出 uppercase 标题（不再渲染成 MODELSCOPE 混进标题）。**生产防波 = e2e 新增 ⑥ 列对齐判据（中英双语，跑生产构建）**，删除实验双向通过 | 2026-10-09 |
| 118 | 清理卡失败明细原生 title 残留清零 + 门禁固化（用户批注「修复，不允许维护两套逻辑」，子代理全站交互审查的唯一确认残留）：`TrashCleanCard` 截断路径外包 `ToolTip` 删 `:title`（#101 同日新写代码漏网，其计数声明当场失真）；`style-audit` 新增第 24 条「原生 title 禁令」——模板内 title/`:title` 宿主只允许 `a-*` 组件与 iframe，自证解析规模（合法命中 <6 即红）；frontend.md §7.5.6 计数声明修订为实测 6 处、并补记 #115 漏改的「⑥ 级别筛选仍写分段单选组」 | 2026-10-08 |
| 117 | GGUF 建议芯片走官方 checkable 交互档（用户批注「偏离完全修复」，审查结论「视觉完全官方、交互未走 checkable」）：applicable 档挂 `:checkable` + `:checked`（恒 true 保 arcoblue 配色，点击仍走既有 `@click`），即获官方悬停底色反馈与过渡；只读档保持非 checkable 不加假可供性；键盘缺失随「快捷路径非唯一路径」豁免（Arco Tag 不透传 $attrs，tabindex 挂不上） | 2026-10-08 |
| 116 | 设置页状态摘要条分隔线退役（用户批注「内容分隔还是使用被淘汰的样式」）：`.status-summary` 三个状态项之间的 `.summary-divider`（自绘 1px×18px 竖条）与统计条/分段组分隔线同族，是全站最后一处自绘分隔——两根分隔节点与样式块删除，项间距由容器既有 `gap: 10px` 承担；全站自此再无任何自绘或 a-divider 分隔线（`grep divider` 零命中） | 2026-10-08 |
| 115 | 分段单选组全站退役，换切换按钮组（用户批注「按钮分隔还在使用被淘汰的样式」）：按钮型 radio-group（分段样式）的内建钮间分隔线与 #113 退役的统计条分隔线同族——全站仅存两处（日志页级别筛选、设置外观主题三选一）一并换成独立 `a-button` 切换组：选中 = primary 实底、其余 secondary，`role="group"` + `aria-label`（新键 `lbl_level_filter`）+ `aria-pressed` 表达单选按下态，组件间纯 `gap: 8px` 无线；不取 checkable tag 方案（Arco Tag 无 tabindex，键盘用户将无法切换级别）；AppearancePanel 原 `.theme-radio-on` 对比度修正随组消亡（primary 实底白字为 Arco 官方预设自身达标），style-audit 第 20 条登记同步删除 | 2026-10-08 |
| 114 | 日志页工具条单行编排（用户批注「优化工具条编排为单行」）：`.filter-row` 开着 `flex-wrap: wrap` 而三段内容（级别筛选 353px + 搜索框 min 200px + 两颗带文字按钮 234px + 间距）在 761px 行宽下放不下，按钮掉到第二行、行高 38→70 跳变——「复制输出 / 清空控制台」本就带 ToolTip，收成纯图标方钮（`aria-label` 补无障碍名，全站仅日志页一处、无跨页不一致），省出 ~160px 交给搜索框；`.filter-row` / `.level-filter` 两处 `flex-wrap` 删除（五钮是一组刚性筛选，组内折行只会更难看），搜索框 `min-width` 200→140 兜底。窗口最小宽 1024（window.ts 契约）下三段合计 ~440px，单行恒放得下；narrow-viewport e2e 的 /logs 1024 判据守零溢出 | 2026-10-08 |
| 113 | 统计条分隔线全站退役（用户批注「去掉分割样式，目前部分组件之间有分隔线，部分没有，这是不符合前端统一的语言」，前一轮「清理静态统计时也需要清理间隔」为其直接成因）：参数页状态条删完两个静态统计后，残留的 `stat-divider` 只隔在「已调整 ┆ 显存占用」之间，后面的目标选择器 / 折叠总控 / 全部重置之间全无分隔——同一容器内半有半无。全站仅存的两处统计条分隔线（参数页状态条 + 模型管理统计行）一并删除，两处 `.stat-divider` 样式与「a-divider 分隔」注释清理（零读者样式不留），组件间距由容器既有 `gap: 12px` 承担；frontend.md §7.5「分隔线节奏」的区块分隔规范不受影响（那是 border 机制，非 a-divider） | 2026-10-08 |
| 112 | 参数页重置入口收敛单钮（用户批注「清理会话参数按钮、恢复基线按钮用户体感混淆，应只做全部重置按钮，并且将重置逻辑对齐当前支持的参数的默认值」）：「恢复基线」（回基线快照，无基线灰掉）与「清除会话参数」（回出厂默认）并排双钮回退目标不同但外观一致，且「恢复基线」的可用性取决于用户感知不到的基线状态——收敛为单一**「全部重置」**，重置目标即当前 `PARAMS` 表全部条目的 `default`（原 `clearSession` 语义：保留模型选择、清空基线），确认弹窗换明确文案；禁用条件只看「无基线且无修改」（有基线时参数与基线一致但基线≠默认，重置仍有意义）。`restoreBaseline` 动作与 `msg_restore_baseline` / `msg_clear_session` 键随双钮删除（零读者不留），新增 `btn_reset_all` / `msg_reset_all_confirm`；store 测试同步（恢复基线用例段移除）；params-system / frontend / testing / design-decisions 四篇与 AGENTS.md 双语同步 | 2026-10-08 |
| 111 | 模型下拉收敛为纯模型清单（用户批注「模型选择菜单不需要额外出现管理模型选项」）：「管理模型…」动作项与其分割线删除，到模型管理页的导航由侧栏承担；`onSelectModel` 的空路径分支（原管理项入口）随之移除，`router` 仅剩内置 Web UI 一处读者；`.dd-manage` / `.dd-divider` 样式与 360px 宽度共享选择器一并清理（零读者样式不留；`lbl_manage_models` 键在服务页还有读者，保留） | 2026-10-08 |
| 110 | 下拉触发钮的箭头从死槽里救回（用户批注「过长的名称省略逻辑正常，但下拉栏仍看不到下拉箭头」）：TopBar 模型下拉与参数页性能目标按钮的尾箭头一直写在 `<template #suffix>` 里，而 a-button 官方只有 icon/default 两个槽——Vue 对未声明的槽静默丢弃、无警告无渲染，箭头自 Arco 迁移首日（6564de7）起就从未出现过（也是前几轮「下拉栏缺图标」观感反复的真因之一）；两处箭头改挂默认槽，尾间距自理并对齐官方前导图标 margin 节奏（medium 8px / small 6px）。守卫：style-audit 新增第 23 条（a-button 块内出现 #suffix / v-slot:suffix 即红；块内 HTML 注释不参与判定；解析规模自证 ≥30 块、实测 67），删除实验：贴回 `#suffix` ⇒ 红 | 2026-10-08 |
| 100 | 引擎提示行本体对齐官方组件（用户批注「审查提示样式是否符合arco官方档」）：#99 后提示行仍剩行布局 / 角色色 / 忽略钮三处自绘——官方 `a-alert` 是横幅（width:100%、14px、8/15 内距硬编码）与行内形态冲突，评估后不采纳；换 `a-tag closable`（warn=orange / info=gray 官方预设 + 官方关闭钮内建 role="button"/aria-label + `#icon` 槽 + `nowrap`），自绘行布局 / 角色色 / 忽略钮全删，忽略指纹逻辑不变（@close 入库）；`btn_dismiss_hint` 键失去读者删除（官方钮 aria-label="Close" 为库内硬编码） | 2026-10-08 |
| 109 | 模型下拉条目补齐图标（用户批注「其他下拉栏存在的图标缺失了」）：全站下拉的条目图标约定由 URL 历史下拉确立（每条前置弱化色图标），模型下拉全部条目无图标——「管理模型…」前置 `models`（12px，指向模型管理页）、模型行前置 `file`（12px，gguf 文件），着色 / 收缩约定照搬（`.dd-icon`：text-3 弱化、不收缩） | 2026-10-08 |
| 108 | 模型下拉顶部动作项回归普通 option 形态（用户批注「优化下拉栏顶部（非菜单）的样式，目前实现和其他下拉栏样式存在明显差异」）：「管理模型…」动作项的手绘斜体灰形态（自绘层级区分）删除，回归普通 option（正体 + 官方文字色），与同面板模型条目及全站下拉（URL 历史下拉 = dgroup 组标题 + 普通选项）一致；层级区分由既有分隔线承担；`ARCO_COLOR_ALLOW` 删 `.dd-manage` 死登记 | 2026-10-08 |
| 107 | 日志页卡片化（用户批注「优化卡片化，按arco官方档实现」）：概览卡片化后日志页是全站最后一个内容裸页面——整页内容（筛选行 / 提示条 / 控制台 / 计数条）包进官方 `Card` **无标题卡**（页级 h1「日志」已存在，加卡标题即与 h1 重复）；弹性链逐环打通（page-frame → 卡 → 卡体 → console-wrap → console-fill，每环 min-height: 0），卡片撑满页面剩余高、控制台填充卡体（实测卡高 786、consoleFills） | 2026-10-08 |
| 106 | 概览应用操作日志换官方 Card 基座（用户批注「参考其他卡片样式进行优化，注意前端范式」，点名自绘 `.q-section` 裸标题区与同页官方 Card 状态卡的形态分裂）：换 `Card title-key="card_dash_applog"`（标题 h2 / 卡片头 / 边框 / 体边距 / 卡间 16px 全交回库），`.q-section`/`.q-header`/`.q-title`/`.card + .q-section` 四组自绘样式删除；恒深控制台与错误跳转钮原样保留在卡体内（useAutoScroll 定高小窗机制不变） | 2026-10-08 |
| 105 | 范式纯化裁定：官方组件上的角色色修正层全部回归官方预设配对（用户对 #104 终态的追问「是否是自绘 arco 范式，这也是非预期的」；「跟随库官方观感」豁免从按钮文字延伸至 tag 预设配对，对比度差距 2.41~4.2 如实登记为已接受官方观感）：`subcat-changed` 文字覆写、LocalModelsPanel 四条 `badge-*`、ParamsPage 两个 stat 的值色覆写全删（显存超限警示改由官方 orange tag「超限」承载，新键 `lbl_vram_over`）；`ARCO_COLOR_ALLOW` 删两条死登记（账本跟现实）；占位态 muted 灰一并删除。保留终态（#104 裁定不变）：ParamRow 描边（Arco 校验同型）/ 中性灰提示行（文字非组件）/ TopBar 红 hover（窗口铬） | 2026-10-08 |
| 104 | 空态范式统一（用户裁定「项目整体仅保留一套前端范式（arco）」，要求对历轮保留项给方案并最终迁移）：五处自绘「图标 + 文案」空态换 `a-empty` + `:description`——日志页默认插图（描述色取官方 gray-5 配对）、概览小窗插图压 40px、DownloadCard 38 档与 FileBrowserModal 隐藏插图只留描述行（槽几何不变、layout-stability ④ 判据不改自明）、TrashCleanCard 同式；`empty` 字形失去唯一读者按规则 ② 删除。**探索后不迁移的终态裁定**：`badge-orange/red` 与 ParamsPage 角色色文字 = 官方组件上的 AA 对比度修正层（删除即倒退 §7.5.8）；ParamRow `--warn` 描边 = 与 Arco 表单校验同型的边框态；中性灰提示行 = token 着色文字非组件平行；TopBar 关闭钮 = a-button 基座 + 官方调色板 token（窗口铬语义，Arco 无窗口组件）——**其中 AA 修正层已于 #105 二次裁定回归纯预设** | 2026-10-08 |
| 103 | 同族清扫第二轮（用户批注「进一步审查是否还有类似的自绘组件」）：下载任务行状态文字（`STATUS_COLOR` 五档语义色 + 内联上色）换 `StatusTag`（queued=gray / downloading=loading+官方转圈 / paused=warn / completed=ok / error=error）；预设应用提示（自绘 success 底/边/字色盒）换 `a-alert type="success"`。评估后保留并记边界：`fb-error` 空态错误文字（a-list #empty 官方槽内）、ParamsPage 显存超限警示（数据值警示）、`badge-orange/red`（tag 对比度修正）、TopBar 关闭钮红 hover（窗口铬豁免）、中性灰提示行（文字样式非状态芯片）。审计插曲：规则 1 把注释里的「#103」当十六进制色捕获，措辞避开 | 2026-10-08 |
| 102 | 状态卡警示族对齐官方组件（用户批注「仍存在样式残留，为什么还有额外的组件使用非arco官方档」，点名概览端点暴露提示）：端点提示 / 失败横幅 / OOM 归因与减负文案 / 清理卡状态行全部换 `a-tag` 官方预设色（orange / red / gray / green；失败保留 `role="alert"`），自绘配色删除；#81 防跳槽位原样保留（tag 24px 在 36/30/28px 档内，e2e 判据不改自明）。**库层新知识**：Arco Tag 把默认插槽包进 `.arco-tag-text`（flex 项、无 min-width: 0、min-content 撑住不收缩），长文案 tag 窄视口必然溢出（英文态 1024 实测 +118.7px，被窄视口 e2e 抓获）——解法 = 调用方 `:deep(.arco-tag-text)` 放开收缩（`min-width: 0; flex: 1; display: flex`） | 2026-10-08 |
| 101 | 撤销「截断值保留原生 title」边界：剩余 28 处原生 `title` 全部迁 ToolTip（用户裁定观感一致性优先，推翻 §7.5 原 ②③ 类的「勿顺手改」）：ServiceStatusCard 6 处、SettingsPage 摘要 2 处（条件悬浮走 `:disabled`）、ParamsPage 建议 chip、AdvancedPanel 输入框、ParamSummaryCard 摘要 chip（嵌套 ToolTip：键名区=flag、值区=完整值）、PresetsPanel 3 处、LocalModelsPanel 6 处、DownloadCard 7 处；热路径顾虑实测解除（a-tooltip trigger 惰性挂载、弹层仅悬停时创建）；现存 `:title=` 仅 3 处组件 prop + 1 iframe title，`<ToolTip` 62 处 / 20 文件 | 2026-10-08 |
| 98 | 三处日志出口收敛为两处（用户批注「控制台输出出口与当前日志出口应调整到日志界面，只需要输出推理框架日志即可」＋选定档 B）：日志页改为推理框架控制台（`server` store 的原始输出 + 入队时算好的 `tone` 着色 + 同值域级别筛选 + 搜索 / 复制 / 清空），服务页删掉整个控制台卡片只剩三卡，概览「最近问题」改为「应用操作日志」（最近 24 行全级别、时间 / 级别 / 正文三列、出现 error 时给去向按钮）；i18n 删 4 键增 2 键（395/395）；`logs-scroll.spec.ts` 灌流钩子改指 `__mockPushConsole`，`scrollTop` 那条等值断言放宽为「非 0 且不小于首读」（本页现在有 2.5s 一行的正常输出流，等值会把「有输出流」判成回归；删除实验仍咬得红） | 2026-10-07 |
| 99 | 设置页两个提示样式对齐 Arco 官方组件（用户批注「两个提示样式需要先确认是否符合 arco 官方最佳实践」）：引擎状态胶囊是自绘 chip（图标 + 彩字 + 14% 浅色底 + pill 圆角）＝官方 `a-tag` 预设色的平行实现——换 `a-tag`（color 预设 gray/arcoblue/green/red + `size="small"` + `nowrap`，检测态用官方 `loading` prop 替换自绘 spin，图标走 `#icon` 槽），自绘配色样式全删（第 20 条零登记面）；引擎提示的原生 `title` 换 `ToolTip`（a-tooltip 封装），省略链随包裹层适配；橙色保留 `--fg-warning-text` 角色档（官方 `type="warning"` 是裸 warning-6，压白 2.57:1 不达 4.5 纪律） | 2026-10-08 |
| 97 | 全局图标语义审查（用户批注「全局图标审查，是否还有类似的语义偏差图标」）：`folder_open` 与 `folder` 同为纯文件夹导致「上一级」长得和「打开目录」一样——上一级改 `chevron_up`（Arco icon-up）、四处「打开目录」归 `folder`、别名 `folder_open` 删除；「应用预设」不再借用启动服务的 `play` 而用 `check`；设置页「更改即时保存」不再用暗示手动保存的软盘 `save` 而用 `check_circle`；删零读者的 `clock`；字形表抽成 `icon-map.ts` 并导出 `IconName` 类型（六处 `icon: string` 收紧，错名在 vue-tsc 即红——真机实测模型页页签曾静默退化成问号图标）；新增门禁第 21 条（一名一图 + 每名有读者，删除实验：贴回 `folder_open` ⇒ 两条同时红） | 2026-10-07 |
| 96 | 自建浮层归零：引擎获取指引从「Teleport + getBoundingClientRect + 300/150ms 定时器 + 自带 z-index/阴影/入场动画」改挂 `a-popover`（悬停开关与延迟、定位、视口避让、点击外部关闭、hover-stay、表面与层级全交回库；只留库没给的 Esc 关闭与焦点移入/归还），脚本约 90 行降到约 35 行，新增 `e2e/web/help-popover.spec.ts` 3 条用真指针与真键盘钉四条通道（合成 mouseleave 曾给出「离开不关」的假结论）；圆角三别名改指官方档 `var(--border-radius-medium)`；删四个零读者 token（`--dur-med` / `--ease-jelly` / `--shadow-dropdown` / `--z-overlay`）并同步中英规范 14 处声明（批量脚本逐条断言恰好命中 1 次）；新增门禁第 20 条 `ARCO_COLOR_ALLOW`（17 条登记共 23 处带理由，删除实验：改错一个 marker ⇒ 同时报未登记命中与登记数不符）；七项官方能力评估后不采纳并逐条给库层证据（`a-list` 分页 / `a-collapse` / `a-scrollbar` / `a-back-top` / `a-input-search` / `a-link` / `labelAttrs`） | 2026-10-07 |
| 95 | 浅色零换档：删掉 `body` 上的 `--danger-6/5/7`、`--warning-6/5/7`、`--green-6` 与深色块里的 `--green-6` 复述（库的状态色是间接层 `--danger-6: var(--red-6)`，换档连带重绘 125 个元素，而深色下因特异度从未生效——这就是「深色可接受、浅色不像库」的成因），角色档改直接取色板档 `red-7` 5.43 / `orange-8` 6.05 保 AA；四处官方 API 收口＝`ToolTip` 走 `content-class` 与 `position`／`disabled`、三个弹窗删六条与默认值相同的声明、`FileBrowserModal` 改用 `a-list` 的 `:loading` 与 `#empty`、`innerAriaLabel` 注释按实测收窄；两条评估后不采纳并写明理由（`a-list` 内建分页在 `list.js:212` 主动 omit 掉 `current`／`pageSize` 会丢受控能力；`labelAttrs` 不构成 label 关联，实测 69 个 `<label>` 零个带 `for`）；新增门禁第 19 条 + 删除实验（贴回 `--danger-6` ⇒ 点名并退 1） | 2026-10-07 |
| 94 | Arco 官方用法审查：库自带 i18n 从未配置 ⇒ 英文界面浮层按钮「取消／确定」与表空态「暂无数据」都是中文（`stores/i18n.ts` 注册英文包 + `useLocale` 并同步 `html[lang]`）；`a-result :sub-title` 应为 `subtitle`（Web UI 未运行那一行提示从来没渲染过）、`a-menu :collapse` 应为 `collapsed`、`a-input-group compact` 在 2.58 无此 prop 亦无同名类；收回代理「状态栏 5 行 `.arco-tag-checked` 是死规则」的错报（`tag.js:85` 对非 checkable 返回 true，实测 4.84 生效）；新增 `e2e/web/arco-locale.spec.ts` 2 条含中文态正对照与摘掉 `useLocale` 的删除实验 | 2026-10-07 |
| 93 | 十处按钮的 `color` 覆写冻结了 hover 文字色（scoped `[data-v-*]` 特异度 (0,4,0) 压过 Arco 的 `:hover` (0,3,0)，实测浅色悬停描边 161,21,30 而文字仍 203,39,45）：10 条覆写与 4 条 `a-statistic` 复述声明全删，hover／active 交回库按 `-5`／`-7` 档算，默认态颜色零变化；新增门禁第 18 条 `BTN_COLOR_ALLOW`（8 条按钮侧例外带理由与条数登记，另 23 条非按钮 Arco 节点覆写在 #93 里逐族登记），两组删除实验（贴回一条 ⇒ 红、`expect` 改 3 ⇒ 红且退出码 1） | 2026-10-07 |
| 92 | 无标题层级／`main` 地标重复／状态变化不播报：`PageFrame` 由 `a-layout-content` 改普通 `div`（全站只剩外壳那一个 `main`，不用 `role="none"` 遮罩）、`PageHost` 单点渲染 sr-only `<h1>`（文本取 `features` 注册表页名，与侧栏同源）、卡片小节标题改真 `<h2>`（`margin: 0; font: inherit` 继承 Arco 卡片头 16px／500）、概览状态行 `a-space` 透传 `aria-live="polite"` 不新包元素；新增 `e2e/web/semantics.spec.ts` 8 条含 6 组删除实验，六页骨架几何改前后逐项相等 | 2026-10-07 |
| 91 | `style-audit` 扫描盲区与空转的 allowList：`SCAN_DIRS` 纳入 `styles/`（token 本体层只豁免第 1/2/3/9/10 条）、新增第 17 条按 marker 加 expect 行数登记内部态类覆写、`readLines()` 抹平块注释正文修掉尺子自身的假阳性；17 条全绿并配三组删除实验 | 2026-10-07 |
| 90 | 动效规范自相矛盾：拆「交互反馈 fast/med ≤0.3s」与「环境提示 `--dur-ambient` 可 infinite」两档，Card 的 0.15s 与胶囊的 2s 字面值收进 token，`PageHost` 的 WAAPI 淡入改 CSS 关键帧（消灭 setup 期 `matchMedia` 快照），新增门禁第 14、15 条 | 2026-10-07 |
| 89 | 控制台自动滚动三份复制实现且已漂（padding、line-height、定高对弹性、两种胶囊）：抽 `useAutoScroll.ts` 与 `ConsolePanel.vue`，阈值 `dist < 60` 全站唯一，面板本体不写高度，行渲染仍归各页 | 2026-10-07 |
| 88 | 文字对比度系统性不达标（浅色 79/322、深色 49/129）：新增 `--fg-*` 角色档、实底按钮「底、悬停底、字」三件配对、恒深底钉字面量，§7.5.2 那句被实测否证的 AA 陈述改写；复测深色 0 处、浅色残留 15 处全是已登记的装饰 `=` | 2026-10-07 |
| 87 | 引擎获取指引浮层只能鼠标悬停：触发器改 `a-button` 基座并补 `aria-label`、`aria-expanded`、`aria-haspopup`、`aria-controls`，Enter 开 Esc 关，`z-index` 走 `--z-overlay`，`onDeactivated` 关掉 Teleport 残留浮层；标题区像素与改前零差异 | 2026-10-07 |
| 86 | 参数页 69 个控件与标签零程序性关联（Arco `form-item` 无 `for`）加 4 处图标按钮无名：六类控件统一 `aria-label`（`a-input` 系必须走 `:input-attrs`），未新增 i18n 键；可 Tab 的无名称控件 83 降到 0，参数行几何零回归 | 2026-10-07 |
| 85 | 三个弹窗无对话框语义、焦点不进入也不被困住（Arco 全包 0 处 `aria-modal`）：容器补 `role="dialog"`、`aria-modal`、`aria-labelledby`，新建 `useDialogFocus.ts` 管移入、循环与归还；实测 Tab 16 次全在弹窗内、Esc 后焦点回触发器 | 2026-10-07 |
| 84 | 侧栏 7 项导航对键盘与读屏完全不可达，而 `/params` 与 `/settings` 只有这一个入口（Arco `a-menu-item` 无 tabindex 无 role）：补 `role="link"`、`tabindex`、`aria-current`、Enter 与 Space 走既有 `navigate()`，加 `navigation` 地标与焦点环；实测 Tab 30 次命中 7/7 | 2026-10-07 |
| 82 | 页面骨架三层缺「确定高度 + 弹性上下文」：`.app-content` / `.page-host` / `.page-frame` 补齐 flex 列与 `flex: 1 1 0%`，PageFrame 由 `min-height: 100%` 改为内部滚动并给直接子项显式 `flex-shrink: 0`，两处原本失效的 `flex: 1` 收成 `1 0 auto`；实测 400 条日志下 `.console` 恒 539px、`scrollHeight 6602 > clientHeight 537`、`scrollTop` 停在 6065、7 页双语横向溢出 0，新增 `e2e/web/logs-scroll.spec.ts` 10 条含删除实验 | 2026-10-06 |
| 83 | `DashboardPage` 读 `scrollHeight` 未做 `pageActive` 门控（同族 `LogsPage` / `ServicePage` 都有，唯独概览没有，keep-alive 停用期仍强制布局）→ 补门控 + rAF 合帧，写法对齐同族 | 2026-10-06 |
| 81 | 布局跳变总账 11 处：`v-if` 元素无默认占位、数据到位才插正常流（顶栏模型按钮簇与模型名宽、状态栏 PID/URL/复制反馈、模型内置信息卡、命令预览 5 条提示行、模型表行内徽章排、下载卡解析链与任务区、`ParamRow` 依赖警示槽、设置页三态标签与引擎胶囊、清理按钮换文案）→ 全部改静态预留（常驻槽 / `min-height` / `visibility` / 绝对定位），参数网格最小轨 418→434，新增 `cmd_props_pending` 与 `msg_no_download_tasks` 双语键；实测 64 行三类槽宽度唯一、6 行模型行高恒 66px（徽章 1/2/2/3 不影响） | 2026-10-06 |
| 78 | 参数行固定开销 32px 虚胖：Arco `label-col` 自带 16px 右内距（§7.5.4 写的 8px 间距从未为真、可用宽也不是 132 而是 124）+ 滑块数字框 88 对 6 位值富余 12px + 提示槽余量 4px → 最小轨 450 回收到 418，两列阈值 914→850（视口 ≥~1170 即两列）、1600 由 2 列回 3 列、2560 由 4 列回 5 列 | 2026-09-20 |
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
