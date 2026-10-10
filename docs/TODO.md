# 待办与未决事项

本文件是**全项目待办的唯一活归口**（工程 + UI 风格）：CHANGELOG 条目只记已发生的事实，凡「未修 / 待确认 / 备查 / 待裁定」的事项一律登记在此。**本文件只保留未关闭内容（2026-10-10 定版）**：条目关闭时，把关闭结果作为事实记入 `docs/CHANGELOG.md`（当轮 `[Unreleased]`，注明出处版本）并从本文件删除该条——不设「已关闭」区，历史存量已于当日清账（17 条，出处索引见 CHANGELOG 同日条目）。

**已确认方案的条目按 spec 写、实施中主动回写（2026-10-10 起）**：用户确认方案后先把方案按「**做什么 / 怎么做 / 怎么验 / 什么算合格**」四段写进对应 T 条目再动代码，「怎么做」里带可勾选检查点（每步含文件与位置、命令、判据）；**每完成一个检查点就回写该条目**（勾掉 + 附证据），别等用户问、也别攒到收尾；全部完成后把结果记入 CHANGELOG 并从本文件删除该条；方案中途变更先改条目再改代码。关联条目互相指名（如「T17 由 T21 归零」）。

**UI 风格类不一致项自 2026-10-10 起也登记在这里**（归一，不再设第二处登记口）：同样用 T 编号，标题里标注 `style(ui)`，正文写「位置 / 描述 / 建议修复 / 修复效果验证」四段——描述要可复现、验证方式要可执行，禁止静默引入新风格。修复完成后把结果记入 CHANGELOG 并从本文件删除该条，其**详细记录**按既有惯例追加进 [archive/style-todo-resolved.md](archive/style-todo-resolved.md) 的条目明细区，并在「已修复索引」表补一行。原双语清单 `docs/{zh,en}/style/STYLE_TODO.md` 已于 2026-10-10 整段并入该归档并移除（英文镜像是同内容的译文，按「归档不译、单份维护」不再另存副本）；审计复现方式改由 [zh/frontend.md](zh/frontend.md) §7.5.9 承载。

归一当日实测：该清单 63 段条目标题全部 🟢、`## 🔴 修复项` 段内 0 条未修，**没有存量待办需要搬迁**；随后按「内容是否已在别处体现」逐区判定并整段并入归档（明细见 CHANGELOG 同轮条目与 T15）。本文件与 CHANGELOG 同属不译清单，只维护中文单份。

## 开放项

### T17 e2e `arco-locale.spec.ts` 竞态复现（2026-10-10 登记，翻 [T11] 的案）

- **位置**：`e2e/web/arco-locale.spec.ts:31`（模型页搜索框 `toBeVisible`）与 `:62`（`html[lang]` 一次性读取）。
- **描述**：T11 于 2026-10-09 按「观察期零复现」关闭，本轮实测**仍在复现且不是偶发**：在不含本轮改动的 HEAD 构建上 `--repeat-each=10` 连跑两次，分别 3 红 / 20 条 与 2 红 / 20 条，两条腿都出现过（zh 态搜索框 `element(s) not found`、en 态 `html[lang]` 读到 `zh-CN`）。同轮带 mock 空态改动的首次全量 e2e 也是这一条红（82 绿 / 1 红），已用 HEAD 基线对拍排除「本轮改动引入」。
- **成因（两条，互不相同）**：① `:62` 写作 `await ...getAttribute('lang')` 后再 `expect(...).toBe()`——一次性读取不重试，而应用启动是异步的（`main.ts` 动态 import demo-mock → `settings.load()` → i18n store 才写 `document.documentElement.lang`），`page.goto` 在 load 事件即返回，此时读到的还是 `index.html` 里静态的 `zh-CN`；② `:31` 的前一步 `page.goto('/?lang=xx#/models')` 若早于应用挂载完成，`last_tab` 恢复会把路由 replace 回 `/dashboard`，搜索框自然找不到。
- **建议修复**：① 换成会重试的断言 `await expect(page.locator('html')).toHaveAttribute('lang', …)`；② 带 hash 的 goto 之后先等挂载完成标志（如 `.sidebar`）再取搜索框——不要在用例里用 `waitForTimeout` 猜时长。
- **修复效果验证**：`--repeat-each=12` 定向复跑 24 条全绿 + 两轮全量 e2e 全绿；补一条负向实验（把 ① 退回一次性读取应能稳定复现红），关闭时在 CHANGELOG 写明「翻 T11 案」。
- **为何不当轮就修**：本轮交付的是 mock 空态开关；改 e2e 判据属另一件事，且取证需 ≥24 次重复跑，待裁定。
- **与 T11 的关系**：T11 的「观察期届满零复现」在当时为真，但 12 次重复的样本量不足以证伪一个概率约 10–15% 的竞态；T11 的关闭记录已按 2026-10-10 清账规则移入 CHANGELOG 存档（原文不改写），本案以 T17 重开。
- **归零路径**：由 **T21** 改判据写法（web-first 断言 + 等挂载）从根消除，T21 完成即关闭本条。

