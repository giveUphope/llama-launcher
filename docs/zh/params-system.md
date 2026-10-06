# 参数系统

> 语言：中文 · [English](../en/params-system.md)
> 范围：参数系统：参数定义（definitions.ts）、双轨机制（临时会话/预设）、依赖联动与推测解码自动检测、参数控件组件。
> 索引：[README.md](../../README.md) · 相关：[core-modules.md](core-modules.md)（命令构建）· [frontend.md](frontend.md)（参数页）

### 5.1 参数定义 (shared/params/definitions.ts)

- **`PARAM_GROUPS`**：3 组 — `basic`（基础）/ `advanced`（高级）/ `server`（服务）。
- **`PARAMS`**：共 69 个参数，分布如下：
  - basic：26 个（19 核心 + 7 采样）
  - advanced：29 个（5 思考控制 + 10 推测解码（其中 **4 个** `dependsOn.values` 依赖外部草稿类型 draft-simple/eagle3/dflash/dspark，另 2 个 `spec_draft_n_max`/`spec_draft_n_min` 用 `notValues: ['', 'none']` 即任何非空类型都生效）+ 6 多模态 + 6 KV 扩展 + 2 模板）
  - server：14 个（2 服务标识与鉴权 + 4 端点 + 4 CORS + 4 运行行为）
- 每个参数定义包含：`key, group, type, flag, default, subcategory, dependsOn, ggufField, invert_flag` 等字段。
- **两套「默认值」必须分开**（`params/engine-baseline.ts`，2026-09-25 拆）：`ParamDef.default` 是**界面初值**（里面装着启动器的基线推荐，如 `-ctk q8_0`、`--load-mode none`、`--fit off`）；发射判定的基准是另一个概念 **`engineDefault` = `llama-server` 没收到该 flag 时的行为**，逐条取自 help 基线。二者混用的后果是推荐值刚好等于 `default` 就永远不进命令行——引擎按自己的缺省跑，界面却显示着推荐档位。表内另有 `sentinel`（显式声明「此值 = 不指定，永不发射」，如 `chat_template` 的 `none`）与 `note`（`default ≠ engineDefault` 时必填，说明为什么覆盖引擎缺省）。**键集与 `PARAMS` 双向相等、`engineDefault` 与 help 对拍均由 `verify-params-sync.cjs` 硬拦。**
- **8 种控件类型**：`text` / `int_slider` / `int_entry` / `float_slider` / `dropdown` / `checkbox` / `file` / `dir`。
- **ggufField 映射**：参数可声明 `ggufField` 映射到 `GgufModelInfo` 的字段，参数行内联显示模型内置值；`buildSuggestions` 从元数据推导建议参数，点击可一键应用。映射按实际用途分类（2026-09 梳理）：仅**确定性事实映射**（`nextn_predict_layers → spec_type` 采样推荐等）与**启发式规则**（量化权重 → KV q8_0 等）进入建议；**纯参考信息**（`context_length` 训练上限、`rope.freq_base` 等）只在行内/信息卡展示，不产生建议（`-c` 默认 0 = 从模型加载，逐项建议属混淆源）；`cache_type_k/v`/`jinja`/`alias` 已移除语义错挂的 ggufField。
- **显存占用估算与性能目标**：core `devices.ts`（`--list-devices` 显存探测）+ `vram-estimate.ts`（KV 内存模型与显存/内存双侧占用 `estimateOccupancy`、无 OOM 最大上下文求解 `solveMaxContext`）+ `target-recommend.ts`（四档性能目标联动建议），经 `system:estimateVram` 暴露；参数页状态条「显存占用(估算)」stat 与目标选择器为唯一 UI 入口（详见前端 §7.3 / core-modules §4 模块表）。

### 5.2 参数双轨机制（临时会话 / 预设）

参数**没有独立启用/禁用状态**——命令行发射规则是「**值 ≠ 引擎缺省（`engineDefault`）才发射**，且不属于该参数的 `sentinel` 哨兵值」（checkbox 勾选发 `flag`、取消发 `invert_flag`，无 `invert_flag` 且 default false 的开关取消时不发射；空串跳过；依赖不满足跳过——详见 [core-modules.md](core-modules.md) §4.3）；旧版 `_enabled` JSON 启用机制已随双轨逻辑移除（`buildCommand` 读到 legacy `_enabled` 直接忽略）。

