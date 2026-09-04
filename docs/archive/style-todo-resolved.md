# STYLE_TODO 已修复明细（归档）

> 范围：[docs/style/STYLE_TODO.md](../style/STYLE_TODO.md)「已修复」各项的完整记录（问题 / 修复 / 验证证据）与已固化进规范的历史设计决策。
> **归档只读，不随项目演进更新**；其中描述的页面结构（如概览 Q1–Q4、服务页状态卡、Card compact 变体等）可能已被后续重构调整，仅作决策与验证依据留存。当前风格规范一律以 [frontend.md §7.5](../frontend.md) 为准。
> 索引：[README.md](../../README.md) · [归档总表](INDEX.md)

***

## 已修复明细（#1–#49、#52 + 历史修复）


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