### T18 Electron 日志里的 `DNS config watch failed`——已定性为上游良性噪声，决定不处理（2026-10-10 备查）

- **现象**：真实 Electron 运行的终端日志出现 `[45376:...:ERROR:net\dns\dns_config_service.cc:273] DNS config watch failed.`，用户不知道要不要管。
- **结论（不修）**：这是 Chromium 网络栈自己的 DNS 配置变更监听在 Windows 上注册失败时打印的一行，与本应用无关——本应用没有任何功能因此失灵。
  - 启动期没有自发网络请求：全仓无 `electron-updater` / 遥测 / 崩溃上报；唯一走 Chromium 网络栈的通道是 hf-mirror 列表与下载（`apps/desktop/src/main/net/hf-transport.ts`、`download-transport.ts`），要用户进下载页才触发；ModelScope 与非 HF 下载走 `node:https`，`/props` 回读走 Node `fetch`，域名解析由操作系统解析器完成，不经这个监听器。
  - 这行也**不进应用日志页**：主进程没有转发 Chromium 日志的代码（`console-message` / `appendSwitch` / `--enable-logging` 全仓零命中），它是 Electron 原生 stderr——`scripts/dev-watch.cjs` 以 `stdio:'inherit'` 起 Electron，`scripts/dev.cjs` 按行加 `[electron]` 前缀，所以只有 dev 终端看得见。
  - 唯一理论影响：**运行期间改系统 DNS 设置，Chromium 的网络服务不会即时感知**（上游源码在此处把监听器标记为失败后不再重启，注释见 crbug.com/116139），重启应用即恢复。常见诱因是 Dnscache 服务被停、VPN/代理/TAP 网卡或安全策略干扰注册表通知；与本应用 `sandbox: false` 无关。