- **回读校验（2026-09-26 起）**：「值等于引擎缺省就不发射」有两个界面看不见的前提——引擎默认值可能与我们登记的基线不符（跨版本漂移），以及用户环境里可能有 `LLAMA_ARG_*` 改写缺省值。因此服务就绪后 core 会 `GET /props` 把引擎**实际生效值**读回来逐项对账，并按需复检（页签重新可见、或用户点「重新校验」；结果变化才补发事件，`checkedAt` 标注新鲜度）；映射与比对规则在 `shared/params/props-mapping.ts`，详见 [core-modules.md](core-modules.md) §4.11：映射表 **15 项**，同一份真机夹具按现行规则是 **9 项校验 / 6 项跳过 / 0 假报**，其余约 54 项引擎不回读，故命令预览卡**只在真的不一致时出声**。其中六个采样项是 `modelDerived`（模型文件自带的 `general.sampling.*` 会把未发射的缺省顶掉，只有 `envOverrides` 命中对应 env 通道才参与比对——详见 §5.5 第 3 条与 §4.11）。同一链路还捎带比对 `build_info` 与常量 `ENGINE_BASELINE_BUILD`（基线所钉引擎构建），**引擎比基线旧**即提示"参数基线可能已过期"。
- **临时轨道（会话）**：所有参数编辑自动持久化到 `~/.llama_launcher/settings.json` 的 `session_values` + `session_baseline`（`autoSave` watch 800ms 节流，**只写 settings、永不写预设文件**）；应用启动时经 `restoreSession` 恢复上次会话（参数值 + 基线一并还原）。
- **预设轨道**：`<models_dir>/presets/*.json` 仅在用户显式「保存预设」时写入；应用预设（`applyPreset`）以「预设名 + 参数快照」建立新会话基线（`markBaseline`）。
- **基线**：`SessionBaseline { preset_name, values }`——`hasChanges`（改动行 `--warn` 橙描边 / 侧栏橙点）有基线时相对基线快照逐键对比，无基线时对比出厂默认。基线不再以徽章展示（2026-09 移除，与「已调整」统计重复）；「恢复基线」（`restoreBaseline`，resetAll 后回写基线快照）与「清除会话」（`clearSession`，带确认；保留模型选择）入口保留在参数页状态条。
- **防丢确认**：切换模型（`applyModel`）与应用 GGUF 建议参数（`applyModelWithSuggestions`）前检测 `hasChanges`，未保存修改时弹 `confirmDiscardDirty` 确认，确认后应用并重建临时基线；应用启动重挂上次模型走 `reattachModelRuntime`（直接赋值、不确认、不重建基线、别名不重派生）。
- **`MODEL_KEY`（`model`）** 恒随命令携带 `-m`；`set(MODEL_KEY)` 自动派生 `alias`（`modelBaseName`，文件名去 `.gguf` 后缀）。

### 5.3 参数控件组件 (ui/components/params/)

| 组件 | 控件类型 |
|------|----------|
| `SliderParam` | int_slider / float_slider |
| `IntEntryParam` | int_entry |
| `TextParam` | text |
| `FileParam` | file / dir |
| `DropdownParam` | dropdown（自定义下拉面板，Teleport to body，与 TopBar 模型下拉统一样式） |
| `CheckboxParam` | checkbox |
| `ParamRow` | 统一行布局容器（两列网格、卡片化分隔、GGUF 内联提示、依赖警告） |

### 5.4 依赖联动与推测解码自动检测 (ui/stores/params.ts)

- **通用依赖联动清理** `syncDependencies()`：遍历所有声明 `dependsOn` 的参数，依赖不满足时重置为默认值并以 `dep-unmet` 警示呈现（橙描边 + 底色 + 警示图标，见 ParamRow；**控件不真正禁用**，用户仍可改值，改后按当前依赖状态重新判定）——判定与 `ParamRow.dependencyMet` 一致：依赖参数须"生效" + 值须满足 values/notValues。**"生效"语义与命令构建器 `isDependencyMet` 统一**：checkbox 依赖源按布尔判定（勾选即生效，默认值为 true 的 `cache_prompt` 也因此正确判定，不因"值=默认"误判不满足），其余类型按"值 ≠ 默认值"判定（默认值 = 未启用）；**例外**：`file` / `dir` 类型保留用户已选路径不重置（避免误清大段路径输入）。仅在被修改的 key 是依赖源（`DEP_SOURCE_KEYS`）时触发，避免"先填下游值、后选依赖源"被误清。
- **依赖分组**：
  - `spec_draft_model` / `spec_draft_ngl` / `spec_cache_type_k/v` → 依赖 `spec_type` 为外部草稿类型（`draft-simple`/`draft-eagle3`/`draft-dflash`/`draft-dspark`）
  - `spec_draft_n_max` / `n_min` → 依赖 `spec_type` 非空且非 `none`（MTP/ngram 也适用）
  - `reasoning_effort` / `reasoning_budget` / `reasoning_format` / `reasoning_budget_message` → 依赖 `reasoning` 非 `off`
  - `cache_reuse` → 依赖 `cache_prompt` 为 `true`
- **推测解码草稿数联动** `set('spec_type', ...)`：选择投机采样类型时自动应用该类型的推荐最大草稿数（`spec_draft_n_max`，映射 `SPEC_DRAFT_N_MAX_BY_TYPE`：draft-simple/eagle3/dspark=8、draft-dflash=15、draft-mtp=5、ngram-*=5）并启用——仅选类型不配草稿数无法达到该方式最佳效率；同时保持 `n_min ≤ n_max`（切换类型或手动调小 `n_max` 时钳制 `n_min`）。关闭（none/空）时经 `syncDependencies` **把草稿数重置为其默认值**（`spec_draft_n_max` 默认 **3**，不是清空为 0/空——`resetDep` 赋 `p.default`，见 stores/params.ts:337）。
- **DFlash/草稿模型自动检测** `detectDraftModel()`：模型切换时检测同目录 dflash/draft 文件——dflash 文件自动配置 `spec_type=draft-dflash` + `flash_attn=on` + `spec_draft_n_max=15`（Muse-Glimmer DFlash 每 block 预测 16 位置：1 条件位 + 15 草稿 token）；普通 draft 文件设 `draft-simple`；用户已选类型时尊重不覆盖。
- **切回外部草稿类型自动重新检测**：`set('spec_type', ...)` 检测到新值为外部草稿类型且 `spec_draft_model` 为空时，自动重新调用 `detectDraftModel` 填入路径；路径已有值时不重复检测。注意：依赖不满足时 `file` 类型**保留路径不重置**（见上条例外，仅 `buildCommand` 跳过发射），因此"切到 draft-mtp/ngram 再切回"通常仍有路径、不触发重检——重检发生在路径为空的场景（如清除会话/`resetAll` 后）。

