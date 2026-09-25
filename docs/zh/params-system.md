# 参数系统

> 语言：中文 · [English](../en/params-system.md)
> 范围：参数系统：参数定义（definitions.ts）、双轨机制（临时会话/预设）、依赖联动与推测解码自动检测、参数控件组件。
> 索引：[README.md](../../README.md) · 相关：[core-modules.md](core-modules.md)（命令构建）· [frontend.md](frontend.md)（参数页）

### 5.1 参数定义 (shared/params/definitions.ts)

- **`PARAM_GROUPS`**：3 组 — `basic`（基础）/ `advanced`（高级）/ `server`（服务）。
- **`PARAMS`**：共 64 个参数，分布如下：
  - basic：22 个（15 核心 + 7 采样）
  - advanced：28 个（5 思考控制 + 9 推测解码（其中 **4 个** `dependsOn.values` 依赖外部草稿类型 draft-simple/eagle3/dflash/dspark，另 2 个 `spec_draft_n_max`/`spec_draft_n_min` 用 `notValues: ['', 'none']` 即任何非空类型都生效）+ 6 多模态 + 6 KV 扩展 + 2 模板）
  - server：14 个（2 服务标识与鉴权 + 4 端点 + 4 CORS + 4 运行行为）
- 每个参数定义包含：`key, group, type, flag, default, subcategory, dependsOn, ggufField, invert_flag` 等字段。
- **两套「默认值」必须分开**（`params/engine-baseline.ts`，2026-09-25 拆）：`ParamDef.default` 是**界面初值**（里面装着启动器的基线推荐，如 `-ctk q8_0`、`--load-mode none`、`--fit off`）；发射判定的基准是另一个概念 **`engineDefault` = `llama-server` 没收到该 flag 时的行为**，逐条取自 help 基线。二者混用的后果是推荐值刚好等于 `default` 就永远不进命令行——引擎按自己的缺省跑，界面却显示着推荐档位。表内另有 `sentinel`（显式声明「此值 = 不指定，永不发射」，如 `chat_template` 的 `none`）与 `note`（`default ≠ engineDefault` 时必填，说明为什么覆盖引擎缺省）。**键集与 `PARAMS` 双向相等、`engineDefault` 与 help 对拍均由 `verify-params-sync.cjs` 硬拦。**
- **8 种控件类型**：`text` / `int_slider` / `int_entry` / `float_slider` / `dropdown` / `checkbox` / `file` / `dir`。
- **ggufField 映射**：参数可声明 `ggufField` 映射到 `GgufModelInfo` 的字段，参数行内联显示模型内置值；`buildSuggestions` 从元数据推导建议参数，点击可一键应用。映射按实际用途分类（2026-09 梳理）：仅**确定性事实映射**（`nextn_predict_layers → spec_type` 采样推荐等）与**启发式规则**（量化权重 → KV q8_0 等）进入建议；**纯参考信息**（`context_length` 训练上限、`rope.freq_base` 等）只在行内/信息卡展示，不产生建议（`-c` 默认 0 = 从模型加载，逐项建议属混淆源）；`cache_type_k/v`/`jinja`/`alias` 已移除语义错挂的 ggufField。
- **显存占用估算与性能目标**：core `devices.ts`（`--list-devices` 显存探测）+ `vram-estimate.ts`（KV 内存模型与显存/内存双侧占用 `estimateOccupancy`、无 OOM 最大上下文求解 `solveMaxContext`）+ `target-recommend.ts`（四档性能目标联动建议），经 `system:estimateVram` 暴露；参数页状态条「显存占用(估算)」stat 与目标选择器为唯一 UI 入口（详见前端 §7.3 / core-modules §4 模块表）。

### 5.2 参数双轨机制（临时会话 / 预设）

参数**没有独立启用/禁用状态**——命令行发射规则是「**值 ≠ 引擎缺省（`engineDefault`）才发射**，且不属于该参数的 `sentinel` 哨兵值」（checkbox 勾选发 `flag`、取消发 `invert_flag`，无 `invert_flag` 且 default false 的开关取消时不发射；空串跳过；依赖不满足跳过——详见 [core-modules.md](core-modules.md) §4.3）；旧版 `_enabled` JSON 启用机制已随双轨逻辑移除（`buildCommand` 读到 legacy `_enabled` 直接忽略）。

