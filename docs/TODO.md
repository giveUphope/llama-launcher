# 待办与未决事项

本文件是**工程待办的唯一活归口**：CHANGELOG 条目只记已发生的事实，凡「未修 / 待确认 / 备查 / 待裁定」的事项一律登记在此，关闭后移至文末「已关闭」区并注明关闭版本。UI 风格类待办另有归口：[zh/style/STYLE_TODO.md](zh/style/STYLE_TODO.md)（双语两树）。本文件与 CHANGELOG 同属不译清单，只维护中文单份。

## 开放项

当前无开放项。（新登记请写在本节，关闭后整条移入下方「已关闭」并注明关闭版本；本文件保持**恰好一个** `## 开放项` 与 **一个** `## 已关闭`——两个同名 `## 已关闭` 加一个空 `## 观察项` 就是 T12 搬走时新建标题而非合并留下的，2026-10-10 已并回来。）

## 已关闭

### T14 `docs/CHANGELOG.md` 越过归档滚动阈值（2026-10-10 登记并关闭）

- **出了什么事**：AGENTS.md 定的规则是主文件超过约 100 KB 或累计 3–4 个版本，就把最旧的版本段整体搬进 `docs/archive/CHANGELOG-*.md`。登记时实测：主文件 **116.5 KB / 13 个版本段**（0.0.53 → 0.0.65 + `[Unreleased]`），上一轮开始前就已是 112.4 KB。
- **成因**：0.0.57–0.0.65 九轮连发，每轮条目按「出了什么事 / 改法 / 验证」长书写，归档一次没做过；归档区间当时止于 0.0.52。
- **关闭**：2026-10-10 把 **0.0.53–0.0.60 共 8 段**整段搬入新建的 [archive/CHANGELOG-0.0.53-0.0.60.md](archive/CHANGELOG-0.0.53-0.0.60.md)（103.7 KB）。主文件剩 **13.2 KB / 5 段 +** `[Unreleased]`（0.0.61–0.0.65），首段仍是最新已发布版本——`bump-version.cjs` 划段与 `verify-version-sync.cjs` 取标题都只认主文件，已复跑绿。**纯移动的可证明性**：搬运脚本先做逐字节对账「原文件 = 未改动的头部 + 被搬块（逐字节） + 尾部」，不通过就拒绝落盘；diff 中搬运自身只表现为被搬段的整段删除 + 开头指路行 1 行改写（同轮 `[Unreleased]` 新写的条目另计插入行，两个数别当同一个东西读）。被搬段落里有一处 `[TODO.md](TODO.md)` 在新深度下会断，按既有归档先例（`CHANGELOG-0.0.40-0.0.52.md` 里写的是 `../CHANGELOG.md`）改成 `../TODO.md`——只调链接深度、不动正文，这属搬运的必要修正。同步处：主文件指路行、AGENTS.md 的归档清单（补 `CHANGELOG-0.0.53-0.0.60.md`）。**踩到的一次门禁自证**：本条原先把「未来的归档文件名」写成了真实路径样式，被 `check-docs-links` 判死路径——占位名请写成 `docs/archive/CHANGELOG-<start>-<end>.md` 形式。

### T13 设置页「忽略引擎提示」的忽略状态存不进磁盘（2026-10-10 登记并关闭）

- **出了什么事**：在设置页引擎行下方点「忽略」关掉某条提示，界面当场安静，但**重启应用后提示又回来了**，而界面上没有任何报错。
- **成因（逐处实测）**：`packages/ui/src/components/settings/GeneralPanel.vue:276` 写入 `settings.engine_hint_dismissed`（UI 侧按 `HINT_DISMISS_CAP = 50` 裁剪）后调用 `settings.save()`；`packages/shared/src/types/settings.ts:44` 声明了该字段；但 core `packages/core/src/settings-store.ts` 的 zod `settingsSchema` **没有这个键**，`normalizeSettings` 对未知键的既定行为是剥除，于是它永远进不了 `settings.json`；启动时的配置诊疗（`healSettingsFile`）还会把盘上手工添加的同名键当 `unknown_keys` 清掉。
- **同型排查**：把 `AppSettings` 的 16 个键与 `settingsSchema` 的 15 个键逐个对拍（脚本取数，非目测），差集只有 `engine_hint_dismissed` 一条，schema 侧无多余键——即「类型声明有、schema 没有」当时唯一一例。
- **关闭**：2026-10-10 采纳裁定 ①，在 `settingsSchema` 补 `engine_hint_dismissed: z.array(z.string()).optional().catch(undefined)`（zod 4 下 `.catch(undefined)` 必须挂在 `.optional()` 之后才过类型），并加四条判据：`settings-store.test.ts` 的「写入后落盘并可载回」/「脏数据回退 undefined」/「键缺失不凭空补空数组」，`config-doctor.test.ts` 的「已声明的字符串数组字段不被当未知键剥除」（同一条文件里混进真未知键时只剥 `session_values`、留下数组字段，且修复后复跑必干净）。测试规模随之 core 40 文件 / **558 → 562** 用例（AGENTS.md 与中英 `testing.md` 的规模行同步校准，全绿实跑）。文档侧 `docs/{zh,en}/data-persistence.md` 的该字段行已由「落不进磁盘」回改为「随 `settings.json` 落盘」。
- **留下的教训**：新增 `AppSettings` 字段时必须同轮进 zod schema，否则界面写入照常、磁盘静默丢弃；判据写法是「save→load 往返 + 该键在盘上的存在性」，光测内存对象等于没测。