### 5.5 二进制升级后的参数固定流程（re-pin）

**背景**：仓库固定 `docs/params/llama-server-help-out.txt`（`llama-server --help` 原始输出）作为参数文档基线与同步校验的对照源；`scripts/generate-params-doc.cjs` 在 `docs/{zh,en}/params/LLAMA_SERVER_PARAMS.md`（中英两份，一次生成）头部标注来源二进制版本。应用不随捆绑二进制发布（引擎目录由用户自选），固定 help 只是文档基线，但升级引擎后必须重走本流程，否则参数表/文档与真实后端脱节。

**升级 llama.cpp 二进制后的固定步骤**：

1. **导出新 help 到临时文件**（先审计、后替换——若先覆盖基线，第 3 步审计会拿"新 help 对比新 help"，flag 增删恒为空，漂移全部漏检）：
   ```
   node -e "const{execFileSync}=require('child_process');const fs=require('fs');const out=execFileSync('.\\llama-bXXX-bin-win-vulkan-x64\\llama-server.exe',['--help'],{encoding:'utf8',maxBuffer:1024*1024*64});fs.writeFileSync('docs/params/llama-server-help-new.txt',out)"
   ```
   ⚠ 勿用 PowerShell `>` 重定向：PS5.1/部分环境会写 **UTF-16**（含 BOM/空字节），
   文档生成器按 UTF-8 读取会整段漏解析（b10734 升级踩坑，2026-09-01 改为 Node spawn 落盘）。
2. **漂移审计**（新 help vs 固定基线：flag 增删 / 默认值变化 / 应用参数缺失）：
   ```
   node scripts/verify-help-drift.cjs docs/params/llama-server-help-new.txt
   ```
   flag 级漂移或应用 flag 缺失时退出码非 0（CI 可拦截）；默认值变化只提示不失败，需人工决策是否跟随。
3. **审计通过后替换基线**：`llama-server-help-new.txt` 覆盖 `llama-server-help-out.txt`。**两版 help 逐字节相同是合法结果**（b11178 → b11243 即如此，两侧 sha256 一致），此时该文件连 diff 都没有——但第 4 步照旧要做，因为界面那条「基线可能已过期」的告警比的是**构建号**，不是 help 内容。
4. **更新基线构建号**：事实源是 `packages/shared/src/params/engine-baseline.ts` 的 `ENGINE_BASELINE_BUILD` 常量，另有 **6 处声明**必须同步：本文件头部注释「当前固定 bN」、`scripts/generate-params-doc.cjs` 中英两行的来源串、`README.md`「基线对齐 llama.cpp **bN**」、`README.en.md` "baseline aligned to llama.cpp **bN**"、本文中英两侧「当前实测」段首行的括号。`verify-params-sync` ⑥ 会把这 6 处逐个解析并要求相等（**解析不到同样 fail**），漏改一处即红。旧版本文在这一步只写了「改生成器里硬编码的版本串」——那是常量化之前的写法，今天照做只够改 1/6。
5. **检查把基线值写死的夹具与 mock**：同一个字面量既表达「实测数据」又表达「当前配置」的地方，改完常量必然假失败或假报警——`packages/core/tests/props-check.test.ts` 真机快照的 `build_info`、`packages/ui/src/dev/demo-mock.ts` 的 props-ok 演示值都踩过这两个后果。处置口径：真机串按抓到的原样保留（它确实比新基线旧，就如实断言漂移），而「引擎等于基线 ⇒ 不报漂移」这类断言改由 `ENGINE_BASELINE_BUILD` 拼出值来验。
6. **更新 `packages/shared/src/params/definitions.ts`**：按审计结果新增/移除参数、同步下拉 `options`（allowed values）、调整默认值（默认值变更需结合实测结论决策，例如 b10429 将 `--load-mode` 默认改为 `auto` 时，应用按 `docs/archive/experiments/plan-kv-split-cli-test.md` 实测结论保留 `none`）。
7. **重建 shared**：`pnpm --filter @llama-launcher/shared build`（core 测试依赖 `dist`，不重建会测试不一致）。
8. **重新生成参数文档**：`node scripts/generate-params-doc.cjs`。
9. **校验一致**：`pnpm lint` 内含 `verify-params-sync.cjs`（六类校验，**任一有出入即 fail**）：① 参数定义 ↔ 对照表 ↔ help 三方对拍；② 文档里的参数计数声明（总数与分组数）与实测一致；③ `PARAM_LABELS`/`PARAM_HELP` 键集与 `PARAMS` 双向完全相等且 zh/en 非空（表里有字典无 → 界面渲染裸 key；字典有表里无 → 死条目）；④ `engine-baseline.ts` 的 `engineDefault` ↔ help 的 `(default: X)` 对拍（键集双向相等，`default ≠ engineDefault` 的覆盖必须写 `note`，解析不到条目同样 fail）；⑤ argv 发射实现唯一（只准 `shared/src/params/command.ts` 拼装）；⑥ 基线构建号 6 处一致。单独跑该脚本可看逐项输出。
10. **IPC 通道如有变更**：同步 `packages/shared/src/types/ipc.ts` 与 preload 生成，跑 `pnpm lint`（含 `verify-ipc-sync.cjs`）。
11. **回归**：`pnpm lint` + `pnpm test`。
12. **记录**：`docs/CHANGELOG.md` [Unreleased] 补充条目。

