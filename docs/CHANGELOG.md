# 更新日志

本项目所有显著变更都记录在此文件。版本遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## \[Unreleased]

## \[0.0.47] - 2026-09-25


- **修复「界面显示的默认值其实没生效」：发射判定基准从界面初值改为引擎缺省值**：用户报「实际启动命令与预览不一致，命令生成逻辑有问题，需要先分清多个不同默认值的定义」，并附真机命令（`llama-b11178` + Qwen3.6-35B IQ1_M）。先确认两条路径不可能有两套逻辑——预览与启动都调 `core` 的同一个 `buildCommand`、传的都是 `params.snapshot() + settings.settings`，用用户机器上持久化的 `session_values` 复算得 28 个 token 与其贴出命令逐 token 相同，故差异不在生成器。真病根是 `ParamDef.default` 一值两用：它既是界面初值、又是「值 == 默认就不写进命令行」的判定基准，而 `definitions.ts` 文件头 2026-08-15 的**基线推荐值**（`cache_type_k/v` = q8_0、`load_mode` = none、`fit` = off）恰好就等于 `default`——于是这三项推荐**从来没送达引擎**（help 里 `-ctk/-ctv` 默认 **f16**、`--load-mode` 默认 **auto**、`--fit` 默认 **on**，方向相反），用户在界面上看到的档位只是文字。连带缺陷：服务页 OOM 缓解钮「KV 量化」就是把 ctk/ctv 设成 q8_0，值已等于应用默认 → 点下去命令零变化、静默无效。修法：① 新增 `packages/shared/src/params/engine-baseline.ts`，60 条逐个登记 `engineDefault`（取自 help 基线）、`sentinel`（显式「不指定」值，如 `chat_template` 的 `none`、`kv_unified_per_slot` 的 0）、`note`（`default ≠ engineDefault` 时必填，说明为何故意覆盖引擎缺省）；② `command-builder.ts` 的 `shouldSkip` 改按 `engineDefault` + `sentinel` 判定，checkbox 恒发射与依赖判定（看的是"用户动过没有"，仍用 `default`）不变；③ `verify-params-sync.cjs` 新增第四段对拍——键集与 `PARAMS` 双向相等、help 可解析出 `(default: X)` 的必须等 X、条件式默认与覆盖项必须有 note、**解析不到条目直接 fail**（防结构改版后静默空转）。验证：默认状态发射集合从 9 项变 13 项（新增 `--load-mode none`、`--fit off`、`-ctk q8_0`、`-ctv q8_0`），快照钉死在 `command-builder-definitions.test.ts`（含「基线推荐值必须真的发射」专条 + 「每个非 checkbox 参数都有可发射取值」结构断言，防选项被引擎缺省/哨兵吃光）；旧表驱动用例按新契约重写，`spec_type='none'` 一条改为断言不发射且不被改写成 `draft-simple`。core **373** + ui 75 用例、`pnpm lint`（含新对拍：help 可对拍 49 项全等、条件式 5 项、覆盖 4 项均有 note）、`pnpm e2e:web`、`pnpm style:audit` 13 项全绿。**负测试四项全咬住**：漏登记参数、engineDefault 填错（实测抓到我手填的 `reasoning_format` 'none'，真值 auto）、覆盖引擎默认却不写 note、留孤儿条目，各红一次后还原复绿。文档同步 `docs/{zh,en}/` 的 params-system §5.1/5.2、core-modules §4.3、design-decisions 第 1 条与第 18 条（**订正 2026-09-20 一版写下的「后端沿用自身默认，恰好同向」这一错误论断**）、architecture 结构树与脚本清单、`AGENTS.md` 两条约定；`verify-i18n-usage.cjs` 的裸中文扫描白名单加入 `engine-baseline.ts`（`note` 是开发者读的说明，与 definitions.ts 的中文注同性质，永不进界面）。

- **参数页自定义分区改为可折叠 + 命令预览标明"运行中≠当前"**：① `Card.vue` 新增 `collapsible` + `v-model:expanded`（卡片头整体换成 `a-button` 切换钮、`chevron_right` 旋转 90° 作展开指示、折叠时隐藏 `arco-card-body` 不留空档），ParamsPage 的 13 个子分类分区接入，标题右侧 `a-tag size="small"` 显示「N 项已改」（分区计数一次算好随数据携带，不在 `v-for` 里逐行求值），状态条加「展开全部分区 / 折叠全部分区」两钮；默认全展开、折叠态为会话内 `ref`（keep-alive 下跨页签保留，重启回全展开）。之所以给既有 `Card` 加能力而不是改用 Arco `a-collapse`：后者会让参数页与其他页的分区出现两套容器体例，正是本仓库反复批过的「同页/跨页混排即不统一」。② 预览可信度：`CommandPreviewCard` 在服务运行中且启动快照与当前参数有差异时，于内置命令框下出一行橙色提示（`params.countDiffers(server.runningValues)`，忽略 mmproj/草稿路径等自动检测字段，含差异项数与「重启后生效」），避免用户把「下次启动会用的命令」误读成"正在跑的"——这正是本次误报被放大成「严重问题」的认知路径之一。新增 i18n 键 4 个（zh/en 各 382 键）。

## \[0.0.46] - 2026-09-25


- **修复服务运行中界面误报「异常退出」，并把进程判定权收归核心状态机**：用户报告「模型正常在服务，服务日志出现报错时状态机短暂误报异常退出，稍后又自动恢复为运行中」。根因是判「崩了」用的不是进程状态而是日志文字——`stores/server.ts` 的 `effectiveStatus` 看最近 80 行里有没有 `error|failed|unable` 字样，而 llama-server 拒绝单个越界请求时必然打 `E srv  send_error: task id = N, error: request (481560 tokens) exceeds the available context size (95744 tokens)`（用户实测日志原文，上下文 95744、请求 48 万 token），进程活着就被判死；因为是 80 行滑动窗口，日志再滚过 80 行它自己就"恢复"了，误报时长完全取决于出日志快慢。改法是把判定权交回唯一知道真相的地方：① `shared` 新增 `ServerStopInfo { reason: exited|spawn_failed|stopped_by_user, code, signal, hadBeenReady, at }` 与 `ServerStatusEvent { status, stop }`，`ServerInfo` 加 `stop` 与事件同源，`refreshStatus()` 拿不到比事件旧的停止事实；② `core/launcher.ts` 在 exit 时记事实（曾就绪 + 非 0 或有信号 = 崩，未就绪 = 启动失败），`stop/stopSync/forceStop` 先置 `stopRequested`——**Windows 下 `taskkill /F` 的退出码不是 0，只靠退出码分不出「用户停的」与「自己崩的」**，另把 `process.ts` 用来归一「被信号杀死」的 `-1` 还原成 `null`，`start()` 清空上一轮事实（跨轮污染由事实清空替代原先的 `runStart` 下标边界）；③ 渲染层 `effectiveStatus` 只按事实派生，删掉 `FAIL_RE`/`tailHasFail`/`runStart`/`OutputLine.fail` 整条文字猜测（控制台着色 tone、OOM 警示、端口占用提示不动，它们不参与状态）；④ `demo-mock` 改发同形状事件。验证：core **369** + ui **75** 用例全绿（新增 8 条覆盖越界行不翻转/崩溃/主动停/启动失败/干净自退/-1 归一/跨轮不污染）、`pnpm e2e:web` 15 通过、`pnpm lint` 全绿。**负测试**：把旧文字判定临时塞回 `effectiveStatus`，恰好两条回归用例变红（`expected 'crashed' to be 'running'`、`expected 'failed' to be 'starting'`），证明确实咬得住。文档同步 `docs/{zh,en}/core-modules.md`（§4.2 加停止事实一条 + 修正 `forceStop` 与 `before-quit` 的行号引用）、`ipc-channels.md`（`server:status` 兼反向推送载荷）、`frontend.md`（server store 行加 `stopInfo`）、`AGENTS.md`（新增「进程死活只由核心状态机判定，渲染层不得猜」约定）。

## \[0.0.45] - 2026-09-24


## \[0.0.44] - 2026-09-24


- **新增中英双树配对门禁 `scripts/verify-doc-pairs.cjs`（接入 `pnpm lint` 第 6 项）**：用户选定「加结构配对门禁，拦住大部分漏同步」。逐对（`docs/zh/x.md` ↔ `docs/en/x.md`）硬拦四类：① 两树同名成对，缺一侧即 fail（含"只有英文、没有中文"这种反向错误，中文是权威版）；② 语言行必须存在且指向真实对侧文件；③ 结构形状相等——标题数、层级序列、`N.x` 编号序列、表格行数、代码围栏数、列表项数；④ `x.y.z` 版本串集合相等。**有意不比整篇数字多重集**（先量后定）：拿全量数字对拍时 15 篇里有 3 篇报差异，逐条看全是语言差异而非内容漂移——中文「收尾二批/三批/六批」英文写 "batch 2/3/6"、「退出码非 0」写 "exits non-zero"、中文裸写 140 英文写 140px；带单位与反引号数字也仍有 3 篇误报。这类检查长期误报的下场是被调松或绕过（本仓库已为"只打印不拦"记过账），故数字改由三个声明门禁按各自语言句式精确兜（`verify-ipc-sync` / `verify-params-sync` / `verify-version-sync` 均已递归覆盖两树）。**负测试四项全咬住**：删英文语言行 → 报「缺语言行」；删 `docs/en/ipc-channels.md` → 报「中文侧有、英文侧无」；删 `docs/en/frontend.md` 的 `#### 7.5.1` 标题 → 一次报出 headingCount / headingLevels / headingNumbers 不等 + 版本串缺 `7.5.1` 共 4 条；还原全部复绿。**顺带抓到并修掉一处真漂移**：`STYLE_TODO #65` 中文写「静态审计 12 条与单测均无法覆盖」（该条目记录时的历史事实），英文镜像被写成了 "13 static audit checks"——按中文权威改回 12，并在约定里写明"历史条目的数字不顺手更新成今天的值"。文档同步：`AGENTS.md`（脚本清单 + lint 组成 + fail 条件 + 文档双语规则两条改写为"门禁兜住三层、兜不住散文语义"）、`docs/{zh,en}/workflow.md`（lint 表行 + 编写约定第 6 条）。验证：`pnpm lint` 全绿（4 包类型检查、56 通道、60 参数、6 处版本、309 条链接、15 篇配对、i18n 378 键、oxlint 0 告警）。

- **中文版设为默认展示：`README.md` ↔ `README.en.md` 对调**：用户要求「中文版作为默认展示，英文版可切换」。GitHub 进仓库渲染的就是根 `README.md`，所以默认语言由文件名决定、只能靠对调实现：`git mv README.md README.en.md && git mv README.zh-CN.md README.md`，两份顶部语言行互指（中文侧指 `README.en.md`，英文侧指 `README.md`），徽章锚点各留本语言版（中文 `#技术栈`/`#许可证`、英文 `#tech-stack`/`#license`）。连带同步 6 处：`docs/en/**` 15 篇的 `Index:` 行改指 `README.en.md`（中文树继续指 `README.md`，语义正好变对）、`check-docs-links.cjs` 与 `verify-ipc-sync.cjs` 的清单、`bump-version.cjs` 第 5 步清单与头注释、`.github/workflows/ci.yml` 的纯文档 pathspec（`README.zh-CN.md` → `README.en.md`，漏改会让只动英文着陆页的提交被判非文档、白触发发版）、`generate-params-doc.cjs` 英文表头的 Index 行（已重生成两份对照表）、`AGENTS.md` 的 README 条目与 bump 说明。**参数计数门禁改成两条各管一侧**：`README.md` 认中文句式 `**(\d+) 个** \`llama-server\` 参数`、`README.en.md` 认英文句式 `**(\d+)** \`llama-server\` parameters`——负测试把两边各改成 61/62，门禁一次报齐两行并 exit 1，还原复绿。验证：`pnpm lint` 全绿（44 篇 md / 309 条链接与锚点、56 通道、60 参数、6 处版本一致、i18n 378 键、oxlint 0 告警）。

- **文档双语规则写清「英文不是自动产物」**：用户确认问题「每次只改中文，英文是否自动联动」——答案是**不会**，本轮把这一点从隐含共识变成成文规则，避免后来者按错误预期干活。`AGENTS.md`「文档双语规则」新增两条：① **英文不是自动产物**——`docs/en/**` 是独立文件，唯一的自动生成物是参数对照表（`generate-params-doc.cjs` 一次产出中英两份），所以「只改中文就收工」等于任务未完成；同时讲明门禁能兜住什么、兜不住什么：**数字与链接**兜得住（两树通道数 / 参数总数 / 分组数 / 版本号不等即 fail，三个门禁都递归覆盖两树），**散文语义漂移**兜不住；② **同步纪律**——改完中文对英文做三步机械对账（标题数与编号、表格行数与围栏数、数字 token 集合 `grep -o '[0-9]\+' | sort | uniq -c` 对拍）。`docs/{zh,en}/workflow.md` 文档编写约定同步该口径。

- **文档按目录分类重构为中英双树：`docs/zh/` + `docs/en/` 成对，15 篇 × 2 全部互链**：用户要求「检查文档按目录分类；所有文档均需存在中英独立文档和互 refer 链接」，四项取向经确认选定（拆 `docs/zh/`+`docs/en/`、主题文档+风格清单出英文版、加 `README.zh-CN.md`、标题下加语言行）。
  - **分类检查先做**：`docs/` 共 5322 行 md，顶层平铺 13 篇主题文档 + `CHANGELOG.md`，只有 `params/`、`style/`、`archive/`、`badges/` 四个子目录——**「入门 / 架构 / 工程发布」四类分组只存在于 README 文档地图的文字里，目录上没有体现**；章节编号还是三套并存（`data-persistence.md` 用全局 CODE_WIKI 编号 `## 9`、`ci-cd.md`/`auto-release.md`/`architecture.md` 各自从 `## 1.` 重排、其余 6 篇完全无编号标题），跨文档引用靠「文档名 §N.x」，所以**编号一律保留不动**，只按语言分树。
  - **迁移与链接**：13 篇主题文档 + `style/STYLE_TODO.md` + `params/LLAMA_SERVER_PARAMS.md` 用 `git mv` 进 `docs/zh/`（`CHANGELOG.md`、`archive/`、`badges/`、语言无关的 `params/llama-server-help-out.txt` 留在原位）；两树同深度，故文内相对链接写法完全一致，只需把 `../README.md` 类上跳补一级。迁移后一次性修 60 条断链，并把 `AGENTS.md`（19 处散文路径 + 链接）、两份 README、`docs/CHANGELOG.md`、`docs/archive/**` 的引用全部对齐；`README.md` 文档地图改指 `docs/en/*`、`README.zh-CN.md` 指 `docs/zh/*`（着陆页只链本语言树）。链接数 145 → **310 条 / 44 篇**全绿。
  - **配对与互链机制**：每篇标题下第三行是语言行（中文侧「语言：中文 · 」+ 指向 `../en/` 同名文件的链接，英文侧对称指 `../zh/`），15 篇双向齐备；按选定方案**不新增配对门禁**，规则写进 `AGENTS.md`「文档双语规则」与 `docs/zh/workflow.md` 文档编写约定（新增第 6 条双语同步方向、第 7 条不译清单：`CHANGELOG`/`archive`/help 基线/徽章保持单份）。约定里明确**示例不得写成方括号链接**——`check-docs-links.cjs` 会连行内代码里的链接示例一起解析，早期草稿因此自造了 4 条假断链。
  - **门禁必须跟着改，否则翻译=关掉检查**（这是本轮真正的风险点）：`verify-ipc-sync.cjs` 的文档扫描原只读 `docs/*.md` 顶层，两树整体落到检查之外，改为**递归 `docs/zh` + `docs/en`** 并继续跳过 `CHANGELOG`/`archive`；`verify-params-sync.cjs` 的 `DOC_PARAM_CLAIMS` 由 5 条中文式样扩到 **10 条**（`docs/zh/*` 5 条 + `docs/en/*` 5 条，另加 `README.zh-CN.md`），参数三方对拍同时校验**中英两份对照表**；`verify-version-sync.cjs` 收 `docs/en/architecture.md` 的版本表行（五处 → **六处**）；`bump-version.cjs` 第 5 步清单补 `docs/en/packaging.md`、`docs/en/architecture.md`、`README.zh-CN.md`（AGENTS.md 的「新增版本声明处两件事都要做」按此执行）；`generate-params-doc.cjs` 改为**一次产出中英两份**（`docs/{zh,en}/params/`），杜绝手改单侧；`check-docs-links.cjs` 的 `EXTRA_FILES` 加 `README.zh-CN.md`；`.github/workflows/ci.yml` 的纯文档 pathspec 加 `README.zh-CN.md`（否则只改中文着陆页也会被 `changes` 判成非文档、白触发一次发版）。
  - **负测试（三项，全部先红后还原复绿）**：英文侧把 `PARAMS (60:` 改 61 → params 门禁 exit 1；把 "`IPC` (56 channels)" 改 57 → ipc 门禁点名 `docs/en/core-modules.md:197`；把 `docs/en/architecture.md` 版本表改 0.0.42 → version 门禁报「应为 0.0.43」。不测这一轮，英文镜像就是「看着有、其实没人管」。
  - **顺带修掉两处真实文档缺陷**：① `core-modules.md` 模块表 `retry.ts` 行的说明列在历史上被截断成「重试」，尾巴「|判定与退避（§4.9）」挂到了 `types.ts` 行末尾（表格错列），两树各自修好；② `testing.md` 写「两者均为手动执行」但表里只有一行——补上 `scripts/integ_devsession.mjs`（模拟 `turbo run dev` 进程树验证 `findDevSessionRoot` + `killProcessTree` 杀树）后中英一致。
  - **英文镜像的忠实性核对**：逐篇比对标题数、表格行数、围栏数与数字 token 集合（如 `STYLE_TODO` 中英均 36 标题 / 29 条目 / 79 表格行；`frontend.md` 219 行对 219 行；数字 60/22-28-10/56/124px/418px/8195/5000 全等）；代码标识符、路径、命令、i18n 键、`bump-ignore` 标记一律原样保留（英文侧该注释已改为纯英文说明，`bump-version.cjs` 只认 `bump-ignore` 这个 token，保护仍然生效）。
  - 验证：`pnpm lint` 全绿（4 包类型检查、IPC 56 通道 + 两树通道声明对拍、参数三方对拍中英双表 + 10 条计数声明、6 处版本一致、310 条文档链接与锚点、i18n 378 键、oxlint 207 文件 0 告警）+ `pnpm test` 全绿（core 362 + ui 69）。本轮无渲染层改动，故未起 mock 预览页。

