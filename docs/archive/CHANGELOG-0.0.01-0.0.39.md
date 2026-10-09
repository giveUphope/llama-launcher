# 更新日志归档：0.0.01 – 0.0.39（2026-08-20 – 2026-09-20）

> 只读历史归档，2026-10-09 自 docs/CHANGELOG.md 整体拆出，勿再更新。现行日志见 [../CHANGELOG.md](../CHANGELOG.md)。

## \[0.0.39] - 2026-09-20


- **拉取后全量复核：修 4 处代码缺陷 + 6 处文档漂移（2026-09-20）**：对 v0.0.38 树做一次代码/文档对账，逐项读源码复现后落地。
  - **`pnpm lint` 假报错根因消除**：`turbo.json` 的 `lint` 补 `dependsOn: ["^build"]`。`apps/desktop` 的 `tsc --noEmit` 走 project references，解析 `@llama-launcher/core`/`shared` 走的是包 `exports` 指向的 `dist/*.d.ts`；拉取新代码后未构建就 lint，会报出一整批假的 `has no exported member 'detectTrashAsync'` / `'probeError' does not exist` / `Property 'SERVER_OUTPUT_BATCH' does not exist`（CI 里 `pnpm build` 显式先于 `pnpm lint` 正是同一原因，此前只写在 ci-cd.md §2.3，本地必踩）。现在 lint 自动带上游构建。
  - **mock 预览深链被弹回**：`packages/ui/src/main.ts` 的 `last_tab` 恢复改为「URL 已带显式 hash 时跳过」。实测 `127.0.0.1:5173/?x#/logs` 整页加载后停在 `#/dashboard`，只能靠点侧边导航进页（AGENTS.md 收尾动作要求「导航到本轮改动的页面」，此前每次都得点一遍）。Electron 走 `loadFile` 无 hash，生产启动行为不变。
  - **`ParamGroupKey` 死成员**：删 `'sampling'`——`PARAM_GROUPS` 只有 3 组，60 个参数无一带 `group: 'sampling'`，采样一律是 `group: 'basic'` + `subcategory: 'sampling'`（`ParamsPage` 的 13 子分类走 `SUBCATEGORY_ORDER`，与该联合类型无关）。留着会让后来者误以为存在第四个参数组。
  - **日志页渲染上限死余量**：`LogsPage` 的 `RENDER_LIMIT` 原为 3000，而 `appLog` 缓冲 `MAX_LINES` 只有 2000，该限制永不触发；把缓冲上限提为 store 导出的 `APP_LOG_MAX_LINES` 并让页面直接引用，两处不再各写一个数。
  - **过时注释/类型**：`shared/src/types/server.ts` 与 `ui/src/stores/server.ts` 的 `ServerInfo.values` / `runningValues` 注释仍写「含 `_enabled`」，该逐参数启用位已随双轨逻辑移除；`ParamRow.vue` 还原 ✕ 槽注释仍写「最小轨 400 → 450」，#78 已回收到 418。
  - **文档对齐实现**：`core-modules.md` 的 trash-cleaner 索引补 `detectTrashAsync` / `cleanTrashAsync`（IPC 实际只用异步版）；`core-modules.md` HF 客户端「302 手动跟随且始终保持在镜像 host 内」按传输拆开讲清——默认 `node:https` 传输成立，主进程注入的 `net` 传输用 `redirect: 'follow'`（net 的 `manual` 会抛 `Redirect was cancelled`），跟随由 Chromium 完成、可能离开镜像 host，`request()` 的 3xx 分支只是不触发的兜底；`ipc-channels.md` 的 `system:estimateVram` 行补上 `d788d24` 漏掉的 `probeError` 透出、设备探测「只缓存成功结果」与 `resolveServerExe` 回退链（`desktop-main.md` 早已写明）；`frontend.md` 日志页 3000 → 2000。
  - **测试规模**：`AGENTS.md` / `testing.md` 的 core 用例数 355 → 359（实测 `pnpm test`）。
  - 验证：`pnpm build` → `pnpm lint`（4 包类型检查 + IPC 56 通道同步 + 155 文档链接 + i18n 364 键 + oxlint 203 文件 0 告警）→ `pnpm test`（core 359 + ui 66）全绿。

## \[0.0.38] - 2026-09-19


- **参数行 32px 虚胖回收：最小轨 450 → 418，列数不靠对齐换（STYLE_TODO #78）**：用户批注「当前设计的参数页每列宽度不够紧凑，看看如何优化」——#77 把最小轨从 400 推到 450 后，1156 视口退成单列、1600 只剩 2 列 ×640px 轨道。逐视口量行宽构成，抓到 450 里 **32px 是虚胖**而非必要代价：① **Arco `.arco-form-item-label-col` 自带 `padding: 0 16px 0 0`**，叠加我方 `margin-right: 8px` 后可用宽其实是 `140 − 16 = 124`（**§7.5.4 一直写的「140 − 8 = 132」是错的**），而标签到控件之间实际空 16+8=**24px**、规范写的是 8px——又一处文档与实现漂移；用真实字体（`14px Inter/PingFang` 栈；13px 探针低估 7%，据此写的「最长标签 127px」也是错值）量得最长标签 122.8px，即 124 可用只剩 1.2px 余量，**列宽不能再降、那 16px 内距可以归零**。② 滑块数字框 88px 对最长值 `262144`（6 位 mono ≈ 42.2px）富余 12px，收到 76 后 13/13 只滑块 `input.scrollWidth ≤ clientWidth` 零溢出。③ 提示槽按实测字宽 7.03px/字（#74 记的 7.3 偏大）收到 72px、省略预算 8 → 7 字（别名 "Qwen3…_M" → "Qwen…_M"，完整值仍在 tooltip）。落地后**逐视口实测**：两列阈值 `2×450+14=914` → `2×418+14=850`（视口 ≥~1170 即两列），列数 1600 由 2 → **3**、2560 由 4 → **5**（1280/1440 仍 2 列但每列控件宽 +20、1728/1920 仍 3），轨道 80–222px 全部 ≥#73 的 80px 下限，标签列 `[124]` 单值、控件宽与两槽 x 每列各一值、`waste=0`、0 截断 / 0 裁切 / 0 溢出 / 0 刻度——**#77 的两条不变量（行尾两槽常驻、轨道 ≥80）一条没让**。测量纪律补一条：判标签截断只能比文本承载元素 `.tooltip-host > span` 的 `scrollWidth/clientWidth`，比 label 自身会因 Arco 内层包装漏判（第一版探针就把截断报成 0）。可再议旋钮（列间距 14→10、行内距 8→6、`.dep-hint` 预留）本轮实测后不动，理由写进 STYLE_TODO。`vue-tsc`、`vitest`（core 359 + ui 66）、`style:audit` 13/13、`vite build`、`pnpm lint` 全绿。规范落点 §7.5.4「统一控件宽度」（124 + 内距归零 + 真实字体探针口径）、§7.5.7「参数网格」418px 推导与复测表。

- **行尾装饰一律常驻定宽槽 + 建议值芯片族同档（STYLE_TODO #77）**：用户对参数页三条批注（「调研所有建议值组件样式是否统一」「调研建议值组件出现后挤压左侧组件宽度导致变形的问题」「优化建议值、还原按钮均固定占用宽度，变化时控制可见不再挤压其他组件变形」）。**先订正第二条的前提**：逐行量 60 行得带提示行与不带提示行的控件宽同为 171——挤压**不来自建议值**（`.gguf-hint-slot` 自 #72 起就是常驻槽），真凶是**行尾还原 ✕**：它按 `v-if="hasChange"` 内联在行里，一出现就吃掉 24+gap4=28px，同行控件宽 **171 → 143**（滑块轨道跌到 47px，远低于 #73 的 80px 下限）、提示槽整体左移（芯片 x 597 → 569）。#72/#73 当时把这条判为「瞬时态不预留」（文档里就写着控件宽 `[176, 148]` 两值），本轮按用户口径改为**装饰元素 presence 不得改变其它元素几何**：✕ 外包 `.clear-slot`（`flex: 0 0 24px` + `min-width: 0`，`v-if` 留在 `ToolTip` 上以免渲染空 host），与提示槽同构。第二条（芯片族统一）实测三处不同档：`.gguf-hint` 内距 `0 6px`（#74 为挤进 72px 旧槽写的覆写）、`.suggestion-chip` `0 8px`、`.rec-chip`（性能目标联动建议）**缺 `size="small"` → h24** 且无 key/=/value 三段配色、另带一条与 a-tag 原生同值的死声明 `color: --color-text-1`；现三族统一为 `size="small"`(h20) + `0 8px` + mono + `--fs-sm` + `gap 5px` 三段配色，提示槽因内距回归原生由 72 → **76px**（8 字 mono 74.3px ≤ 76）。**代价如实记录**：网格最小轨 400 → **450**（新增 28px 预留 + 旧推导漏算的行自身 2px 边框与 16px 内距——413px 轨道上滑块本来只剩 75px，已低于 #76 自己援引的 80px 下限），列数随之变化：1600 由 3 列退 2 列、2560 由 5 列退 4 列、≤1210 退单列，**1920 仍 3 列**；按「控件可用性优先于列数」（#76 既定原则）取此方向。验证（Playwright 逐视口 1156/1280/1440/1600/1728/1920/2560 + 内置浏览器交互）：控件宽 distinct 取值 `[171,143]` → **每列恰一个值**、槽 x 每列恒定、滑块轨道 94.7–480px 全 ≥80、8/8 芯片零裁切、点芯片 `40→20` 与点 ✕ `20→40` 全程三个几何值不变；三族芯片 `offsetHeight` 全 20。**明确不预留** `.dep-hint` 警示图标（4+14px）：`syncDependencies` 只保留 `file`/`dir` 型依赖参数的路径，11 条 `dependsOn` 中 file 型仅 `spec_draft_model` → 该态最多命中 1/60 行，为它预留会把最小轨推到 468（1728 再少一列）。同类扫描：全库 23 个 `<a-tag>` 使用点清点尺寸档，除 `.cat-chip`（§7.5.4 ⑥ 明文的 24px 交互档）外仅 `ServiceStatusCard` 外部实例徽章无 `size`（mock 无外部实例态、未实测），已登记待定。**同轮追加第四条批注**（「审查为什么样式与其他建议值不一致」，指「上下文长度」的 `32,768` 芯片）：八条芯片逐个数计算值对完，差异是**灰底只读档 vs 蓝底可点档**——灰档本身正确（`buildSuggestions` 明文不为 `context_length` 等纯参考信息产生建议，`-c` 默认 0 即从模型加载，蓝底会撒谎），缺陷在**只读档留 `cursor: auto`**、与可点档只差底色、悬停零反馈，被读成「坏掉的芯片」；改为 `cursor: help`（与 `.rec-chip` / `.dep-hint` 同词汇表），「蓝底 + pointer = 点它生效／灰底 + help = 悬停看说明」立为唯一规则（实测 2 help + 6 pointer，八条 `border` 全透明——截图里的方框是批注选区高亮）。同时排除千分位嫌疑：三族 formatter 同为 `v.toLocaleString()`，非离群写法，且当前最大 7 位数值挤不爆 8 字省略预算。`vue-tsc`、`vitest`（core 359 + ui 66）、`style:audit` 13/13、`vite build`、`pnpm lint` 全绿。规范落点 §7.5.4「统一控件宽度」（两槽常驻 + `.dep-hint` 量化豁免）、§7.5.7 新增「建议值芯片族统一」+「参数网格」450px 推导与复测表、§7.5.8 两条检查项。

## \[0.0.37] - 2026-09-19


- **修复参数页「显存占用(估算)」在真机不可用（探测静默失效）**：先自下而上排除——真机 `--list-devices` 正常（`Vulkan0: AMD Radeon RX 7900 XTX (24560 MiB, 22077 MiB free)`）、core 解析正常、按 handler 的入参形状跑真实会话模型也正常（当前会话 35B-IQ1_M → 64% 无警示；27B-Q4_K_S → 105% 警示），preload 四参数透传与 `env.d.ts` 签名也对。断点在**主进程探测用的 exe 路径**：`getDevicesCached()` 直接拼 `dirname(settings.server_exe) + llama-server.exe`，既不校验存在也无回退——引擎目录一旦改名/搬走（本机就发生过 `llama-b10938-*` → `llama-b11053-*`，settings 里留着旧路径）spawn 静默失败返回 `[]` → `primary` 为 null → `occupancy`/`recommendations` 全 null，界面只剩一个「—」且**没有任何原因可看**；更糟的是这个空结果按 30s TTL 缓存，把目录改对后还要空转半分钟。修法：① 解析策略下沉为 core 的 `candidateServerExes` / `resolveServerExe`（纯函数 + 注入 `exists`/`listSubDirs` 便于单测），按 `server_exe` → 其同目录 → `llama_dir` 根 → 一级子目录 → 开发态仓库根 `llama-*-bin-*` 依次校验存在；顺带修一处实现缺陷——去重必须忽略分隔符差异（win32 `path.join` 出反斜杠、settings 存正斜杠，同一路径会被当两个候选，单测直接抓到）；② **只缓存成功结果**（失败时 `at` 归零，改对目录即下次重探）；③ 结果新增 `probeError`（含尝试过的路径），参数页 tooltip 由「不可用」一句升级为带原因的说明。真机验证：把 settings 指向已删除的 b10938 后，`resolveServerExe` 回退命中 b11053 并返回真实双设备（`Vulkan0:23749MiB / Vulkan1:15413MiB`）——旧实现在同一状态下返回 `[]`。新增 4 条 core 单测（排序去重 / 空设置 / 失配回退 / 全无命中），`pnpm build` 4/4、`pnpm test`（core **359** + ui 66）、`pnpm lint` 全绿。文档落点 core-modules.md §devices 表、desktop-main.md `system:estimateVram`。
## \[0.0.36] - 2026-09-19

- **参数网格响应式：去掉每行 3 列硬封顶（STYLE_TODO #76）**：用户批注「硬限制每行 3 个参数项，1920×1080 等常用分辨率右侧大面积空白」。Playwright 无头逐视口实测发现一处 `max-width: 1160px` 同时造成**两个方向**的坏结果：① 宽屏浪费——卡片可用宽 1600 视口 1326 / 1920 视口 1646 / 2560 视口 2286，而网格恒 1160，右侧空白 **166 / 486 / 1126px**；② 中间宽度反而退化——1440 未触及封顶，`minmax(340px,1fr)` 排 3 列 ×369px，控件仅 145px、**滑块轨道 31px**（同页 1280 两列却有 142px，同一控件相差 4.6 倍）。修法：删上限，最小轨 340 → **400px**（= 标签 140 + 8 + 控件 ≥176〔轨道 80 + 间隙 8 + 数字框 88〕+ 4 + 提示槽 72），列数交给 `auto-fill`。**取 400 而非 380 的依据**：380 能让 1920 排到 4 列，但滑块轨道压到 55px、低于 #73 定的 80px 下限——为凑列数牺牲控件可用性是本末倒置，故宁可在 1920 保持 3 列宽轨（191px）并把「不得为凑列数下调」写进 §7.5.7。实测（1280/1440/1600/1728/1920/2560 六档）：`waste` **全为 0**，列数 2/2/3/3/3/5 单调增长，滑块轨道 142/222/84/127/191/102px 全部 ≥80，标签列宽恒 `[140]`、控件起点每列一个值、**0 行截断**、0 刻度节点。同类扫描：全库 `max-width: <数字>` 复核，其余命中均为元素级文本截断（TopBar 180 / DownloadCard 200·480）或 `max-width:100%` 伙伴声明，**无第二处内容区硬封顶**。`vue-tsc`、`style:audit` 13/13、`vite build` 全绿。