**实测参考（2026-08-15，b10429→b10502）**：flag 集合 415 个完全一致（应用 55 个 flag 全部存在于新 help），唯一语义变化为 `--load-mode` 默认 `mmap`→`auto`（b10502 新增 auto 模式）→ 应用下拉补入 `auto` 选项，默认保持实测推荐的 `none`。此流程即本次审计的完整回放。

**实测参考（2026-09-01，b10502→b10734）**：flag 级漂移审计**移除 0、应用 flag 缺失 0**（全部顶格安全）；`--help` 落盘改用 Node spawn（修 PowerShell UTF-16 重定向坑，见步骤 1）；新增 9 参数入表（参数表 49 → **58**，含 `--lazy-mode`、`-ncffn`、`--kv-unified-per-slot`、`-mmdev`、`--video-fps` 等）。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]「参数基线升级至 llama.cpp b10734」。

**实测参考（2026-09-04，b10734 基线）**：`verify-params-sync` 代码 flag 67 / 对照表一致；`verify-help-drift` 基线 help 428 flag 全一致（无新增无移除）。

**实测参考（2026-09-19，b11053 基线，version 0.4.1-dev / commit 1af554f8f）**：flag 级漂移 = **新增 2**（`--log-jsonl` / `--no-log-jsonl`）、**移除 7**（`--mlock`、`--mmap`/`--no-mmap`、`-dio`/`--direct-io`/`-ndio`/`--no-direct-io`——都是 b10734 里已标 `DEPRECATED in favor of --load-mode` 的独立别名，应用早已迁移到 `--load-mode` 下拉，**零影响**）；应用 69 个 flag **缺失 0**。默认值变化仅 1 条真实语义变化：`--reasoning-preserve` 由 `template default` → `enabled`（该 flag 未入参数表，无跟随动作）。枚举白名单逐项核对**无漂移**：`--load-mode` 取值仍含 `dio`、`--spec-type` 11 值全同、`--chat-template` 内置模板列表与 b10734 **逐字节相同**（我们 24 项为其子集）。`--log-jsonl` **决定不收录**：它把 stdout 改成每行一个 JSON 对象，直接破坏 `launcher.ts` 的 listening 检测（按行匹配 `listening` + `http|server`）与控制台逐行着色，与 `--log-file` 同类。另修 `verify-help-drift` 解析器一处误报：说明续行 `… default: follows --device)` 不以 `(` 开头、而剥离字符集不含括号，于是把 `--device)` 当成新 flag（本次首跑即误报「新增 --device)」）；修正后 flag 数两侧同步下降——**b10734 基线 428 → 421，当前 b11053 基线实测 416**（自比对输出 `基线 flags: 416 | 新 flags: 416`；引用该数字时务必注明「哪个基线 + 哪个解析器版本」）。

**实测参考（2026-09-26，b11178 基线，version 0.5.0-dev / commit f9af9be21）**：flag 级漂移 **新增 0、移除 0**（416 ↔ 416，应用 69 个 flag 缺失 0）。换基线后 `verify-params-sync` 仍报「help 可对拍的 49 项 `engineDefault` 全等」，即**这两个版本之间没有任何一个应用参数的引擎默认值发生变化**，`definitions.ts` 与 `engine-baseline.ts` 的取值本轮零改动。三条真实变化需要记录：

1. **`--host` 改为接受逗号分隔多地址**（说明同时补入「多个 TCP 地址时 `::` 只绑 IPv6」「地址重叠属未定义行为」），默认仍是 `127.0.0.1`。`verify-help-drift` 把这条报成「默认值变化」，实为 `(default:` 被折行到下一行造成的 diff 噪声——人工比对两侧原文后判定不改判（该脚本按行比对，遇到折行默认值就会误报，**看到默认值变化先查是否折行**）。启动器侧的连带缺陷已修：整串当单地址用会拼出 `http://0.0.0.0,::1:8080/` 这种打不开的 URL，端口探测也会拿无法绑定的串去探从而把占用误报成空闲；现由 shared 的 `hostList` / `tcpHosts` / `displayHost` 统一解析（见 [data-persistence.md](data-persistence.md) 的 `ServerInfo.url` 与 [desktop-main.md](desktop-main.md) 的 `system:checkPort`）。
2. **`(env: LLAMA_ARG_*)` 通道由 139 条增至 145 条**，新增的 6 条恰好是采样族（`LLAMA_ARG_TEMPERATURE` / `TOP_P` / `MIN_P` / `REPEAT_PENALTY` / `PRESENCE_PENALTY` / `FREQUENCY_PENALTY`）。60 个应用参数里 **57 个**带该通道。这构成发射规则的一个新前提缺口：「值等于引擎缺省 ⇒ 不发射」成立的假设是**没有别的东西改写缺省值**，而这些变量正是改写缺省值的东西。实测（b11178，畸形值 + 合法命令行参数并用）证明 env 在启动期即被处理、**即便命令行给了合法值也会因 env 解析失败而终止进程**。处置见 [design-decisions.md](design-decisions.md) 第 24 条与 `ServerInfo.envOverrides`。
3. **`--completion-bash` 不能当默认值来源**：实测吐 298 个长 flag 挤成一行，既无类型也无默认值；`--list-devices` 只给设备，`--json-schema` / `-jf` 是约束生成用的，不是配置导出。