## \[0.0.43] - 2026-09-24


- **README 改写为英文（连带把两道文档计数门禁改成中英双式）**：承接上一条瘦身后的骨架逐段重写（非对译）为英文着陆页——`What it takes off your plate` / `Highlights` / `Quick start` / `How you use it` / `Project layout` / `Tech stack` / `Documentation map` / `License`。四处连带处理：① **徽章锚点随标题改**（`stack.svg` → `#tech-stack`、`license.svg` → `#license`，正文内链 `#documentation-map`；`check-docs-links.cjs` 的 GitHub 风格 slugify 同时支持中英锚点）；② **翻译把门禁翻空了**——`verify-params-sync.cjs` 的 `DOC_PARAM_CLAIMS` 里 README 那条写死中文句式 `/(\d+) 个参数与 llama-server/`，英文 README 不再命中，而该表把「声明未匹配」也判 fail，于是 lint 单点红在文案语言上。修法不是把数字改回中文，而是**把期望式样改成英文句式** `/\*\*(\d+)\*\*\s*`llama-server` parameters/`；同类隐患一并堵上：`verify-ipc-sync.cjs` 的 `DOC_CHANNEL_RE` 原只认「N 个通道」，README/AGENTS 里的 "56 IPC channels" / "56 channel constants" 完全落在检查之外（**这才是真漏洞**——通道增删后译文数字不会报错），改为同时认 `channels?`。③ **负测试确认两道门禁仍咬得住**：把 README 的 60→61、56→57 后 `verify-params-sync` 报「声明 61，实际 60」、`verify-ipc-sync` 报「README.md:116 声明 57，实际 56」并各自 exit 1，还原后复绿——不这么测一次，改完正则极可能变成静默空转。④ **语言边界写明**，`docs/` 与 `AGENTS.md` 仍是中文，故 README 在 Highlights 末注与文档地图两处明示"这些文档目前是中文"，避免英文访客点进去有落差；并把约定落到 `AGENTS.md`（README 条目：英文撰写 + 勿改回中文 + 改后跑 `pnpm docs:check`；lint fail 条件补「计数声明表必须中英双式」的根因说明）与 `workflow.md` 文档编写约定引言（列出英文段落骨架）。**本轮经 rebase 落到 origin/main（v0.0.42）之上**，冲突合并时把远端新增的「唯一事实源」声明并进了 `data-persistence.md` 的字段表（`download_max_concurrent` 边界与默认值来源 `shared/src/settings-limits.ts`、`hf_mirror_host` 默认站名来源 `shared/src/hosts.ts`），README 的 lint 说明同步为七项门禁。中文原文完整保留在备份分支 `backup/readme-en-local` 的历史中。**注意：因本次动了 `scripts/**`，该推送不再属于纯文档路径，CI 会照常 bump 到 v0.0.43 并触发 Release。**

- **README 瘦身 442 → 134 行：深度内容下沉，README 只留「一眼看懂这项目干什么」**：用户反馈「内容过多不适合展示、阅读」。**先核对归属再搬**，避免拆出重复段落——`settings.json` 字段表、项目目录树、Monorepo 依赖图、IPC 10 类统计表在 `docs/data-persistence.md` §10 / `architecture.md` §2–3 / `ipc-channels.md` 中**本就有更详细的版本**，README 侧删除只留指针；docs 侧缺的两处细节改为**搬家而非删除**：① README 的「文档编写约定」7 条移入 `docs/workflow.md`（该文件 `> 范围` 原已声明覆盖「文档维护」，现补上「编写约定」），并加第 8 条指向 AGENTS.md 新增的「表述风格」；② `settings.json` 表格在 `data-persistence.md` 原本是一条约 400 字的 run-on 项目符号，改成 §10「字段全清单」表格 + 单独的「写入与加载」条（原子替换 / CAS 守卫 / 逐字段归一化，字段级说明不减）；③ README 的「启动 OOM 时给出缓解动作」在 docs 无归属（全库 grep `缓解` 0 命中），据 `ServiceStatusCard.vue` 实现补进 `frontend.md` 组件表该行的「OOM 归因与缓解动作」（减半口径 1024 粒度 / 下限 4096、KV 量化连带 `-fa on`）。README 新结构：`它在替你做掉什么`（大白话讲清省了什么事）→ `功能一览`（**放弃长表格改短行分组**：表格单元 150 字以上会在 GitHub 撑出横向滚动，且左列被拉窄）→ `快速开始`（6 条命令合并成一个 bash 块 +「改完跑什么」三条指针）→ `使用流程`（7 步）→ `项目结构`（6 行摘要树）→ `技术栈`（表格压成一行）→ `文档地图`（改为「想弄明白… / 读这里」两列对照，16 篇一次看全）→ `许可证`。**徽章锚点保住**：`stack.svg` / `license.svg` 分别指向 `#技术栈` / `#许可证`，两节保留（其余被删章节经 grep 确认无任何跨文档锚点引用）。验证：`node scripts/check-docs-links.cjs` 绿（28 个 md / 143 条相对链接与锚点全有效，链接数因删除重复段落由 155 → 143）。纯文档改动，未触发代码构建与 UI 预览。

- **两项主进程/冒烟验证债结清（2026-09-22，用户真机确认）**：硬编码审计收尾时有两腿 mock 覆盖不到、只能交用户在真机判定，现均已确认正常——① **托盘菜单语言即时生效**（0.0.40 条目，修法为 right-click 现场 `buildTrayMenu`）：`pnpm dev` 里切语言后右键托盘，文案即时跟随、无需重启；② **`verify-server-start.mjs` 的模型三级解析**（同条目，`--model=` → `LLAMA_SMOKE_MODEL` → `models_dir` 最小 `.gguf`）：不再依赖写死的本机绝对路径也能解析到模型并跑通冒烟。至此本轮硬编码审计**没有遗留未验证项**。（①的结论已就地标注在原条目，此处只做汇总以免读者翻到 0.0.40 才看到闭环。）

## \[0.0.42] - 2026-09-21


- **发版后回查：上一轮「根因修复」其实没修住，补第七道门禁（2026-09-22）**：推送后核对 bot 的 `chore(release): v0.0.41` 提交，发现 `docs/architecture.md` 的 desktop 行**又漂了一次**（文档 0.0.40 / 实际 0.0.41）。读码定位：上一轮我只把 `docs/architecture.md` 写进了 `bump-version.cjs` 的**文件头注释**，第 5 步的**清单数组**仍是三个文件——注释声称已同步、代码没动，等于没修。这正是本项目「文档声明必须与实测对拍」要防的东西，却发生在我自己声称的修复上。
  - **清单数组补 `docs/architecture.md`**，与头注释对齐；用只读同构 dry-run 验证（不能真跑脚本，它会写版本+打 tag）：下一轮 bump 命中该行 1 处，README/AGENTS 不误伤。
  - **不靠「清单写全」，改由不变量兜底**：新增 `scripts/verify-version-sync.cjs` 并接入 `pnpm lint`（第 7 项）。断言 root/desktop `package.json`、`APP_VERSION`、`architecture.md` 版本表、`CHANGELOG` 最新已发布标题**五处相等**；且**解析不到值同样 fail**——否则表格改版会让检查静默变空转，比没检查更糟。
  - **连带发现一个内容篡改级缺陷**：`bump-version.cjs` 对文档做全文 `replace(旧版本 → 新版本)`，把 `packaging.md` 里一段**历史反例**（记录「旧文字错误声称 electron-builder 会剥 SemVer 尾零」）中的举例版本号一并改写，`v0.0.38 → v0.0.41` 三轮连改，如今反例写成「`0.0.41` → `0.0.5`」——一个尾零都没有的版本号，论证对象自己失效了。修法：第 5 步改**按行**替换，含 `bump-ignore` 标记的行跳过（与 `// i18n-ignore` 同构）；同时把该段拆成两行——「实测产物名」是真声明，继续跟随 bump；「历史反例」加标记固定住，并把举例改回永不与当前版本碰撞的 `x.y.34` 形式。dry-run 复核：受保护段逐字不动，声明行照常更新。
  - 验证：`pnpm lint`（七项门禁 + 157 文档链接）/ `pnpm test`（core 362 + ui 69）/ `pnpm e2e:web`（15 例）/ `pnpm build` 全绿。新门禁跑过两次**负测试**：把版本表退回 `0.0.34` → 点名「应为 0.0.41」；把该行改成非版本号 → 报「解析不到版本号（检查本身失效）」，两次均 exit 1，还原用反向 Edit（不用 `git checkout`，那会连本轮未提交改动一起回退）。
  - 文档同步：`AGENTS.md`（脚本清单 + lint 组成 + fail 条件 + bump 规则「新增版本声明处两件事都要做」）、`docs/ci-cd.md`（lint 七项、bump 同步范围与「脚本自身不在文档路径内」）、`docs/workflow.md`、`docs/architecture.md`（脚本树 + 版本表对齐 0.0.41）、`docs/packaging.md`（§11.7 反例拆分与标记说明）。

## \[0.0.41] - 2026-09-21


- **文档对齐审计（2026-09-21）**：逐条把文档声明与代码/实测对账（先量再改，未凭记忆）。**9 处修正 + 1 处根因修复**：
  - **两处旧用例数**：`AGENTS.md` 与 `docs/testing.md` 的「core 359 / ui 66」→ 实测 **362 / 69**（本轮新增 6 例：core download-log +3、ui params +3）。
  - **`architecture.md` 的 monorepo 版本表 desktop 行 0.0.34 → 0.0.40**，并修根因：`scripts/bump-version.cjs` 的文档同步清单缺 `docs/architecture.md`，该行已在 0.0.12 → 0.0.34 → 0.0.40 两轮发版中持续漂移。补进清单后用**只读模拟**验证（不能真跑该脚本——它会写版本、CHANGELOG 并打 tag）：该文档里当前版本串只出现在这一行，历史版本引用不会误改。注意该修复只能防住**今后**的漂移——旧值 0.0.34 不在当时脚本认识的字符串里，替换不会命中，须一次性手工对齐到最新（本轮已做），否则永远不自愈。
  - **`architecture.md` 脚本树补 3 个漏收脚本**（`dev.cjs` / `reinstall-electron.cjs` / `verify-i18n-usage.cjs`），并把 `style-audit.cjs` 的「十项检查」改为**不写死项数**——实测脚本输出 12 项且编号 7 自首个提交起即空缺；`frontend.md` §7.5 自己就定了「计数勿在文档写死」的口径，architecture 那处正是反例。
  - **`docs/workflow.md` 的 `pnpm lint` 行**只列了两个脚本，补齐六项组成。
  - **`docs/params-system.md` §5.5 第 8 步**写着「该脚本目前只打印差异、不阻塞 lint」——上一轮已把 `verify-params-sync` 升级为硬 fail，该句连同新增的三类校验（三方对拍 / 计数声明 / 字典双向相等）一并重写。
  - **`docs/core-modules.md`** 补 `error-classify.ts` 与 `types.ts` 两行模块表，并在 §4.10 记录「done 记录 `errorType` 恢复时归一化」（本轮新增行为）。
  - **`docs/desktop-main.md`** 补主进程文案的语言同步机制（`settings:save → setLang`，托盘菜单因右键现场构建而即时生效）。
  - **`AGENTS.md` 脚本清单**补漏收的 `reinstall-electron.cjs`。
  - **实测无漂移、未改**（列出来是为了让「查过了」可复核）：`docs/ipc-channels.md` 的 56 个通道**逐值**与 `ipc.ts` 一致（0 缺失 / 0 幽灵）；`docs/testing.md` 的核心测试文件表 25 行 = 实际 25 个文件；README 的「60 参数 / 56 通道 / 13 子分类 / GGUF 60 字段」四项全部与 `definitions.ts`、`ipc.ts`、`SUBCATEGORY_ORDER`、`GgufModelInfo` 实测相符；i18n 键数在 CHANGELOG 之外无任何文档写死；`STYLE_TODO` 无「共 N 项」类计数声明。
  - 验证：`pnpm lint`（六项门禁 + 157 文档链接与锚点）/ `oxlint` 全绿。**遗留提案**（未做，待定）：测试用例数属「每次加测试都会漂」的数字，目前靠人工同步；若要收口，可在校验脚本里加「文档声明的用例数 == 实际」断言，或在文档里改写成可复现口径（如「以 `pnpm test` 输出为准」）。

## \[0.0.40] - 2026-09-21

- **参数页英文标签截断归零 + 几何判定扩到参数页（残留清单第 7、10 条，2026-09-21，STYLE_TODO #80）**：#79 修的是设置页（英文标签压控件），参数页是同一列宽口径的另一半——124px 由 #78 按**中文**最长标签 122.8px 定，英文侧没逐条量。用页面真实字体 canvas 实测 **11/60 条英文标签 > 124**（超 4–45px，被 `overflow: hidden` + 省略号截断；中文态 0/60）。
  - 两条路线交用户选边：① 列宽 124→176 彻底不截断，但最小轨 418→470，**1600 由 3 列退 2 列、2560 由 5 列退 4 列**，与 #78「不拿列数换对齐」冲突；② 缩短英文文案（零布局代价，完整术语在 `PARAM_HELP` 与 tooltip 里）→ **选 ②**。
  - `labels.ts` 的 `en` 改 11 条（zh 一字未动）：`Continuous Batch` / `Multimodal Proj.` / `Proj. GPU Offload` / `Video TS Interval` / `Jinja Engine` / `Draft KV Type K|V` / `Synth. Accept Len` / `Synth. Accept Rate`（顺带修单复数 bug，zh 为「合成接受率」）/ `Reasoning Budget` / `Budget End Msg`。**每条候选改前都实测 ≤122px** 留余量；键名逐条 grep 对回（我按表推断的 key 有 4 个不准）。
  - **第 10 条**：`e2e/web/app.spec.ts` 的几何用例从设置页三面板扩到参数页 60 行（双语各一条，断言零截断 + 不压控件），并加 `expect(行数).toBe(60)` 防「少渲染也算过」。web e2e 13 → **15 例全绿**；负测试把 `Budget End Msg` 退回长版本 → 英文态参数页用例点名失败，还原后回全绿。今后新增参数若英文标签超长，CI 直接拦下。
  - 一处口径自我更正：先前报「8/60 截断」用的是「超出到会压控件」的更严判据（>132px），按「自然宽 > 列宽」实为 **11 条**——已在 STYLE_TODO #80 里写清两个数各自含义。
  - 同步：STYLE_TODO #80 全文登记、frontend.md §7.5.4 新增「标签列宽必须按双语最长核」条。


- **旧下载日志的错误类型归一化（残留清单第 8 条，2026-09-21，修法经实测修正）**：原报告写的是「保证每条失败路径都有 errorType，删掉 `errorDisplay` 的 raw 回退」。读码实测**前提不成立**：两条置 error 的路径（`download-manager.ts:475` 校验和、`failTask`）都同时写 `errorType`，`classifyError` 还有 `'unknown'` 兜底、永不返回 null——**活路径不存在空 errorType**；唯一可达 raw 回退的是 `download-log.ts` 恢复的**旧日志记录**（该字段加入前写的只有 error 原文）。删回退会让这些行渲染成空串，比现状更糟，故改到加载侧收口。
  - `download-log` 恢复 done 事件时：`errorType` 必须落在 `DOWNLOAD_ERROR_TYPES` 内才采信（旧代码 `typeof === 'string'` 盲转，脏值会渲染成裸 `dl_err_xxx`）；缺失/非法且 `status==='error'` 时用 `classifyError(errorText)` 补分类。
  - `classifyError` 从 `download-manager.ts` **移到新模块 `core/src/error-classify.ts`**——`download-manager` 已依赖 `download-log`，反向引用会成环。
  - 成员列表单一来源：`shared/types/download.ts` 新增 `DOWNLOAD_ERROR_TYPES` 运行时数组，`DownloadErrorType` 联合由它派生（`satisfies` 校验），`download-log` 校验与 `dl_err_*` 门禁读同一份（门禁改为优先解析数组、回退解析联合类型）。
  - 新增 3 例测试（该文件 11 → 14）：缺 errorType 按消息补分类、非法 errorType 不采信、非 error 终态不凭空补。验证：build / lint / test（**core 362** + ui 69）/ e2e 13 例全绿。