## \[0.0.35] - 2026-09-19


- **全量文档对齐实现（2026-09-20）**：先由代码量出事实基线（`PARAMS` 60 条 / 类型分布 / 13 子分类 / 69 flag、IPC 56、i18n 364 键、ui 7 测试文件 66 用例、各依赖版本、根 scripts 清单），再按互不重叠的文件簇派 4 个只读代理逐条核到代码，**每条改动本人复核后才落笔**。**修掉一处真实回归（唯一代码改动）**：`pnpm test:e2e` 原为 `pnpm build && playwright test --project=web && node e2e/electron/run-smoke.mjs`——web 腿绕开驱动，而上一轮删掉 `playwright.config.ts` 的 `webServer` 后**没人起 4173**；实测把浏览器指向残留的无关监听进程时 11 条用例全红（正是"谁占 4173 谁定结果"），现改为 `pnpm build && pnpm e2e:web && pnpm e2e:electron`，web 腿复跑 **11 passed**。**文档订正 25 处**，按类：① **数字漂移**——architecture.md desktop `0.0.12` → `0.0.34`、AGENTS.md/testing.md「ui 5 个测试文件 / 54 用例」→ 7 / 66、README「12 条建议规则」→ 11（`context_length` 只用于门控 Flash Attention，非建议项）、STYLE_TODO #75 的 `:title` 与 `<ToolTip` 计数改为可复现口径（33 + 1 iframe + 6 prop；`<ToolTip` 35 处）、params-system/CHANGELOG 的基线 flag 数注明「b10734=421、b11053=**416**，且随解析器版本变」；② **归属/位置错**——`forceStop()` 实在 `Launcher`（launcher.ts:100）而非 `LlamaServerProcess`、`detectCompanionTags` 在 `models-scanner.ts:111` 而非 paths.ts 节下、下载写流 HWM 16MB → **2MB**、外部草稿依赖 6 → **4**（另 2 个用 `notValues`）、「清空草稿数」实为**重置为默认值 3**；③ **描述与代码矛盾**——design-decisions 的「IPC 四层含 `env.d.ts`」（脚本只查三项）、item 18「默认值天然下发」（dropdown 值=默认时**不发射**，四者仅 `kv_unified` 恒发射）、item 23「structuredClone 已替换深拷贝」（仅 params.ts:298 一处，`useIPC.ts:23` 与 preload `clonePlain` 仍是 JSON 往返且注释说明了 Proxy 原因）、packaging.md 临时配置 `.yml` → **`.cjs`**、packaging.md「版本号被剥离 trailing zeros（`0.0.34`→`0.0.5`）」与真实资产 `llama.Launcher.0.0.34.exe` 及 auto-release.md 自相矛盾、ci-cd.md 的 `pnpm lint` 组成漏了 `verify-i18n-usage` 与 `lint:ox`；④ **Arco 迁移后失效的样式规范**——frontend.md 的 `auto-fit`→`auto-fill`、`--sidebar-w-collapsed` 64→**48**、侧栏导轨 56px→48px、`mini-btn`/`version-badge`/自绘状态圆点（8×8/7×7）/`--glass-*` 兼容映射/Card `padding: 10px 0 14px`+头高 38px/表格 `padding: 6px 8px`+sticky 表头+`--bg-card`/圆角「四 token」——逐条 grep 确认代码 0 命中后改为现状（Arco 默认或已删），STYLE_TODO 的 mini-btn 历史决策条目加失效标注、索引表补 #50/#51 两行。⑤ **归档**：`docs/ARCO_MIGRATION_TODO.md`（77 项已勾、余 2 项为人工目验）移入 `docs/archive/` 并登记 INDEX 行、同步 STYLE_TODO 引用路径，README 文档地图补上此前遗漏的 `docs/workflow.md` 行。验证：`pnpm lint`（含文档链接/锚点全绿）+ `pnpm test`（core 355 + ui 66）+ `pnpm e2e:web`（11 passed）；`pnpm e2e:electron` 因用户正在运行应用持有单实例锁而本机不可测（该腿由 CI 的 xvfb 运行背书，今日已绿）。

- **CI 文档订正：反无限循环的归因与 bump 步骤实态（2026-09-19）**：`docs/ci-cd.md` §1.2/§2.4 原写「`github.actor != 'github-actions[bot]'` 防止无限循环：bot 推入的 bump 提交不再触发第二次 bump」——**归因不准**。真正阻止回环的是 GitHub 的 token 规则：**用仓库默认 `GITHUB_TOKEN` 写入的 push 不再触发工作流**；实测 v0.0.34 的 bump 提交 `712233a` 在 CI 运行历史里根本不存在（列表从其父 `e156388` 直接跳到 `13b5ee8`）。actor 判断只是防「将来改用 PAT / 手动以 bot 身份推送」的第二层。连带写明两点已知取舍：① **被发布的 bump 提交没有独立 CI 校验**（只改版本串，真校验在其父提交）；② `gh workflow run release.yml` 走 `workflow_dispatch`，不受 push 抑制规则影响，故 Release 照常跑（v0.0.34 实测成功）。同处再修一处陈旧文档：§1.2 步骤 2 仍写 `pnpm/action-setup + setup-node + pnpm install`，而 bump job 自 2026-09-09 起已免装（`bump-version.cjs` 为纯 node 脚本）。运维侧同时删除 v0.0.33 遗留的**空 draft Release**（`assets=0`，其发布工作流在 `softprops/action-gh-release` 步以 `Headers Timeout Error` 失败）——**保留 tag `v0.0.33`**（指向真实提交，删 tag 会让版本号语义断裂）。

## \[0.0.34] - 2026-09-19


- **E2E preview 进程收敛为单点拥有（顺带修掉一处死配置）**：`playwright.config.ts` 的 `webServer` 只写了 `port: 4173` 未写 `url`，而 Playwright **仅在给定 `url` 时**才建可用性回调（`playwright/lib/runner/index.js:839`）→ ①不检测端口占用（不会报 "already used"）；②照样 spawn 一个 vite，因驱动 `e2e/run-web-e2e.mjs` 已占 4173 而 EADDRINUSE 退出；③`_waitForProcess` 在无 url、无 stdio 等待时直接 `processExitedPromise.catch(() => {})` **吞掉退出码**（同文件 935-939 行）。净效果：每次跑白起一个必死进程，**「谁在服务 4173」取决于两个进程的抢绑顺序**，且 `reuseExistingServer: !CI` 与 `timeout: 60s` 两个旋钮完全无效。另外文档原写「Linux CI 仍走 Playwright 自带 webServer」是**错的**——`pnpm e2e:web` 的定义就是「build + 该驱动」，CI 走同一条路径。修法：配置里删掉 `webServer`（驱动成为唯一拥有者），驱动加两道确定性保障——开跑前探测 4173，**已被占用即 exit 1**（不静默复用，避免"绿了但验的是旧产物/别人的服务"这类假阳性）；子进程 stdout/stderr 留末 60 行并在超时/spawn 失败时打印（此前 `stdio: 'ignore'` 只有干巴巴的超时），`try/finally` 保证任何路径都杀子进程。实测三条路径全过：连跑两次 `pnpm e2e:web` 各 **11 passed（2.0~2.3s）**、无端口残留；外部进程占 4173 时驱动 `exit=1` 并给出中文原因；故障注入（把 vite 路径改错 + 超时收到 3s）确认子进程 MODULE_NOT_FOUND 输出被完整回显、退出码 1。文档落点 [testing.md](../zh/testing.md)「要点与坑」+ [ci-cd.md](../zh/ci-cd.md) §1.4。

- **CI/CD 流水线优化（2026-09-19）**：先取实测数据再动手——`gh api` 拉最近一次 main 运行的**步骤级**耗时（总墙钟 1m11s：verify 56s / e2e 54s / changes 5s / bump 7s），据此定优先级。① **修一个潜伏的 PR 门控缺陷**：`pull_request` 事件**没有** `github.event.before`，`changes` job 展开成空串后 `git diff --name-only "" HEAD` 以 **exit 128** 失败（本地实测复现），而 `run` 默认 `bash -e` → PR 上 changes 必红、`e2e`（`needs: changes`）连带被跳过；现按事件分取基线（push→`event.before`，PR→`event.pull_request.base.sha`），并加 `git rev-parse --verify` 守卫 + **拿不到基线一律保守判为非文档变更**（宁多跑不漏检）+ 事件上下文改由 `env:` 注入（防内插注入姿势）。该缺陷长期潜伏的原因：仓库两次 PR 运行都早于 `changes` job 引入。② **每个 job 补 `timeout-minutes`**（changes 5 / verify 15 / e2e 20 / bump 10 / release.build 45）——release 侧已实测过 turbo daemon × vite 8 的挂死竞态，无 job 级超时一次挂死白占 6h。③ **e2e 失败现场上传**：`if: failure()` + `actions/upload-artifact@v7` 传 `playwright-report/` 与 `test-results/（取自 playwright.config.ts 的 outputDir/reporter）`，此前失败只能靠 list 输出猜。④ **缓存 Playwright 浏览器**：`actions/cache@v6` 键含 `pnpm-lock.yaml` 哈希——Chromium 下载实测 16s 是本 job 最长单步（占 54s 里的 30%）。⑤ **并发策略收紧**：CI 的 `cancel-in-progress` 改为**仅 PR 生效**（bump 在同一 run 内 commit→tag→push→触发 Release，中途取消会留下「tag 已推、Release 未触发」的半程状态；实测 bump 仅 7s，串行排队代价可忽略）；`release.yml` 新增 `group: release-v${{ inputs.version }}` + `cancel-in-progress: false`（同版本不并发、在跑的绝不取消）。⑥ **Release 版本一致性闸门**：checkout 后、构建前比对 `inputs.version` / `package.json` / `definitions.ts` 的 `APP_VERSION`，不符即失败——避免发出「Release 标题 vA、exe 报 vB」的产物（打包侧历史陷阱，docs/packaging.md §11.7）。**明确不做**：跨 job 传构建产物（install 仅 4~5s、build 16s，artifact 往返不划算）、`pnpm/action-setup` 升 @v6（v6 装错 pnpm 版本，pnpm/action-setup#225，沿用既有决定）。新引入 action 版本均经 `gh api …/releases/latest` 核对（cache v6.1.0 / upload-artifact v7.0.1）。**验证**：工作流 YAML 用仓库内 js-yaml 解析通过；`changes` 判定逻辑抽出后本地跑 7 个场景全对（push 非文档→true、push 纯文档→false、无改动→false、PR 有 base→true、PR 无 base→true 保守、全 0 基线→true、未知 sha→true）；`pnpm lint`（含文档链接）全绿。文档落点 ci-cd.md §1.3/§1.4/§2.1/§2.5 + 新增 §2.6（超时与耗时基线表）、auto-release.md §2（步骤表加闸门步 + 并发/超时）。

- **参数基线升级至 llama.cpp b11053（re-pin，2026-09-19）**：本地引擎由 b10734 换为 `llama-b11053-bin-win-vulkan-x64`（`version: 0.4.1-dev (build 11053, commit 1af554f8f)`），按 [docs/params-system.md](../zh/params-system.md) §5.5 的 11 步 re-pin 流程重走（导出新 help → 先审计后替换 → 版本标注 → 参数表决策 → 重生成对照表 → 双向校验）。**漂移结论**：flag **移除 7**——`--mlock`、`--mmap`/`--no-mmap`、`-dio`/`--direct-io`/`-ndio`/`--no-direct-io`，均为 b10734 已标 `DEPRECATED in favor of --load-mode` 的独立别名，应用早已迁移（`load_mode` 下拉），**零影响**；flag **新增 2**——`--log-jsonl`/`--no-log-jsonl`，**决定不收录**：它把 stdout 改成每行一个 JSON 对象，会破坏 `launcher.ts` 的 listening 检测（按行匹配 `listening` + `http|server`）与控制台逐行着色（与未收录的 `--log-file` 同类）。应用 69 个 flag **缺失 0**。默认值变化 1 条真实：`--reasoning-preserve` `template default` → `enabled`（未入参数表，无跟随）。枚举白名单逐项核对无漂移：`--load-mode` 取值仍含 `dio`、`--spec-type` 11 值全同、`--chat-template` 内置模板列表与 b10734 **逐字节相同**（我们 24 项为其子集）→ `definitions.ts` 本轮**零改动**。**顺带修 `verify-help-drift.cjs` 一处误报**：说明续行 `… default: follows --device)` 不以 `(` 开头、而剥离字符集不含括号，导致把 `--device)` 当成「新增 flag」（本次首跑即误报）；剥离集补 `()` 后两侧同步下降——**b10734 基线 428 → 421、当前 b11053 基线实测 416**（自比对 `基线 flags: 416 | 新 flags: 416`），重跑新基线为「无新增 / 无移除 / 默认值变化 0 / 应用缺失 0」。落盘仍走 Node `execFileSync` 捕获 stdout（避开 PowerShell `>` 写 UTF-16 的老坑，实测新文件无 BOM、无空字节）。校验：`verify-params-sync` ✅ 69 flag 完全一致；对照表由 **269 → 267 行**（删 3 行别名 + 增 1 行 `--log-jsonl`，生成器 stdout 报 `Total: 259, Supported: 60, Missing: 199`），且被删的三行在旧表里本就标着 **⬜ 未支持**——「零影响」由此直接可证；README 与 `generate-params-doc.cjs` 的来源版本串同步到 b11053；`pnpm lint`（4 包 + IPC 56 + 文档链接 + i18n + oxlint）与 `pnpm test`（core 355 + ui 66）全绿。

- **提示机制统一到 Arco `ToolTip`（STYLE_TODO #75）**：#74 只收了参数行，其余仍是「参数页一套、别处一套」——原生 `title` 不受主题控制（深色下仍是系统白底浮层）、约 1s 延迟、承载不了多段文本。按「先定边界再动」执行，**26 处 / 9 个文件**的页面级与铬面固定控件转 `ToolTip`：TopBar 8（含 3 个 win-btn，`aria-label` 保留）、StatusBar 2、ParamsPage 4（显存统计块 + 性能目标/恢复基线/清除会话）、LogsPage 2、ServicePage 2、DownloadCard 3、ServiceStatusCard 3、GeneralPanel 1、FileBrowserModal 1。**同时把保留原生的三类写成硬边界**（避免下一轮又被「顺手统一」）：① 组件 `title` **prop**（`a-modal`/`a-popconfirm`/`a-statistic`/`a-dgroup`）与 `iframe title` 无障碍名——本就不是浮层；② **`v-for` 数据条目上的提示**（模型表格行、下载任务行、预设行、chip 列表）——每条目一个 Arco trigger 实例，与 §7.1 热路径铁律相冲；③ **截断值提示**（`.mono-val`/`.file-name`/`.task-name`/`.task-error`/`.summary-label`）与 `a-input :title`（外包 host 会动到表单控件盒型）。实测：`:title` 计数 **60 → 34**（剩余逐条核过全属三类边界）、顶栏 `.right` 五子项宽 `234/82/82/82/131` 与 8px gap 零回归、`.model-name` 仍在 180px 省略（279/180）、状态栏值 109px 未撑破、hover「启动」浮层底 `rgb(29,33,41)` + 白字。两条落地坑记进 §7.5.6：自带 `v-if` 者必须把 `v-if` 移到 `ToolTip`（`v-if`/`v-else` 成对的两位一起移，DownloadCard 的 HF Mirror/ModelScope 即此例）；`a-dropdown` 触发器外包 `ToolTip` 不破坏下拉（Trigger 挂 host、点击冒泡；实测顶栏模型下拉中心 x=493 = 触发器中心、参数页 `position="bl"` 弹层 x=723 恒等）。`vue-tsc`、`vitest`（66）、`vite build`（index chunk 230.71 → 231.08 kB）、`style:audit` 13/13、`pnpm lint` 全绿。附带确认（非本轮改动）：参数页首挂的 60 条 `[Vue warn] toRefs() expects a reactive object…` 已查清为 **Arco 侧 dev-only 噪声**——`form-item` setup 里 `toRefs(inject(formInjectionKey, {}))`，而参数行刻意无外层 `a-form`，注入落到普通对象 `{}`；栈定位到 dev 包 `@arco-design_web-vue.js:20096`，设置页（有 `a-form`）实测 0 条，警告串不在 `dist` 产物中。决定不修（套 `a-form` 会启用 60 行 `setLabelWidth` 测量 + 引入 `<form>` 提交语义，深路径 import 非公开导出则违反「勿依赖 Arco 内部实现」）。详见 STYLE_TODO #75 末条。