- **回读校验（2026-09-26 起）**：「值等于引擎缺省就不发射」有两个界面看不见的前提——引擎默认值可能与我们登记的基线不符（跨版本漂移），以及用户环境里可能有 `LLAMA_ARG_*` 改写缺省值。因此服务就绪后 core 会 `GET /props` 把引擎**实际生效值**读回来逐项对账，并**每 60s 复检**（`POST /props` 能运行期改属性，只查一次会陈旧；结果变化才补发事件）；映射与比对规则在 `shared/params/props-mapping.ts`，详见 [core-modules.md](core-modules.md) §4.11：真机实测覆盖 **14 项映射 / 13 项校验 / 0 假报**，其余约 50 项引擎不回读，故命令预览卡**只在真的不一致时出声**。同一链路还捎带比对 `build_info` 与常量 `ENGINE_BASELINE_BUILD`（基线所钉引擎构建），不一致即提示"参数基线可能已过期"。
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
3. **审计通过后替换基线**：`llama-server-help-new.txt` 覆盖 `llama-server-help-out.txt`。
4. **更新版本标注**：`scripts/generate-params-doc.cjs` 中硬编码的来源版本串（如 `b10734`）改为新版本号（文档头"来源"行）。
5. **更新 `packages/shared/src/params/definitions.ts`**：按审计结果新增/移除参数、同步下拉 `options`（allowed values）、调整默认值（默认值变更需结合实测结论决策，例如 b10429 将 `--load-mode` 默认改为 `auto` 时，应用按 `docs/archive/experiments/plan-kv-split-cli-test.md` 实测结论保留 `none`）。
6. **重建 shared**：`pnpm --filter @llama-launcher/shared build`（core 测试依赖 `dist`，不重建会测试不一致）。
7. **重新生成参数文档**：`node scripts/generate-params-doc.cjs`。
8. **校验一致**：`pnpm lint` 内含 `verify-params-sync.cjs`（三类校验，**任一有出入即 fail**）：① 参数定义 ↔ 对照表 ↔ help 三方对拍；② 文档里的参数计数声明（总数与分组数）与实测一致；③ `PARAM_LABELS`/`PARAM_HELP` 键集与 `PARAMS` 双向完全相等且 zh/en 非空（表里有字典无 → 界面渲染裸 key；字典有表里无 → 死条目）。单独跑该脚本可看逐项输出。
9. **IPC 通道如有变更**：同步 `packages/shared/src/types/ipc.ts` 与 preload 生成，跑 `pnpm lint`（含 `verify-ipc-sync.cjs`）。
10. **回归**：`pnpm lint` + `pnpm test`。
11. **记录**：`docs/CHANGELOG.md` [Unreleased] 补充条目。

**实测参考（2026-08-15，b10429→b10502）**：flag 集合 415 个完全一致（应用 55 个 flag 全部存在于新 help），唯一语义变化为 `--load-mode` 默认 `mmap`→`auto`（b10502 新增 auto 模式）→ 应用下拉补入 `auto` 选项，默认保持实测推荐的 `none`。此流程即本次审计的完整回放。

**实测参考（2026-09-01，b10502→b10734）**：flag 级漂移审计**移除 0、应用 flag 缺失 0**（全部顶格安全）；`--help` 落盘改用 Node spawn（修 PowerShell UTF-16 重定向坑，见步骤 1）；新增 9 参数入表（参数表 49 → **58**，含 `--lazy-mode`、`-ncffn`、`--kv-unified-per-slot`、`-mmdev`、`--video-fps` 等）。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]「参数基线升级至 llama.cpp b10734」。

**实测参考（2026-09-04，b10734 基线）**：`verify-params-sync` 代码 flag 67 / 对照表一致；`verify-help-drift` 基线 help 428 flag 全一致（无新增无移除）。