- **托盘菜单语言即时生效（残留清单第 9 条，2026-09-21）**：`createTray` 在启动时 `setLang(loadSettings().language)` 后一次性 `Menu.buildFromTemplate(...)` 并缓存进 right-click 闭包——上一轮虽然把 `setLang` 接进了 `IPC.SETTINGS_SAVE`（让探测错误等即时文案跟随语言），但托盘菜单文本是构建时定死的，切语言后仍停在旧语言、非重启不更新。改为抽 `buildTrayMenu(win)` 并在**每次 right-click 现场构建**（三行模板，开销可忽略）。`docs/desktop-main.md` §6.8 原写「文案跟随设置语言」属过度声明，已改为记录真实机制与该缺陷。验证：`pnpm build` 通过（desktop `tsc`）；**该腿属主进程，mock 覆盖不到**，需 `pnpm dev` 里切语言后右键托盘目验。 → **2026-09-22 该目验已由用户完成、结果正常**（切语言后右键托盘文案即时跟随），此项验证债结清。


- **参数三方对拍升级为硬门禁（残留清单第 6 条，2026-09-21）**：`verify-params-sync.cjs` 的两类漂移——「代码有 flag 而清单未标已支持」与「清单标已支持而代码无 flag」——此前**只 `console.log` 不 `process.exit`**，等于打印一条没人看的提示；而本脚本上一轮刚接入 `pnpm lint`，只打印意味着门禁名存实亡。今天实测两类皆空（`✅ 按参数维度检查完全一致`），故转 fail 不会立刻炸 CI。
  - 失败信息给两条出路：① 代码侧补/改 flag（`definitions.ts`）；② 文档侧改标注或 `node scripts/generate-params-doc.cjs` 重生成对照表；并指向二进制升级漂移的 re-pin 流程（`verify-help-drift.cjs` + params-system §5.5）。
  - **负测试**：把 `temperature` 的 flag 临时改成 `--zzz-bogus` → 同时报出两类出入（文档侧 `--temp, --temperature` 无对应 flag、代码侧 `--zzz-bogus` 未标），**真实退出码 1**（第一次注入锚点把 `--temp` 抄成 `-temp` 导致 `INJECT FAILED`，取真实行文本后成功）；`.bak` 还原后回到 ✅。
  - 顺带修一处文档落后：`docs/ci-cd.md` 仍写 lint 是「五项」且未列 `verify-params-sync.cjs`（上一轮接入时漏改），改为六项；AGENTS.md 的脚本职责同步「对拍有出入即 fail」与字典双向相等。


- **动态拼接键族门禁（残留清单第 5 条，2026-09-21）**：`DownloadCard.vue:627` 写的是 `i18n.t('dl_err_' + task.errorType)`——键名由代码拼出来，检查 1「字面量 `t('k')` 悬空」完全看不见，`DownloadErrorType` 成员改名或新增不会有任何报警，界面直接渲染 `dl_err_xxx`。实测今天 11 个成员的双语 `dl_err_*` 齐全。
  - `verify-i18n-usage.cjs` 新增检查 6：按枚举成员逐个断言 `前缀+成员` 在 zh/en 都存在，并反查该前缀下的**字典孤儿**；规则做成 `DYNAMIC_KEY_FAMILIES` 表，将来同类前缀加一行即可。成员解析按行首 `| 'name'`：该类型每成员一行且行尾带中文注释，按 `|` 切分会把注释吞进成员名（本会话前一次量覆盖度时就这样误报过 10 条「缺键」，只有行尾是 `';` 的 `unknown` 躲过）。
  - 负测试双向成立：从 en.ts 删 `dl_err_checksum_mismatch` → 报「动态键缺失」；往 zh.ts 注入 `dl_err_ghost_case` → 报「动态键孤儿」。均 `.bak` 还原。
  - 顺带把脚本头注释从「检查三件事」更正为六件事（前几轮逐条加规则时没同步计数，属文档与实现漂移）。


- **参数字典同步门禁（残留清单第 4 条，2026-09-21）**：`paramLabel()` 缺键时回退渲染**裸 key**（`spec_draft_n_max` 直接上界面），而此前**没有任何脚本检查 `labels.ts` 与 `definitions.ts` 是否同步**。实测今天 60/60 参数标签与帮助齐全、zh/en 均非空，但字典里躺着 **6 条孤儿**：`repeat_last_n` / `typical_p` / `mirostat` / `mirostat_lr` / `mirostat_ent`（参数早已删）与 `model`（模型行标签实际走 `t('lbl_model_path')`，不经 `paramLabel`）——逐条查过 9 个 `paramLabel(` / 6 个 `paramHelp(` 调用点，全部传 `props.p.key` 或 `dep.key`，确认不可达后删除（两字典各 6 行，共 12 行）。
  - **新门禁**（`verify-params-sync.cjs`，已随 lint 运行）：`PARAM_LABELS` / `PARAM_HELP` 的键集与 PARAMS **双向完全相等**，且每条 `zh`/`en` 非空。两个方向都会出事——表里有字典无 → 裸 key 上界面；字典有表里无 → 死条目误导读码者。
  - 踩到一处解析坑：初版按 `^\s*(\{\s*)?key:` 取参数键，把 `PARAM_GROUPS` 的 `{ key: 'basic', labelKey: … }` 也算了进来（**63 ≠ 60** 报出 3 条假缺失）。改为按 `key: 'x', group: '` 相邻取键，并加自检「解析出的 key 数 ≠ 条目数即 fail」——**结构一变就要求同步解析规则，而不是静默少查几个参数**。
  - 负测试双向都做且都成立：删掉 `temperature` 标签 → 报「PARAM_LABELS 缺 'temperature'」；注入孤儿 `ghost_param` → 报「有孤儿条目」（第一版注入锚点抄错导致 `INJECT FAILED`，改用文件内真实声明行后成功）。全部经 `.bak` 副本还原。
  - 验证：`git grep` 确认 docs 无 labels 条目数的计数声明（不受删行影响）；mock 实测参数页 **60 行标签全部渲染、零裸 key**；build / lint / test（core 359 + ui 69）全绿。


- **E2E 预览端口收敛（残留清单第 3 条，2026-09-21）**：`4173` 原本在 `e2e/run-web-e2e.mjs:9`（`PREVIEW_PORT`）与 `playwright.config.ts:20`（`baseURL`）各写一份。改为**驱动做唯一所有者**：spawn `playwright test` 时注入 `E2E_PREVIEW_URL`，配置读该变量作 `baseURL`，并在 `test` 调用下缺变量即 `exit 1`。
  - 为什么是快速失败而非「留一个默认值」：2026-09-20 的 CHANGELOG 记过同类事故——`pnpm test:e2e` 曾绕开驱动直接 `playwright test`，`webServer` 移除后没人起 4173，浏览器连到残留占用进程，11 条用例全红且原因难定位。留默认值等于把这个坑重新敞开（静默连到 `127.0.0.1:4173` 上的任何东西）。
  - 验证：`pnpm e2e:web` 13 例全绿；绕开驱动 `pnpm exec playwright test --project=web` 实测**真实退出码 1** 并打印指引（第一次读管道 `$?` 得到的是 `tail` 的退出码，改用 `> /dev/null 2>&1; echo $?` 才拿到真值——管道尾码陷阱本轮第二次踩，记入纪律）。改后 `git grep 4173` 在 e2e/配置里只剩驱动那一处代码字面量，其余全是注释与文档叙述。同步 docs/testing.md 的端口归属说明。


- **对外链接收敛（残留清单第 2 条，2026-09-21）**：先把 `ui`/`desktop`/`core` 三处的全部 `https?://` 字面量捞干净（排除 scheme 前缀判断、注释、SVG 命名空间、由 host 变量拼接的模板串），真实外链只有 **3 条**：`AboutPanel.vue` 的仓库地址与 llama.cpp 发布页、`GeneralPanel.vue:110` 又写了一份**完整相同的**发布页 URL（改地址必漏一处）。
  - `definitions.ts` 与 `APP_NAME`/`APP_VERSION` 并列新增 `APP_REPO_URL` / `LLAMA_CPP_RELEASES_URL`，AboutPanel 去掉两个本地 `const` 别名直接引用常量（模板可读 script setup 导入），GeneralPanel 的 `openExternal` 改引常量。
  - 验证：`git grep` 实测 ui/desktop 已无 github/modelscope/hf-mirror 字面量；「关于」面板两个按钮实测仍渲染出完整 URL（`https://github.com/giveUphope/llama-launcher`、`https://github.com/ggml-org/llama.cpp/releases`），版本 v0.0.39；build / lint / test（core 359 + ui 69）全绿。


- **端口范围收敛到事实源（残留清单第 1 条，2026-09-21）**：`1`/`65535` 实测散落 **代码 5 处 + 文案 2 处**——`definitions.ts` 的 `port` 条目（事实源）、`ipc/system.ts` findFreePort 的扫描上界与起始回退值、`TextParam.vue` 与 `useStartServer.ts` 各一份 `port < 1 || port > 65535`、`msg_free_port_not_found` 的字符串实参 `'65535'`，外加 zh/en 的 `err_invalid_port` 文案里写死「1-65535」。
  - `definitions.ts` 新增 `PORT_MIN`/`PORT_MAX`/`isValidPort()`，与上一轮的 `DEFAULT_HOST`/`DEFAULT_PORT` 同源于 `port` 条目；派生改走统一的 `paramOf(key)`（缺条目即抛），并加 `paramBound()`——`ParamDef.min/max` 是**可选字段**，缺界会静默变 `NaN` 让校验全线放行，故宁可启动即抛。
  - 消费点全部替换：`system.ts` 两处、`useStartServer.ts` 校验 + 提示实参；`err_invalid_port` 文案改占位符 `{0}-{1}`，实参由 `PORT_MIN`/`PORT_MAX` 提供（上一轮加的「实参数=占位符数」门禁正好校验这条新写法）。
  - **顺带清掉一处死代码**：`TextParam.vue` 的 `if (props.p.key === 'port')` 永不成立——`port` 是 `int_entry`，由 `IntEntryParam` 渲染（Arco `a-input-number` 的 `:min/:max` 钳制），而 `ParamRow` 的显式分支已覆盖 `ParamType` 除 `text` 外的全部 8 种取值，TextParam 只服务 `type: 'text'`。数值范围校验归 IntEntryParam（输入钳制）+ `useStartServer`（启动前兜底），不在文本控件里特判他参数。
  - **补单测**：`isValidPort` 与派生常量此前**零覆盖**（`git grep` 实测无一处测试引用）。新增 3 例到 `params.test.ts`：`PORT_MIN/MAX` 等于表内 `min/max` 且有限、`DEFAULT_PORT` 落在合法区间（默认值自洽）、边界行为（两端合法 / 越界 / 小数 / `NaN` / `Number('')` 全拒）。负测试：把断言改成 `65534` 即报 `expected 65535 to be 65534`，证其读真值。
  - 验证：`pnpm build` / `lint`（四道 i18n 门禁 + 156 文档链接）/ `test`（core 359 + **ui 69**，+3）全绿。文档同步 core-modules 的 definitions 行。


- **英文态设置页标签压控件修复（STYLE_TODO #79，2026-09-21）**：用户批注「修复英文状态下组件重叠问题」并附高级面板截图。Range 探针实测根因是**列宽按单语言拍板 + Arco 自带 16px 右内距**：三面板列宽 110/110/140 实际可用只有 94/94/124，而英文「Max Concurrent Downloads」自然宽 172、「When Closing Window」141，`label-col` 默认 `overflow: visible` + `nowrap` 故既不截断也不省略，文本直接盖进控件 **24px / 23px**（Advanced 文本右缘 437 vs 控件左缘 413）。中文侧全部放得下（最长 127），所以缺陷只在英文态显形。
  - **修复**：三面板统一 `paddingRight: '0'` + `flex: '0 0 <W>px'` + `minWidth: '0'`（与 #78 参数页同口径：列宽 = 可用宽，标签-控件间距回到规范的 8px，此前实际 24px）；W 按**双语最长**取值 General 110 → **145**、Advanced 140 → **176**、Appearance **保持 110**（双语最长 61，本就够，不为凑数改动无缺陷面板）；`SettingsPage.vue` 加一条共用 `:deep(.arco-form-item-label)` 省略号兜底——将来任一语言出现更长标签，宁可截断也不可压控件。
  - **可执行判定（不靠目测）**：`e2e/web/app.spec.ts` 新增「设置页表单标签几何（双语）」，逐面板逐行断言 `控件左缘 − 文本右缘 ≥ 0` 且 `label.scrollWidth − clientWidth ≤ 1`，中/英各一条用例。踩到的坑：切语言前界面仍是中文，入口必须按初始中文标签点（每个 test 全新 context、mock 初始语言恒 zh），否则英文用例在切换前就找不到侧栏项——首跑即因此超时失败。
  - **验证**：修复后三面板 × 双语共 7 行 **slack 全部恰为 8px、truncated 全 0**（含 172→176、141→145 两行）；**负测试**把 Advanced 退回 `0 1 140px` 后英文用例即点名失败「Advanced 标签『Max Concurrent Downloads』与控件间隙」，`.bak` 还原后 13 例全绿。`pnpm build` / `lint`（含四道 i18n 门禁 + 155 文档链接）/ `test`（core 359 + ui 66）/ `e2e:web` 全绿。规范落点 §7.5.4「设置面板标签列」。


- **第 4 道 i18n 门禁：实参数与占位符数匹配（2026-09-21）**：`t('key', [..])` 的实参个数须等于该键 zh/en 文案里 `{N}` 的槽数——少一个就渲染出裸 `{1}`（`tr` 只替换存在的槽），多一个是白传；两语言槽数不一致也在此暴露。检查 48 处收敛结果时发现**首版计数器有缺陷**：`countArrayArgs` 的字符串分支只跳过不累加 `cur`，导致含字符串实参的调用**计数恒少 1**，误报 4 个调用点（`msg_search_failed` / `msg_files_load_failed` / `msg_free_port_not_found` / `msg_external_detected`）——逐处读源码判为假阳性后修正计数器，再跑全绿。负测试：删掉 `msg_port_in_use` 的一个实参 → 双语各报一处「需要 1 个（槽 0）」，`.bak` 副本还原后恢复全绿（**不用 `git checkout` 还原**，那会连该文件未提交改动一起回退）。


- **站点识别后缀归位（第 3 项，2026-09-21）**：`url-parser.ts` 的两处站点判定原写死 `host.includes('huggingface.co') || host.includes('hf-mirror.com')` 与 `host.includes('modelscope.cn')`，与 `hosts.ts` 的建站 URL 常量是两份字面量。做法是**新增「识别后缀」而非复用建站 host**：`MODELSCOPE_HOST` 是 `www.modelscope.cn`（用于拼下载/浏览 URL），若拿它做后缀匹配，裸域 `modelscope.cn/...` 链接会判为无法识别（`url-parser.test.ts` 有该用例）。故 `hosts.ts` 增 `HF_SOURCE_HOST_SUFFIXES`（内部引用 `DEFAULT_HF_MIRROR_HOST`，不再重复字面量）与 `MODELSCOPE_HOST_SUFFIX = 'modelscope.cn'`，url-parser 消费之，语义逐字不变。回归：`url-parser.test.ts` 12 例（含 www/裸域/镜像三种写法）+ 全量 build/lint/test 全绿。已知边界照旧：**用户自定义镜像域名不被识别**为 huggingface 源（本轮不改判定范围，仅去字面量重复）。


- **下载并发默认值收敛（第 2 项，2026-09-21）**：`download_max_concurrent` 的默认 `3` 与闭区间 `1..5` 实测散落 **6 处 8 个点**（`settings-store` 默认值 + zod schema、`download-manager` 字段初值 + `setMaxConcurrent` 钳制、`ipc/download` + `ipc/settings` 两处 `?? 3`、`AdvancedPanel` 输入钳制 + 下拉 `[1,2,3,4,5]`）。新增 `shared/src/settings-limits.ts`（`DOWNLOAD_CONCURRENCY_DEFAULT/MIN/MAX/OPTIONS` + `clampDownloadConcurrency`）作唯一来源并全量替换——放 shared 是因为依赖流单向 `ui ↛ core`，若常量放 core 则设置页无法引用，正是「各写一份」的成因。实测风险面：改大 MAX 后只要漏改一处，就会出现「设置里能选 6、下载层悄悄压回 5」。下拉列表改由边界推导（`Array.from`），不再手写 5 个字面量。同步 data-persistence.md 标注来源。build / lint / test 全绿。