- **建议值芯片读不到值 + 参数行两个 ✕ 修复（STYLE_TODO #74）**：用户对「模型别名」行两条批注各自命中一个真缺陷。① **建议值显示**：别名建议是模型文件名（30 字），落在 72px 定宽槽里实测 `scrollWidth 220 / clientWidth 70`，而 `.arco-tag` 是 `inline-flex` 且无内容包装层（#69 同源）→ **CSS `text-overflow: ellipsis` 根本不生效**，界面只剩被硬切、连省略号都没有的 "Qwen3-32B"；原生 `title` 又只写「点击应用此建议值」，值在界面上任何地方都读不到。改为 JS 中间省略（头 5 + `…` + 尾 2，保留量化后缀这类区分信息）+ 完整值/参数名/操作提示三段进 `ToolTip`；芯片横向内距收到 §7.5.4 ① 徽章档 6px（8px 档下 8 字 mono 实测要 74.7px > 72px 槽）。顺带修掉 `ToolTip` 长期折行问题：`content` prop 渲染的 `.arco-tooltip-content` 是 `white-space: normal`，全站「标签\n帮助」浮层一直被折成一行（实测高 30px），改 `#content` 插槽 + `.tooltip-text { white-space: pre-line }` 后 3 段 74px。② **重复的还原按钮**：`TextParam` 的 `a-input allow-clear` 渲染 Arco 清除 ✕（平时 `visibility: hidden`、hover 有值现形），与行级「还原默认」✕ 同屏 = 一行两个，且它写入空串而非默认值（`host` 清空即报 `err_invalid_host`），语义也错——去掉 `allow-clear`，参数行还原入口唯一。实测：8/8 芯片 `scrollWidth === clientWidth` 零裁切（别名 "Qwen3…_M" 70px、高仍 20px）、全页 `.arco-input-clear-btn` **4 → 0**（行级 `.clear-btn` 保持 1）、点芯片仍写入完整值（`ToolTip` 包裹不吞点击）。规范落点 §7.5.7 两条 + §7.5.6 多行浮层 + §7.5.8 豁免措辞收敛。**追加（用户指定）**：参数行还原 ✕ 的提示同样从原生 `title` 换成 `ToolTip`——按钮基座仍是纯 Arco（`a-button type=text size=mini shape=circle status=warning`，`.clear-btn` 类全库仅 1 处出现、零 CSS 覆写，实测 24×24 / 底透明 / 文字 `rgb(255,125,0)` = `--orange-6` / 圆角 50%，字形 `arco-icon-close` 亦 Arco 官方），外包 `ToolTip` 后几何零变化（host 同盒、行高 38px）、浮层渲染「恢复为默认值」108×30、点击仍还原（别名 → 默认值、✕ 随之消失）。全站另有 **60 处**原生 `title`（grep 实测，6 处为 `a-dgroup`/`a-statistic`/`iframe` 等合法组件 prop），是否统一需先定「表格单元格截断提示是否保留原生」这条边界，当时登记 STYLE_TODO **#75 🔴** 不在本轮擅改（避免文档与代码漂移）——该条已在本轮末按边界收口，见上一条。`vue-tsc`、`vitest`（66）、`vite build`、`style:audit` 13/13、`pnpm lint` 全绿。

- **参数滑块刻度彻底移除 + 标签列 110 → 140px（STYLE_TODO #73）**：用户再次批注「滑块样式还是没有统一」。#72 那轮我给 `show-ticks` 加的 `(max-min)/step ≤ 40` 门控是**半措施**——真机量得参数页 13 只滑块里 12 只无刻度、唯独「温度」(0–2 / step 0.05 = 40 格) 恰好落在门槛内，一行带满刻度圆点、其余全是光轨道，「只有一只不一样」比全部带刻度更刺眼。改为**参数滑块一律不开 `show-ticks`**（删 `TICK_LIMIT`/`showTicks`，Arco 默认即 false），性能收益同时拿满：刻度节点 39 → **0**。复测标签列时又抓到 #72 自身的定宽取小了——离屏 nowrap 探针量 60 行标签自然宽，最长「合成接受长度（基准）」= **140px**，而 110px 列（扣 `margin-right: 8px` 后可用 94px）使 **11/60** 行中文标签被省略号截断（「每槽位统一 KV 上限」「草稿模型 GPU 层数」「草稿 KV 缓存类型 K/V」…），右对齐下像被啃掉一截。把「（基准）」从 `spec_synth_len`/`spec_synth_rates` 中文标签移入 tooltip（help 文本本就写明「仅基准测试」，标签里再缀一次是冗余），配合 `flex: 0 0 140px` 后实测截断归零（trim 后全页最长 127px ≤ 可用 132px），控件起点 `[422, 854]` 两列各自单值、控件宽 `[176, 148]`（残差仍是 ✕）、滑块轨道 80px、全页 0 刻度节点。规范落点：AGENTS.md 热路径铁律的刻度条目由「>40 关闭」改为「参数滑块不开刻度」，frontend.md §7.5.4 同步（定宽 140px 的理由 + 新增硬规则）。`style:audit` 13/13、`vue-tsc`、`vitest`（66）、`vite build` 全绿。

- **参数页 60 行控件对齐（STYLE_TODO #72）**：用户批注「发现样式不统一 / 优化所有输入组件的位置与宽度，要求看起来更整体」，逐行量得三处叠加缺陷——① Arco `.arco-form-item-label-col` 原生 `flex: 0 0 auto` 按文字宽自适应（实测标签 28–93px 九种），控件起点从 x=318 漂到 380；而 §7.5.4 早已写明应为定宽 110px 右对齐——**文档与代码漂移，该规则从未在参数页落地**（设置面板三块真用 `label-col-style` 实现，实测恒 110px、起点单值，故只参数页受影响）。② GGUF 提示标签内联在行内（`flex: 0 1 auto`，44–72px），8/60 带提示行控件区宽从 400 掉到 296~352，切换模型时还会当场变宽。③ 改常驻槽位后复测又抓到通用陷阱：`flex: 0 0 72px` 因 flex 项默认 `min-width: auto` 被 30 字别名提示撑到 **222px**，控件反被挤到 146px、`a-input` 内部宽度 **0px**（值看不见）。修复：标签列 `flex: 0 0 110px` + `min-width: 0` + 右对齐 + 省略号（实测 `0 1` 可收缩版在参数网格会被控件内在最小宽挤压成 64/83px，故必须 `0 0`）；提示改常驻定宽 `.gguf-hint-slot`（配 `min-width: 0` + 溢出省略）；`IntEntryParam` 数字框撑满控件列（原固定 100px）。实测：标签宽九种 → `[110]` 一种、控件起点 `[318…380]` → `[392, 824]`（每列一个）、控件宽 `[212…356]` → `[206, 178]`（唯一残差是「已修改」行内联的还原 ✕，该行本身有橙描边、属瞬时态不预留），别名行控件 146 → 178px 且输入框不再为 0 宽。同类扫描：全库 `flex: 0 0 <px>` 定宽项复查无其他撑破（topbar/statusbar 两条系列向高度基准的探针误报、滑块 88px 数字项实测未撑破），设置页实测已对齐。§7.5.4「统一控件宽度」条目重写为可执行判据（含「定宽 flex 槽位一律配 min-width: 0」）。`style:audit` 13/13、`vue-tsc`、`vitest`（66）、`vite build` 全绿。

- **mock 下载任务「暂停/取消」点击无反应修复**：先核真实链路确认它本来就是好的——`DownloadManager.pauseDownload()` / `cancelDownload()` 会 emit `status: 'paused' / 'canceled'` 的进度事件，`stores/download.ts` 也据此改状态/移除行；坏的是 `dev/demo-mock.ts` 的三个桩：`pause/resume/cancel` 全是 `Promise.resolve({ok:true,data:true})` 的 no-op，既不停模拟定时器也不回推状态，于是预览里点按钮零反馈（连带无法验证按钮态切换与取消移除行）。改为按任务 id 维护模拟状态（`DemoDl{fileName,total,done,timer}` + `startFeed/stopFeed`）：暂停停表并回推 `paused`（速度 0）、恢复从断点续推、取消回推 `canceled` 并清除状态；`pause`/`resume` 在状态不匹配时返回 `ok:false`，与真实管理器的守卫一致。顺带修一个隐患：模拟 id 原为纯 `demo-${Date.now()}`，同一毫秒连点多个文件会撞号、进度事件串到别的任务行，现追加随机后缀。真机实测（内置浏览器跑一次下载）：点暂停 → 状态 `下载中 → 已暂停`、按钮 `[暂停,取消] → [恢复,取消]`、进度冻结在 3.70 GB；点恢复 → `下载中`、按钮翻回、进度续到 3.91 GB；点取消 → 任务行移除（rows 1 → 0）。`vue-tsc`、`vitest`（66）、`vite build`、`pnpm lint` 全绿。

- **下载进度改为按真实字节连续推进（120ms 采样，速率窗口独立 500ms）**：原 `PROGRESS_INTERVAL_MS = 500` 让进度条每半秒才跳一次，高速下载时观感是"卡住后跳一大截"，与 #71 的条宽单位错误叠加让进度可信度进一步下降。现将**进度推送**与**速率采样**解耦：`progress` 事件每 120ms 发一次（`recomputeDownloadedSize` 逐段求和，载荷只含 5 个字段，8.3 次/秒/任务成本可忽略），而速度/ETA 仍在 500ms 窗口上按 EMA(α=0.5) 平滑——120ms 样本噪声大，同频会让速度剧烈跳动，故 `t.speed` 在两次采样之间保持上一个值。demo-mock 的 `simulateDownload` 同步改为 120ms + 抖动小步（曾是 8 步 × 900ms，即预览里看到的 12.5% 一跳，无法用来核对进度是否连续）。实测（注入传输跑 60 MB 下载）：事件间隔中位数 **121ms**、24 个事件中速率仅更新 5 次（≈每 500ms 一次），二者节奏确认解耦；`pnpm --filter core test` 355 全绿。docs/core-modules.md 进度推送条目同步。注：条宽仍不带过渡动画（§7.5.7「只允许动 transform/opacity」，且 Arco 默认 `transition: all .6s` 动的是 width），如需更顺滑可改为按 120ms 匹配的 `width` 过渡或 transform 缩放，属观感取舍待用户定。

- **模型下载进度条与实际进度不一致修复（STYLE_TODO #71）**：Arco `progress/line.js` 的 `percent` 约定是 **0–1 小数**（`width = percent × 100%`、文本 `percent × 100 + '%'`），而 `DownloadCard.progressPct()` 返回 `Math.min(100, downloaded/total×100)`（注释还写着「0-100 数值供 a-progress 使用」）→ 任何 ≥1% 的进度都算出 ≥100% 条宽被轨道裁满，**下载一开始进度条就是满格**；又因 `:show-text="false"` 无数字暴露矛盾，只能靠同行「584.1 MB / 4.56 GB」文本察觉。改 `progressRatio()` 返回 0–1 比值，并给 `style-audit.cjs` 加**第 13 条**回归规则（`:percent` 表达式含 `100`/`Pct` 即 ❌，自检旧写法 FLAG、新写法 pass）。真机实测（demo-mock 按 12.5% 步进跑一次下载）：条宽/轨道 **12.5% → 25% → 37.5% → 50%** 与字节数逐级吻合。规范落点 frontend.md §7.5.4 新增「数值型组件单位约定」（a-progress 0–1 / a-slider 原值 / 开关布尔）；审计条目 12 → 13 同步 STYLE_TODO 清单。`style:audit` 13/13、`vue-tsc`、`vitest`（66）、`vite build` 全绿。

- **页签标题图标与文字 0 间距修复（STYLE_TODO #70）**：用户标注设置页签条「优化图标与文字间距」后真机实测——`theme.scss` 里那条 `.arco-tabs .arco-tabs-tab-title { display: inline-flex; gap: 4px }` **从未生效**：Arco 的 `.arco-tabs-nav-type-line .arco-tabs-tab-title { display: inline-block }` 与之**同为 (0,2,0)**，而组件样式由 `unplugin-vue-components` 运行时注入、排在打包 CSS 之后，同特异后写者胜 → 计算值仍是 block，而 block 盒不认 `gap`，实测 svg 右边界与文字左边界完全相接（0px）。现将选择器带上 nav 类型类升到 (0,3,0)，间距取 6px 与同族「图标 + 文本」行（`.summary-item`、状态栏条目）一致。实测三处页签（设置 4 页签 / 参数 2 / 模型 2）间隙 **0 → 6px**、页签高 40px 不变、图标与文字垂直中心差 0.5px（亚像素）。规范固化 frontend.md §7.5.4 新增两条硬规则：**覆写 Arco 必须严格更高特异性（同特异会因运行时注入顺序而输）**、**gap 只在 flex/grid 生效**，并新增「图标 + 文本行 = 6px」体例；`style:audit` 12/12、`vite build` 通过、控制台 0 error。