### T12 b11524 引擎 help 漂移——切换日常引擎前必须 re-pin（2026-10-09 登记并关闭）

- **漂移内容**（登记时实测）：`--port` 默认 8080 → 9931（有咬合：不 re-pin 直接切引擎，端口缺省的会话不发 `--port` 而引擎听 9931，界面探活落空）、`--moe-cache-mib` 新增、应用 flag 无缺失。
- **关闭**：2026-10-09 按用户裁定完成 §5.5 re-pin 全流程（help 基线替换、`moe_cache_mib` 入表、`port` engineDefault 跟随 9931 + note、`ENGINE_BASELINE_BUILD` 与 6 处声明、对照表重生成、13 处计数声明 + 门禁句式外活声明），`verify-params-sync` 六类校验 / 全门禁 / 单测 548+212 / e2e 84 全绿。**切换注意**：re-pin 后 b11408 相对新基线已「更旧」——仍钉 b11408 的环境（本机 `settings.json` 未动）会开始出现「参数基线可能已过期」提示，这是方向性告警的设计行为；在设置页把引擎目录切到 `llama-b11524-bin-win-vulkan-x64` 后即静默。`moe_cache_mib` 未入 `PROPS_FIELD_MAP`（b11524 的 /props 是否回读该字段未验证，未映射即不出声，无假报风险）。

### T06 「引擎比基线新 ⇒ 静默」分支缺真机证据（2026-10-09 关闭）

用户放入新引擎 `llama-b11524`（build 11524 > 基线 b11408），阻塞条件解除，真机实测两向收敛。**正腿（T06 本体）**：经 core `Launcher` 真起 b11524 服务（真 fetch 打 /props），回读结论 `buildInfo="b11524-86a283532"`、`baselineDrift === null`——比基线新的引擎**保持静默**，不再提示基线过期；回读本身健康（model 已校验、14 项按 onlyWhenSent/modelDerived 规则跳过、无 error）。**阴性对照（同脚本同机）**：b10754（旧于基线）如实测得 `baselineDrift = { engineBuild: "b10754", baselineBuild: "b11408" }`——证明静默来自方向性判定正确工作，不是检测器失明。顺带发现：本机设置页钉的仍是 b11408，静默分支的 UI 呈现（概览状态卡与设置页引擎提示均只在 `baselineDrift` 非空时出声）消费同一份 core 结论，core 层 null 即两层都安静。详见 T12——同轮审计发现 b11524 help 有漂移，切换前须 re-pin。

### R01 v0.0.55 / v0.0.56 发版失败，版本号延续补发（2026-10-09 登记并关闭）

- **出了什么事**：v0.0.55 与 v0.0.56 两次推送的 CI `verify` job 红牌（run 37865210758、37910555980，ubuntu 上 `modelParamsKey` 跨平台键漂移与 `dev-session-integ` 组杀超时两项，本地 Windows 全绿无感），`release` job 被连坐跳过——**两个版本均未发版**（tag 与 GitHub Release 停在 v0.0.54）。
- **原因**：① 两处失败都是 Linux 特有契约（`basename` 平台分隔符、进程组组长前提），本地 Windows 测试对这类契约零证明力，推送前无从复现；② verify 红牌连坐 release（`needs: [verify, changes]`）；③ **changes job 的 dorny 过滤反向 bug**（0.0.56 换 dorny 时引入）：默认量化器 `some` 无视 `!` 排除，`doc` 过滤「任一文档文件命中即 true」被当成「纯文档变更」——混合推送（代码+AGENTS.md）被判纯文档，e2e 与 release **静默跳过**。实证：run 37923177708（红牌修复后推送）verify 已绿、release 仍跳，据此把 ③ 从 ② 里剥离定位。
- **修复**：① 两处实现/测试修复随 f12a729 提交；② **版本号不跨版**：七处版本声明从 0.0.56 回落 0.0.55，CHANGELOG 的 [Unreleased]/[0.0.55]/[0.0.56] 三段合并为 [0.0.55] 一段（附补发说明），原定 0.0.56 的全部变更并入 v0.0.55 一次发出，**后续发版自 0.0.56 起继续递增**，不跳号；③ changes job 改 `code` 过滤 + `predicate-quantifier: some-with-excludes`（aa3da8d，ci-cd.md §1.3 双语同步）。
- **关闭确认（2026-10-09）**：run 37923878429 四 job 全绿（verify / changes / **e2e 恢复执行** / release），tag v0.0.55 已打，Release **v0.0.55 发布成功**（资产 `llama.Launcher.0.0.55.exe`，packaging.md 的实测陈述重新为真）。经验教训：本地 Windows 全绿对 Linux 特有契约无证明力，CI 特有失败只能靠 CI 暴露——发版后应回看 run 的 job 是否**真的都跑了**（skipped ≠ 通过）。