**实测参考（2026-09-29，b11243 基线，version 0.5.0-dev / commit fc07d781e）**：本轮一句话结论——**新 help 与固定基线逐字节相同**（两侧 sha256 一致，59615 字节 / 732 行）。于是 flag 416 ↔ 416、新增 0 移除 0、应用 74 个 flag 缺失 0、默认值与描述变化 0 条，`definitions.ts` 与 `engine-baseline.ts` 的取值本轮零改动。上游 b11178 → b11243 共 65 个提交（GitHub compare 实测），改的是实现而不是参数面。四条判断需要记录：

1. **既然零漂移为什么还要重钉**：`/props` 的 `build_info` 与 `ENGINE_BASELINE_BUILD` 比对是唯一能发现「拿旧尺子量新引擎」的运行时通道。基线留在 b11178 时，用 b11243 的用户每次都会看到基线漂移提示，而这份逐字节相同的 help 恰好证明两者等价——**常年误报的告警会被无视，等于把这条通道废掉**。重钉的成本只有 6 处声明，且 `verify-params-sync` ⑥ 逐个解析并要求相等，漏改一处即 fail。
2. **顺手改掉两处「把基线值写死」的耦合**：`packages/core/tests/props-check.test.ts` 用真机快照的 `build_info` 字面量同时承担两件事——「真实回读形状」与「引擎等于基线所以不该报漂移」，基线一挪后者就假失败。现在夹具字符串按抓到的原样保留（历史记录要诚实），「相等 ⇒ 不报漂移」改由 `ENGINE_BASELINE_BUILD` 拼出合成值来验；`packages/ui/src/dev/demo-mock.ts` 的 props-ok 演示值同理，否则 mock 页一打开就自己显示成漂移。**教训**：夹具里同时表达「实测数据」和「当前配置」的字面量，重钉时必然假失败，后者应当从常量取数。
3. **env 通道重新实测**：help 里 `(env: LLAMA_ARG_*)` 仍是 145 条（与 b11178 相同），但按当前参数表重算是 **74 个应用 flag 里 67 个**带该通道。上一条写的「60 个参数里 57 个」是当时那张 60 参数表的数字，按历史条目原样保留，不顺手改成今天的值。
4. **未验证项（诚实记录）**：`/props` 的字段形状本轮**没有**用 b11243 真机重抓——这台机器 `models_dir` 指向的目录不存在、全盘无 GGUF，起不了 server。help 逐字节相同使 CLI 面的判定可信，但 `/props` 属引擎内部实现，65 个提交里若有人新增或改名字段，只有真机回读能发现。补法：在有模型的环境跑 `node scripts/verify-server-start.mjs --model=…`，或直接 GET `/props` 与上述夹具对拍。（这一格已在 2026-10-06 的 b11408 真机回读中补上，见下一节「当前实测」的第 3 条；此处按历史陈述原样保留。）

**当前实测（2026-10-06，b11408 基线，version 0.5.0-dev / commit 9f12cd4a4）**：本机 `llama-b11408-bin-win-vulkan-x64`（构建号较基线 +165，未逐提交核对上游改动）。help 面只多一个 flag——`--spec-draft-sampling`（`{greedy,probabilistic}`，默认 `greedy`，带 `LLAMA_ARG_SPEC_DRAFT_SAMPLING` 环境通道，无短名），`verify-help-drift` 报 flag **416 → 417、移除 0、应用 74 个 flag 缺失 0**，两份 help 的整篇 diff 恰好只有那 5 行新增、**0 行改写**。三条判断需要记录：

1. **参数表本轮不动**：新 flag 未收录，`definitions.ts` 与 `engine-baseline.ts` 的取值零改动，因此对照表只多出一行「⬜ 未支持」，参数总数仍是 64。收录它是另一笔账（要动 13 处计数声明并给基线表加键），与重钉分开决策。help 里 `(env: LLAMA_ARG_*)` 由 145 条变 146 条，差集正是这一条；「74 个应用 flag 里 67 个带该通道」不变（新 flag 不在应用表内）。
2. **漂移提示改成方向性（本轮的行为变更）**：`driftOf` 此前是「构建号不等就报」。基线一旦钉到最新版，这条就会打在每一个抢先升级引擎的用户身上，而真正需要提醒的是**引擎比基线旧**的人——那批不可回读参数的缺省判定可能对不上。现在只在 `engine < baseline` 时出声，中英文案同步改为「引擎构建比参数基线旧」。**代价必须写明**：引擎比基线新的用户从此**不再收到任何提示**，「上游前进了而我们还没重钉」这件事退回靠 re-pin 纪律与本节流程保证，运行期通道不再兜底。
3. **`/props` 真机回读（2026-10-06 同轮补做）**：起 `llama-b11408-bin-win-vulkan-x64`（Vulkan / AMD）加载 9.1 GB 的 Qwen3.8-27B-UD-Q2_K_XL，`--port 8099`（不动 8080，收尾只杀自己起的 PID）。**`PROPS_FIELD_MAP` 的 14 项在真机上全部取到值、0 项静默失效**；float32 噪声（发出 `0.7` 回读 `0.699999988079071`）与 `build_info = b11408-9f12cd4a4` ⇒ 不报漂移，两条都在真机确证。真机顶层键 19 个（b11178 夹具 10 个），多出 `chat_template_caps` / `modalities` / `ui_settings`（空对象）与 `params.*` 里 32 个我们未映射的采样项（`dry_*` / `mirostat*` / `dynatemp_*` / `xtc_*` 等），**没有任何夹具字段消失或改类型**。**顺带抓到一处真缺陷并已修**：`default_generation_settings.n_ctx` 回读的是**每槽** ctx 而非 `-c` 的总值——同一 `-c 4096`，`-np 4` 回读 1024（日志 `n_ctx_slot = 1024` 吻合）、`-np 1` 回读 4096，故 `parallel > 1` 时直接相等比对会**稳定假报「参数没生效」**；乘回去也不可行（4097 ÷ 4 向下取整 = 1024，任何算术补偿都会重新制造假报）。修法是给映射表加数据式的 `skipWhenProps: { path: 'total_slots', gt: 1 }`，多槽时不比这项——宁可少一条证据，也不许界面谎报。**仍未判定**：b11178 夹具里 `total_slots: 4` 与 `n_ctx: 262144` 恰等于发出值，说明「每槽」语义可能是 b11178 之后才改的；b11178 无法复测，故按当前引擎处理、夹具原样保留。**其余未验证**：`seed` 的 uint32 环绕真机未触发（传的是 `-s 1234`，仍只有单测覆盖）；方向性漂移的另两支（引擎更旧⇒告警 / 引擎更新⇒静默）本机只有 b11408 一个引擎，未验证。（这一句写于上一轮，第 4 条已经把「更旧⇒告警」那支补上了。）