- **应用性能专项（渲染层热路径 / 主进程 I/O / IPC / 解析，2026-09-19）**：按实测证据分五组修复，全部门禁绿（`pnpm lint` 4 包 + IPC 同步 + 文档链接 + i18n + oxlint；`pnpm test` core 355 + ui 66）。
  - **渲染层**：① `a-slider` 的 `show-ticks` 按 `step` 逐格建 `<div>`，参数表 `(max-min)/step > 40` 一律关闭刻度——实测参数页 **11,589 → 1,857 个 DOM 节点（-84%）**、刻度 9,717 → 39（「缓存重用大小」单只 8,195 节点、拖拽时每帧重算）；② 行派生值前置到入队时：`server` store 新增 `OutputLine.tone/fail/oom`（控制台 1000 行 × 3 条正则 / 每条新日志 → 每行一次），`appLog` store 新增 `AppLogLine.time/cls/lower`（2000 行 `Intl` 时间格式化 + `toLowerCase` / 每条日志 → 入队一次），`effectiveStatus` 由「join 80 行再跑正则」改为扫布尔标记，OOM 判定同样下沉；③ 控制台自动滚动 `requestAnimationFrame` 合帧 + `pageActive` 门控（keep-alive 失活页不再每行强制布局），日志页双滚动 watch 合一、搜索去抖 150ms、`v-for` 由 index key 改单调行号；④ keep-alive 资源泄漏修复：设置页非 passive 捕获期 `scroll` 监听、模型页 2.5s 体检轮询与 `models:onChanged` 整树重扫订阅全部配对 `onActivated`/`onDeactivated`（`onUnmounted` 在 keep-alive 下永不触发）；⑤ 其他：TopBar 取消「每次导航全量递归扫描」、VRAM 估算加 300ms 去抖并去 `deep`、概览 1s 心跳仅在运行中开、`benchJobs` 就地写单键（原整体替换使表格每 2.5s 全表失效）、下载任务行量化按文件名记忆 + 状态映射表提模块级、进度条关掉 `transition: all`（动的是 width，2Hz 推送下持续重排）、内置 Web UI 的 iframe 首次进入页才设 src、`activeParamCount`/`hasChanges` 的 Set 提升、`demo-mock` 改 `await import()`（不再压进入口 chunk）、图标改逐个深路径引入（Icon chunk 139.65 → 130.29 kB）。
  - **IPC**：`server:output` → **`server:output-batch`**（载荷 `OutputEntry[]`，16ms 窗口一批一条消息；原实现「聚合后仍逐条 send」，模型加载数百行即数百次 IPC + 结构化克隆 + 数百次渲染刷新），历史缓冲重放按 200 行分块；`MODELS_READ_GGUF_META` 裁剪 `info.metadata` 与 `chat_template` 原文（截断 200 字符，界面只用派生字段与「有无」）。通道总数仍 56。
  - **主进程 I/O**：`FS_LIST_DIR` 与目录遍历全同步 → `fs/promises` + `withFileTypes`（实测 3000 条目目录主进程阻塞 **19.6ms → 1.5ms**）；模型批量适配检测由「100 × 整目录 readdirSync + 串行 GGUF 读」改为「目录清单记忆 + 8 路并发」（实测同一目录 readdir **51.2ms → 0.7ms**）；`netstat`/`tasklist` 由 `spawnSync` 改异步、空闲端口探测 16 路并发；`trash-cleaner` 递归统计改异步（深度上限 8、每 64 项让出，实测 **23.3ms → 1.1ms**）；扫描缓存改目录级 mtime+ctime 指纹 + `invalidateScanCache(changedPath)` 精准失效（单个 `.gguf` 变动不再清空全部缓存）。
  - **下载与持久化**：完成校验改为「有 expected 才算 SHA-256，无 expected 时仅 ≤512 MiB 计算信息性摘要」（此前对最大 20 GB 文件无条件全文件重读+哈希）；`deletePartials` 由 `unlinkSync` + `Atomics.wait` 改异步（不再 parked 主进程至 1s）并新增 `pendingDeletes` 防新任务被旧删除误清；写流 HWM 16 MB → 2 MB；进度推送在窗口不可见时挂起、可见时补发最新帧且不再逐 tick 重建窗口数组；`settings-store` 加 mtime+size+字节指纹的读缓存与单次 normalize、新增 `saveSettingsAsync`（关闭路径仍保留同步写）；`presets-store` 按文件指纹缓存解析结果。
  - **解析与生命周期**：GGUF 字符串数组跳过新增 `skipStringArray()`（块内直读长度，避免 10 万+ 次 `await` 与逐元素 Buffer 分配）——合成 20 万 token / 3.4 MB 头部实测解析 **48–53ms → 5.0–5.8ms**；`LlamaServerProcess.terminate()` 轮询步进 100/80ms → 25ms（该路径刻意保持同步以保退出时序确定性，故只收紧阻塞下限）；`launcher` 的 listening 检测加 `status === 'starting'` 门控（运行期不再每行 `toLowerCase` + 子串扫描）；窗口改用 `ready-to-show` 显示（不再等整页 `load`，dev 模式即数百个 Vite 模块）。
  - **规范落点**：AGENTS.md 新增「控制台输出是批量通道」「渲染层热路径三条铁律」；docs/frontend.md §7.1 末（keep-alive 清理配对 / 行派生值前置 / rAF 合帧）、docs/desktop-main.md §6.4、docs/ipc-channels.md、docs/core-modules.md §4.4/§4.5 同步。
  - **评估后未做（记录以免重复排查）**：模型表格虚拟滚动（Arco 虚拟列表要求行高可控，本表行含可变徽章行；真正的更新风暴已由 `benchJobs` 就地写入消除）；`clonePlain` 去双重序列化（preload 全量约定，风险大于收益）；`params.values` 的 `deep` watch 改版本号（61 键遍历成本极低，改版本号有漏掉某条写入路径导致会话不保存的风险）；图标改自绘内联 SVG（可再省 ~100 kB 但 43 个字形需逐一视觉核对，与「Arco 为唯一 UI 基座」约定冲突，待单独一轮决策）；`paths.ts` 模块期同步 I/O 与 tray 图标候选循环（成本为微秒级，且路径解析触及打包边界）。

- **两处「内容间距」缺陷修复（Arco 内部结构臆想导致的死规则，STYLE_TODO #68/#69）**：用户在 mock 页标注模型文件行与「模型路径」芯片间距过挤，DOM 实测确认两处**从未生效**的样式——① `DownloadCard` 的紧凑可选中行：`a-list-item` 把默认插槽包进 `.arco-list-item-main > .arco-list-item-content`（均 block），行容器的 `display:flex` + `gap:8px` 落空、子项按行内空白排布（实测间隙 ≈3px），`.file-name { flex:1 }` 与省略号一并失效；同时 #65 为压过 Arco `size="small"` 写的同构 `padding: 0` 规则把行类自带的 `6px 10px` 也清零（行类与 `.arco-list-item` 同一元素），实测行内距 0、行高 25px。现两层包装 `display: contents` 透传 + 行内距写进该高特异性规则（`.file-list` 6px 10px / `.result-list` 8px 10px）。实测：行内距 `0 → 6px 10px`、行高 `25 → 34px`、五段间隙 `≈3px → 8px`、`.file-name` 转 `block` + `flex:1 1 0%` 且省略号生效、徽章右对齐到行内边（末元素 right 1090 = 1101−10−1）。② `a-tag` **不渲染 `.arco-tag-content`**，`.summary-chip` / `.meta-chip` / `.suggestion-chip` 三处 `:deep(.arco-tag-content){gap:4px}` 全是死规则，key / `=` / value 三段实测 0 间距（`模型路径=D:/…gguf` 挤成一坨）；gap 改落 a-tag 根类（`align-items:center` + 刻度 `5px`），实测 key→eq、eq→val 均 `0 → 5px` 且标签高度不变。规范同步固化 frontend.md §7.5.4 ①（a-tag 无包装层、芯片内部 gap 落根类取 5px）与 §7.5.7 ②（紧凑可选中行两条落地要点）。⚠️ `.result-item`（搜索多结果行）与 `.meta-chip` / `.suggestion-chip` 共用同形规则但 demo-mock 分支未触发，像素级未覆盖。

- **dev 会话一次 Ctrl+C 即退出（修复需按两次）**：`pnpm dev` 原链路 `pnpm → turbo run dev → pnpm run dev:vite → cross-env → concurrently → 3 × pnpm xxx` 在 Windows 上叠加了 4 层 `node_modules/.bin` 的 `.cmd` 批处理 shim；cmd.exe 在批处理等待子进程期间收到 CTRL_C_EVENT 会打印 `Terminate batch job (Y/N)?` 并阻塞等待按键，于是首次 Ctrl+C 只让 node 子进程退出、批处理层全部卡在无人应答的提示上，turbo 等满优雅超时后 `Force killed Turborepo tasks`（实测日志中 4 处提示 + 8 次 `1 task shutting down`）。新增 `scripts/dev.cjs` 编排器：vite / `tsc -b --watch` / dev-watch 三个任务一律由 `process.execPath` 直接执行依赖 `package.json` 的 `bin` 真实 JS 入口（`binEntry()` 解析，零 `.cmd` 层），保留原 `concurrently -k --success first` 观感与语义（`[vite]/[tsc]/[electron]` 彩色前缀、首个退出的任务码为整体退出码、其余任务 `taskkill /T /F` 杀整棵树、SIGHUP/SIGTERM 同样收口、`process.on('exit')` 兜底防孤儿，退出码取 0 以免 pnpm 报 ELIFECYCLE）。根与 `apps/desktop` 的 `dev`/`dev:console` 改为指向它，删 `dev:vite`，`dev:tsc:watch`/`dev:electron:watch` 去 `cross-env`（保留为单层手动入口）。另修两处拖慢收尾的隐患：dev-watch 退出清理由 `child.kill()`（TerminateProcess 不带走 Electron 的 GPU/渲染子进程）改为递归 `taskkill /T /F`；主进程信号处理在 `LLAMA_DEV_SKIP_QUIT_KILL=1` 时跳过 `findDevSessionRoot()`——该父进程扫描要跑一次 PowerShell 进程枚举（秒级），且 dev 会话收尾已由编排器负责。实测：`node scripts/dev.cjs` 起来后 tsc 增量重建与 Electron 热重启正常；强杀 vite 单个任务 → 编排器 4s 内退出且 tsc/dev-watch/Electron 全树消失、5173 释放。规范固化于 AGENTS.md「dev 编排必须保持零 .cmd 批处理层」与 docs/workflow.md。

## \[0.0.33] - 2026-09-17

- **徽章调色板与来源标识修复（2026-09-18）**：① `--badge-src-huggingface` 与 `--badge-quant-k` 同为 `#2563eb`，而「HF Mirror」来源徽标与「Q4_K_M」量化徽标在下载任务行并排出现、真机实测完全同色无法区分——根因是类别族（4 值）+ 量化族（8 值）已占满色相预算，故**来源族改为中性配色**（`--color-text-2` + `--color-fill-2`，删 `--badge-src-*` 两个 token）并以文字区分，在 `theme.scss` 写明色相预算规则；② 「模型文件」区块内解析信息行 `.info-tag` 与文件区标题 `.source-badge` 重复显示同一来源——去掉解析行的来源徽标（保留文件区标题那处，因 `currentSource` 可能不同于 URL 解析来源），来源标识现只在「模型文件」区与下载任务行各出现一次，并删除已无引用的 `parseSourceLabel()`。实测：`.info-tag` 计数 1→0、来源徽标中性色（浅色 `rgb(78,89,105)` / `rgb(242,243,245)`，深色对应同名 token）、任务行两徽章可区分。详见 STYLE_TODO #67。

- **文件浏览弹窗行态死规则修复（2026-09-18）**：`FileBrowserModal` 的 `.fb-row.is-selected :deep(.arco-list-item)` / `.fb-row:hover :deep(.arco-list-item)` 要求「行元素内部的后代列表项」，而 `.fb-row` 本身即 `a-list-item`（`.arco-list-item` 是其根元素）——规则永不匹配，弹窗的行选中高亮与悬停反馈实际从未生效（真机渲染核对发现，与列表行内距失效同一根因）。现选择器落到行元素本身，并以 `&.is-selected:hover` 压过 `:hover` 保证悬停中选中行不掉色。详见 STYLE_TODO #66。

- **真机渲染核对（Playwright + 真实构建产物 + demo-mock）修复 3 类静态检查无法覆盖的缺陷（2026-09-18）**：① **深色主题单类徽章被 Arco 压掉**——`.info-tag` / `.rec-badge` 为单类选择器 (0,2,0)，被 Arco `body[arco-theme='dark'] .arco-tag(-checked)` (0,2,1) 压过，深色下蓝字/白字被替换为 `--color-text-1`，现改为作用域到父容器（`.parsed-info` / `.file-item`）提升特异性；② **列表行内距归零从未生效**（存量缺陷）——`.file-list` / `.result-list` 的 `:deep(.arco-list-item) { padding: 0 }` (0,3,0) 被 Arco `size="small"` 规则 (0,4,0) 压掉，实测行内距 9px 20px 且行容器自带内距同时失效，现按同构选择器对齐特异性后归零；③ **demo-mock 数据漂移**——`quantization.family: 'k'` 与 `parseQuantization` 的 `QuantizationFamily` 不符致量化徽章样式类全部失配（退化为 Arco 灰底），且缺 `sizeStr`（文件大小列空白），现直接复用 `parseQuantization` / `formatBytes` 真实现。实测：行内距 0px、深色徽章恢复 token 色、量化徽章 `quant-k-quants` 正常上色、文件大小 `4.56 GB`、任务行零重叠零溢出、控制台 0 error。详见 STYLE_TODO #65。

- **下载卡片（模型下载功能）样式与全站规范收敛（2026-09-18）**：`DownloadCard` 是全库唯一未随 Arco 迁移收敛的样式区，本次统一 8 项——① 5 类手绘 `<span>` 徽章（解析来源/文件来源/量化/类别/推荐）改 `a-tag` 原生承载（保留 §7.5.4 ① 的 `1px 6px` 内距与 `--radius-pill` 圆角）；② 类别筛选 chip 不再覆写 Arco 内部态类 `.arco-tag-checked`，改 `color="arcoblue"` 走 Arco 自带 hover/选中态（选中底 = `rgb(var(--arcoblue-1))` / 深色 `rgba(var(--arcoblue-6), .2)`，与全站 `--row-selected-bg` 同源）；③ 计数徽章去 `opacity` 削弱文字（§7.5.2），改 `--color-text-2` + `currentColor` 半透明底；④ 非 scoped 浮层样式块选择器全部以私有类 `.url-history-*` 圈定（`.arco-dropdown-list:has(> .url-history-item)`），不再裸写 `.arco-dropdown-group-title` 全局命中他处；⑤ 任务项 CSS Grid 改 flex（全库唯一非规范 grid），两个列表加 `:split="false"` 走原生 prop 替代 `border-bottom: none` 覆写；⑥ 推荐标记竖条由裸 `box-shadow: inset` 改加粗左边框（§7.5.8）；⑦ 标题体例收敛——`section-title` 归 `--fs-sm`，独立组标题改用 §7.5.4 ③ 下划线体例（`.group-title`）；⑧ 间距与冗余收敛——筛选组间距 4→6px（对齐 §7.5.4 刻度表）、任务操作组 4→6px、删 `url-row` 死过渡声明。详见 STYLE_TODO #60–#64。

- **style-audit 新增两条回归规则（2026-09-18）**：第 11 条「非 scoped 样式块顶层选择器必须含组件私有类」（防 Arco 全局类名外泄）、第 12 条「禁止覆写 Arco 内部态类（`.arco-*-checked` / `active` / `selected` / `disabled`）」。两条规则全库全绿，规范固化于 frontend.md §7.5.6 / §7.5.8。

- **文档漂移修正（2026-09-18）**：frontend.md §7.5.3 原称「标签/chip 4px」与 Arco a-tag 实际默认圆角 2px（`--border-radius-small`）不符，已改为「a-tag 2px；筛选 chip 与彩色小徽章按业务约定取 `--radius-pill` 4px」；§7.5.4 ①③、§7.5.6、§7.5.7、§7.5.8 补齐徽章承载方式、两档标题体例、非 scoped 命名空间、列表行两种变体与布局范式；同步修正 §7.5.7 `param-grid` 的 `auto-fit` → `auto-fill`（与 2026-09-13 实现一致），并补齐 STYLE_TODO 已修复索引缺失的 #54–#59 行。