- **手工插值收敛到 `t(key, [args])`（第 1 项，2026-09-21）**：`.replace('{0}', x)` 是与 `t(key, args)` 并行的第二套填参机制——只替换首个占位符（键里 `{0}` 出现两次时第二个裸奔）、多槽链式顺序易错、且 `t()` 与 `.replace()` 混排难读。实测 12 个文件共 **48 处**，全部改为 `t(key, [a, b, …])`。
  - 做法：写平衡括号 + 字符串状态机的 codemod（正则处理不了 `String(e?.message ?? e)`、模板串与嵌套 `t()` 实参），**干跑核对每一处 -/+ 后再应用**；只收敛「槽号自 0 连续」的链，非连续一律跳过留人工。首轮 codemod 有累积 bug（`out` 每轮从 `src` 重算，导致每文件只保留首处），跑门禁时以 48 处残留暴露出来，修正后二次收敛余下 36 处。
  - 语义差别即修复点：`tr` 的 `/\{(\d+)\}/g` 是全局替换，改后同键多占位一次填满。
  - **新门禁**：`verify-i18n-usage.cjs` 增加检查 4——源码出现 `.replace('{N}', …)` 即 fail（豁免走同一白名单）；`xxxKey: 'yyy'` 间接引用键纳入双字典存在性校验（`reasonKey` 不含 `t()` 调用，旧的悬空检测看不见这类键）。规则本身用 4 组输入自测（含 `i18n/index.ts` 自身的全局替换正则为负例）。
  - 顺手：`ParamsPage` 显存/内存/上下文三行 tooltip 的 `lines.push()` 塌回单行。验证：`pnpm build` / `pnpm lint` / `pnpm test`（core 359 + ui 66）全绿。


- **硬编码全量审计与清除：4 类真缺陷 + 3 道新门禁（2026-09-21）**：按「机器专属值 / 默认值散落 / 数据层文案 / 无门禁数字」四类扫 `ui`+`core`+`shared`+`desktop`，逐项读源码复核后落地。
  - **`verify-server-start.mjs` 去掉本机绝对路径**：原 `modelPath` 写死 `C:\Users\<user>\.lmstudio\...\nomic-embed...gguf`（全库唯一含机器路径的受控文件），换机或模型删除即失效且报错误导。改为 `--model=` → `LLAMA_SMOKE_MODEL` → 设置的 `models_dir` 中**最小的 `.gguf`**（启动最快）三级解析，端口同步支持 `--port=`，解析不出模型时打印可操作提示并 exit 1（不静默跳过）；`host` 改引 `DEFAULT_HOST`。
  - **网络默认值收敛到单一事实源**：`definitions.ts` 由 `host`/`port` 两条目派生导出 `DEFAULT_HOST`/`DEFAULT_PORT`，替换散落的 7 处回退字面量（`launcher.ts` 字段初值与 `start()` 回退、`stores/server.ts`、`useStartServer.ts` ×3 + 接管 host、`ServiceStatusCard.vue`、`ipc/system.ts` checkPort/findFreePort）。此前改默认端口只要漏一处就会出现「UI 探 8080、服务实际起在别端口」的假端口占用告警。实测 `'127.0.0.1'` / `8080` 在 `src/**` 仅剩事实源、注释与测试夹具。
  - **数据层不再产文案**（新立约定，见 AGENTS.md「数据层不产文案」）：`target-recommend.ts` 删 `TARGET_LABEL` 与 6 条中文模板串，改发 `reasonKey`（`target_rec_*` 六键）+ 仅含数值/枚举的 `reasonArgs`，`ParamsPage` 芯片 tooltip 走 `i18n.t(...)`——原实现在英文界面直出「目标「均衡」：显存预算内最大无 OOM 上下文」；`TargetRecommendation` 类型随之变更，demo-mock 同步。`ipc/system.ts` 两条探测失败原因改 `tr('msg_probe_*')`，并在 `IPC.SETTINGS_SAVE` 里 `setLang(s.language)`（此前主进程语言只在托盘创建时同步一次）。
  - **「在浏览器打开」跟随镜像设置**：`DownloadCard.vue` 原写死 `hf-mirror.com` / `www.modelscope.cn`，而 `settings.hf_mirror_host` 是可配置项（高级设置 → `setHfMirrorHost`），自定义镜像后下载走自建站、外链仍跳默认站。新增 `shared/src/hosts.ts`（`MODELSCOPE_HOST` / `DEFAULT_HF_MIRROR_HOST` / `normalizeMirrorHost`）作唯一来源，core 的 `setHfMirrorHost` 与 `modelscope-client` 同时改为引用（剥协议/尾斜杠的归一化逻辑从两份合一）。
  - **死载荷与平行字典**：`GgufSuggestedParam.description`（core 11 条中文说明）实测**无任何渲染端消费者**（建议芯片只显示 key=value，tooltip 用 `paramLabel`+value+`t('msg_click_to_apply')`），连字段一并从类型删除；`shared/src/time-format.ts` 的私有 `REL_ZH`/`REL_EN` 双表迁入 zh/en 字典（新增 `rel_*` 5 键，`i18n` 加 `trAt(lang, …)` 供需显式语言的纯函数用），此前它绕开字典因而完全逃过键集一致性检查。
  - **新门禁三道**：① `verify-i18n-usage.cjs` 扫描范围扩到 `shared`/`desktop`（原仅 `ui`/`core`），并新增「注释外裸中文串字面量即 fail」——状态机剥 `//`、`/* */`、Vue `<!-- -->` 三类注释，白名单仅 i18n 字典与 demo-mock，确不进界面的诊断日志须就地 `// i18n-ignore`（本轮 3 处：`ipc/models.ts`、`tray.ts` ×2）。负测试：故意改一个键名即报 2 处悬空 + 退出 1。② `verify-ipc-sync.cjs` 校验文档「N 个通道」声明与实测一致（实测命中 8 处，AGENTS/README/docs 全覆盖；CHANGELOG 与 archive 属历史陈述不比对）。③ `verify-params-sync.cjs` 校验 7 处文档参数计数声明 == `definitions.ts` 实测（60：basic 22 / advanced 28 / server 10）。负测试实测 exit 1 后还原。
  - **顺手清**：TopBar 三个窗口按钮的 `aria-label`（英文字面量，与其 tooltip 的 `t('win_*')` 是平行副本）改走 i18n；裸时序数字提常量（`params.ts` 会话保存节流 `SESSION_SAVE_THROTTLE_MS = 800`、`main.ts` 设置加载兜底 `SETTINGS_LOAD_TIMEOUT_MS = 3000`）；`huggingface-client` 重试耗尽的错误串中英混排改全英文。
  - 文档同步：AGENTS.md（三脚本职责、新增「数据层不产文案」约定）、README lint 段、core-modules（新增 `hosts.ts` 行与两个唯一来源说明）、desktop-main（probeError 文案口径）、architecture 脚本清单。**键数 364 → 378**（`target_rec_*` 6 + `msg_probe_*` 3 + `rel_*` 5）。验证：`pnpm build` → `pnpm lint`（4 包类型检查 + IPC 56 通道同步 + 文档计数断言 + docs 链接 + i18n 378 键含裸中文门禁 + oxlint）→ `pnpm test`（core 359 + ui 66）全绿。
  - **本轮明确不动**（避免范围漂移，留待需要时处理）：`.replace('{0}', …)` 手工插值在 11 个文件共 49 处并存（`t(key, args)` 已支持，属并行机制收敛，与硬编码无关）；`download_max_concurrent` 的默认 `3` 与钳制 `1..5` 同样散落 6 处（`settings-store` ×2、`ipc/{download,settings}`、`AdvancedPanel` ×2，属同一缺陷类，但 `ui ↛ core` 需先在 shared 立边界常量）；`url-parser.ts` 的 `huggingface.co`/`modelscope.cn` 是**识别**用后缀匹配（换常量会破坏非 www URL 判定，有测试覆盖）；dev 端口 5173/4173 已有 `.vite-dev-port` 文件协商，兜底值属合理硬编码。


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


- **E2E preview 进程收敛为单点拥有（顺带修掉一处死配置）**：`playwright.config.ts` 的 `webServer` 只写了 `port: 4173` 未写 `url`，而 Playwright **仅在给定 `url` 时**才建可用性回调（`playwright/lib/runner/index.js:839`）→ ①不检测端口占用（不会报 "already used"）；②照样 spawn 一个 vite，因驱动 `e2e/run-web-e2e.mjs` 已占 4173 而 EADDRINUSE 退出；③`_waitForProcess` 在无 url、无 stdio 等待时直接 `processExitedPromise.catch(() => {})` **吞掉退出码**（同文件 935-939 行）。净效果：每次跑白起一个必死进程，**「谁在服务 4173」取决于两个进程的抢绑顺序**，且 `reuseExistingServer: !CI` 与 `timeout: 60s` 两个旋钮完全无效。另外文档原写「Linux CI 仍走 Playwright 自带 webServer」是**错的**——`pnpm e2e:web` 的定义就是「build + 该驱动」，CI 走同一条路径。修法：配置里删掉 `webServer`（驱动成为唯一拥有者），驱动加两道确定性保障——开跑前探测 4173，**已被占用即 exit 1**（不静默复用，避免"绿了但验的是旧产物/别人的服务"这类假阳性）；子进程 stdout/stderr 留末 60 行并在超时/spawn 失败时打印（此前 `stdio: 'ignore'` 只有干巴巴的超时），`try/finally` 保证任何路径都杀子进程。实测三条路径全过：连跑两次 `pnpm e2e:web` 各 **11 passed（2.0~2.3s）**、无端口残留；外部进程占 4173 时驱动 `exit=1` 并给出中文原因；故障注入（把 vite 路径改错 + 超时收到 3s）确认子进程 MODULE_NOT_FOUND 输出被完整回显、退出码 1。文档落点 [testing.md](zh/testing.md)「要点与坑」+ [ci-cd.md](zh/ci-cd.md) §1.4。

- **CI/CD 流水线优化（2026-09-19）**：先取实测数据再动手——`gh api` 拉最近一次 main 运行的**步骤级**耗时（总墙钟 1m11s：verify 56s / e2e 54s / changes 5s / bump 7s），据此定优先级。① **修一个潜伏的 PR 门控缺陷**：`pull_request` 事件**没有** `github.event.before`，`changes` job 展开成空串后 `git diff --name-only "" HEAD` 以 **exit 128** 失败（本地实测复现），而 `run` 默认 `bash -e` → PR 上 changes 必红、`e2e`（`needs: changes`）连带被跳过；现按事件分取基线（push→`event.before`，PR→`event.pull_request.base.sha`），并加 `git rev-parse --verify` 守卫 + **拿不到基线一律保守判为非文档变更**（宁多跑不漏检）+ 事件上下文改由 `env:` 注入（防内插注入姿势）。该缺陷长期潜伏的原因：仓库两次 PR 运行都早于 `changes` job 引入。② **每个 job 补 `timeout-minutes`**（changes 5 / verify 15 / e2e 20 / bump 10 / release.build 45）——release 侧已实测过 turbo daemon × vite 8 的挂死竞态，无 job 级超时一次挂死白占 6h。③ **e2e 失败现场上传**：`if: failure()` + `actions/upload-artifact@v7` 传 `playwright-report/` 与 `test-results/（取自 playwright.config.ts 的 outputDir/reporter）`，此前失败只能靠 list 输出猜。④ **缓存 Playwright 浏览器**：`actions/cache@v6` 键含 `pnpm-lock.yaml` 哈希——Chromium 下载实测 16s 是本 job 最长单步（占 54s 里的 30%）。⑤ **并发策略收紧**：CI 的 `cancel-in-progress` 改为**仅 PR 生效**（bump 在同一 run 内 commit→tag→push→触发 Release，中途取消会留下「tag 已推、Release 未触发」的半程状态；实测 bump 仅 7s，串行排队代价可忽略）；`release.yml` 新增 `group: release-v${{ inputs.version }}` + `cancel-in-progress: false`（同版本不并发、在跑的绝不取消）。⑥ **Release 版本一致性闸门**：checkout 后、构建前比对 `inputs.version` / `package.json` / `definitions.ts` 的 `APP_VERSION`，不符即失败——避免发出「Release 标题 vA、exe 报 vB」的产物（打包侧历史陷阱，docs/packaging.md §11.7）。**明确不做**：跨 job 传构建产物（install 仅 4~5s、build 16s，artifact 往返不划算）、`pnpm/action-setup` 升 @v6（v6 装错 pnpm 版本，pnpm/action-setup#225，沿用既有决定）。新引入 action 版本均经 `gh api …/releases/latest` 核对（cache v6.1.0 / upload-artifact v7.0.1）。**验证**：工作流 YAML 用仓库内 js-yaml 解析通过；`changes` 判定逻辑抽出后本地跑 7 个场景全对（push 非文档→true、push 纯文档→false、无改动→false、PR 有 base→true、PR 无 base→true 保守、全 0 基线→true、未知 sha→true）；`pnpm lint`（含文档链接）全绿。文档落点 ci-cd.md §1.3/§1.4/§2.1/§2.5 + 新增 §2.6（超时与耗时基线表）、auto-release.md §2（步骤表加闸门步 + 并发/超时）。

- **参数基线升级至 llama.cpp b11053（re-pin，2026-09-19）**：本地引擎由 b10734 换为 `llama-b11053-bin-win-vulkan-x64`（`version: 0.4.1-dev (build 11053, commit 1af554f8f)`），按 [docs/params-system.md](zh/params-system.md) §5.5 的 11 步 re-pin 流程重走（导出新 help → 先审计后替换 → 版本标注 → 参数表决策 → 重生成对照表 → 双向校验）。**漂移结论**：flag **移除 7**——`--mlock`、`--mmap`/`--no-mmap`、`-dio`/`--direct-io`/`-ndio`/`--no-direct-io`，均为 b10734 已标 `DEPRECATED in favor of --load-mode` 的独立别名，应用早已迁移（`load_mode` 下拉），**零影响**；flag **新增 2**——`--log-jsonl`/`--no-log-jsonl`，**决定不收录**：它把 stdout 改成每行一个 JSON 对象，会破坏 `launcher.ts` 的 listening 检测（按行匹配 `listening` + `http|server`）与控制台逐行着色（与未收录的 `--log-file` 同类）。应用 69 个 flag **缺失 0**。默认值变化 1 条真实：`--reasoning-preserve` `template default` → `enabled`（未入参数表，无跟随）。枚举白名单逐项核对无漂移：`--load-mode` 取值仍含 `dio`、`--spec-type` 11 值全同、`--chat-template` 内置模板列表与 b10734 **逐字节相同**（我们 24 项为其子集）→ `definitions.ts` 本轮**零改动**。**顺带修 `verify-help-drift.cjs` 一处误报**：说明续行 `… default: follows --device)` 不以 `(` 开头、而剥离字符集不含括号，导致把 `--device)` 当成「新增 flag」（本次首跑即误报）；剥离集补 `()` 后两侧同步下降——**b10734 基线 428 → 421、当前 b11053 基线实测 416**（自比对 `基线 flags: 416 | 新 flags: 416`），重跑新基线为「无新增 / 无移除 / 默认值变化 0 / 应用缺失 0」。落盘仍走 Node `execFileSync` 捕获 stdout（避开 PowerShell `>` 写 UTF-16 的老坑，实测新文件无 BOM、无空字节）。校验：`verify-params-sync` ✅ 69 flag 完全一致；对照表由 **269 → 267 行**（删 3 行别名 + 增 1 行 `--log-jsonl`，生成器 stdout 报 `Total: 259, Supported: 60, Missing: 199`），且被删的三行在旧表里本就标着 **⬜ 未支持**——「零影响」由此直接可证；README 与 `generate-params-doc.cjs` 的来源版本串同步到 b11053；`pnpm lint`（4 包 + IPC 56 + 文档链接 + i18n + oxlint）与 `pnpm test`（core 355 + ui 66）全绿。

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

- **`pnpm test`** **在 Windows 上挂死**：ui 包全量测试通过后 vitest 进程静默不退出（turbo 管道随之挂死，测试本会话卡住 15 分钟才被手动终止）。排查定位：vitest 2.1.x 的 tinypool worker 销毁后 IPC 管道句柄残留主进程（实测 17 个 PipeWrap），ui 恰为 4 个测试文件时触发退出竞态——1\~3 个文件正常、threads/forks、顺序执行、单 worker、isolate=false 均无法绕开；core 包同版本同规模句柄残留但正常退出。修复：`packages/ui/vitest.global-setup.mjs`（经 `vitest.config.ts` 的 `globalSetup` 引用）在运行结束、退出码确定后 `process.exit` 兜底退出，测试结果与退出码不变；仅 run 模式适用，详见 [docs/testing.md](zh/testing.md)。验证：`pnpm test` 连续多次端到端全绿（core 300 + ui 48）。

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