### T03 `partialOffloadLayers` 不计 GPU 侧 KV，auto 层数系统性偏多（2026-10-09 关闭）

真机实测翻案后落地修复。**测量**（b11408 + RX 7900 XTX + Qwen3.8-27B Q3_K_XL 真实 GGUF 头与引擎 buffer 日志）：每层权重实测 ≈191 MiB（公式 192.9，偏差 <1%）、KV@8k/q8_0 实测 272 MiB（公式 289，~6%）——公式基本量可信；**偏差由上下文决定**：ctx=8192 只偏 1 层（~0.4 GiB），ctx=262K（训练上限）偏 7~25 层（**8~13 GiB**）。且启动器基线 `--fit off`（引擎自带适配实测会中止留劣化状态），估算器是唯一防线。**修复**：`partialOffloadLayers` 增可选 `ctxTokens`/`dtypeBytes`——预算按「每层权重 + 每层摊到的 KV」折算，ctx 未知回退纯权重口径；`estimateOccupancy` auto 分支与 `recommendOffloadAdvice` 减负 `-ngl` 接上会话 ctx/KV 档位（`recommendForTarget` 增可选 `session` 尾参；`system:estimateVram` 从 occCfg 取值，`ctx_size=0` 按训练上限折算 = `-c 0` 的引擎回退语义）。修完后「建议层数」与「占用/fits」首次自洽（旧实现 auto 档自己都会报 `fits=false`）。用例：vram-solve +2（KV 口径 28→18、ctx 未知回退）、occupancy auto 大 ctx 自洽 fits（旧口径同档 `fits=false` 钉进注释）、target-recommend 减负 `-ngl` 带会话 27→17 / 缺省 27。**边界如实记录**：本机 24 GB 卡装得下全部本地模型，「建议层数 → 实际起服务装载结果」的端到端观察不可得（部分卸载路径无法自然触发）；已验证的是机制层（每层权重/KV 折算公式被引擎实测数字钉住）与估算自洽性。

### T05 e2e `offload-advice.spec.ts` 第 ④ 条偶发红（2026-10-09 关闭）

观察期届满零复现：登记后经 `--repeat-each=12` 定向复跑（108 条）+ 三轮全量 e2e（84×3）全绿，CI 侧 2026-10-07 起该规格亦无红牌记录。按本条「长期不复现可关闭」的预定判据关闭；若 CI 再现，凭 trace/screenshot 重新登记。

### T07 「有新日志」胶囊缺一次真机目测（2026-10-09 关闭）

挂起理由「mock 造不出场景」已失效——mock 的输出流每 2.5s 推一行（`startOutputFeed`），「滚离底部 + 新日志到达」可直接造出。浏览器目测：拨离底部 600px 后等节拍，胶囊出现于控制台框内右下角（10px 边距，82×27px，`insideBox` 判据通过），压字底色为 accent 22% 混 `--console-bg`、文字清晰可读。**点击回底未在本环境目测**（浏览器窗口被遮挡时 Chrome 暂停帧生产，rAF/scroll 事件停摆——环境假象，非应用行为；该行为由 e2e `logs-scroll.spec.ts` 覆盖，连续三轮全绿），用户日常 `pnpm dev` 时顺带一瞥即可。

### T11 e2e `arco-locale.spec.ts` zh/en 态偶发红（2026-10-09 关闭）

与 T05 同轮观察期届满：`--repeat-each=12`（24 条）+ 三轮全量 e2e 全绿，期间未动任何 i18n/locale 代码。按预定判据关闭；CI 若再现再凭 trace 定性。

### T08 清理卡「上次清理结果」切走期间不自刷新（2026-10-09 关闭）