- **下一步**：无需动作。若日后出现「真机网络功能确实失败」的回报，再凭 trace 重开并复查这一假设（当前证据：electron/electron 仓库按该串搜索 0 结果，无专属 issue）。
- **归零路径**：调研把归因与排查口径固化成文档由 **T24** 执行（含「为何不抑制」的理由），T24 完成即关闭本条。
- **出处**：Chromium `net/dns/dns_config_service.cc`（`OnConfigChangedDelayed()` 打印该行）与 `net/dns/dns_config_service_win.cc`（`RegistryWatcher::OnObjectSignaled` 重注册失败）；[crbug.com/116139](https://crbug.com/116139)。

### T19 core 全量跑时 `download-manager` 的 resume 用例偶发 20s 超时（2026-10-10 登记，观察项）

- **位置**：`packages/core/tests/download-manager.test.ts:567`（`resumeDownload restarts a paused task to completion`）。
- **现象**：`pnpm --filter @llama-launcher/core test` 连红 3 次，报 `Error: Test timed out in 20000ms`；同一文件单独跑 1.7s 通过。
- **已排除**：① 与 2026-10-10 那批首次使用修复无关——退回 HEAD 与带着改动各跑「download-manager + gguf-meta」这一对，分别是 2.3s / 2.5s 通过；② 不是用例本身慢（安静时段全量复跑 41 文件全绿）；③ 关掉文件并行（`--fileParallelism=false`）当次仍超时，但同环境重跑又正常，复现率与机器负载相关。
- **当前假设**：该用例自建 `200 * 1024 * 1024` 的 Buffer 并逐字节填充，再落 200 MB 临时文件；并行 worker 各自分配时内存压力会把这段 CPU/IO 推到 20s 之外。本机 32 GiB，跑 e2e + dev 服务 + 子代理同时在场时最先遭殃。
- **下一步**：若 CI 出现同一条红，按两件事处理——把该用例的 fixture 缩小（几百 KB 足以验 resume 语义，不需要 200 MB）或给它单独提高 `testTimeout`；在没量化出 CI 复现率之前先不动测试面（缩小 fixture 会削弱「大文件续传」这一原始覆盖意图）。
- **不修代码的理由**：产品侧无已知故障，登记为观察项避免下次再花时间重查一遍。
- **归零路径**：由 **T22** 缩小 fixture（不调全局超时）处理，T22 完成即关闭本条。

### T20 命令预览告警补「去应用设置」CTA（2026-10-10 登记，源自首次使用调研）

- **做什么**：未配引擎 / 引擎文件不存在时的预览告警里加一只按钮，一键跳到应用设置页。现在只说「请在应用设置页配置…」——差最后一步动作（微软错误消息指南与 Ant Design 空状态规范都要求「问题 + 原因 + 一个可执行动作」）。
- **怎么做**：
  - `packages/shared/src/i18n/{zh,en}.ts` 加 `act_goto_settings`（短句、无插值槽）。
  - `packages/ui/src/components/service/CommandPreviewCard.vue`：`.cmd-alert` 内加 `a-button size="mini"`（范式抄 `ServiceStatusCard.vue` 的 `oom-act`），点击 `useRouter().push('/settings')`。**只在 `exe_not_configured` / `exe_missing` 两态给按钮**——unknown 那一态说不清原因，给跳转是误导。
  - 检查点：☐ 双字典键落地且 `verify-i18n-usage` 绿；☐ `CommandPreviewCard.test.ts` 加一条（两态出现按钮且点击触发 push、unknown 不出现）；☐ mock `?fresh=1#/service` 目测；☐ `pnpm lint` + `pnpm style:audit` 绿。
- **怎么验**：`pnpm --filter @llama-launcher/ui test`、`node scripts/verify-i18n-usage.cjs`、mock 目测（vite 常驻 5173）。
- **什么算合格**：未配引擎时预览区是「一句指路文案 + 一只按钮」，点按钮落在设置页；unknown 态无按钮；按钮必须是 `a-button`（无自定义控件、无新 token）。

### T21 e2e `arco-locale` 竞态从根归零（2026-10-10 登记；**T17 由本条归零**）

- **做什么**：把 T17 那两条 ~10–15% 复现率的红腿改成确定性的，不用 retry 摊薄（官方口径：retry 转绿 ≠ 竞态修好）。
- **怎么做**：
  - `e2e/web/arco-locale.spec.ts:59-63`：一次性 `getAttribute('lang')` + `expect().toBe()` 改为 web-first 自动重试断言 `await expect(page.locator('html')).toHaveAttribute('lang', …)`（一次性读取是 flakes 头号成因）。
  - `e2e/web/arco-locale.spec.ts:29-37`（`tableEmptyText`）：不再 `goto('/?lang=xx#/models')` 深链（若早于应用挂载，`last_tab` 恢复会把路由冲回概览），改成本仓既有约定——先 `goto('/')`、等 `.sidebar` 可见，再点侧栏进模型页（`e2e/web/app.spec.ts:25` 同款）。
  - 检查点：☐ 两处改完；☐ 负实验：把 ① 退回一次性读取，`--repeat-each=12` 必须稳定复现红；☐ `--repeat-each=12` 定向复跑 24 条全绿；☐ 全量 `pnpm e2e:web` 两轮全绿；☐ 关闭 T17（结果记 CHANGELOG 并删除条目）。
- **怎么验**：`E2E_PREVIEW_URL=http://127.0.0.1:4173/ pnpm exec playwright test arco-locale --project=web --repeat-each=12`（预览服务用驱动起，或直接 `pnpm e2e:web`）+ 上述负实验。
- **什么算合格**：24 条重复跑零红；负实验可稳定复现红（证明判据不是被改空）；T17 关闭并把结果记入 CHANGELOG。

### T22 `download-manager` resume 用例缩小 fixture（2026-10-10 登记；**T19 由本条归零**）

- **做什么**：把那条自建 200 MB 逐字节填充 buffer + 落 200 MB 临时文件的用例缩到 MB 级，消掉全量并行时的内存叠加超时（T19）。
- **怎么做**：`packages/core/tests/download-manager.test.ts:567` 起：`totalSize` 由 `200 * 1024 * 1024` 降到 `4 * 1024 * 1024` 量级（验续传边界够用），逐字节 `for` 填充改成构造式（`Buffer.alloc` + 一次性写入）。若确需保留真实体积覆盖，另挂 Vitest 4.1 的 test tag（slow）单独跑并只给该标签超时豁免；**不动全局 `testTimeout`**（官方口径：worker 内存叠加属资源超卖，调大超时会让真超时缺陷隐身）。
  - 检查点：☐ fixture 缩小；☐ 负实验：故意把 resume 起点改错，该用例必须转红；☐ 全量 core 连跑 3 次绿；☐ 关闭 T19（结果记 CHANGELOG 并删除条目）。
- **怎么验**：`pnpm --filter @llama-launcher/core test` 连跑 3 次 + 上述负实验。
- **什么算合格**：三次全量无超时；负实验证明用例仍守得住「续传确实从断点接着下」这条语义。

### T23 目录选择器增加原生「浏览…」快捷入口（2026-10-10 登记，**待用户裁定是否做**）

- **做什么**：应用内目录浏览弹窗的工具栏加一只「浏览…」按钮，调主进程的 `dialog.showOpenDialog({ properties: ['openDirectory'] })` 作系统原生快速通道；自绘列表保留，负责原生对话框做不到的「手输路径 / 不存在则创建」。
- **为什么**：调研结论——VS Code / 思源笔记等走原生对话框，零滚动容器风险且符合系统习惯；自绘是 web 架构的被迫选择（SillyTavern/ComfyUI），但保留了路径可编辑这一优势；两者并存各自覆盖对方短板。
- **代价（必须先说清）**：需要新 IPC 通道（通道数从 56 增到 57）⇒ 连带 `packages/shared/src/types/ipc.ts` + `pnpm generate:ipc` + `apps/desktop/src/preload/index.cjs` 包装 + `docs/{zh,en}/ipc-channels.md` + AGENTS.md 与文档里的通道数声明（中英两种句式都要改，漏一处 `verify-ipc-sync` 就红）。
  - 检查点：☐ 用户裁定；☐ 通道注册 + 生成物 + preload 包装；☐ 双语文档与计数声明同步；☐ mock 的 `listDir` 与原生通道二选一的分支在预览环境可目测（mock 无 dialog，按钮在预览态隐藏或走 `__mock*` 钩子，需先定）；☐ lint 七道绿；☐ Electron 真机由用户 `pnpm dev` 复核。
- **怎么验**：`pnpm generate:ipc` 后跑 `node scripts/verify-ipc-sync.cjs`；`pnpm lint` 全绿；用户真机点一次。
- **什么算合格**：真机能弹出系统目录对话框并把选中路径写回当前输入框；自绘路径不受影响；通道计数在代码、生成物、双语文档、AGENTS.md 五处一致。

### T24 DNS `config watch failed` 归因写入中英文档（2026-10-10 登记；**T18 由本条归零**）

- **做什么**：把调研结论固化进文档——这行是 Chromium 网络服务在 Windows 上注册表通知重注册失败后的**已知无害降级**，不是本应用的网络故障证据。
- **怎么做**：中英 `docs/{zh,en}/core-modules.md` 的网络客户端一节各加一句（同轮、结构对齐）：成因（`dns_config_service_win.cc` 注册通知失败 → `dns_config_service.cc` 打印）、影响（配置只上报空值 → 内置解析器回落系统解析、域名仍可解析；代价是本进程不再感知 DNS 变更，重启即复位 + Secure DNS/DoH 判定失效）、可见性（仅 dev 终端 stderr，打包后 Windows GUI 无 stderr，也不进应用日志页）、排查口径（真信号是 `ERR_NAME_NOT_RESOLVED` 或 `Failed to read DnsConfig`）。**明确写「不抑制」及其理由**：`--log-level=3` 会连 SSL 握手失败这类真线索一起吞掉，按行过滤等于维护一份长期黑名单。
  - 检查点：☐ 中英两句落地；☐ `pnpm docs:check`（链接/锚点）与 `verify-doc-pairs` 绿；☐ 关闭 T18（结果记 CHANGELOG 并删除条目）。
- **怎么验**：`pnpm docs:check`、`pnpm lint`。
- **什么算合格**：下次有人看到这行日志，只读文档即可判定「不用管 + 真信号看哪个」。

### T25 v0.0.68 CHANGELOG 段「待用户在 Electron 里复核」整段重复（2026-10-10 清账时发现，备查）

- **位置**：`docs/CHANGELOG.md` [0.0.68] 段 fix(ui,core,desktop) 条目末尾——同一段连排两遍，第二遍是去掉了「没有 desktop 测试 harness 可补」括注的短版，疑为该轮编辑残留。
- **判定（不修）**：属已公开发布的版本记录，按「已公开发布的记录不回改」纪律保持原样（T16 先例：连日期差错都不回改）；重复无害，仅阅读冗余。
- **下一步**：无需动作。若日后确需勘误发布记录，先裁定改法与留痕方式再动。