## \[1.4.4] - 2026-08-16

### 新增

- **关闭窗口应用内弹窗**：`close_behavior=ask` 的首次询问与"模型服务运行中退出"二次确认改用应用内自定义弹窗（毛玻璃风格，替代 Electron 原生 dialog）。主进程窗口 close 拦截后经 IPC 请求渲染进程弹窗（`CloseDialog.vue`），用户选择回传主进程执行退出/托盘；渲染进程不可用时 10s 超时兜底（ask 默认托盘、退出确认默认取消）。

- **llama.cpp 引擎获取引导**：设置页引擎卡片更名"llama.cpp 引擎"，卡片标题行新增帮助图标（悬浮显示按步骤引导：打开发布页 → 按显卡选 zip → 解压 → 设置引擎目录），面板底部提供发布页跳转按钮（`openExternal`）；引导文案基于 llama.cpp releases 实际资产命名（cuda/rocm/vulkan/cpu、x64/arm64）梳理。

- **模型下载 URL 会话历史**：URL 输入框在本次运行内临时保存用户提交解析的 URL（去重、最多 10 条、最新在前），点击空白输入框时在下方弹出历史列表，点击即回填并重新解析；应用退出（进程结束）自动清空。

- **窗口启动默认最大化**：每次启动固定以最大化窗口呈现（不再受 `window_maximized` 保存值影响；字段仍保存以兼容旧数据）。

- **推测解码草稿数联动**：选择投机采样类型（`spec_type`）时自动应用该类型的推荐最大草稿数（`--spec-draft-n-max`：draft-simple/eagle3/dspark=8、dflash=15、mtp=5、ngram-=5）并启用；保持 `n_min ≤ n_max`（切换类型或手动调小 `n_max` 时钳制 `n_min`）；关闭推测解码时清空草稿数。

- **删除模型同步清理关联预设**：`models:remove` 删除模型子目录/文件后，自动删除 model 路径以被删路径开头的预设文件（`<models_dir>/presets/*.json`，分隔符兼容）。

### 修复

- **托盘右键菜单位置**：菜单底缘精确对齐托盘图标上缘（按菜单项数估算高度，替代固定 57px 估算——原估算远小于实际高度导致菜单压住图标/任务栏）；按图标所在显示器工作区钳制，上方放不下时回退到图标下方。

- **dev 退出显示 Failed**：托盘退出后 vite/tsc 被 `concurrently -k` 强杀以非 0 码退出导致 turbo 报 Failed；改为 `concurrently --success first`（以 Electron 退出码 0 为准）+ 根 `dev` 只跑 desktop 包（消除 turbo 双重 vite 与挂起）。

- **打包 exe 进程名显示 Electron**：`signAndEditExecutable: false` 跳过 rcedit 导致 exe 的 `VS_VERSION_INFO` 保持 Electron 默认（ProductName/FileDescription=Electron、版本号 33.x）；`after-pack.cjs` 用 resedit（纯 JS）重写版本资源为 llama Launcher + 应用版本，图标注入保持原有策略。

- **参数项悬浮提示不显示**：① `ParamRow :deep(.tooltip-host)` 与 6 个参数控件 `.label-col` 的 `overflow: hidden` 裁切向上弹出的 tooltip（已移除，省略号由 `.label-text` 承担）；② Electron 窗口默认 `backgroundThrottling` 在窗口被遮挡/最小化时冻结定时器与 rAF，ToolTip 500ms 延迟与进入动画卡住（已设 `webPreferences.backgroundThrottling: false`）。

- **dev 热重载启动即重启**：dev-watch 在 `dist/main/index.js` 出现即启动 Electron，但 tsc 初始构建尚未写完其余产物，启动后立即触发一次多余重启；现改为先注册监视、等待 dist/main 构建产物静止（1s 无写入）再启动 Electron。

- **设置页重复按钮**：llama 引擎/模型目录卡片移除"打开目录"按钮（与"更改"逻辑重复），仅保留更改入口。

### 变更

- **打包命令优化**：根目录新增 `pnpm dist` 一条命令打包（委托 `@llama-launcher/desktop dist`，无需 `cd apps/desktop`）；`dist-with-fallback.cjs` 调用 electron-builder 由 `npx` 改为 `pnpm exec`（避免 npx 在线下载、统一 pnpm 包管理），子脚本启动用 `process.execPath`；portable 文件名提示由硬编码 1.4.0 改为从 package.json 动态读取。

- **依赖管理优化**：root `package.json` 声明 `engines.node >= 20`（resedit 3 要求）；`.npmrc` 补 `registry=npmmirror`（与 electron 镜像一致）；`tsconfig.node.json` 产物输出到 `node_modules/.vite-config-dist`（消除 vite.config.js/.d.ts 污染与 Vite 加载旧产物的隐患）；resedit 纳入 root devDependencies 管理。

- **参数悬浮内容**：参数项悬浮由长帮助文案改为显示参数名称（`paramLabel`）；帮助文案保留在 i18n API 中。

- **移除 GGUF rope 元数据**：`GgufModelInfo` 删除 6 个 rope 字段及解析、模型卡 RoPE 显示行、相关 i18n/labels 死键（rope 参数已不支持）；字段数 62 → 59。

- **引擎帮助信息入口**：设置页引擎卡片移除常驻帮助信息框，统一收敛到标题行帮助图标（悬浮步骤引导 + 发布页跳转按钮）。

### 增强

- **模型管理**：删除模型时同步清理关联预设并记录到主进程日志（不阻塞删除主流程）。

## \[1.4.3] - 2026-08-15

### 新增

- **退出行为设置 + 托盘保活**：设置页「外观与语言」新增「关闭窗口时」选项（询问我 / 直接退出 / 最小化到托盘，默认询问）。首次关闭窗口弹出选择框（可勾选"记住我的选择"写入 `close_behavior`）；选择托盘或设置为托盘后，窗口关闭即隐藏并驻留系统托盘（托盘菜单：显示主窗口 / 退出，单击图标唤起窗口）；**模型服务（llama-server）运行中退出应用会二次确认**，确认后经 `before-quit` 清理并停止服务。托盘图标复用 `resources/icon.ico`（打包配置已纳入随包文件）。单实例二次启动会从托盘唤起窗口。

### 修复

- **托盘图标不显示**：根因是路径**少一层**——tsconfig `outDir=dist/rootDir=src` 使产物在 `dist/main/`，`../resources` 解析到不存在的 `dist/resources`。已改为 `../../resources`（dev 正确指向 `apps/desktop/resources`）+ `process.resourcesPath`（打包版经 electron-builder `extraResources` 复制，规避 asar 内路径 nativeImage 无法读取的问题）；图标改为 32px PNG 优先、16px/ico 兜底，加载成功/失败均有日志。

- **托盘右键菜单位置**：改为**手动定位到图标上方**——`popUpContextMenu` 的 position 是菜单左上角，按估算菜单高度（2 文本项 + 分隔线 + 边框 ≈ 57 DIP）把**菜单底缘对齐图标上缘、右缘对齐图标右缘**，菜单显示在托盘图标右上方（原生 `setContextMenu` 在托盘区不保证向上翻转，故手动定位）。

- **托盘图标不显示（初版）**：托盘图标由 icon.ico 改为优先加载 32px PNG（Windows 托盘各 DPI 渲染可靠），失败逐级兜底 16px PNG / icon.ico，加载失败时打印告警便于诊断。

- **托盘右键菜单位置**：不再 `setContextMenu`（默认固定在托盘图标处弹出），改为 `right-click` 时按鼠标当前位置 `popUpContextMenu`（菜单出现在鼠标处）。

- **模型列表删除模型报错（IPC 漏绑）**：`MODELS_REMOVE` 通道与主进程处理器均存在，但 preload `models` API 漏写 `remove` 包装 → `window.api.models.remove is not a function`，二次确认后报错。已补绑定；`verify-ipc-sync.cjs` 新增"通道 → preload API 包装覆盖"检查，此类漂移今后被 `pnpm lint` 拦截。

### 变更

- **参数表精简（56 → 47）**：移除采样卡片的 `repeat_last_n`/`typical_p`/`mirostat`/`mirostat_lr`/`mirostat_ent`（保留温度、top-p、top-k、min-p、重复惩罚、存在惩罚、随机种子）；移除 advanced 的 rope 参数（`rope_scaling`/`rope_freq_base`/`rope_freq_scale`/`swa_full`）。GGUF 建议同步移除对应条目（元数据仍解析进 info）；参数文档重新生成（Supported 47），README/params-system 计数同步。

### 修复

- **i18n 缺失修复**：`PARAM_GROUPS` 的 `param_advanced`/`param_server` 键缺失——`ParamsPanel` 用 `group.labelKey` 作为卡片标题（`<Card :title-key>`），高级/服务参数面板标题直接显示原始键。已补 zh/en 两键（en 与 zh 键集由 Dict 类型保证一致）。全量审计确认：47 参数 × labels/help、13 个子分组 `subcat_*`、201 个字面量 `t()` 键、24 个 `labelKey/titleKey`、12 个 `gguf_*`、4 个 `cat_*` 均无缺失。

- **界面切换性能优化**：① LaunchPage 命令预览 deep watch 加 **150ms 防抖**——拖滑块/应用预设时 params 高频变更曾每次触发 IPC + 整页重渲染（keep-alive 下后台也消耗主进程）；② 控制台行分类 `lineClass` 加 **WeakMap 缓存**（输出条目不可变，避免每次输出批次/切页激活对全部渲染行重跑 3 条正则），渲染上限 1500 → 1000（完整缓冲仍在 server.outputs）；③ 页面过渡 `mode="out-in"` 由 120ms×2 串行改为 **leave 0ms + enter 90ms**——新页立即挂载，不再等待旧页淡出（原串行等待是切换明显迟缓的主因之一）。

- **dev 会话随应用退出结束**（热重载修复）\*\*：此前用户关闭窗口后 Electron 退出但 dev-watch/vite/tsc 仍占终端。现在 Electron 退出码 0（用户正常关闭或单实例锁冲突）时，dev-watch 打印提示并退出自身——`concurrently -k` 连带终止 vite/tsc，整个 dev 会话随之结束，终端不再残留进程。

- **dev-watch 用户主动退出不再自动重启**：退出处理按退出码区分——`code=0`（用户关闭窗口/应用自退，含单实例锁冲突 `app.quit()`）停止自动重启并打印原因（锁冲突时提示"可能为上次 dev 残留实例"）；仅 `code!=0`/信号终止（崩溃）才自动重启（保留快速退出拦截 + 熔断）。同时**移除启动时按路径清扫 Electron 的逻辑**（实测会导致并发 dev 实例互相误杀：B 清扫杀 A、A 重启后清扫再杀 B，退出码 -1 循环）。

- **`swa_full`** **残留支持清除**：参数本已于参数表精简时移除，但 `gguf-meta.ts` 仍为含 `full_attention_interval` 的混合 SSM 模型生成 `swa_full` 建议（会写入不存在的参数）；已删除该建议块与 i18n 死键（`PARAM_LABELS`/`PARAM_HELP`）。元数据字段 `full_attention_interval` 保留解析与模型卡展示（属模型信息，非参数）。

- **顶栏图标加载错误**：`app-icon.svg` 注释体内含 ASCII `--`（`--rainbow-grad`）——`<img>` 加载 SVG 走严格 XML 解析，注释内含 `--` 属致命错误导致整图加载失败。已改写注释（严格校验：3 处注释体内均无 `--`，标签配对 OK）。

- **卡片 hover 闪烁**：Card 去掉 `transform: translateY` 上浮（鼠标扫过成排卡片时合成层提升导致文字重栅格闪烁/"整体浮动"），改为边框 accent 高亮过渡。

- **应用图标异常**：像素级解码发现 `gen-icon` 采样判定中**外耳三角完全包含内耳**，内耳分支永不执行（旧版窗口图标实际无内耳，而 SVG 因画家算法会显示，两处图标不一致；20px 下内耳成白色剪影上的脏点）。修复：统一为**白色羊驼剪影 + 彩虹底**（两处均去掉内耳），窗口图标已重新生成（icon.ico/png），顶栏 SVG 同步。

- **dev-watch 单实例锁健壮性**：① 启动前清扫残留 dev Electron（路径精确匹配，不误伤打包应用）；② 启动 <1.5s 即退出（崩溃/锁冲突）不再自动重启并打印提示；③ 退出时尝试清理 Electron 子进程。

- **重构后体验异常修复**：命令预览多行文本框禁用胶囊圆角；三处粘性表头改不透明 `--bg-card`；`.btn-restart` warn 黄底 hover 文字改深色。

### 增强

- **CJK 字体栈强化**：`--font-family` 增加 `Microsoft YaHei`（防精简系统缺 YaHei UI 时中文落到宋体）、`HarmonyOS Sans SC`/`MiSans`（现代黑体，若安装）；`--font-mono` 末尾补 CJK 回退（日志含中文时）。字号体系已于前一轮整体上调 1px。

- **侧边栏参数设置入口移除"已调整"小黄点**。

- **彩虹一致性**：下载推荐竖条改用 `--rainbow-grad`（与进度条/启动 CTA 呼应）。

- **界面切换性能**：页面过渡去掉 transform（避免重型页面合成层开销）+ 时长减半（out-in 各 120ms，原 0.22s 串行明显迟缓）。

- **焦点/悬停闪烁优化**：`:focus-visible` 由瞬时 outline 改为可动画的 box-shadow 焦点环；`--dur-fast` 0.12s→0.16s（玻璃表面背景切换更顺滑）；reset 增加交互元素基础过渡（含 box-shadow），输入/下拉/参数行 scoped 过渡补 box-shadow。

- **全局字号上调 + 字体栈优化**：`--fs-*` 语义字号整体上调 1px（xs 10→11 / sm 11→12 / base 12→13 / md 13→14 / lg 14→15 / appname 15→16 / xl 18→20），改善桌面端小字号可读性（原 10/11px 层级在徽章、状态栏、summary chip 偏小）；`--font-family` 加入 `Segoe UI Variable`（Win11 默认 UI 字体）与 `--font-mono` 的 `Cascadia Mono` 回退。规范同步 frontend.md §7.5.1。

- **dev 模式默认关闭 DevTools**：`window.ts` 仅在 `LLAMA_DEV_CONSOLE=1`（新命令 `pnpm dev:console`，根目录与 desktop 均可用）或生产热重载逃生口 `LLAMA_DEV_SERVER_URL` 时打开浏览器控制台；`pnpm dev` 默认不再弹出。

- **彩虹按钮边框化**：启动 CTA 由彩虹实底改为**仅边框彩虹 + 玻璃内部**（`padding-box`/`border-box` 双层背景技巧，内部无高亮底色），文字色跟随主题。

- **动效补齐**：页面切换淡入+上浮（PageHost）、参数分区展开/收起过渡（CollapsibleSection）、**侧边栏折叠**（底部折叠按钮 + 图标模式，宽度过渡为单次用户触发例外，持久化 `sidebar_collapsed`）。

- **配色进阶**：浅色主题玻璃不透明度 0.55→0.72（深色文字对比度）；滚动条 thumb accent 着色；状态栏主色→accent 微妙渐变；应用图标改彩虹渐变底。

- **清理**：移除未引用组件 `PageNav`/`PageHeader` 与未使用的 `.glass`/`.glass-strong` 工具类。

### 重构

- **UI 全面重构（胶囊 + 单层毛玻璃 + 果冻动画 + 点缀式彩虹）**：① 交互元素胶囊化（新增 `--radius-pill/card/modal/row/control` token，替换散值圆角）；② 全局半透明毛玻璃采用**单玻璃层**架构（`styles/surface.scss` 全视口 1 层 `backdrop-filter` + 表面半透明，性能核算：blur 层数 18→1，稳态开销 ≈0-3% 帧时间，滚动容器/列表行不 blur）；③ 果冻动效（`--ease-jelly`，只动 transform/opacity，`prefers-reduced-motion` 关闭）；④ 彩虹点缀（启动按钮 `--rainbow-grad`、下载进度条、分区 `--hue` 循环装饰条）；⑤ 新增 `data-fx='glass|off'` 视觉效果开关（Settings「外观与语言」可切，off = 实底性能模式，回退 = 一个属性）。样式契约同步更新至 `docs/frontend.md §7.5`（圆角体系/玻璃规则/动效规则/检查清单）与 `docs/style/STYLE_TODO.md`（新增 backdrop-filter 预算与动画审计命令）。验证：`pnpm lint`（含 check-docs-links）+ `pnpm test` 全绿。

### 修复

- **dev 构建无限重启循环（自持触发）**：`dev-watch` 监视整个 `apps/desktop/dist`，而每次重启都会经 `copy-preload`/`generate-preload` 无条件重写 `dist/preload/*.cjs` 与 `src/preload/ipc-constants.cjs`（均在被监视目录内）→ 形成"重启→写入→触发重启→再写入"的无限循环（实测任意主进程/共享源码变更即触发，123 次/90s）。修复：`generate-preload` 与 `copy-preload` 幂等化（内容相同跳过写入），`dev-watch` 只监视 tsc 主进程产物 `dist/main`（不再监视自身写入的 `dist/preload`）。修复后源码变更仅触发 1 次重启并收敛，preload 内容变更仍会正确复制。