4. **第二次真机回读：补上「引擎更旧⇒告警」那一支，并抓出第二处假报（2026-10-06）**：本机其实不止一个引擎——仓库根还有 `llama-prism-b10754-2459f68-bin-win-vulkan-x64`（比基线旧 654 个构建），于是上一条那句「未验证」的前提解除了。同一端口纪律（`--port 8099`、收尾只杀自己起的 PID），加载 `Ternary-Bonsai-2-27B-PQ2_0`（7.2 GB）后 `/props` 抓取时序 `503 → 503 → 200`，**`build_info` 原文 `b10754-2459f68b5`** 喂进 `checkEngineProps` 判出 `baselineDrift = { engineBuild: 'b10754', baselineBuild: 'b11408' }` ⇒ 「更旧就告警」这一支从此有真机证据；控制组（只把 `build_info` 换成当前基线）立刻安静，证明告警确实只由构建号触发。**「引擎更新⇒静默」那一支仍然只有单测**——本机没有比 b11408 更新的引擎，不许假装验过（用例里用 b11999 构造，是形状而非实测）。顺带两份抓取的**顶层 19 键 / 70 个叶路径键集完全相同**，b11408 与 b10754 之间没有任何字段消失或改类型。
   - **覆盖面重估的结论**：按「表内可下发 ∧ /props 有键」交叉，名字对得上的只有 4 条，**实收 1 条** `props_endpoint` → `endpoint_props`（真机两态各抓一次：不发 `--props` ⇒ false、发 ⇒ true，其余键值只差 seed / temperature / 每次随机的 `media_marker`），映射表 14 → **15**。`reasoning_format` 与 `spec_type` **不收**：发了 `--reasoning-format deepseek` / `--spec-type ngram-mod` 之后 `/props` 那两个同名键仍是 `"none"`（它们是**每次请求**的 chat 参数默认值，不是服务端 flag 的结果，映射过去等于每次启动假报）；另注意 `params["speculative.types"]` 是**字面含点号**的单个 JSON 键，现有取数按 `.` 下钻根本取不到。`chat_template`（回读是数千字符的模板原文，量纲不同）、`cors_proxy_enabled`、`is_sleeping`、`chat_template_caps` 同理不收——清单写在 `props-mapping.ts` 的注释里，免得下一个人凭同名键再评估一遍。那 34 个未映射的采样项（`dry_*` / `mirostat*` / `dynatemp_*` / `xtc_*`）是**我们表里没有、发不出去**，不是漏收。
   - **第二处假报（真机抓到，已修）**：模型自带 `general.sampling.{temp,top_k,top_p,min_p,repetition_penalty,penalty_present}` 时，引擎会在我们**没发**该 flag 的前提下用模型推荐值改写。实测未发 `--temp` / `--top-k`，回读却是 `temperature: 1`、`top_k: 20`（引擎缺省 0.8 / 40），而这行没有 `onlyWhenSent` ⇒ 界面假报「`--temp` 没生效」。b11408 与 b10754 两款模型上都复现，也就是说**只要模型文件带推荐采样参数就必然假报**，不是边缘情形。修法不是简单加 `onlyWhenSent`：那会顺手把「`LLAMA_ARG_*` 覆写在回读里现形」这条既有能力一起废掉（`props-check.test.ts` 里有专门用例守着它，删了就是把尺子折了）。改成新的表内声明 `modelDerived: { envChannel }`——未发射时，只有主进程检出的 `envOverrides` **命中该参数的 env 通道**才参与比对，否则计为 skipped；判据两头都钉（没命中不许出声、命中不许哑），`Launcher` 的透传链路另有用例。成员清单不靠猜：就是 `gguf-meta.ts` 里那六个源键（该模块正是据此生成「模型内置建议」）。`seed` 保持「没发也比」，因为 help 里它没有 env 通道、模型也没有对应源键。删除实验：把 `top_k` 那条标记摘掉 ⇒ 3 条用例转红。

### 5.6 部分落地：把「装不下的模型放内存跑」接进界面（2026-10-05 登记，2026-10-06 收下第 1 项）