## \[0.0.32] - 2026-09-13


- **状态栏标签芯片对比度修复（2026-09-13）**：状态栏为恒定品牌蓝铬面，但状态标签芯片随主题取值——深色下 `gray` 预设为半透明灰底 + `#929293` 灰字，叠蓝条对比仅 ~1.4:1 不可读。现芯片与铬面一致改为恒定外观（`theme.scss` 固定 Arco light 色板取值：gray/green/orange/red/arcoblue），双主题观感一致；gray 文字用 `#4e5969`（5.5:1 达 AA）。

- **检测应用外启动的 llama-server 实例（2026-09-13）**：新增外部实例检测与「接管监控」——启动端口冲突时若占用者是 llama-server 进程，弹窗给出专属文案与「接管监控」选项（记录并展示该实例，不拉起本应用进程，stop/restart 不作用其上）；概览服务状态卡激活与 15s 轮询探测配置端口（复用 `system.checkPort`，无新增 IPC），发现外部 llama-server 时状态行并排「外部实例 · PID x」徽章、API 地址行显示其地址、「打开 Web UI」在系统浏览器直达，实例出现/下线均落控制台日志；本应用自身进入 starting/running 时外部标记自动失效。进程名识别跨平台兼容（Windows `llama-server.exe` / POSIX lsof 截断名 `llama-ser`）。demo-mock 支持控制台 `__mockExternalServer = true` 模拟外部实例。

- **性能目标下拉弹层位置固定（2026-09-13）**：触发按钮文字随所选目标变化（宽度 112~154px），Arco Dropdown 默认 `bottom` 位置水平居中锚定触发器，弹层随之左右跳变（实测 x 在 609~630px 间摆动）。改 `position="bl"` 左对齐触发器（左缘恒定），弹层 x 恒定不跳；配合上一定宽修复，切换目标时弹层宽度与位置均稳定。

- **性能目标下拉弹层定宽（2026-09-13）**：弹层原随建议 chips 内容自适应，切换目标（最大上下文/均衡/最低延迟/省显存）时宽度在 300~591px 间跳动拉宽（chips 单行铺开，最长 591px）。现 `.target-menu` 定宽 340px，chips 走 flex-wrap 换行（单行最多 2 个），切换目标弹层宽度恒定不变。

- **参数网格展示优化（2026-09-13）**：自定义参数分组网格 `auto-fit` → `auto-fill` 并加 `max-width: 1160px` 封顶——`auto-fit` 会折叠空轨道，参数少的组（如「网络」2 个）控件被拉伸至 ~795px 而常规组仅 ~391px，同页控件宽度不一致；列数原先随窗口宽度无上限增长（1920px 宽下一行挤 4 个参数）。现各组轨道宽度恒定一致，单行最多 3 个参数、超出自动换行多行显示；1280px 常规窗口渲染不变（2 列）。

- **修复状态标签深浅色下不可读（2026-09-13）**：状态胶囊 a-tag 传入了 Arco 不识别的语义色名（`success`/`warning`/`danger`/`processing`）——a-tag 预设色仅 13 个物理色名，语义名落入自定义色分支后 inline 背景被浏览器丢弃，标签只剩兜底浅灰底 + 状态栏继承白字（对比度 ~1.6:1），深浅色下均不可读。现映射为预设物理色（`green`/`orange`/`red`/`arcoblue`），由 Arco 自带深浅主题适配。涉及 `StatusTag` 与 `StatusBar` 状态/复制反馈标签。

- **深色主题选中行不再使用深色底（2026-09-13）**：选中态底色收敛为业务语义 token `--row-selected-bg`（`theme.scss`）——浅色保持 `rgb(var(--primary-1))`，深色改为 `rgba(var(--primary-6), 0.2)` 半透明蓝染（深色下 `primary-1` 为比底色更暗的近黑藏青 `rgb(0,13,77)`，整行铺满观感过重）。模型表格选中行、DownloadCard 任务/文件选中项、文件浏览器选中行三处同源切换；浅色观感不变，深色选中行亮于底面且与 hover 明显区分。

- **默认主题改为浅色（2026-09-13）**：全链路默认值 `dark` → `light`（core `settings-store` 默认与脏值回退、ui settings store 内存默认、demo-mock 演示设置、`index.html` 引导属性），新用户/浏览器预览不再落入深色主题；已显式选择深色/跟随系统的存量用户设置不受影响（仅默认值变更）。顺带移除 `index.html` 上已无引用的 `data-fx="glass"` 残留属性。

## \[0.0.31] - 2026-09-12

- **修复服务运行状态不一致（2026-09-09）**：端口冲突处理后重新启动，状态卡/状态栏停留在「启动失败/异常退出」而服务实际已运行——失败判定原先扫描全部控制台输出，上一轮 `bind() failed` 残留行把本轮 starting/running 误判为 failed/crashed。现改为只按本轮运行输出判定（进入 starting 重置判定边界，server store `runStart`）；主进程 `Launcher` 的同步失败（服务已运行/命令构建失败/spawn 失败）落入控制台缓冲，不再静默吞掉；端口冲突「结束占用进程」后轮询等待端口释放（最多 2s），释放超时给出明确提示（新增 i18n 键 `msg_port_still_busy` 等 3 个）；启动/重启 IPC 返回后立即以主进程权威状态同步一次。

## \[0.0.30] - 2026-09-09


## \[0.0.29] - 2026-09-09


## \[0.0.28] - 2026-09-08


- **Arco 全量引入改为按需引入（2026-09-08）**：`unplugin-vue-components` + `ArcoResolver`（`importStyle: 'css'`）按需解析模板 `<a-*>` 组件与样式，移除 `app.use(ArcoVue)` 与全量 `arco.css`；`main.ts` 保留全局 base CSS（`es/style/index.css`）以维持主题变量。生产产物总量 1490KB→1083KB（约 -27%）。`src/components.d.ts` 由插件生成并入库（`vue-tsc` 需其声明全局组件）。

- **接入 Oxlint 静态分析门禁（2026-09-08）**：根 `lint:ox`（`oxlint .`，correctness 为 error）并入 `pnpm lint` 链尾；`tests/` 走 vitest env、preload 走 browser+node env，忽略生成物（components.d.ts / ipc-constants.cjs）。首轮清零 44 处存量告警：修复 `before-pack.cjs` 的 `const` 重赋值潜在崩溃、删除各包死代码、未用参数下划线化、`catch (_)` 改可选捕获绑定、死循环 spread 简化。

- **新增 Playwright E2E 层（2026-09-08）**：根级 `e2e/` 提供 Web 渲染层 E2E（`pnpm e2e:web`，真实构建产物 + demo-mock）与 Electron 冒烟（`pnpm e2e:electron`，headless 启动打包产物验证窗口链路）；CI 新增 e2e job（Playwright 装 chromium + xvfb 跑 Electron 冒烟）。

## \[0.0.27] - 2026-09-08


## \[0.0.26] - 2026-09-08


## \[0.0.25] - 2026-09-07


## \[0.0.24] - 2026-09-07


## \[0.0.23] - 2026-09-05


## \[0.0.22] - 2026-09-05


- **移除「下载任务」页签（2026-09-05）**：模型页「下载任务」与「模型库」功能重复——`DownloadCard` library 模式已内置完整下载任务区（进度/暂停/恢复/重试/清除）。移除第三页签与 `DownloadsPanel.vue`（任务统计条一并删除），模型页回归两页签（本地模型 / 模型库）；旧路由 `/download` 保留并重定向到 `/models?tab=library`（旧书签仍落到下载功能所在页）。i18n 清理 6 个失效键（`nav_models_downloads`、`lbl_total_tasks`/`lbl_active_tasks`/`lbl_completed_tasks`/`lbl_failed_tasks`、`btn_clear_finished`）。

- **参数悬浮气泡不再被侧边栏截断（2026-09-05）**：气泡原以标签居中锚定（`left:50%`），靠近侧边栏的参数长文案向左溢出时被内容区 `overflow` 在侧栏边界处裁掉。改为左边缘锚定（只向右生长）+ 侧边栏 z-index 压至 0、内容区升至 1，气泡完整显示于侧栏之上。

## \[0.0.21] - 2026-09-04


- **移除「性能测试」页签与相关模块**：`ParamsPage` 的 bench 子标签、`BenchPanel.vue`、主进程 `bench-client.ts`（HTTP /metrics + timings 客户端）、IPC `server:bench` 通道（57 → 56）、`BenchRequest`/`BenchResult`/`BenchRunResult`/`BenchMetrics` 类型、`useWaitRunning` composable 与 `verify-bench-client.mjs` 冒烟脚本一并移除；`ParamsPage` 页签降为两页签（参数预设 / 自定义参数）。**「模型体检」（模型管理内 llama-bench 离线体检，`system:benchLlama*`）不受影响**。

## \[0.0.20] - 2026-09-03


### 依赖

- **文档更新不再自动发版（2026-09-01）**：`ci.yml` 新增 `changes` job **确定**本次 push 变更性质（checkout 后以 `github.event.before` 为基线 `git diff --name-only` 解析文件清单，不依赖 webhook `commits[].modified` 字段——Actions 环境中该字段不可靠，首版实现即为判定失败所验证），`bump` job 增加 `needs.changes.outputs.non-doc == 'true'` 守卫——**纯文档变更**（仅 `docs/**`、根 `README.md`、`AGENTS.md`）跳过 bump 与 Release（版本不再为空文档更新递增），verify 照常执行；`.github/`、`package.json`、`packages/`、`scripts/` 等代码/工程变更仍自动发版。配套更新 `docs/ci-cd.md` §1.2/§1.3 与 `AGENTS.md` 自动发版说明。