### 增强

- **dev-watch 重启熔断**：滑动窗口（8 次/30s）内重启次数超限即停止自动重启并输出明确告警（防止崩溃循环/未来任何自持循环烧 CPU）；Electron 非热重载退出（崩溃/手动关闭）现在会自动重启（同样受熔断约束）。

- **`load_mode`** **选项对齐 b10429**：llama-server 实际二进制（b10429）为 `--load-mode` 新增 `auto` 模式（默认 mmap，设备不支持时回退），应用下拉补入 `auto` 选项；默认仍为实测推荐的 `none`。

- **参数 re-pin 流程固化**：新增 `scripts/verify-help-drift.cjs`（二进制升级后对比新 help 与固定基线的 flag 增删 / 默认值变化 / 应用参数缺失，flag 级漂移非零退出码可接入 CI），完整流程写入 `docs/params-system.md` §5.5（替换基线 help → 更新版本标注 → 漂移审计 → 更新 definitions → 重建 shared → 重新生成文档 → 校验 → 回归）。

- **docs 引用修复**：`AGENTS.md` 失效的 `CODE_WIKI.md` 链接改为 `docs/packaging.md#打包配置-electron-builderyml`；`packaging.md` 图标路径明确为 `apps/desktop/resources/icon.ico`；`OPTIMIZATION_TODO.md` 中已重构删除的 `ipc-handlers.ts` 引用更新为 `apps/desktop/src/main/ipc/models.ts`。docs 全量链接审计（17 个 md、80 个相对链接）全部有效。

- **docs 链接检查纳入常规维护**：新增 `scripts/check-docs-links.cjs`（扫描 `docs/**/*.md` 与根 `AGENTS.md`/`README.md` 的相对链接与 GitHub 锚点，断链/失效锚点非零退出码），已接入 `pnpm lint`（`turbo run lint` → `verify-ipc-sync.cjs` → `check-docs-links.cjs`），亦可单独运行 `pnpm docs:check`。

### 变更

- **内存参数基线启用（实测结论落地）**：`cache_type_k`/`cache_type_v`（KV 量化 q8\_0）、`load_mode`（`--load-mode none`）、`fit`（`--fit off`）四个推荐内存参数由"定义了但未启用"改为**初始化与重置时即启用并下发到命令行**，且不计入参数分组"已修改"蓝点。依据 `docs/experiments/plan-kv-split-cli-test.md`（2026-08-15 实测）：f16 KV + mmap + fit on 的长上下文组合在 32GB 内存机器上可冻结系统；q8 KV 使 27B\@262K 显存需求从 \~35GB 降至 \~25.7GB，`--load-mode none` 防权重页常驻内存，`--fit off` 规避显式 ctx/ngl 时 fit 中止导致的劣化（262K 下 25.7 vs 36.6 tok/s）。新装用户不再默认跑在 OOM 配置上。

### 增强

- **i18n 补齐与清理**：新增 `load_mode`/`fit` 参数标签与帮助文案（含 mmap 冻结风险、fit 劣化警示、`-nkvo` 混合模型乱码提示），移除已废弃参数 `mmap`/`mlock` 的残留 i18n 条目。

- **参数文档同步**：重新生成 `docs/params/LLAMA_SERVER_PARAMS.md`（`--mmap/--mlock` 由已支持降为未支持，`--load-mode`/`--fit` 升为已支持），`verify-params-sync.cjs` 校验一致。

## \[1.4.2] - 2026-08-14

### 修复

- **预设参数未正确覆盖到参数配置**：`applyPreset` 原先按「合并」语义仅覆盖预设中存在的参数 key 与 `_enabled` 中列出的启用状态，未包含的参数会残留当前会话配置（如切换模型后应用另一模型的预设、或应用旧版本保存的预设，产生混合配置，残留的已启用参数仍会发射进命令行）；旧格式预设（无 `_enabled`）加载后参数虽显示在配置页但不会生成到命令。修复：应用预设前先重置全部参数为默认（完全覆盖语义），未携带模型的预设保留当前模型；新格式预设以 `_enabled` 为权威启用状态，旧格式预设按「值非默认自动启用」兼容，确保预设真正覆盖参数配置并生效。

### 增强

- **退出资源释放强化**：主进程 `before-quit` 清理由 `pauseAll` 升级为 `getDownloadManager().dispose()`(暂停下载保存续传元数据 + 销毁 https 连接池 + 移除事件监听);dev 会话树清理统一收敛到 `before-quit` 并加 `LLAMA_DEV_SKIP_QUIT_KILL` 守卫(移除 `quit` 处理器中因 `NODE_ENV` 不可靠而失效的重复代码——热重载跨平台不再误杀 dev 会话树);渲染端新增 `settings.flushSave()` 并在 `App.vue` `beforeunload`/卸载时调用(防抖窗口内最后一次设置变更不再丢失),`SettingsPage` 卸载时清理挂起的引擎检测计时器。

- **开发热重载强化**：`apps/desktop` dev 流程由「vite + electron 单次启动」改为三进程编排——`dev:vite` = Vite(UI HMR) + `tsc -b --watch`(shared/core/desktop 增量重建) + 新增 `scripts/dev-watch.cjs`(监视主进程 dist / preload 源 / shared 类型,变更时自动重新生成并复制 preload、重启 Electron);主进程退出守卫 `LLAMA_DEV_SKIP_QUIT_KILL=1` 使热重启不连带杀掉 dev 会话树(tsc watch/监视器)。改 UI 即时热更;改 core/shared/主进程/preload 自动重建重启,无需手动操作。

- **下载量化标签识别修复（Q8\_K\_XL / Q8\_K）**：`parseQuantization` 的 k-quant 模式区间 `[2-6]` 漏掉 Q8——`Qwen3.8-27B-UD-Q8_K_XL.gguf` 与裸 `Q8_K` 文件名均识别为 null,下载列表不显示量化徽章;修正 XL 与裸 k-quant 模式为 `[2-8]`(Q2\_K..Q8\_K,含 Q8\_K\_XL),新增回归用例。

- **ModelScope 下载跳过仓库搜索**：粘贴 `modelscope.cn/models/{author}/{model}` 链接时直接进入仓库文件列表（URL 已完整标识仓库），与 HuggingFace 链接行为一致——不再先搜索再"选择仓库"的多余操作；HF 与 ModelScope 两条 URL 路径合并为同一"直接列文件"逻辑（裸 `author/model` 输入仍走搜索）。

- **性能优化(续):模型列表浅响应式 + 选中态 O(n²)→O(n)**：模型管理页与顶栏模型下拉的模型数组改为 `shallowRef`(整体替换、无原地变更,取消数百个 ModelInfo 深响应式代理包装——大模型库扫描后过滤/渲染更快);模型行选中态由「每行执行 `filteredModels.findIndex`(O(n²))」改为模板直接比较 `m.path === modelPath`(O(1)/行)。

- **性能优化（减少卡顿）**：① 设置保存**防抖合并**（`settings` store 200ms 批量,路径输入/主题/语言等高频变更不再每次击键触发 IPC + 主进程同步文件 I/O,CAS 合并 + 原子写收敛为一次);② 引擎检测**防抖**(设置页 400ms 停止输入后才执行 findLlamaExe + fileExists,避免每次击键两次 IPC);③ 控制台**渲染窗口上限**(1500 行有界 DOM,长会话 5000 行日志不再整表渲染,复制/清空仍用全量缓冲);④ 主进程日志推送**批量合并**(launcher-bridge 16ms 窗口批量 webContents.send,模型加载数百行突发日志不再逐行压 IPC)。

- **模型列表管理能力增强**：模型列表项新增**伴随文件标签**（扫描器按模型目录检测 mmproj / dflash / draft 文件并写入 `ModelInfo.tags`，列表以淡底徽章展示）；每行新增**打开目录**（`openPath` 打开模型文件所在目录）与**移除**操作（新增 `models:remove` IPC，按模型子目录删除——含 mmproj/草稿等伴随文件，仅允许删除 `models_dir` 内路径，删除后扫描缓存失效并自动刷新列表；操作前有 danger 确认弹窗）。通道 45 → 46。

- **注册表化重构（P0）**：路由与侧栏导航由静态硬编码改为**功能注册表**装配——新增 `packages/ui/src/features/`（`FeatureDef`/`NavItem` 类型 + 6 个功能模块 + 注册表 `features/index.ts`），路由从注册表汇总（`router/index.ts` 只装配 `featureRoutes`），侧栏由 `navItems` 驱动渲染（含参数页橙点经 `dot()` 求值保持响应式，`order` 决定排序，`enabled:false` 可停用功能）；主进程 IPC 由单文件 `ipc-handlers.ts` 拆分为**功能域注册表** `apps/desktop/src/main/ipc/`（settings/models/presets/server/system/window/download 各自 `register*Ipc`，`index.ts` 聚合装配，共享 `models-watcher.ts` 监听单例）。行为零变化，通道数不变（45）。

- **冗余内容清理（前后端）**：移除 5 个 dialog IPC 桩通道（`dialog:pickDir/pickFile/saveFile/askYesNo/askCreateDir`，50 → 45）——目录/文件选择与确认弹窗早已迁移到渲染进程自定义组件（FileBrowserModal/ConfirmModal），这些通道仅剩返回 null/false 的桩实现且 UI 零使用；同步移除 preload `dialog.*` 暴露、env.d.ts 类型与 ipc-handlers 桩处理器（含未使用的 `FileFilter` 导入）。另清理 83 个未使用的 i18n 键（zh/en 同步，含历史页面标题 `page_*`、控制台状态 `console_*`、采样建议 `gguf_sampling_*`、下载旧文案 `dl_*`/`lbl_*`/`col_*` 等；动态拼接键 `dl_err_*`/`subcat_*`/`cat_*` 经核实在使用中，保留）。

- **Web UI 内嵌帧常驻（修复切页重载）**：Web UI iframe 从路由组件（被 keep-alive 缓存、切走时 DOM 移出文档导致浏览上下文销毁而重载）提升到布局层常驻组件 `WebUiFrame`（AppLayout 内 absolute 覆盖内容区），仅用 `v-show`（display:none）切换显隐——display:none 不销毁 iframe 浏览上下文，从 Web UI 切到其他菜单页再切回时页面保持不刷新；服务停止时清空 src（后端已不存在，重启后重新加载）。`WebUiPage` 简化为 `/webui` 路由占位。

- **Web UI 应用内嵌**：新增侧边栏「Web UI」标签页（路由 `/webui`）——服务运行时用 iframe 在应用内直接展示 llama-server 的 Web UI，不再跳转外部浏览器；服务未运行时显示占位提示（含启动引导文案）。「打开 Web UI」按钮（顶栏与控制台页）由 `openExternal` 改为跳转内嵌标签页；`openExternal` IPC 保留供模型页链接等场景使用。经 keep-alive 缓存，切换标签时 Web UI 会话状态保留。

- **应用设置入口统一化**：新增「应用设置」页（侧边栏齿轮入口，路由 `/settings`），把分散在模型管理页（引擎目录 + `llama-server.exe` 内联检测徽标、模型目录、HuggingFace 镜像源）与下载页（最大并发下载数）的应用设置收敛为一处统一表单，另含主题/语言完整面板；更改即时保存。ModelsPage 移除引擎/模型目录/镜像卡片（保留模型列表、GGUF 信息、建议参数，目录变化仍自动重扫），DownloadCard 移除并发选择器（并发数经设置页修改后由 SETTINGS\_SAVE 同步到 DownloadManager）。**移除顶栏中英切换与深浅色切换按钮**（主题/语言统一由设置页「外观与语言」卡片调整；`Ctrl+D` 快捷键切主题保留），清理对应 i18n 键（`lang_toggle`/`theme_dark_tip`/`theme_light_tip`）。新增 i18n 键（zh/en）与 `settings` 图标。

- **下载任务状态改 JSONL 事实源 + 投影**：新增 `download-log.ts`——下载续传持久化从「内存状态 + 5s 周期快照 `.llama_dl.json`」改为 **append-only 事件日志** **`.llama_dl.jsonl`**（`start` 含段布局 / `segment` 段进度逐事件落盘 / `done` 终态三类事件）；崩溃/重启后 `replayDownloadLog` 重放事件精确重建段进度，**状态丢失窗口从 ≤5s 归零**，内存/磁盘双份状态的漂移源（节流定时器）删除；旧版 `.llama_dl.json` 快照由 `migrateLegacyMeta` 一次性迁移为事件日志（v1/v2 均支持），下载完成/取消后日志随部分文件一并清理。新增 `download-log.test.ts` 11 例 + download-manager 重放/迁移路径回归。

- **设置保存 CAS 合并守卫**：`saveSettings` 写入前读取磁盘当前值作为合并基线——其他窗口/实例写入的字段（如 `hf_mirror_host`、`last_tab`）不再被盲写覆盖，本次传入值覆盖同名，写入失败重试；与原子写共同把「多实例并发保存互相踩」从概率性故障变为确定性合并。新增「并发磁盘更新合并」用例。

- **预设版本化 + 形状校验**：`Preset` 新增 `preset_version` 字段（当前 1）；`savePreset` 落盘盖章版本，`loadPreset`/`listPresets` 对旧版无版本文件补齐默认 1，并校验 `values` 形状（非对象回退空对象）、损坏 JSON 返回 null 静默跳过。

- **重试逻辑收敛**：新增 `retry.ts`（`isRetryableError` + `retryDelayMs`），统一原先 `download-manager.ts`（code/状态码判定）与 `huggingface-client.ts`（消息关键词判定）两份近似重复的实现，新增网络调用零成本复用；新增 `retry.test.ts` 5 例。

- **已有完整文件的校验和验证**：`startDownload` 的「文件已存在且大小达标」早完成路径现在也会计算 SHA-256 并与 `expectedChecksum` 比对——不匹配以 `checksum_mismatch` 显式失败（不再静默把损坏文件当作已完成），匹配则立即完成并随 `complete` 上报 checksum。新增 2 例测试。

- **GGUF 元数据读取异步化**：`readGgufMetadata` 改为异步（`fs/promises` + `FileHandle.read`，底层线程池 I/O，不再阻塞主进程事件循环）；`BufferReader` 持有 FileHandle；`MODELS_READ_GGUF_META` handler 改 async；测试 36 例全过（33 处 await、3 处 rejects）。决策：GGUF 头部解析为 I/O 密集，异步 fs 即充分，未引入 worker 池（避免 asar/ESM 打包复杂度）。

- **下载校验和接入源 API**：HF tree API 的 LFS `oid`（sha256）经 `extractSha256` 提取为 `ModelScopeFile.sha256`，DownloadCard 启动下载时透传为 `expectedChecksum`——HF 下载完成自动校验，损坏以 `checksum_mismatch` 显式失败。

- **实时指标改主进程推送（随指标面板一并移除）**：`server:metricsPush` 通道与 `launcher-bridge` 2s 采样推送已随实时指标面板移除（见「实时指标面板（Live Metrics，已移除）」）。

- **设置文件原子写 + schema 校验 + 版本迁移**：`settings.json` 保存改为「先写 `.tmp` 再 rename」原子替换（崩溃/断电不再留下半个 JSON）；`loadSettings` 逐字段归一化（`theme_mode`/`language` 枚举校验、布尔/数值钳制、`download_max_concurrent` 钳到 1–5），损坏或结构非法的文件自动备份为 `settings.json.bak` 后回退默认（不再静默吞掉用户配置）；新增 `settings_version` 字段（当前 1，未来字段变更走 `migrateSettings` 版本迁移，与下载元数据 `migrateMeta` 同模式）。

- **预设文件原子写**：`savePreset` 同样改为 `.tmp` + rename 原子替换。

- **下载统计（token-meter 模式，已移除）**：曾实现每次下载完成追加一行 `~/.llama_launcher/stats.jsonl`（append-only 事实源）+ `download:stats` IPC + `readDownloadStats` 聚合 + 下载页「累计下载」展示；2026-08-14 因展示内容无实际作用而整体移除——界面展示、`download-stats.ts` 模块、`stats.jsonl` 落盘、`download:stats` 通道（53 → 52）与对应 preload/类型一并删除。

- **自定义 HuggingFace 镜像源**：`AppSettings.hf_mirror_host`（默认空 = hf-mirror.com）经设置持久化，`loadSettings`/`saveSettings` 自动同步到 `setHfMirrorHost`；hf 列表/下载 URL/传输选择（`isHfMirrorHostname`，Electron net 分支）全部跟随配置；ModelsPage 引擎卡片新增镜像源输入行（受限网络可指向自建镜像/内网缓存）。