**第 1 项已落地（2026-10-06）**：`--device` / `--override-tensor` / `--tensor-split` / `--cpu-moe` 已收进 `packages/shared/src/params/definitions.ts`。flag 取**短别名形态** `-dev` / `-ot` / `-ts` / `-cmoe`（与同族 `-ncmoe`、`-ncffn` 一致——这张表存的就是实际发射的那个 token）。控件类型 `text` / `text` / `text` / `checkbox`：设备名与张量模式串都是动态值、多卡比例是逗号分隔列表，沿用 `-mmdev` / `--spec-synth-rates` 的 `text` 写法，没有新增 type。四项一律归 `basic` 的 `memory` 分区，与 `-ngl` / `-ncmoe` / `-ncffn` 同族，**分区总数仍是 14**（`packages/ui` 的 `SUBCATEGORY_ORDER` 是硬编码清单，加分区要动 UI，本轮不动）。`engine-baseline.ts`：这四条 help 原文都没有标注 `(default: X)`，故 `engineDefault` 登记为「不下发」（`''` / `false`），`default == engineDefault` 因此无需 `note`；`none` 对 `--device` 是「完全不卸载」的字面取值，不是哨兵，填了照样下发。`--device` 与 `--fit` 的交互写成行内提示而不是 `dependsOn`，依据是 help 把 `--fit` 定义为 "whether to adjust unset arguments to fit in device memory"——它只改写**未设置**的参数，填了值本就不归它改；而 `dependsOn` 会在依赖翻转时清空用户输入的设备名，那是数据丢失而不是提示。**参数总数 64 → 68**：`README.md` / `README.en.md` 与本文中英两处的计数声明本轮已同步；`AGENTS.md`、`docs/{zh,en}/architecture.md`、`docs/{zh,en}/core-modules.md`（还含 basic 分组数 22 → 26）、`docs/{zh,en}/frontend.md`、`docs/{zh,en}/testing.md` 共 9 处声明**本轮未改**（不在授权改动范围内），`verify-params-sync` 的计数门禁会红，需由串行改动者一并更新。**第 2、3 项同日落地（2026-10-06）**：界面上现在会说这件事了，且**判据只有一份**——「装不下 ⇒ 该改哪个参数」由 core 的 `recommendOffloadAdvice`（`packages/core/src/target-recommend.ts`）判定，条目带 `offloadRelief` 标记随**已有**的 `system:estimateVram` 通道下发（通道总数仍 57，未新开），渲染层 `packages/ui/src/stores/hardware.ts` 只做「MiB → GiB 换算 + 按标记分流」，不再自己算一遍「装不下吗」。**第 2 项**：服务页命令预览卡新增常驻行 `.cmd-placement`（`visibility: hidden` + `min-height: 36px` 的静态预留，不是「测量再回填」），三态取 `place_all_vram` / `place_split` / `place_all_ram`，数字全部来自 core 的占用估算（有权重落在内存侧时走橙色警示档，因为那时决定出字速度的是内存到显卡的搬运）。**没有写任何「慢 N%」之类没量过的数**。**第 3 项**：概览状态卡的 `.oom-row` 同档常驻槽里给出减负建议，最多两只按钮（超出会换行 = 卡片长高），建议项只引用参数表里真实存在的 key（`cpu_moe` / `n_gpu_layers` / `device` / `tensor_split`），点击即 `params.set`；服务正在跑时按设计闭嘴（那时喊「装不下」是自相矛盾，真炸了由既有的 OOM 归因接管）。新增 9 个 i18n 键（中英同建、槽数一致）。验证：`packages/ui/src/stores/hardware.test.ts` 守派生与取数时机（含「探不到设备就不出声」「后台页不敲主进程」），`e2e/web/offload-advice.spec.ts` 15 条把两行钉住——中英各量的「无声/出声两态同高 + 档位」、四种落位现场都在两档预留内（英文长句不截断、全在显卡不标警示）、同一份「装不下」形状去掉 `offloadRelief` 标记后必须一条不出、点掉一条建议后下一条补位而卡片不长高，另有 6 条「撤掉预留 / 撤掉标记必须转红」的自证腿。演示现场由 `dev/demo-mock.ts` 的 `HW_SCENE_DATA` 提供（URL `/?hw=all-vram|split|all-ram|relief|relief-off|silent`，形状用 `satisfies VramEstimateResult` 钉住、设备名取真机 `--list-devices` 原文）。**过程如实记录**：这一段先后两个子代理完成了实现与真浏览器取证，但它们的产物都没进本仓库（一个声称的 commit 在 reflog 与 dangling 对象里都查不到、转储文件 0 字节），最终由主进程与第三个代理复核后落地——**其中一处假红是主进程自己造的**：先写的判据按六个档位初始化却只量四个现场，未量的两个 0 进了比较集合，于是把「卡片跳高」判成成立，而实测四个现场本都一样；该重复判据已删除，只留 `offload-advice.spec.ts` 一份。

出了什么事（以下为登记当时 2026-10-05 的状态，保留作历史陈述）：llama-server 早就能把模型里「暂时用不到的那块知识」留在系统内存、只让显卡算当下要用的部分，因此 24 GB 显存也能跑远超显存容量的模型（MoE 类最明显），代价是内存到显卡的搬运决定出字速度。**当时界面碰不到这些开关**：`--device` / `--override-tensor` / `--tensor-split` / `--cpu-moe` 在 `packages/shared/src/params/definitions.ts` 里**没有**（四个都在 b11243 与 b11408 的 help 里，`--cpu-moe` 带 `LLAMA_ARG_CPU_MOE` 环境通道）。