**实测参考（2026-09-19，b11053 基线，version 0.4.1-dev / commit 1af554f8f）**：flag 级漂移 = **新增 2**（`--log-jsonl` / `--no-log-jsonl`）、**移除 7**（`--mlock`、`--mmap`/`--no-mmap`、`-dio`/`--direct-io`/`-ndio`/`--no-direct-io`——都是 b10734 里已标 `DEPRECATED in favor of --load-mode` 的独立别名，应用早已迁移到 `--load-mode` 下拉，**零影响**）；应用 69 个 flag **缺失 0**。默认值变化仅 1 条真实语义变化：`--reasoning-preserve` 由 `template default` → `enabled`（该 flag 未入参数表，无跟随动作）。枚举白名单逐项核对**无漂移**：`--load-mode` 取值仍含 `dio`、`--spec-type` 11 值全同、`--chat-template` 内置模板列表与 b10734 **逐字节相同**（我们 24 项为其子集）。`--log-jsonl` **决定不收录**：它把 stdout 改成每行一个 JSON 对象，直接破坏 `launcher.ts` 的 listening 检测（按行匹配 `listening` + `http|server`）与控制台逐行着色，与 `--log-file` 同类。另修 `verify-help-drift` 解析器一处误报：说明续行 `… default: follows --device)` 不以 `(` 开头、而剥离字符集不含括号，于是把 `--device)` 当成新 flag（本次首跑即误报「新增 --device)」）；修正后 flag 数两侧同步下降——**b10734 基线 428 → 421，当前 b11053 基线实测 416**（自比对输出 `基线 flags: 416 | 新 flags: 416`；引用该数字时务必注明「哪个基线 + 哪个解析器版本」）。

**当前实测（2026-09-26，b11178 基线，version 0.5.0-dev / commit f9af9be21）**：flag 级漂移 **新增 0、移除 0**（416 ↔ 416，应用 69 个 flag 缺失 0）。换基线后 `verify-params-sync` 仍报「help 可对拍的 49 项 `engineDefault` 全等」，即**这两个版本之间没有任何一个应用参数的引擎默认值发生变化**，`definitions.ts` 与 `engine-baseline.ts` 的取值本轮零改动。三条真实变化需要记录：

1. **`--host` 改为接受逗号分隔多地址**（说明同时补入「多个 TCP 地址时 `::` 只绑 IPv6」「地址重叠属未定义行为」），默认仍是 `127.0.0.1`。`verify-help-drift` 把这条报成「默认值变化」，实为 `(default:` 被折行到下一行造成的 diff 噪声——人工比对两侧原文后判定不改判（该脚本按行比对，遇到折行默认值就会误报，**看到默认值变化先查是否折行**）。启动器侧的连带缺陷已修：整串当单地址用会拼出 `http://0.0.0.0,::1:8080/` 这种打不开的 URL，端口探测也会拿无法绑定的串去探从而把占用误报成空闲；现由 shared 的 `hostList` / `tcpHosts` / `displayHost` 统一解析（见 [data-persistence.md](data-persistence.md) 的 `ServerInfo.url` 与 [desktop-main.md](desktop-main.md) 的 `system:checkPort`）。
2. **`(env: LLAMA_ARG_*)` 通道由 139 条增至 145 条**，新增的 6 条恰好是采样族（`LLAMA_ARG_TEMPERATURE` / `TOP_P` / `MIN_P` / `REPEAT_PENALTY` / `PRESENCE_PENALTY` / `FREQUENCY_PENALTY`）。60 个应用参数里 **57 个**带该通道。这构成发射规则的一个新前提缺口：「值等于引擎缺省 ⇒ 不发射」成立的假设是**没有别的东西改写缺省值**，而这些变量正是改写缺省值的东西。实测（b11178，畸形值 + 合法命令行参数并用）证明 env 在启动期即被处理、**即便命令行给了合法值也会因 env 解析失败而终止进程**。处置见 [design-decisions.md](design-decisions.md) 第 24 条与 `ServerInfo.envOverrides`。
3. **`--completion-bash` 不能当默认值来源**：实测吐 298 个长 flag 挤成一行，既无类型也无默认值；`--list-devices` 只给设备，`--json-schema` / `-jf` 是约束生成用的，不是配置导出。