按裁定 A 修复，**mock 目测抓到初版无效并修正**：初版只给卡片加 `onActivated` 轻量重扫，但浏览器实测回切后待清列表仍丢失——根因是卡片状态的存活期根本盖不住「回切」：① 设置页页签状态存 URL query，侧栏往返丢 `?tab=advanced`；② 即便 query 保留，`AdvancedPanel` 也是页签 v-if 直接销毁（include 名单只有 GeneralPanel），卡片连缓存容器一起死。修法按 GeneralPanel 先例把缓存上移：SettingsPage 的 KeepAlive 名单扩为 `GeneralPanel,AdvancedPanel`（四面板收进同一 KeepAlive、v-if 链改 v-else-if），面板跨页签存活后 `onActivated` 重扫才真正触发；AdvancedPanel 内层不再包 KeepAlive（放那里会连缓存容器一起被页签 v-if 销毁）。重扫语义不变：**不清「上次清理结果」行、不自动弹窗、不自动清理**（检测逻辑抽成 `runDetect`，按钮路径保留「清空旧态」）。用例：TrashCleanCard.test.ts 以真实 `<keep-alive>` 驱动三判据（首挂不扫 / 回切扫一次 / 不触发清理与确认弹窗）；mock 页两场景目测通过（页签往返 / 页面往返后回点页签）。

### T09 切页后滚动位置不恢复（2026-10-09 关闭）

**实测翻案**：mock 探针证实 0.0.52 的失败前提已消失——#82 骨架链改版把纵向滚动下移进每页自己的 `.page-frame`（随页面组件被 keep-alive 缓存），切回时内容高度**立即**等于离开前（2654 == 2654），不存在「容器还没长回原高度」。恢复实现因此极简：新增 `useScrollRestore.ts`（watch `route.fullPath`：离开前存旧页 `{scrollTop, scrollHeight}` → `nextTick` 后写入；等待循环只作异常路径兜底，30 帧上限强制写入；快速连切打断未完成的恢复），PageHost 接线。判据：`useScrollRestore.test.ts` 4 条（rAF 手动桩：就绪即写 / 逐帧等高度 / 30 帧上限 / 连切打断）+ `e2e/web/scroll-restore.spec.ts`（参数页滚到底 → 日志页 → 切回 scrollTop 保留，行数等齐再滚——首轮 flaky 教训：69 行异步挂载未齐时「滚到底」只滚到 51px，样本失效）。连续三轮 e2e 全绿。

### T10 下载进度条是否加 width 过渡（2026-10-09 关闭）

按裁定 B 落地：`.task-progress-bar` 的 `transition: width var(--dur-fast) linear`——160ms token 与 120ms 推送节拍构成「追赶式」平滑（每次推送在上一段过渡未完时重启，观感连续无节拍感）。时长走 `--dur-*` token 是 style-audit 第 8/14 条的硬要求，故不写字面 120ms；transition 窄化到 width 单属性，不用 Arco 默认 `all`。`pnpm style:audit` 24 条全绿（token 写法天然合规，无需登记例外）。

### T01 未知大小下载生成 `end=-1` 段，空 .part 秒「完成」（2026-10-09 关闭）

修复比登记时预想的深——不止 `createSegments` 一处，是「无界段」语义的完整收口（5 处）：① `createSegments` 未知大小时产出 `end: Infinity`（此前误写 `totalSize-1` 负值，worker 认领条件永假 → 空 .part 秒「完成」）；② 新增 `Segment.done` 完成标记——无界段没有数值终点，不做此标记 worker 会把已完成的段无限重认领；③ 续传日志以 `-1` 哨兵落盘/重放还原（JSON 无法承载 Infinity）；④ `download-log.ts` 两处校验放行哨兵（`validSegmentStart` 的 `end>=start`、重放进度范围检查）；⑤ 续传文件上界校验对未知大小跳过（`totalSize<=0` 无「文件大于总量」可言，否则断点续传恒作废）。用例：无界段 `bytes=0-` 全量落盘（200 全文件回退）+ 中断续传 `-1` 哨兵往返从断点继续（download-manager-edge）。

### T02 `solveMaxContext` 两处 Infinity→null 分支不可达（2026-10-09 关闭）

删除两处死分支：`fullCtx` 恒为有限值（预算/权重有限、kvBpt>0 已在入口拦截），且各返回点都保证 `fullCtx < trainedCap`，故 `min(trainedCap, …)` 不可能产出 Infinity——`finishFull` 与「全卸载直达上限」分支的 `=== POSITIVE_INFINITY ? null` 判空永假。trainedCap 的 Infinity 保留为「无训练上限」内部哨兵，行为零变化（vram-solve 既有 10 用例原样全绿即证）。

### T04 `appLog.subscribe` 对 `list()` 异步拒绝无兜底（2026-10-09 关闭）

`subscribe` 的初始 `list()` 挂 `.catch` 静默兜底：初始缓冲拉取失败（权限/磁盘）不再产生 Unhandled Rejection，live 推送订阅照常挂接。新增异步拒绝用例（appLog.test.ts，同步 throw 与异步拒绝两条形态的注释也一并厘清）。