**上一条登记时写的是「五个收录数为 0」，那是错的**（2026-10-06 更正）：`--n-cpu-moe` 早就在表里，登记形态是短别名 `-ncmoe`（`definitions.ts:67`），同族的 `-ncffn` / `--n-cpu-ffn` 也在 `:68`——所以真实缺口是 4 个而不是 5 个。错的成因值得记下来：**这张表按短别名存 flag**，拿长名 `--n-cpu-moe` 去 grep `definitions.ts` 必然报「没有」，本轮我按长名搜就复现了这次假阴性。判收录与否要按表里实际登记的 token 搜，或长名短名两种形态各搜一遍再取并集。于是用户只能去「扩展参数」手打字符串——命令预览不体现它、界面无法核对（这几项 `/props` 不回读）、切预设或换模型时容易被无声覆盖。

1. **把 4 个开关收进参数表**：改 `packages/shared/src/params/definitions.ts`（并按 help 原文登记 `engine-baseline.ts` 的引擎默认值），再跑 `node scripts/generate-params-doc.cjs` 一次产出中英对照表。只改这一处：命令预览、控件、持久化、i18n 都从这份表派生，别处再写一份就是第二套实现（`verify-params-sync` 的「发射实现唯一性」门禁正是为这类事故立的）。验证：`pnpm lint` 会逼齐中英标签与参数计数声明；在 mock 参数页拨动这四项，命令预览应实时出现对应 flag。
2. **界面上说清权重落在哪、为什么慢**：拿 `--list-devices` 的真实输出（主进程已在解析它）在服务页加一行大白话说明「主体在显卡、闲置部分在内存，搬运会拖慢出字」。文案走 i18n 键，数据层不拼中文串。验证：mock 页看双语排版；数值口径必须真机 `pnpm dev` 对一次真实输出——**内存带宽会慢到多少 token/s 本轮没有量**，没量过的数字不得写进文档。
3. **显存装不下时给减负建议，而不是只报错**：复用「性能目标联动建议」那套机制（下发 `xxxKey` + 只含数值的 `args`，渲染端翻译），新增建议键并中英两份同建，建议内容引用第 1 项收进来的真实参数键。**依赖第 1 项**——开关不在表里，建议给出去也无法核对。验证：单测断言「模型大于显存 ⇒ 出建议 / 显存足够 ⇒ 不出」，再真机选一个装不下的模型目测文案与跳转。

**b11408 漂移实测（2026-10-06，本机 `llama-b11408-bin-win-vulkan-x64`，引擎自报 `0.5.0-dev (build 11408, commit 9f12cd4a4)`）**：`node scripts/verify-help-drift.cjs <b11408 help>` 对拍 b11243 固定基线，报 flag **416 → 417**——新增 **1 个** `--spec-draft-sampling`（`{greedy,probabilistic}`，默认 `greedy`，带 `LLAMA_ARG_SPEC_DRAFT_SAMPLING` 环境通道，无短名；语义按 help 原文是草稿怎么出 token：greedy 取 argmax，probabilistic 采样后交目标模型用拒绝采样验证）、移除 **0 个**、参数表在用的 **74 个 flag 缺失 0 个**。两份 help 的整篇 diff 恰好只有这 5 行新增、**0 行改写**，所以**无破坏性**；`(env: LLAMA_ARG_*)` 由 145 条变 146 条，差集正是这一条。上面那 4 个外溢开关在 b11408 的 help 里原文逐字未变——**落地它们不依赖重钉**。**重钉状态**：本轮已按 §5.5 流程重钉到 b11408（见上一节「当前实测」），同时把那条提示改成方向性——只有引擎比基线旧才出声。新 flag 已于后续轮次收录进表：登记键 `spec_draft_sampling`，`advanced` 组的 `speculative` 分区（与 `--spec-type` / `-ngld` / `-ctkd` 同族），控件 `dropdown`（两个取值 `greedy` / `probabilistic`），`engineDefault: greedy` 逐字取自 help 原文的 `(default: greedy)`，界面初值同为 `greedy` 因此不覆盖引擎缺省、无需 `note`；help 里这条没有短别名，故按长名登记。**有意不挂 `dependsOn`**：help 从没写「须 `--spec-type` 非 none 才生效」，这条至今仍是本节末尾记着的未实测项，而凭语义推断挂上 `dependsOn` 的代价是切换投机采样类型时清空用户已选的值——那是数据丢失而不是提示，与上面第 1 项 `--device` / `--fit` 的处置同理，生效条件改写进了 `PARAM_HELP`。参数总数 68 → 69（advanced 28 → 29），13 处计数声明（`AGENTS.md`、`README.md` / `README.en.md`，以及中英两树的 architecture / core-modules / frontend / testing / params-system）与基线表本轮一并改齐。§5.5「当前实测」第 1 条那句「参数表本轮不动、总数仍是 64」是重钉那一轮自己的陈述，按历史保留，不代表今天的参数表。**未实测**：b11408 下 `/props` 的字段形状（本轮没有真机起 server），以及 `--spec-draft-sampling` 是否要求 `--spec-type` 非 none 才生效（help 未写这条依赖）。

**明确不做（免得下一个人重新评估一遍）**：把 ktransformers 接进启动器。它的 AMD 文档确实写明「用 EPYC 9274F 与 Radeon 7900 XTX 开发测试」，但标注 Beta、安装走 Linux/WSL2 的 ROCm 驱动，且与本应用「找一个 `llama-server(.exe)` + 读 `/props` 对账」的单引擎假设完全不同。同期调研另记一条：`ik_llama.cpp` 的「同质量更小文件」思路正对着这条路，但作者声明只有 CPU（AVX2+）与 CUDA（Turing+）后端完整可用，ROCm/Vulkan 不在其支持范围，故本机拿不到它的新量化。