- **参数表驱动测试生成**：新增 `command-builder-definitions.test.ts`，从 `definitions.ts`（唯一事实源）自动生成用例——结构约束（key 唯一、flag 齐全、int/float 范围与默认值合法性、dropdown 默认在选项中、checkbox invert\_flag 完整性）与发射行为（56 参数逐一验证显式启用按类型发射、禁用零发射、float 2 位小数无 float32 噪声）；新增/修改参数时零成本获得全约束覆盖，与 `verify-params-sync.cjs`（文档一致性）互补。

- **服务输出截断 + 统一 fetch helper**：`process.ts` 输出按行转发时对单行 >8KB 截断并追加 `... [truncated N bytes]` 标记，无换行缓冲 >64KB 时强制按一行输出并清空（防超长行/无换行流塞爆 IPC 与 UI 渲染，恒定内存）；`bench-client.ts` 的 `requestJson` 与 `fetchMetrics` 收敛为统一 `requestText`/`requestJson` helper（超时/网络错误/JSON 解析单点实现，非 2xx 不抛错、由调用方按语义处理），新增 API 调用零成本接入。

- **实时指标面板（Live Metrics，已移除）**：曾实现 Launch 页「实时指标」卡片（`server:metricsPush` 主进程 2s 推送 + `server:benchMetrics` 轮询回退 + `useServerMetrics` composable）；2026-08-14 因实际运行中无有效计数而整体移除——控制台指标卡、`useServerMetrics`（含 6 例测试）、`launcher-bridge` 2s 采样推送、`server:metricsPush`/`server:benchMetrics` 通道（52 → 50）与对应 preload/类型/i18n 一并删除；`bench-client.fetchMetrics` 保留（性能测试 runBench 仍需 `/metrics` 累计值）。

- **参数依赖清理声明化 + 稳定态测试**：依赖满足判定收敛为导出的纯函数 `isDependencySatisfied`（启用 + values/notValues 校验）与 `computeViolatedParams`（违规参数集合），`syncDependencies` 不再内联判定逻辑；新增用例覆盖「先填下游值、后选依赖源不被误清」「切 draft-mtp 清空 -md」「重复设置依赖源幂等收敛」三组稳定态不变量（params.test.ts 16 例全过）。

- **下载校验和（SHA-256）落地**：下载完成时流式计算已下载文件的 SHA-256（恒定内存，不整读大文件）并随 `DownloadCompletePayload.checksum` 上报；`StartDownloadRequest.expectedChecksum`（预留自源 API，如 HF LFS oid）提供时逐位比对，不匹配则以新错误类型 `checksum_mismatch` 显式失败（UI 友好文案已加中英文），把「下载损坏」从静默变为可归因；`DownloadMeta.checksum` 预留字段保留。

- **模型目录扫描异步化 + 缓存**：`scanModels` 从同步递归（`readdirSync/statSync`，阻塞主进程事件循环）改为 `fs/promises` 异步并行遍历；新增扫描结果缓存（按 `dir:mtimeMs` 为键，上限 8 条），切页/刷新命中缓存零重扫；`MODELS_WATCH` 监听到 .gguf 增删时调用新增的 `invalidateScanCache()` 使缓存失效（新增导出，IPC 层接入）。

- **IPC 常量生成化（消除双写漂移）**：新增 `scripts/generate-preload.cjs`，从 `packages/shared/src/types/ipc.ts`（唯一事实源）生成 `apps/desktop/src/preload/ipc-constants.cjs`；preload `index.cjs` 改为 require 生成物，不再内联 51 个通道常量；`verify-ipc-sync.cjs` 升级为「生成物未过期检查（--check）+ 防内联回退守卫」；`copy-preload.cjs` 在复制前自动重新生成；新增根脚本 `pnpm generate:ipc`。

- **预设值智能归一化**：应用预设时对每个参数值做类型/范围/选项适配——checkbox 布尔化（兼容字符串 `"true"`/`"1"`）、int/float 数值化并钳制到 \[min, max]（旧预设超范围值不再产生非法命令）、dropdown 校验当前选项（旧版 `draft-model` 自动映射为 `draft-simple`，非法值回退默认）、未知 key（旧版本已移除的参数）直接丢弃。

- **模型预设智能应用**：在顶部模型下拉或模型管理页**显式选择**模型时，若存在该模型已保存的预设（按预设名匹配：文件名/去扩展名；或按预设内记录的模型路径匹配，兼容 alias 命名），弹窗询问是否应用；确认后完全覆盖参数配置，并以用户选择的模型为准重新自动检测 mmproj/草稿模型/GGUF 元数据。同一（模型,预设）组合本会话内拒绝后不再重复打扰。

- **应用反馈**：应用预设后面板内短暂显示「已应用预设「{0}」，启用 {1} 项参数」并写入控制台；预设列表中当前应用的预设行标记「当前」徽章（基于 `settings.last_preset`）。

- **UI 包新增 vitest 回归测试**：`packages/ui/src/stores/params.test.ts` 覆盖预设完全覆盖、残留清理、旧格式兼容、依赖联动、值归一化、快照往返恒等等 8 个用例（`pnpm --filter @llama-launcher/ui test`）。

- **性能测试历史「应用」按钮**：测试历史表格每条记录在「删除」前新增「应用」按钮，点击把该次测试使用的参数（含启用状态，来自测试时保存的快照）完全覆盖应用到当前参数设置——复用预设的覆盖逻辑（智能归一化 + 依赖联动清理），面板内短暂显示「已应用测试参数「{0}」，启用 {1} 项参数」并写入控制台。

- **切换模型预设应用修复**：修复切换模型时出现二次确认弹窗与确认后参数未正确切换的问题——(1) `applyModelPresetIfAny` 增加模块级并发防护（`applyingPath`），双击/快速连点触发重复调用时直接忽略，确保只弹一次确认；(2) 确认后直接应用预设列表返回的 `values`（不再二次 `load`，消除「确认后无反应」的失败路径），并以用户刚选择的模型路径为准重新同步 `selected_model`；(3) 应用预设后仅在预设未显式配置推测解码（`spec_type` 为空）时才自动检测草稿模型，避免检测结果覆盖预设已保存的 `spec_type`/`flash_attn`/`spec_draft_n_max` 等选择；(4) 失败时向控制台输出错误提示而非静默无反应。新增 `useModelPreset.test.ts` 7 个用例覆盖上述行为。

## \[1.4.1] - 2026-08-09

### 新增功能