- **CI Actions 升级至 Node 24 运行时（2026-09-01）**：GitHub 官方公告（[actions/runner-images#14029](https://github.com/actions/runner-images/issues/14029)）Node.js 20 于 2026-04-30 EOL、2026-05-19~26 从 runner 镜像移除且默认版本改 Node 22——`actions/checkout@v4` → `@v7`、`actions/setup-node@v4` → `@v7`（工作流 node-version 20 → 24，移除 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out env）、`pnpm/action-setup@v4` → `@v5`（node24 稳定线；不用 @v6：v6 存在指定 `version` 装错 pnpm 版本的 bug，pnpm/action-setup#225）、`softprops/action-gh-release@v2` → `@v3`（release.yml）。全部为 node24 runtime，弃用告警消除；配套更新 `docs/ci-cd.md` §2.1 与 `docs/auto-release.md` 版本表。README 参数/CI 描述同步对齐 b10734 基线。

- **依赖升级（2026-09-01）**：vue 3.5.39 → 3.5.42、turbo 2.10.3 → 2.10.12、resedit 3.0.2 → 3.1.0、sass 1.101.0 → 1.103.1、concurrently 9 → 10、cross-env 7 → 10、wait-on 8 → 9、electron 44.0.0 → 44.1.0、@vue/devtools-api 8.1.5 → 8.2.1；**TypeScript 5.9.3 → 6.0.3**（`^6.0.3`，最后一条官方 JS 线）。TS6 默认值翻转适配：`core/tsconfig.json` 显式 `types:["node"]`（TS6 起 `@types` 不再自动注入）、`ui/tsconfig.json` 移除 `baseUrl`（TS6 弃用，7.0 移除，paths 改相对解析）。**TypeScript 7.0（Go 原生）暂缓**：无稳定程序化 API（计划 7.1 提供），`vue-tsc` 最新 3.3.11 运行时崩溃（`./lib/tsc` 子路径不再导出；上游修复 vuejs/language-tools#6123 已合并但未发布）。解除条件：npm 发布含 #6123 的 `vue-tsc`，或 TypeScript 7.1 稳定 API 落地。


### 重构

- **设置页状态摘要整体按页签收敛（2026-09-03）**：顶部状态摘要（即时保存提示 + 模型目录/引擎文件状态）对应控件全部位于「常规」页签，现**整体仅在该页签渲染**，外观/高级/关于不再出现无关提示条；提示条版本号移除（「关于」页签与侧边栏页脚已有展示，三处重复）；文案矛盾修正——原「未配置（目录不存在）」对已配置但路径消失的场景自相矛盾，改为 idle=「模型目录未设置」/ missing=「模型目录不存在」（`lbl_model_dir_unset` 新增、`lbl_model_dir_missing`/`lbl_exe_state_missing` 语义修正、`lbl_dir_not_exist` 删除）；引擎 idle 改用「未配置」短标签替代长句提示（`msg_no_exe_hint` 保留于启动校验等原场景）。

- **参数设置回归单页 + 页内 tab-strip 统一（2026-09-03）**：移除侧栏子树（参数设置的可展开 chevron 与「参数预设/自定义参数/性能测试」子项），次级页面切换统一回归**页内 tab-strip**（与设置页同一体例，`query.tab` 可深链、`/presets` 旧重定向保持可用）；Sidebar/NavButton 清理子树展开/子标签高亮的死代码（`NavItem.children`、NavButton `child`/`expandable` 等能力随删）；参数橙点信号上移到侧栏一级项（自定义参数有未保存调整时点亮）。
- **模型内置信息与参数映射分类（2026-09-03）**：按实际用途将展示信息与参数映射划为四类——A 身份识别（只展示）/ B 事实映射（确定性：`nextn_predict_layers → draft-mtp`、`general.sampling.* → 采样参数`）/ C 启发式（量化权重 → KV q8_0、长上下文 → fa=on、名称+规模+量化 → alias）/ D 纯参考（永不映射）。实现：`buildSuggestions` 新增附件守卫（`general.type≠model` 与 clip 架构不再生成建议——mmproj 也会携带 sampling 元数据）；**移除 `ctx_size` 建议**（训练上限 ≠ 推荐值，`-c` 默认 0 = 从模型加载，建议纯冗余）；修正三处语义错挂的 ggufField（`cache_type_k/v`✗quantization、`jinja`✗chat_template、`alias`✗name，行内灰字不再误导）；新增 `--swa-full` 参数（kv_cache 子分组，可调不自动建议——混合架构缓存策略由元数据自动决定，纯 SWA 模型长上下文排查用）；补抽取 `rope.freq_base`，ModelMetaCard 详情按 B/D 类重组并新增 MoE 专家（总数/激活）与 RoPE 基频参考行。参数表 58 → 59，`LLAMA_SERVER_PARAMS.md` 重新生成（--swa-full ⬜→✅）。

- **服务状态卡迁入概览（2026-09-03）**：概览 Q1–Q3（运行状态/当前模型/API 地址）与服务页状态卡两页重复展示同一组信息——状态卡整体抽取为 `ServiceStatusCard` 迁入概览（页面级唯一展示区：状态/模型/API 地址/主机/端口/PID/运行时长 + 「打开 Web UI/管理模型」快捷操作行），服务页聚焦命令预览/参数摘要/配置清理/控制台；顺带移除 ServicePage 从未置位的 `stopping` 死临时态。底部状态栏/顶栏为全局常驻 chrome，不属页面级展示约束。

- **移除基线徽章控件（2026-09-03）**：`BaselineBadge` 作为冗余状态提示整体移除（概览服务状态卡与参数页状态条两处，后者与「已调整」统计重复）——删除组件、清理 `baseline_temp`/`baseline_dirty`/`lbl_baseline` 孤立键；「恢复基线」「清除会话参数」操作保留在参数页状态条（`clearSession` 同时修复为保留模型选择，清空后显存估算/目标选择器不失联）。

- **参数预设面板低摩擦重做（2026-09-03）**：5 按钮 → 1 自适应按钮 + 行内操作——保存按钮按输入名自动在「保存为预设/覆盖预设」间切换（自适应文案即覆盖预告）；删除与同名保存完全等价的「覆盖选中」按钮，选中行回填名称输入框的行为（应用他人预设后沿用旧名保存的错绑诱因）一并移除；应用/删除改为行内 mini-btn（与 BenchPanel 组合表同款）+ **双击行直接应用**；列表 `onActivated` 自动刷新替代手动刷新按钮；删除预设新增确认弹窗（原误触即删）；名称↔绑定模型错绑守卫保留。

- **侧边栏恢复「内置 Web UI」一级导航（2026-09-03）**：标签由"Web UI"更名「内置 Web UI / Built-in Web UI」，order 5 置于日志与设置之间（设置顺延 order 6），侧栏 6 → 7 项；调用链路（导航 → `/webui` → 布局层 WebUiFrame → `server.apiUrl`）不变，顶栏/概览入口保留。README/AGENTS/frontend/architecture 同步 7 项导航描述。

- **概览页防跳动补强（2026-09-01）**：Dashboard 四区跳动审计后，修复 Q4 最近问题区高度随行数变化（空态 1 行 ↔ 3 行，50px 差）——`.issues-console` 按问题条数上限（3 行）预留 `min-height: 72px`，问题出现/消失时 Q4 区块高度恒定；Q1/Q2/Q3 经审计为替换式文案与常驻值盒（无跳动，豁免项记录于 STYLE\_TODO #46）。

- **边界测试补强（2026-09-01）**：全量盘点核心模块边界覆盖后补齐两处缺口——新增 `format.test.ts`（shared `formatBytes`/`formatDuration` 7 例：0/负数/NaN/Infinity、1023/1024 切换点、KB·MB 1 位/GB·TB 2 位、TB 封顶、秒/分/时切换点与整点折叠），`url-parser.test.ts` 追加空/空白/null 输入与大写扩展名 2 例；顺带加固 `parseModelUrl` 空/非 string 输入防御（此前 `null` 会抛 TypeError）。总用例 core 306 → 315，全部通过。

- **可复用优化（2026-09-01）**：① `modelscope-client` 接入共享 `retry.ts`（`requestWithRetry`：`isRetryableError` + 指数退避，最多 3 次，与 download-manager / huggingface-client 同一套网络韧性）；② 字节与时长格式化收敛到 `shared/src/format.ts` 新增 `formatBytes` / `formatDuration`——`modelscope-client.formatFileSize`（保留导出名的别名 re-export）、`DownloadCard.formatBytes`、`TrashCleanCard.formatSize`、`ServicePage.formatDuration` 四处本地重复实现统一为单一事实源（core 与 ui 均依赖 shared，格式语义统一：B 整数 / KB·MB 1 位 / GB·TB 2 位；统一过程发现并修复了 1536 → 误显示 `1.5 MB` 的档位错位 bug）；③ 新增 `modelscope-client.test.ts` 单测（6 例：成功映射 / 分类量化 / retry 退避成功 / 404 不重试 / 重试耗尽 / formatFileSize 别名）；④ BenchmarkPanel 的「服务就绪两阶段等待」抽取为公共 composable `useWaitRunning`（`waitForRunning`），可被性能测试之外的启动场景复用。


### 新增

- **性能目标选择器 + 模型适配徽章 + llama-bench 离线体检（2026-09-03，P1/P2）**：在估算基础上落地智能推荐三层——① **性能目标选择器**（参数页状态条，四档：最大上下文/均衡/最低延迟/省显存）：core `target-recommend.ts` 确定性规则联动关键杠杆（`flash_attn`、KV 档位、`ctx_size`、部分卸载 `ngl` 层数、MTP 推测解码）。**上下文无固定封顶**：core `solveMaxContext` 在显存+内存联合预算内求解各目标 dtype 下的无 OOM 最大值（约束：f×(权重+KV) + 余量 ≤ 空闲显存、(1−f)×(权重+KV) + 开销 ≤ 可用内存），max-context 允许部分卸载以速度换上下文（如稠密 27B 模型推算 ctx 32768 + ngl 59/64），其余目标优先全卸载、放不下时回退联合预算；下拉面板展示与当前会话值的**差集** chips + 一键应用（确认后写入会话轨道）。② **模型列表适配徽章**：新 IPC `system:estimateModelFit` 批量判定每个量化文件 fit（✓ 全卸载）/ partial（△ 部分卸载）/ no（✗ 建议降档，权重超总显存）+ tooltip 展示全卸载上下文上限。③ **llama-bench 离线体检**：新 IPC `system:benchLlamaRun/Status`（单模型单作业、2.5s 轮询、会话期缓存），对未启动服务的模型文件跑 pp512/tg128 实测 prefill/decode tok/s，模型行「时钟」按钮触发（确认弹窗提示 GPU 占用），结果徽章 `pp N · tg N` 展示。通道 54 → 57；core 新增 `target-recommend.ts` + `llama-bench.ts`（`-o json` 解析以 b10734 真实输出为基准）。设备探测加 30s 共享缓存（estimate/fit 复用，避免重复 spawn）。顺带移除参数页状态条的基线徽章并修复 `lbl_baseline` 缺失键导致的徽章 tooltip 显示原始键问题（基线徽章后已整体移除，见上条）。

- **显存探测与硬件资源占用估算（2026-09-03，v2）**：回答「当前配置在我的硬件上占用多少」——新 IPC `system:estimateVram`：主进程 spawn 随引擎分发的 `llama-server --list-devices`（输出含每设备总/空闲 MiB，Vulkan/CUDA 通用、逐行容错解析）+ GGUF KV 内存模型（`kvBytes/token = 2 × 有KV层数 × head_count_kv × key_length × dtype字节`，混合架构按 `full_attention_interval` 折算，权重 ≈ 文件大小）。**v2 占用模型**（`estimateOccupancy`）：由会话参数驱动（卸载层数 / 上下文 / KV 档位），估算显存侧（已卸载层权重 + GPU KV + 1 GiB 计算余量）与内存侧（CPU 层权重 + KV 溢出 + 进程开销）双侧占用，对照设备空闲/系统可用给出 fits 判定；主进程与渲染端共用同一份结构化结果，保证链路一致。UI：参数页状态条「显存占用(估算)」stat 项（占设备容量百分比，槽位常驻占位防跳动，超出空闲时橙色警示，构成明细放 tooltip）；服务页失败 banner 的 **OOM 归因建议**（输出尾部命中显存不足特征 → 「上下文减半 / KV 量化 q8_0」一键缓解动作）。core 新增 `devices.ts` + `vram-estimate.ts`（纯函数估算模型）。

- **依赖升级专项审计（vite 8 / vitest 4 / vue-router 5 / pinia 4 / vue-tsc 3 / electron 44 / electron-builder 26）**：逐一对照官方迁移指南确认破坏面，结论——vue-router 5 对本项目（未用 file-based routing）零破坏；vitest 4 重写 pool（移除 tinypool，Windows 测试挂死根因在上游根治，`vitest.global-setup.mjs` 兜底保留防御性）；electron 44 的 API 使用面（net/shell/app/screen/ipcMain/BrowserWindow）无破坏性变更，剪贴板走 preload 桥 → main 进程的架构符合 44 起 renderer 不再暴露 clipboard 的约束；electron-builder 26 函数式 hook（`before-pack.cjs` 的 `exports.default`）签名匹配；Node 要求 20.19+ / 22.12+ 均满足。

- **vite 8** **`configLoader`** **native 兼容**：`vite.config.ts` / `vitest.config.ts` 的 `__dirname` 全部迁移为 `import.meta.dirname`（vite 8 将默认 native config loader，CJS 全局在 ESM 语境下不存在），构建/测试输出中 `configLoader` 弃用警告消除。

- **pinia 4 peer 显式化**：pinia 4 为 ESM-only 且 `@vue/devtools-api` 变为必需 peer——已显式声明到 ui 包 devDependencies（此前靠 pnpm 宽松模式侥幸解析，严格环境会缺），运行时 ESM import 验证通过。


### 参数系统

- **参数基线升级至 llama.cpp b10734（2026-09-01）**：按 §5.5 re-pin 流程重走参数固定全流程——

  - 基线替换：`docs/params/llama-server-help-out.txt` 由 b10502 更新为 b10734 `--help` 输出（UTF-8 纯文本；顺带修复 PowerShell `>` 重定向写 UTF-16 导致文档生成器解析错乱的隐患，改为 Node spawn 捕获 stdout 直接落盘）。flag 级漂移审计：**移除 0、应用 flag 缺失 0**（全部顶格安全）。

  - 新增 9 个参数（参数表 49 → **58**）：`--lazy-mode`（惰性张量读取 off/auto/on，basic·内存）、`-ncffn`（CPU FFN 层数，basic·内存）、`--kv-unified-per-slot`（每槽位统一 KV 上限，advanced·KV）、`-mmdev`（投影器设备，advanced·多模态，文本输入支持动态设备名）、`--video-fps` / `--video-timestamp-interval` / `--video-ffmpeg-dir`（视频多模态三件套，advanced·多模态）、`--spec-synth-len` / `--spec-synth-rates`（投机合成基准 benchmarking only，advanced·推测解码）。全部按默认值省略规则建模（空/默认值不发射 flag），i18n 双语 label + help 齐全。

  - 文档与校验：`generate-params-doc` 来源串与 `LLAMA_SERVER_PARAMS.md` 更新（Total 261 / Supported **58**）；`verify-params-sync` ✅ 完全一致；`verify-help-drift` b10502→b10734 无移除、无应用缺失。回归：lint / build / test（315+48）全绿。


### 修复

- **端口占用可操作处理（2026-09-02）**：端口冲突从"仅报错提示"升级为"可处理"闭环——① `system:checkPort` 占用时返回**占用者信息**（Windows `netstat -ano` + `tasklist`；POSIX `lsof`/`ss` 兜底，尽力而为）；② 新增 `system:killProcess`（端确认后结束占用进程：taskkill /F /PID / SIGKILL，不递归杀树）与 `system:findFreePort`（按 host 向后扫描首个空闲端口）；IPC 53 通道（+2）。③ 启动端口冲突时弹多动作对话框（`confirm` 扩展 `actions`：结束进程并重试 / 换用空闲端口 / 取消，ConfirmModal 渲染多按钮）——「结束进程」成功复检后自动继续启动；「换用空闲端口」自动写回 port 参数（会话持久化）并继续启动；取消则保留控制台提示。既有 `msg_port_in_use` 提示保留（先说明后引导）。回归：core 316 + ui 53 + vue-tsc + IPC 同步（53）+ docs 链接全绿。

- **端口占用检测与提示增强（2026-09-02）**：端口设定/检测机制全链路审计后两处增强——① **启动前检测精确性**：`system:checkPort` 由固定探测 `127.0.0.1` 改为按 llama-server 将绑定的 `--host` 地址探测（`useStartServer` 透传 host；0.0.0.0/局域网 IP 时覆盖"占用者绑定在其他网卡 IP"的漏报场景）。② **启动后端口占用友好提示**：启动/运行期输出流新增 `PORT_BUSY_RE` 识别（`address already in use` / `bind() failed` / `EADDRINUSE` / `errno 98` / `OS Error: 10048` / `cannot assign requested address`，跨 llama.cpp 版本），命中即追加一条 `[Launcher] 端口 {port} 无法绑定…更换端口后重启` 引导（新 i18n `svc_port_busy_hint`，zh/en；同端口 5s 防重复）——此前启动前检查通过但被外部进程竞态占位时，控制台只有 llama 原始英文报错，状态卡虽显示 failed 但缺少处理指引。既有机制核验保留：启动前 `msg_port_in_use` 提示 + `needPort` 引导、端口范围 1-65535 双重校验（参数定义 + `useStartServer` 同步校验）、重启跳过端口检查（防自身占用误报）。新增 `PORT_BUSY_RE` 2 组单测（命中 7 例/不误伤 5 例），core 316 + ui 53 全绿。

- **参数后端正确性审计与补强（2026-09-02）**：三块审计——① **前端可调集合 vs 后端接受**：66 个 flag 全部存在于 llama-server b10734 `--help`（`verify-params-sync` 硬校验），取值白名单逐一核对均在 help 枚举内（flash-attn/load-mode/fit/lazy-mode/spec-type/cache-type-k-v/reasoning\*）；唯一缺口 `--chat-template`（b10734 只在先置 `--jinja` 时接受自定义模板）此前参数定义顺序 `--chat-template` 先于 `--jinja` 发射，editable 自定义模板名会被后端拒绝——将 `jinja` 前移（定义顺序即发射顺序）并注释约束，新增核心单测守卫（`--jinja` 恒先于 `--chat-template`）。② **默认值一致性**：逐参数对比应用 default 与 help default——默认一致的不发射（后端用其默认，语义等价）；有意的基线推荐差异（cache\_type\_k/v q8\_0、load\_mode none、fit off、kv\_unified off）均经"值≠默认必发射 / checkbox 恒发射"保证实际运行值与 UI/会话声明严格一致，无静默漂移。③ 校验脚本确认：flag 0 增删、默认值变化 0、应用 flag 缺失 0（428 flags 基线）。回归：core 316（+顺序守卫）/ ui 51 / vue-tsc / verify-params-sync / verify-help-drift 全绿。

- **参数配置与实际启动命令一致性修复（2026-09-02）**：参数一致性全链路审计（definitions → UI 控件/持久化 → store 归一化与依赖联动 → `buildCommand` 发射）发现并修复两处"UI 状态 ≠ 命令发射"偏差——① **checkbox 依赖源误判**：UI 侧依赖判定（`stores/params.ts` `isDependencySatisfied` 与 `ParamRow.dependencyMet`）对 checkbox 依赖源套用"值 ≠ 默认值"语义，默认值为 true 的 `cache_prompt` 勾选（生效）被误判"不满足"→ `syncDependencies` 误清 `cache_reuse`、控件误禁用并标警告，与命令构建器（checkbox 布尔语义：勾选即满足、未勾选才不满足）完全相反；统一为布尔语义（true/'true'/1/'1'），三处判定（UI store / UI 组件 / core 构建器）语义一致。② **editable 下拉自定义值预设回退**：`chat_template` 的自定义输入（∉ 内置 options）在 `normalizePresetValue` 预设加载时被回退默认 `'none'`，预设"保存→重载"丢配置；editable 非空自定义值改为保留（内置选项与空串照常收束）。新增 3 组 UI 单测（checkbox 依赖源布尔判定 / 未勾选违规 / editable 自定义保留），core 315 + ui 51 全绿，vue-tsc 通过。审计确认无误项：默认值省略、checkbox 恒发射 flag/invert\_flag、float 2 位小数、draft-model→draft-simple 归一、文件/目录依赖保留、custom\_args 追加、会话/预设双轨持久化。

- **进程终止僵尸误判修复（2026-09-01）**：`LlamaServerProcess` 全部 4 处存活轮询（`terminate` 优雅/强制、`forceKill`、`killSync`）改用新 `isPidAlive`——轮询为同步（`Atomics.wait` 阻塞事件循环），POSIX 子进程退出后未被父进程收割、以僵尸态停留，而 `process.kill(pid, 0)` 对僵尸进程仍返回成功，导致 Linux 上 `terminate()` 误判"仍存活"：优雅终止 800ms 超时 → 误入强制路径 → 强制后仍误判存活 → 返回 false（PR CI ubuntu 实测 2 例失败，Windows 无僵尸态不受影响）。`isPidAlive` 在 `kill(pid, 0)` 之上叠加僵尸态检测（Linux 读 `/proc/<pid>/stat` 状态位 Z，macOS/BSD 用 `ps` 状态列含 Z）；无法探测时保守视为存活（避免误判死进程触发按名扫杀误伤无关同名进程）。Windows 语义不变，本地 315 例全绿。

- **参数输入限制一致性修复（2026-09-01）**：参数输入框限制逻辑全量审查后修复「清空输入框后失焦显示空白、但参数值未变」的显示/逻辑脱节——IntEntryParam 与 SliderParam 的 `applyTextValue` 对空输入由"静默忽略"改为"恢复为已提交值显示"（清空视为放弃编辑）。审查确认其余限制链强健：IntEntry 整数格式过滤 + 阈值 clamp + Math.round；Slider 无私 value 范围/step + 浮点最大 2 位小数（输入中格式即时过滤）；Dropdown 白名单 + `editable` 自定义输入；File 按 `filetypes` 扩展名过滤；Text 对 host/port 正则与范围校验（空值 = 恢复默认不发射）；store 层 `normalizePresetValue` 对外部 set 做夹取兜底。

- **参数提示缺失修复（2026-09-01）**：前端参数显示审查发现——6 个参数控件（Slider/IntEntry/Dropdown/Checkbox/Text/File）的悬停 ToolTip 只显示参数名，"悬停查看帮助描述"（README 特性声明）从未真正实现：`paramHelp` 在 UI 中零调用。统一修复：各控件 ToolTip 改为「标签 + 换行 + 帮助描述」（`paramHelp` 为空时仅标签，ToolTip 本就 `pre-wrap` 支持换行）。顺带审查确认：新 9 参数在 UI 无硬编码遗漏、`activeParamCount` 排除 file 型正确（mmproj/spec\_draft\_model）、依赖联动/默认值显示/浮点 2 位精度均无异常。

- **dev 启动崩溃修复（2026-09-01）**：`pnpm run dev` 报 `turbo 2.10.3` 并以 0xC0000409 退出——根因是根 `node_modules/@turbo/windows-64` 残留 junction 指向旧版 2.10.3 原生二进制（`pnpm` 升级 turbo 到 2.10.12 后未清理的提升链接，turbo shim `require.resolve` 优先命中旧二进制，旧版在 Windows 上触发已知崩溃竞态）。修复：删除残留链接（版本恢复 2.10.12）；随后依赖残留复查清理 `.pnpm` 虚拟 store 中无人引用的孤儿目录 `turbo@2.10.3` / `@turbo+windows-64@2.10.3` 与空的根 `@turbo` 目录（store 仅余 2.10.12）；`dev` 脚本补 `--no-daemon`（与 build/lint/test 对齐，双保险）。验证：`pnpm run dev` 全链路正常（tsc 0 错误 → Vite ready → Electron 启动 → 托盘图标加载）。

- **增强状态机统一（2026-09-01）**：服务页状态卡的 6 态增强判定（failure/crash 关键词尾窗检测）下沉至 `stores/server.ts` 的 `effectiveStatus`（单一事实源），Dashboard Q1 与底部 StatusBar 由原始 4 态升级为同步的 failed/crashed 显示（错误色/文案）；ServicePage 仅保留 UI 临时态 stopping 覆盖并清理死常量 `READY_RE`。

- **防跳动机制推广（2026-09-01）**：按 #42 预留位置模式修复其余 3 处可重复插入行——仪表盘 Q4 问题操作行（`.issues-actions` → `.issues-actions-slot`）、预设列表与性能测试历史的 `applied-msg`（→ `applied-msg-slot`，`min-height: 32px` 恒定）；提示/操作行出现与消失时下方表格与内容不再位移。全 UI `v-if` 扫描的其余候选（状态栏信息带、统计条、URL 卡渐进披露、空态、子面板导航、折叠详情、浮层）经评估属内容态/导航/数据流语义，豁免并记录于 STYLE\_TODO #44。

- **应用图标统一（2026-09-01）**：`scripts/icon-gen/gen-icon.cjs` 的渐变从遗留四色彩虹（`#ff6b6b→#ffa94d→#4dabf7→#9775fa`）改为品牌蓝（`#60a5fa→#2563eb→#1d4ed8`，与 `packages/ui/src/assets/app-icon.svg` 的 `#appTile` 同色），并重生成 `apps/desktop/resources/*`（7 尺寸 PNG + icon.ico + icon.png）；窗口/任务栏/托盘/打包 exe 图标与 UI favicon/AppLogo 恢复一致（2026-08-26「移除彩虹」遗漏项）。

- **Windows 下** **`pnpm build`** **挂死（根因定位 + 固化）**：turbo 2.10.3 的 daemon（后台服务）在 Windows 上与 vite 8（rolldown native 多线程）的 stdout 管道存在句柄竞态——构建产物完整但 turbo 壳进程不退出（曾误判为 vite 8 问题）。定位过程：直连 `vite build` 961ms 正常、`pnpm --filter ui build` 872ms 正常、turbo 单包必挂，`TURBO_DAEMON=false` / `--no-daemon` 后 4.4s 正常退出。修复：root `build`/`lint`/`test` 脚本统一加 `--no-daemon`（本地开发一键恢复），release.yml 的 build/dist 步骤加 `TURBO_DAEMON: "false"` 环境变量 + 20 分钟超时双保险（Windows runner 免挂死）。

- **双轨参数逻辑**：参数编辑分「临时轨道」与「预设轨道」两套体系——临时轨道的参数变化自动节流（800ms）持久化到 `settings.json` 的 `session_values` + `session_baseline`，重启应用后完整恢复上次会话；预设轨道仅在显式保存时写入预设文件。新增 `SessionBaseline`（会话基线：预设名 + 应用时刻参数快照），「已修改」蓝点与侧栏橙点改为相对基线逐键计算。

- **参数基线徽章** **`BaselineBadge`**：参数设置页顶部与服务页状态卡双入口展示当前基线状态（预设名·已修改 / 自定义参数集 / 临时参数 / 默认参数），支持就地「恢复基线」与「清除会话」。

- **切模型防丢确认**：切换模型 / 应用 GGUF 建议参数前，检测到未保存修改时弹确认框，防止参数静默丢失；应用启动重挂上次模型不再触发确认。

- **命令预览双文本框分离 + 内置命令只读（重构，根治「还原」反复修不好）**：原单一文本框把「自动生成的内置命令」与「用户任意文本」混在一起——只有被 flag 索引识别的编辑才回写参数，识别不了的扩展文本既不参与启动、还原也无从清理，导致「还原」点击无反应/清不干净。现拆为两个文本框：① **内置参数命令**改为**只读展示**，随参数实时自动生成，彻底移除手动编辑/解析回写/还原这一整套易错逻辑（要改内置参数一律走参数设置页控件）；② **扩展参数**为唯一可编辑区，绑定新增设置项 `custom_args`（持久化），`buildCommand` 按 shell 词法切分后追加到实际启动命令末尾——此前扩展文本根本不参与启动，现真正生效。复制命令 = 内置 + 扩展合并。`previewCommand` 增 `includeCustomArgs`（内置框预览传 false），`buildCommand`/`launcher.start` 接 `custom_args`。

- **清理功能升级为应用生成文件全清单检测**：「清理配置目录」从仅扫配置目录根扩展为**配置目录 + 模型目录双根**扫描，覆盖应用写入的全部落盘位置——新增识别下载残留（`*.part`/`*.llama_dl.jsonl`/`*.llama_dl.json`，`download_orphan`）、旧版下载统计（`stats.jsonl`，`legacy_stats`）、预设目录原子写残留（`presets/*.tmp|*.bak`，`temp_file`）与孤儿预设（绑定模型已删除的 `presets/*.json`，`orphan_preset`；损坏预设列 `broken_json`，有效预设与纯参数集保留）。进行中/暂停/可重试下载任务占用的路径经 `DownloadManager.getProtectedPaths()` 自动保护；`cleanTrash` 对每项按 kind 复核根归属、路径特征与内容（孤儿预设删除前重读，模型重新出现即放弃），未识别文件保持保守不清理。`TrashItem` 增加 `root: 'config' | 'models'`。

- **参数行非默认值橙色描边提示**：自定义参数页中参数值 ≠ 默认值时，参数行边框变为 `--warn` 调整提示橙（与参数还原按钮同色系、hover 时保持），便于快速定位已调整项；依赖未满足行仍按 `dep-unmet`（同色描边 + 底色 + 警示图标）呈现，不重复叠加。

- **隐藏组件导致的页面布局跳动（预留位置方案）**：服务页「失败/异常退出」提示条（`.failure-banner`，`v-if`）出现时把下方命令预览/参数摘要/清理三张卡片整体下推、消失时上移；服务页控制台头部「有新日志」胶囊（`.new-logs`，`v-if`）出现时右侧滚动提示在 `space-between` 下从左侧跳至右侧；日志页「有新日志」胶囊（`.new-logs-bar`，`v-if`）出现时把 `flex:1` 控制台上下挤压。三处统一改为**预留位置（reserve space）**：外层常驻槽位（`failure-banner-slot` / `new-logs-slot`）固定预留与内容等高的 `min-height`，内容用 `v-if` 条件渲染、槽位用 `visibility:hidden` 隐藏但不占位位移——出现/消失时下方卡片列与控制台高度、右侧提示位置保持完全稳定，零跳动。校验：`pnpm lint` 4 包全绿、`style-audit` 10/10、`pnpm test` 全过、UI 生产构建通过。

- **`pnpm test`** **在 Windows 上挂死**：ui 包全量测试通过后 vitest 进程静默不退出（turbo 管道随之挂死，测试本会话卡住 15 分钟才被手动终止）。排查定位：vitest 2.1.x 的 tinypool worker 销毁后 IPC 管道句柄残留主进程（实测 17 个 PipeWrap），ui 恰为 4 个测试文件时触发退出竞态——1\~3 个文件正常、threads/forks、顺序执行、单 worker、isolate=false 均无法绕开；core 包同版本同规模句柄残留但正常退出。修复：`packages/ui/vitest.global-setup.mjs`（经 `vitest.config.ts` 的 `globalSetup` 引用）在运行结束、退出码确定后 `process.exit` 兜底退出，测试结果与退出码不变；仅 run 模式适用，详见 [docs/testing.md](../zh/testing.md)。验证：`pnpm test` 连续多次端到端全绿（core 300 + ui 48）。

- **侧边栏收起态子标签与橙点消失**：收起时子树整体 `v-if` 隐藏，下级标签图标（参数预设/自定义参数/性能测试）与其上的橙色调整提示点一并消失（提示点被侧栏 overflow 遮罩裁切在导轨外）。现收起态子项以 icon-only 形式渲染（`.nav-sub.compact` 去缩进、子项按钮去 40px 左缩进防推出导轨），橙点改**图标右上角标**（absolute，56px 导轨内永不裁切）；所有导航按钮补 `title`/`aria-label`（收起态此前无可访问名称）。

- **参数行 GGUF 提示角标与数值输入框重叠**：拥挤列宽（多列网格/窄窗口）下，滑块/整数行的数值输入框 `flex: 0 0 100px` 不可收缩，行内容超出列宽时输入框溢出 `param-control`，压在右侧 GGUF 提示角标/还原按钮下面（橙描边脏行三者齐全时最易触发）。`SliderParam`/`IntEntryParam` 的 `.num-input` 改 `flex: 0 1 100px; min-width: 56px`——拥挤时先压缩输入框再压滑块，不再溢出（1152px 收起态 340px 极限列宽实测全行零重叠；下拉/文本/文件控件本已可收缩，不受影响）。

- **窄窗口顶栏按钮文字换行挤压**：≤\~1000px 时「启动/停止/重启/打开 Web UI」被压成两行、应用名被模型按钮裁切半个字。`.btn` 加 `white-space:nowrap + flex-shrink:0`，空间不足由模型按钮（`min-width:0`，名称省略号）与应用名（可收缩省略）先让位。

- **顶栏模型下拉长文本被面板裁切**：下拉项名称列（flex 子项默认 `min-width:auto` 不收缩）在长模型名下撑破面板，被 `overflow-y:auto` 的溢出遮罩直接切掉、尺寸列被推出可视区——名称列补 `flex:1 + min-width:0` 使省略号在面板内生效；模型按钮内名称同样补 `min-width:0`（220px 内省略而非溢出描边）。顺带移除下拉项 `:active scale(0.98)`（STYLE\_TODO #32 已禁止按压缩放）。

- **浮层菜单文字被遮罩影响、可读性差**（STYLE\_TODO #41）：半透明玻璃底让面板下方页面/控制台内容透印削弱对比度，`backdrop-filter` 合成层使文字失去亚像素抗锯齿发虚。四处浮层菜单（顶栏模型下拉 / 参数下拉 / 引擎目录帮助浮层 / URL 历史面板）统一改实底 `--bg-card` + `--border` + `--shadow-dropdown` 并移除 backdrop-filter；选中行暗蓝底叠蓝字改 accent 淡底。§7.5.6 规范同步：下拉/菜单禁玻璃半透明与 backdrop-filter。

- **页面切换闪现**：快速点击侧边栏切换页面时，右侧内容区短暂闪出其他页面内容——PageHost 结构化重构根治（150ms 极限连点压测零双帧）。

- **参数别名自动派生**：`set(MODEL_KEY)` 自动以模型文件名（去 `.gguf` 后缀）派生 `alias` 参数，命令行 `-a` 不再带扩展名。

- **性能测试多并发场景**：并发数跟随 `-np`（np≥2 时 min(np,8)），np≤1 时仅执行单并发，不再出现「默认 4 并发」的误导行为。

- **性能测试 np=1 仍执行多并发**：前一条修复只改了面板侧（np≤1 → `benchConcurrency()=1` 表示跳过），但主进程 `server:bench` 的并发数钳制写反了方向——`Math.max(2, ...)` 把 1 强制抬成 2，多并发阶段必然执行、历史记录照常追加 ×2 行。钳制改为 \[1,8]（只限上限不抬下限）：`concurrency ≥ 2` 才跑多并发聚合，np≤1 时仅单并发并显示跳过提示。

- **测试历史参数与被测服务命令不一致**：历史记录在测试结束后才采集 `params.snapshot()`，而服务实例用的是测试**开始**时刻的快照；模型加载等待（最长 180s）与测试运行期间通过面板/参数页编辑参数，历史行便记录了改后的值，与服务页显示的被测实例命令不符。现统一以开始时刻快照为「被测实例参数」：历史 `comboSnapshot`、多并发数 `benchConcurrency(snapshot)`、请求 `api_key`、np≤1 跳过提示的 np 全部取自该快照，测试期间的编辑不再污染历史记录（`onApplyCombo` 回填的也是真实被测参数）。

- **预设名称与绑定模型无法对应**：预设「应用」会连带把当前模型切换为预设绑定模型，之后若沿用列表中另一行的名字保存/覆盖，会把**新模型**写进**旧名**预设——名称与绑定模型不再对应（智能按名匹配命中后携带错误模型）。保存/覆盖入口新增名称↔模型一致性守卫（`isNameConsistentWithModel`：名称 ∈ 当前模型文件名候选，或模型为空=纯参数集，均放行；不一致时弹确认框说明后果，取消即中止）。

- **切换界面后 URL 历史不再弹出**：模型页三个子标签以 `v-if` 切换面板，切到「本地模型/下载任务」再回「模型库」时 `DownloadCard` 销毁重建，实例级 `urlHistory` 被清零、历史下拉无条目可弹。URL 会话历史抽取为 `useUrlHistory` composable（模块级单例，跨组件重建保留；应用退出进程结束才清空，语义不变），并补充 4 个单测（记录/去重置顶/上限/跨实例共享）。

- **preload `estimateVram` 第 4 参丢失修复（2026-09-04）**：`index.cjs` 包装只转发 `(modelPath, dtype, target)`，第 4 参 `occ`（会话参数驱动的卸载层数/上下文）在桥接层丢失——生产环境占用估算恒按 `ngl='auto'`/`ctx=0` 计算，「会话参数驱动」的硬件占用估算端到端失效（渲染端类型声明/调用点与主进程 handler 均按 4 参设计）；补全 4 参转发。

- **性能目标下拉面板实底化 + 未定义圆角 token 修复（2026-09-04）**：`.target-panel` 补做 #41「下拉/菜单实底」规范（`--bg-card` + `--border` + `--radius-row`，移除 `backdrop-filter`），并修复引用全仓不存在的 `--radius-dropdown`（圆角此前按无效值回退）——style-audit 第 7 条清单不再命中该点。

- **概览「最近问题」空态占位行高修复（2026-09-04）**：`.empty-text` 以 `line-height: 72px` 撑占位——违反行高语义化清单（style-audit #9 ❌）且 border-box 下 72px 已含父级 padding、实际超出预留区 12px；改 flex 居中 + `min-height: 60px`，空态/1–3 行高度严格恒定，style-audit 全绿（STYLE_TODO #49）。

- **bump-version CHANGELOG 头更新失效修复（2026-09-04）**：脚本以 `/^## \[Unreleased\]/m` 匹配标题，而 CHANGELOG 自 2026-09-01 格式化起为转义形态 `## \[Unreleased]`，替换静默 no-op——v0.0.11–v0.0.18 版本条目从未写入（git 历史佐证：该区间 chore(release) 提交对 CHANGELOG 零改动）；正则兼容两种形态并沿用文件现行转义风格，同时回填 0.0.11–0.0.18 缺失的版本标题（空壳，与 0.0.8–0.0.10 同款）。

- **文档一致性审计两轮清理（2026-09-03/04）**：横向核对全部文档与实现——数字层面（IPC 53/51→57、参数 58/49→59、GGUF 59→60、测试规模 core 25 文件/355 用例 + ui 5 文件/54 用例）；行为层面（`estimateVram` 缓存 key 补 ngl/ctx、checkbox 发射语义、`-md`→file 型依赖保留不清理、分组「蓝点」→橙描边、`buildSuggestions` 11 条无 ctx_size、下拉/菜单实底、圆角/间距 token、`server:bench` 多并发条件执行等 23+ 处）；STYLE_TODO 已修复明细移入 `docs/archive/style-todo-resolved.md` 只读留档、活动清单瘦身 694→110 行；README/AGENTS/frontend/params-system/core-modules/architecture/data-persistence/testing/ipc-channels/desktop-main/design-decisions 同步。


### 变更

- **模型下载取消推荐文件自动勾选**：模型库文件列表加载后不再替用户预选推荐文件，下载完全由用户主动勾选触发；推荐文件保留「推荐」徽标、行高亮与相关性排序置顶，仅作提示不作预选。`DownloadCard` 内提交下载逻辑抽取为 `enqueueFiles`（Store 去重 / 本地同名检测 / 后端 ID 回填三层校验不变），并新增过期 `listFiles` 响应守卫（快速切换仓库时不覆盖列表）。

- **预设文件结构升级 v2**：`presets/*.json` 内容结构化——`model` 从 `values` 中分离为顶层元数据字段（null = 纯参数集）、新增 `created_at`（覆盖保存保留首次创建时间）与 `app_version`（写入方版本，参数漂移审计）、`values` 仅含参数键（清除 legacy `_enabled` 残留）并按 `PARAMS` 定义顺序稳定序列化（重复保存零 diff 噪音）。`preset_version` 升至 2；读取 v1/无版本旧文件自动迁移到 v2 内存形状（下次显式保存才改写落盘），IPC 通道与保存入参不变。

- **移除参数独立启用机制（`_enabled`）**：参数无独立启用/禁用状态，改为「值 ≠ 默认值才发射 flag」（checkbox 恒发射、空串跳过、依赖门控），预设文件只存纯值快照；`buildCommand` 读到 legacy `_enabled` 直接忽略。相关死代码 `BASELINE_ENABLED_KEYS` 同步移除（实测依据保留为注释）。

- **性能测试迁至参数设置页**：BenchPanel 自服务页迁入「参数设置 → 性能测试」子标签（KeepAlive 保留测试历史），服务页不再包含性能测试；测试面板动态跟随「自定义参数」中值 ≠ 默认值的参数。

- **页面切换重构（PageHost）**：移除 `<transition mode="out-in">` 交接机制（快速导航时存在短暂双页同框窗口），改为 keep-alive 直接替换 + 路由 watch 容器 90ms 淡入；启动顺序改为挂载前完成设置加载与 last\_tab 恢复（3s 超时兜底），根治切页闪现与启动竞态。

- **UI 风格统一（STYLE\_TODO #21–#40）**：组件间距/分隔线节奏统一（分区线两侧 14px）；标签等列（110px 右对齐）；服务页五行信息改 boxed 值盒；参数还原按钮（clear-btn）重设计；移除全库按钮按压缩放（`:active scale`，防文字挤压拉伸）；应用 Logo 统一为 `AppLogo` 组件；模型页统计条精简 + 模型列表懒加载扫描；日志页提示条移除、按钮并入筛选行；模型元数据卡整合为单一「展开/收起」开关；参数摘要显示模型绝对路径（标签改「模型目录」）。

- **性能测试调优区与参数页样式统一**：「性能参数调整」卡从逐控件手铺 `tune-grid` 改为逐行复用 `ParamRow` 组件——悬停底色/描边、**非默认值** **`--warn`** **橙描边**、依赖未满足底色+警示图标、文件/目录类型文件选择控件与参数设置页完全同源（组件级统一，样式规范后续变更自动跟随，不再依赖两处各自维护）。`tune-grid` 与 `param-grid` 保持同配方网格。

- **移除「视觉效果」设置（固定默认玻璃形态）**：设置页「外观与语言」的视觉效果开关（毛玻璃/实底性能模式）连同 `fx_mode` 设置字段、`FxMode` 类型、`data-fx` 属性与 `theme.scss`/`surface.scss` 的 `[data-fx='off']` 回退块整体移除——视觉表现收敛为唯一默认形态（玻璃表面 + 果冻动效），不再提供实底回退开关（OS 级 `prefers-reduced-motion` 减弱动效仍生效）。旧 `settings.json` 中的 `fx_mode` 字段在加载归一化时自然丢弃。

- **IPC 常量生成化**：preload IPC 常量由 `scripts/generate-preload.cjs` 生成到 `ipc-constants.cjs`（`pnpm generate:ipc`），`verify-ipc-sync.cjs` 改为校验生成物未过期 + 防止手工内联回退。

- **仪表盘「最近问题」数据源**：改为消费应用日志（`logs:*`）的 warn/error 最近 3 条，不再对服务控制台输出做正则启发式分类。

- **API 地址语义收敛到 server store 单一来源**：新增 `server.apiUrl` 计算属性作为界面一切「API 地址」展示/复制的唯一来源（与真实服务状态绑定：`running` 取 `server.url`（为空回退 `http://host:port`）、`starting` 取推导地址、`stopped` 返回空串），全部消费方改为直接消费它——仪表盘 Q3、服务页状态卡（原本地 `apiUrl` 门控推导下线）、**状态栏**（`v-if` 与复制逻辑自 `server.url` 收敛，停止后 URL 条消失）与 **WebUiFrame**（iframe `webUrl` 自 `server.url||推导` 收敛，保留自身 `running` 门控作双保险）；页面/组件不再各自就地派生。修复：停止服务后 `onStatus` 只更新 `status` 不刷新 `url`，页面直读 `server.url` 会继续显示上次启动的已失效地址（状态栏同款残留一并根治）；现在停止态统一回落占位符（`—`/整条隐藏），标签位与复制按钮常驻、无值 `disabled`，运行前后行结构零跳动。

- **文档全面对齐**：frontend/params-system/core-modules/data-persistence/desktop-main/README 等文档与当前实现对齐（发射规则、双轨机制、PageHost、样式断言、下载常量、测试清单等；本次补记 §7.5.7「API 地址语义收敛到 server store 单一来源」与 server store 的 `apiUrl`）。

- **文档一致性审计与归档收敛（2026-09-03/04）**：STYLE_TODO 已修复明细（#1–#47 + 历史修复）整体移入 `docs/archive/style-todo-resolved.md` 只读留档，活动清单仅保留待修复项与已修复索引表（694 → 110 行），新增 #48/#49 已修复与 #50（状态小圆点 7/8 尺寸两制）待修复登记；frontend §7.5 相关引用同步指向归档。


## \[0.0.18] - 2026-09-01

## \[0.0.17] - 2026-09-01

## \[0.0.16] - 2026-09-01

## \[0.0.15] - 2026-09-01

## \[0.0.14] - 2026-09-01

## \[0.0.13] - 2026-09-01

## \[0.0.12] - 2026-09-01

## \[0.0.11] - 2026-09-01


## \[0.0.10] - 2026-08-22

## \[0.0.9] - 2026-08-21

## \[0.0.8] - 2026-08-21

## \[0.0.07] - 2026-08-21

## \[0.0.06] - 2026-08-20

## \[0.0.05] - 2026-08-20

### 修复

- **顶部模型快捷选择下拉栏聚焦样式异常**：打开下拉栏后点击「管理模型…」条目，其焦点描边环呈现"上半圆弧、下半平直"的非对称形状，与下方分割线叠加后下半部分风格不统一。双重根因：①全局 `:focus-visible` 规则设置了 `border-radius: var(--radius-control)`，会覆盖元素自身圆角（且鼠标点击也会命中）；②`.manage` 条目自身是「上圆角、下方角」的非对称圆角 `pill/0/0`，焦点环跟随该形状渲染即暴露不对称。修复：①焦点环只负责 `box-shadow` 描边、不再改 `border-radius`，由各元素自身样式决定形状；②`.manage` 改为统一 `--radius-control` 圆角，焦点环各边一致，仍靠斜体/次级色/分割线维持头部语义。

- **下载重复任务：同文件被多次加入下载队列**：已存在下载任务时，用户切换到其他页面再回到下载页、重新解析 URL 并点击其他文件后，「下载选中」会把推荐文件与用户点击的文件一并提交，导致同一文件被创建第二个下载任务。修复：①`onDownloadSelected` 新增三层校验——

  1. Store 去重：检查 `modelId + filePath` 是否已有任务，`completed`/`queued`/`downloading`/`paused` 均跳过并自动取消勾选，`canceled`/`error` 允许重新下载；
  2. 本地文件检测：通过 `system:fileExists` 检查目标路径是否存在同名文件，存在则跳过并自动取消勾选；
  3. 后端 `startDownload` 按 `localPath` 去重，命中时返回已有任务 ID，UI 侧移除重复本地任务。
     跳过文件时汇总提示用户原因（已在队列中/已完成/本地已存在）。

- **取消下载后 jsonl 日志残留与任务列表残留**：用户点击取消后，磁盘上仍残留 `.llama_dl.jsonl`，且被取消的任务仍显示在任务列表中。三重根因：①`cancelDownload` 拦截 `error` 状态提前返回，未清理文件；②`downloadWorker` 在段下载完成后无条件调用 `logSegmentDone` 写 `.jsonl`，该写入可能发生在取消逻辑之后，**覆盖取消时已删除的日志**；③`executeDownload` 在 `task.status !== 'downloading'` 时未区分取消/暂停路径，未清理残留；④UI store 对 `canceled` 状态仅更新任务状态、不从列表移除。修复：

  1. `cancelDownload` 允许 `error` 任务进入清理；`activeCount` 用 `prevStatus` 精确判断，仅 `downloading` 递减；
  2. `downloadWorker` 在 `logSegmentDone` 前检查 `status === 'downloading'`，取消/暂停后不写入；
  3. `executeDownload` 中断时仅在取消路径删除 `.jsonl` 与 `.part`（暂停保留以支持续传）；
  4. UI store 取消时**立即从列表移除**（不依赖异步 onProgress），后端 `onProgress` 事件作为兜底移除

- **下载未完成文件被模型管理提前检出**：下载过程改为写入 `<file>.part` 临时文件（`DownloadTask.partPath`），完整性校验通过后同目录改名成最终 `.gguf`。未完整下载的文件不再以 `.gguf` 出现，模型列表不会出现无法运行的损坏模型，模型目录监听也不会在下载期间反复触发；旧版本残留的未完成 `.gguf` 在续传时自动迁移为 `.part`。暂停/取消/续传语义不变（暂停保留 `.part` 与日志，取消清理 `.part` 与日志）。

### 增强

- **模型删除按目录内容智能取舍**：`models:remove` 由「递归删除整个模型目录」改为「按模型文件删除」。删除前判断模型所在目录：存在其他量化版本、用户创建的非 gguf 文件或子目录时**仅删除选中的量化版本**，保留其他内容；目录无其他内容时才连同相关伴随 GGUF（mmproj/mtp/dflash 草稿）与空目录一并删除。预设清理相应分支：整目录移除时按目录前缀匹配（覆盖该目录所有模型/伴随文件引用的预设），仅删文件时按文件路径匹配（不误删引用其他量化版本的预设）。

## \[0.0.01] - 2026-08-21

### 变更

- **版本号重置**：版本从 1.4.5 重置为 0.0.01，重新开始计数。

### 新增

- **`--reasoning-effort`** **推理力度参数**：thinking 子分组新增"推理力度"下拉，给聊天模板指定推理力度等级（`default`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`，空=不发送）；依赖思考模式非 `off`。

- **`--kv-unified`** **统一 KV 缓存开关**：kv\_cache 子分组新增"统一 KV 缓存"复选框（`--kv-unified` / `--no-kv-unified`）；默认关闭并纳入基线启用参数（初始化即下发 `--no-kv-unified`，应对槽位数 auto 时后端默认开启的整块共享缓存占用），需要时勾选启用。

### 变更

- **参数基线更新至 llama.cpp b10502**：重新固定 `docs/params/llama-server-help-out.txt`（flag 集合 414→415，新增 `--reasoning-effort`，无移除）；`--load-mode` 后端默认 `mmap`→`auto`（新增 auto 模式），应用默认保持实测推荐的 `none` 不动；应用 55 个 flag 全部存在于新 help，无缺失。

### 增强

- **性能测试单并发 + 多并发一体执行**：一次「运行测试」依次执行单并发（1 个请求）与多并发（并发数跟随 `-np`/parallel 值，>1 时取该值否则默认 4，上限 8）两个场景，历史表每次追加两条记录（多并发行带 `×N` 后缀，部分请求失败时标注失败数）；多并发场景聚合各成功请求的 tok/s 求和（多槽聚合吞吐）与 token 总数，部分失败时聚合其余成功请求、全部失败则整次测试报错。不新增任何测试按钮或控件。