- **新增** **`-ctkd`** **/** **`-ctvd`** **参数**：`spec_cache_type_k`（`-ctkd`，下拉 `auto|f32|f16|bf64`）与 `spec_cache_type_v`（`-ctvd`，下拉 `auto|f32|f16|bf64`），依赖 `spec_type` 不为 `disabled`。参数总数 54 → 55。

- **新增** **`-ngld`** **参数**：`spec_draft_ngl`（`-ngld`，草稿模型 GPU 层数，text 类型，默认 `auto`，支持 `all`），依赖 `spec_type` 不为 `none`。DFlash 等草稿模型可卸载到 GPU 加速。参数总数 55 → 56。

- **`spec_type`** **选项扩展**：跟随 llama-server b10360 新增 `draft-simple` / `draft-eagle3` / `draft-dflash` / `draft-dspark` / `ngram-simple` / `ngram-map-k` / `ngram-map-k4v` / `ngram-mod` / `ngram-cache`（移除已过时的 `draft-model`，command-builder 保留 `draft-model→draft-simple` 旧预设兼容映射）；`spec_draft_n_min` 默认值 1 → 0（对齐官方 help）。

- **mmproj 自动检测修复**：切换模型时，若未检测到对应 mmproj 文件，自动清空路径并禁用（`values['mmproj'] = ''` / `enabled['mmproj'] = false`），避免残留上一次模型的 mmproj 路径。

### 修复

- **服务器输出 ×N Bug**：`server.ts` `subscribe()` 添加 `let subscribed = false` 守卫，防止 Vite HMR 或组件重挂载时重复注册监听导致控制台输出被推送 ×N 次。

- **Launcher 桥接输出缓冲**：`launcher-bridge.ts` 增加 `bufferedWin` 字段，输出缓冲区仅在当前窗口有效时重放，窗口关闭后重置 buffer，防止残留 buffer 导致控制台出现旧输出或 `undefined` IPC 错误。

- **服务重启永远失败**：`useStartServer.restart()` 与 `start()` 共用异步校验，其中 `checkPort` 检测到当前 llama-server 正占用目标端口即返回 `Port is already in use`，导致运行中点击重启 100% 被拦截。修复：重启语义为先杀旧进程再启动，端口被自身占用属预期情况，`restart()` 通过 `checkAsync({ skipPortCheck: true })` 跳过端口占用检查，保留同步校验（引擎/模型目录/模型/端口范围）与 exe 存在性校验；`start()` 仍保留端口检查防止与其他程序冲突。

- **DFlash 加速未生效**：`detectDraftModel` 检测到 dflash 草稿模型（如 Muse-Glimmer-30B 的 `dflash-kquant.gguf`）时一律将 `spec_type` 设为 `draft-simple`（普通草稿模型推测解码），而 DFlash 专用实现需 `--spec-type draft-dflash` 才生效，导致加速效果完全未实现。修复：检测到文件名含 `dflash` 的草稿模型时自动配置 DFlash 完整组合——`spec_type=draft-dflash` + `flash_attn=on`（DFlash 前置要求）+ `spec_draft_n_max=15`（Muse-Glimmer DFlash 每 block 预测 16 位置：1 条件位 + 15 草稿 token），并在控制台推送检测提示（`msg_dflash_detected`）；普通 `draft-*.gguf` 仍走 `draft-simple`；用户已手动选择推测解码类型时尊重选择不覆盖。

### 新增功能

- **参数设置页新增「性能测试」子选项卡**：封装 llama-server 在线实测能力，帮助用户找到 DFlash 最佳参数组合（Muse-Glimmer-30B 场景）：

  - **在线实测**：通过 `--metrics` 端点 + completion `timings` 读取真实吞吐与 DFlash 指标。经 b10360 源码确认 `llama-bench` 不支持推测解码评测，故采用运行中 llama-server 实测（`predicted_tokens_seconds` 与 `spec_decode_num_*` 与日志 `draft acceptance` 同源）。

  - **参数 A/B 对比**：保存当前参数快照为命名组合，调整后重测并排对比 tok/s、DFlash 接受率、生成 tokens。

  - **自动重启**：测试前自动用当前参数重启服务（未启用 `--metrics` 时自动开启），等待 running 后发测试请求。

  - **快捷参数调整**：ctx\_size、spec\_draft\_n\_max/min、flash\_attn、gpu\_layers、spec\_draft\_ngl、采样参数等直接读写参数表。

  - 新增 IPC 通道 `server:bench` / `server:benchMetrics`（49 → 51 通道），主进程 `bench-client.ts` 用 Electron `net` 模块发 HTTP（无 CORS 限制，支持 `api_key` Bearer 鉴权）。

  - **避免模型重复加载**：`Launcher` 保存最近一次启动的参数快照（`currentValues`），`getStatus()`/`ServerInfo.values` 暴露给渲染进程；BenchPanel 运行测试前对比当前参数（含 `_enabled`）与运行中服务快照，若完全一致且 `--metrics` 已开启则**复用现有服务直接测试**（不再无条件重启，省去 30B 模型数十秒重复加载），参数变化时才重启。

  - **数值参数精度对齐**：性能测试页的 `tuneValue`/`setTune` 原先直接 `String(v)`/`Number(raw)`，float 显示可能带浮点尾数（如 `0.94999999`）、输入 3 位小数不校验、越界不钳制，与参数配置页 SliderParam 不一致。修复：复用同一套 float/int 处理——float 显示 `toFixed(2)`、输入校验最多 2 位小数、四舍五入到 2 位、min/max 钳制；int 取整 + 钳制；文本/下拉直存。两界面读写同一 params store，现在格式完全一致。

  - **下拉参数选项校验对齐**：性能测试页的 dropdown 参数（flash\_attn、cache\_type\_k/v 等）原先为自由文本输入，可写入任意字符串（如 `flash_attn=banana`），command-builder 会原样发射导致 llama-server 拒绝；参数配置页 DropdownParam 只能从预定义选项选择。修复：`setTune` 对 dropdown 校验值必须在 `options` 中，非法值拒绝写入，与参数页行为一致。

  - **参数项动态化 + 控件复用**：性能测试页的参数项不再写死 10 个 key，改为**动态跟随参数配置页已启用项**——`activeTuneParams` 实时筛选 `params.isEnabled()` 的参数（排除 model/mmproj/spec\_draft\_model），勾选/取消参数后性能测试页自动增减；控件直接复用参数配置页组件（SliderParam/IntEntryParam/DropdownParam/CheckboxParam/TextParam），交互方式（滑块/下拉/开关/文本）与参数配置页完全一致，读写同一 params store 保证值精确同步传入后端；组合摘要 `snapshotSummary` 同步改为从快照 `_enabled` 解析已启用参数。

  - **参数行视觉隔离**：性能测试页参数行加 `1px` 边框 + `4px` 圆角 + hover 高亮（与参数配置页 ParamRow 卡片化分隔一致），提升视觉隔离与操作目标识别。

  - **运行测试行高修复**：测试提示词行与生成 Token 数行增加 `margin-bottom: 8px` 间距，消除组件重叠。

  - **运行测试按钮智能检测**：按钮不再因服务未运行而禁用——点击后自动检测：服务未运行 → 直接启动；运行中且参数一致（含 `--metrics` 已开启）→ 复用现有服务；运行中但参数不一致 → 停止后用调整后参数重启；`starting` 状态 → 直接重启不杀启动中进程。提示文案同步更新（`bench_status_starting`）。

  - **组合对比表格化**：参数组合对比从卡片式改为**表格**展示（组合名称 / 生成 tok/s / 提示 tok/s / DFlash 接受率 / 生成 tokens / 参数 / 删除），便于调整前后性能指标并排对比；新增 `bench_prompt_tok_s`、`bench_params` 列。

  - **去掉保存组合能力**：移除组合名称输入与「保存组合」按钮——用户直接调整参数后再次点击「运行测试」即可，减少多余操作。表格改为**测试历史**（内存态，关闭应用即清空），每次运行自动追加一条记录，按运行次数命名。

  - **参数摘要只显示已启用项**：修复 `snapshotSummary` 显示所有参数的问题——根因是 `onRunTest` 记录快照时用了 `{ ...params.values }`（不含 `_enabled`），导致摘要回退显示全部参数（含未勾选）。修复为 `{ ...params.snapshot() }`（含 `_enabled`），摘要只展示已启用参数；同时移除无 `_enabled` 时回退显示全部参数的逻辑。**运行测试传参核查**：`server.start/restart` 用的 `params.snapshot()` 含 `_enabled`，command-builder 按 `_enabled` 过滤，未勾选参数不会发射给 llama-server——启动参数正确，无需改动。表格列头标注「参数（仅已启用）」。

  - **性能测试历史切换页面不被清空**：ParamsPage 的 tab 面板原为 `v-else-if` 条件渲染，切换 tab 时 BenchPanel 组件被销毁重建，内存态测试历史（combos）丢失。修复：将参数渲染逻辑提取为独立的 `ParamsPanel.vue` 组件，ParamsPage 改用 `<KeepAlive include="ParamsPanel,PresetsPanel,BenchPanel">` 包裹 `<component :is>` 动态组件（KeepAlive 作为稳定父容器），各面板组件通过 `defineOptions({ name })` 提供缓存身份。经浏览器实测（setup 执行计数法）确认：切换 basic→bench 后组件不重新执行 setup，测试历史保留。

  - **测试历史清空按钮**：测试历史卡片标题栏新增「清空历史」按钮（复用 Card actions 插槽），应用运行期间可手动清空全部测试记录；无记录时按钮禁用。内存态数据关闭应用后自然清空。

  - **多次测试重启竞态修复**：`onRunTest` 原先在参数不一致时手动 `server.stop()` 后立即 `server.start()`——`taskkill` 杀进程是异步的，`exit` 事件触发前 `launcher.proc` 仍指向旧进程，`start()` 会误判 `Server is already running`，多次快速测试时偶发旧服务未停就启新服务。修复：统一改用 `server.restart()`——core 的 `Launcher.restart()` 在运行中会 `proc.once('exit', () => start)` 等旧进程退出后再启动新进程（未运行时直接 start），从根因消除 stop→start 竞态。逻辑测试 7/7 通过（未运行启动、运行一致复用、运行不一致重启、metrics 未启重启、修复前竞态复现、修复后消除）。

  - **重启后端点无法访问修复**：`waitRunning` 原先在 `server.status === 'running'` 时立即返回 true——但 `launcher.restart()` 是异步的（等旧进程 exit 后启动新进程），restart 调用后 `server.status` 可能仍是**旧进程的 running 残留**，此时立即发测试请求会在新进程模型尚未加载完成时访问端点（端点无法访问）。修复：`waitRunning` 增加两阶段等待——restart 场景先等状态**离开 running**（旧进程退出），再等重新进入 running（新进程加载完成）；每轮轮询 `server.refreshStatus()` 获取最新状态。复用场景（restarting=false）保持直接通过。逻辑测试 6/6 通过（旧 running 残留不误判、复用不卡、未运行 restart、超时）。

  - **启动失败不再卡在"等待服务就绪"**：模型/参数配置错误导致 llama-server 启动失败时（如 `failed to create MTP context`），进程 exit 后状态停在 `stopped` 且 pid 为 null，原 `waitRunning` 会一直等到 180s 超时。修复：`waitRunning` 增加启动失败检测——连续 4 次轮询（\~1.2s）看到 `stopped` + `pid === null` 即判定失败并立即返回（区分 restart 时旧进程退出的短暂 stopped 中间态），返回类型改为 `'ok' | 'timeout' | 'failed'`；`onRunTest` 对 failed 显示「服务启动失败（模型/参数配置错误？请查看控制台日志）」（新增 `bench_status_failed`），不再无谓等待。逻辑测试 5/5 通过。

  - **控制台切回时自动滚动到底部**：LaunchPage 原只 watch `server.outputs.length` 滚动——从其他页面切回控制台时（keep-alive 缓存组件，outputs.length 未变化）watch 不触发，内容停留在旧位置。修复：新增 `onActivated` 钩子，切回本页时调用 `scrollConsoleToBottom()` 滚动到最底部，确保看到最新日志。

  - **切换回草稿模型模式自动填入路径**：从 draft-dflash/draft-simple 等外部草稿类型切到 draft-mtp/ngram（`syncDependencies` 清空 `spec_draft_model`）后，再切回外部草稿类型时草稿模型路径不会自动填入（`detectDraftModel` 原只在模型切换时调用）。修复：`set('spec_type', ...)` 检测到新值为外部草稿类型且 `spec_draft_model` 为空时，自动重新调用 `detectDraftModel` 检测并填入路径；路径已有值时不重复检测。逻辑测试 12/12 通过（draft-mtp→draft-dflash 自动填入、ngram→draft-simple 自动填入、路径已有不重复、切 none 不触发）。

### 重构

- **参数设置合并为单页标签页**：原 BasicParamsPage / AdvancedParamsPage / ServerParamsPage / PresetsPage 合并为 `ParamsPage.vue`（基础 / 高级 / 服务端 / 预设四个标签页），路由 `/basic`、`/advanced`、`/server`、`/presets`、`/sampling` 统一重定向到 `/params?tab=...`。

- **引擎配置移到模型管理页**：原控制台页面顶部的引擎目录配置卡片从 LaunchPage 移到 ModelsPage 顶部，顺序为引擎配置 → 模型目录 → 模型列表 → 元数据/建议。

- **启动校验逻辑去重**：新建 `useStartServer.ts` 抽取 `canStartSync` / `canStartAsync` + 跨页跳转逻辑，TopBar 与 LaunchPage 共用（消除原有两处重复实现）。

- **侧边栏导航重排**：去掉"参数设置"可折叠分组，新顺序为模型管理 → 参数设置（单入口，任一分组有改动显示橙点） → 控制台 → 模型下载。

- **模型切换统一入口**：新建 `params.applyModel(path)` 统一模型切换逻辑（清理控制台 + 设置模型 + 并行检测 mmproj + 加载 GGUF），`params.applyModelWithSuggestions` 用于「应用建议参数」场景（重置 + 恢复模型 + 重检 mmproj + 批量应用），ModelsPage 与 TopBar 切换均走统一入口。

- **GGUF 状态收归 store**：原 ModelsPage 本地 `ggufInfo` / `ggufSuggestions` / `ggufLoading` / `ggufError` 状态与 `autoDetectMmproj` / `loadGgufMetadata` 函数全部移除，统一由 `params.ts` store 管理，模板直接读 `params.ggufInfo/ggufSuggestions`。

- **预设管理提取为独立组件**：预设功能从 PresetsPage 提取为 `PresetsPanel.vue` 组件 + `useAutoPresetName.ts` 组合式函数，ParamsPage 嵌入 PresetsPanel。

### 文档

- `docs/frontend.md`：章节 7.1 路由表更新（新增 `/params` + 旧路由重定向）、7.3 页面表更新（7 页 → 4 页）、7.5 样式系统补充下拉面板、版本从 1.4.0 → 1.4.1。

- `AGENTS.md`：页面数 7 → 4，打包输出版本 1.4.0 → 1.4.1，参数表 55 → 56。

- `docs/README.md`：参数数量 54 → 56，打包输出版本 1.4.0 → 1.4.1。

- `docs/params/LLAMA_SERVER_PARAMS.md`：参数总数 54 → 56，新增 `spec_cache_type_k` / `spec_cache_type_v` / `spec_draft_ngl` 文档。

***

### 修复

- **版本号显示不一致**：侧边栏通过 `APP_VERSION` 显示版本，但 `packages/shared/src/params/definitions.ts` 中的 `APP_VERSION` 仍停留在 `1.2`，与 `package.json` 的 `1.4.0` 不一致。已同步为 `1.4.0`，并更新 `AGENTS.md` 与 `docs/packaging.md` 的版本一致性检查清单，明确包含 `APP_VERSION`。

- **内存泄露风险**：修复 `App.vue`、`LaunchPage.vue`、`StatusBar.vue` 中 `setTimeout` 未在组件卸载时清理的问题；`window.ts` 在窗口关闭时显式移除 resize/move/maximize/unmaximize/leave-full-screen 事件监听；`DownloadManager.clearFinished()` 增加对段、速度定时器、元数据定时器的防御性清理。

- **打包失败**：

  - `apps/desktop/node_modules/@llama-launcher/{core,shared}` 在 `shamefully-hoist=true` 或打包失败后可能变为循环/损坏符号链接，导致 `beforePack` 跳过处理、electron-builder 报 `The name of the file cannot be resolved by the system`。`scripts/before-pack.cjs` 现在检测损坏链接并移除，回退到 root `node_modules/@llama-launcher/{core,shared}` 作为来源；`scripts/after-pack.cjs` 在恢复时增加目标有效性回退。

  - `release/` 目录被 Defender/索引器/残留进程锁定时，`scripts/clean-before-pack.cjs` 6 次删除均会失败。新增终极容错：将 locked `release/` 重命名为 `release_stuck_<timestamp>` 并新建空的 `release/`，保证打包流程不中断；同时清理历史 `release_stuck_*` 与更多遗留临时目录。

  - 新增 `scripts/dist-with-fallback.cjs` 包装 electron-builder：`pnpm dist` 现在自动调用该脚本，先执行 `clean-before-pack.cjs`，再在 `release/` 仍被锁定时自动切换到 `release-tmp-<timestamp>` 临时输出目录，打包完成后尝试将产物迁回 `release/`；Windows 下对锁定的目录还会尝试 `robocopy /MIR` 直接覆盖目标文件，无需先删除目录。产物部分或全部迁回时都会给出明确的后续提示。`apps/desktop/package.json` 的 `dist` 脚本已改为 `pnpm build && node ../../scripts/dist-with-fallback.cjs`。

  - **二次打包仍被锁定**：`clean-before-pack.cjs` 原只 `taskkill /IM "llama Launcher.exe"`，无法匹配 portable 产物 `llama Launcher 1.4.0.exe` 的进程名，导致验证后二次打包时 `release/` 仍被占用。现改用 PowerShell 按名称通配符 `llama Launcher*.exe` + 可执行路径前缀双重匹配终止进程，杀进程后增加 1 秒句柄释放等待，并清理历史 `release-tmp-*` 临时目录。`dist-with-fallback.cjs` 的 `isDirLocked` 改为通过尝试重命名目录来探测锁定（目录内可写不代表整体可替换），产物回迁时对锁定文件增加 `copyFileSync` 覆盖回退；`robocopy`/`copyFileSync` 成功后还会清理对应的源目录/源文件，避免 `release-tmp-*` 残留。

  - **打包流程报错噪音与重试时间优化**：`release/` 被 Defender/索引器的文件系统过滤驱动锁定时，程序化重试无法突破。`clean-before-pack.cjs` 重试从 6×5s（30s）降至 2×3s（6s），rename 失败时不再 `console.error` 而改为 `console.log` 提示将走 fallback；新增关闭指向 `release/` 的 Explorer 窗口（通过 COM `Shell.Application`）。`dist-with-fallback.cjs` 的 fallback 检测改用 `console.log`（非 `warn`），并在打包完成后打印 `BUILD SUCCEEDED` / `BUILD FAILED` 摘要。

### 变更

- **HuggingFace 镜像下载支持**：新增 `huggingface-client.ts`，通过 `hf-mirror.com` 镜像访问 HuggingFace API 列出仓库文件。`url-parser` 识别 `huggingface.co` 与 `hf-mirror.com` 均为 `source: 'huggingface'`，DownloadCard 跳过 ModelScope 搜索直接走镜像链路。

- **可注入网络传输层**：新增 `DownloadTransport` / `HfHttpTransport` 接口，Electron 主进程注入基于 `net` 模块（Chromium 网络栈）的传输，规避 Electron 内置 Node 的 BoringSSL TLS 指纹被 hf-mirror.com 拒绝（`read ECONNRESET`）的问题。仅 `hf-mirror.com` 走注入传输，其余源（ModelScope 等）继续走 `node:https`。删除已失效的 `http2-pool.ts`（Node http2 同样使用 BoringSSL，被 RST）。

- **动态段数下载算法**：`computeSegmentCount` 按文件大小递增段数（<100MB→1、<1GB→2、<5GB→4、<20GB→6、≥20GB→8），配合 `SEGMENT_TARGET_SIZE`(50MB) 与 worker 队列模型，消除尾段瓶颈。进度推送间隔从 1s 降至 500ms。

- **移除参数设置页命令预览**：`BasicParamsPage`、`AdvancedParamsPage`、`ServerParamsPage` 不再显示底部命令预览条；删除 `CommandPreviewBar.vue` 组件、对应的 `shared/src/command-preview.ts` 死代码及 `lbl_command_preview` i18n 键。启动页（LaunchPage）保留独立的命令预览卡片。

- **状态栏模型名优先显示别名**：底部状态栏 `StatusBar.vue` 的模型名现在优先读取 `alias` 参数，无别名时回退到模型文件名；复制模型名时也使用 alias 后的名称。

### 测试

- 新增 5 项 `gguf-meta` 单元测试：覆盖新增的 16 个元数据字段提取与 7 个采样参数建议推导。

- 全部测试通过：188/188 → 200/200。

***

## \[1.4.0] - 2026-07-25

### 新增功能

#### 下载功能优化

- **下载速度优化**：≥100MB 文件自动切分为 4 段并行下载；写入流 `highWaterMark` 提升至 4MB；HTTP Agent 启用 `keepAlive: true` 与 `maxSockets: 64`，整体吞吐接近或超过浏览器直链下载。

- **暂停/恢复/重试**：

  - 新增 `download:pause` / `download:resume` 两个 IPC 通道（IPC 总通道数 46 → 48）。

  - 下载任务卡片按状态显示「暂停 / 恢复 / 重试 / 取消」按钮。

  - 暂停时保留部分文件与元数据（`.llama_dl.json`），恢复时按段续传，零重复下载。

  - 失败任务可一键重试，无需重新选择文件。

- **量化标签分类**：

  - 文件名解析器 `parseQuantization` 支持 9 个量化系列：K-quants（Q4\_K\_M）、I-quants（IQ3\_XS）、Legacy（Q8\_0）、FP8（含 e4m3/e5m2 变体）、BF16、FP16/F16、FP32/F32、INT2/4/8。

  - 文件列表与下载任务列表均显示按系列着色的徽标（如 Q4\_K\_M 蓝色、IQ3\_XS 紫色、FP8 橙色）。

  - 鼠标悬停徽标显示位宽信息（如「Q4\_K\_M (4-bit)」）。

- **量化解析容错**：

  - 使用 `(?![a-z0-9])` 边界，允许 `fp8_mixed`、`bf16-instruct` 这类下划线/中划线后缀。

  - `\b` 防止 `iq3_small`、`f16c` 这类非量化串被误识别。

### 修复

- **断点续传双重计数 Bug**：分段恢复时 `position` 计算错误（`start` 与 `segment.downloaded` 都包含已下载量），导致「Segment received more data than expected」错误。修复为 `segment.start + segment.downloaded`。

- **状态覆盖 Bug**：`executeDownload` 的 catch 块会覆盖 `pause/cancel` 已设置的目标状态。增加 `cur.status === 'downloading'` 守卫，仅在真正下载中才标记失败。

- **未处理的异步错误**：上述两个 Bug 的组合导致测试在销毁管理器时产生未处理的 Promise 拒绝，已修复。

### 打包修复

- **修复打包后应用无法启动/无窗口的问题**：

  - 根因：pnpm workspace 在 Windows 上使用 junction 链接 `node_modules/@llama-launcher/{core,shared}`，原 `before-pack.cjs` 仅检测 symlink，导致 electron-builder 把包含过时 `dist/` 甚至 `src/`、`tests/` 的整目录打包进 asar。运行时 `shared/dist` 缺少新增 IPC 通道，主进程注册 handler 时触发 `Attempted to register a second handler for 'undefined'`，应用启动后无窗口。

  - 修复 [`scripts/before-pack.cjs`](../scripts/before-pack.cjs)：使用 `fs.realpathSync` 检测 junction/symlink；无论原路径是链接还是真实目录，都重建为仅含 `package.json` + `dist/*.js` 的真实目录；保存 `.pack-link-map.json` 供 afterPack 恢复。

  - 修复 [`scripts/after-pack.cjs`](../scripts/after-pack.cjs)：读取 link map，删除临时真实目录并恢复原始 junction/symlink，避免破坏 pnpm 开发环境。

- **强化打包前清理**：

  - 更新 [`scripts/clean-before-pack.cjs`](../scripts/clean-before-pack.cjs)：先终止所有运行中的 `llama Launcher.exe`；对 `release/` 删除增加 6 次重试 × 5 秒间隔，并在 Node.js `fs.rmSync` 失败时通过 **重命名 +** **`cmd rd /s /q`** 绕过 Windows `mmap`/Defender 句柄锁定。

- **版本一致性与配置恢复**：

  - `apps/desktop/package.json` 与 workspace root `package.json` 版本统一提升至 **1.4.0**。

  - 临时为绕过文件锁改到 `release-fixed` 的输出已还原为 `release/`，并清理了 `release-fixed`、`release-1.3.0-backup`、`release_stuck_*`、`release_v1.4.0_fix` 等临时目录。

  - 修复了根目录 `package.json` 被意外覆盖为 desktop package.json 的问题，恢复 root workspace 配置（`scripts.dev/build/lint/test`、`packageManager: pnpm@10.12.1`、`turbo` 依赖）。

- **验证**：打包产物 `release/llama Launcher 1.4.0.exe` 可正常启动并显示主窗口；`pnpm lint` 与 188 项测试全部通过。

### 测试

- 新增 10 项 `parseQuantization` 单元测试：覆盖 K-quants、I-quants、Legacy、FP8/BF16/FP16/FP32/INT 系列，以及 `Qwen3-4B-Instruct`（非量化）不被误识别。

- 新增 5 项 `pauseDownload` / `resumeDownload` 单元测试：覆盖暂停后状态切换、恢复后从断点续传完成、错误任务重试、不存在任务与非暂停状态。

- 全部测试通过：188/188。

### 国际化

- `zh.ts` / `en.ts` 新增键：`btn_pause_download`、`btn_resume_download`、`btn_retry_download`、`lbl_quantization`、`lbl_quant_tooltip`、`status_paused`。

### 文档

- `docs/core-modules.md`：`4.6 在线下载` 章节更新（含多段并行、暂停/恢复、量化解析说明）。

- `docs/packaging.md`：新增 `11. 打包配置` 及子章节，记录 junction 检测、beforePack/afterPack 机制、clean-before-pack 重试策略、常见打包故障与版本一致性检查清单。

- `docs/packaging.md`：新增 `11.3 输出目录锁定回退` 记录 `dist-with-fallback.cjs` 的自动回退与产物回迁机制；常见打包故障表同步更新。

- `docs/testing.md` / `docs/design-decisions.md`：测试统计更新为 15 个测试文件 / 188 个用例；关键设计决策新增「打包健壮性」。

- `AGENTS.md`：

  - IPC 通道数 46 → 48，打包输出版本 1.3.0 → 1.4.0。

  - 新增打包规范：junction 检测、输出目录稳定性、workspace root `package.json` 保护、版本一致性、打包后启动验证。

  - 在「打包经验」中 refer 到 `docs/packaging.md` §11，并说明 `pnpm dist` 现在使用 `dist-with-fallback.cjs` 自动处理输出目录锁定。

- `docs/README.md`：参数数量 40 → 47，IPC 通道数 46 → 48，下载特性补充暂停/恢复/重试，打包输出版本 1.3.0 → 1.4.0。

## \[1.3.0] - 2026-07-21

### 新增功能

- 思考控制参数（reasoning mode、token budget、output format、budget exhaustion prompt）。

- 高级参数页新增「思考控制」分组，参数总数 43 → 47。

## \[1.2.0] - 更早

历史版本，未在此详列。
