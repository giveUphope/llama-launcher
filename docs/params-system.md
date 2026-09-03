# 参数系统

> 范围：参数系统：参数定义（definitions.ts）、双轨机制（临时会话/预设）、依赖联动与推测解码自动检测、参数控件组件。
> 索引：[README.md](../README.md) · 相关：[core-modules.md](core-modules.md)（命令构建）· [frontend.md](frontend.md)（参数页）

### 5.1 参数定义 (shared/params/definitions.ts)

- **`PARAM_GROUPS`**：3 组 — `basic`（基础）/ `advanced`（高级）/ `server`（服务）。
- **`PARAMS`**：共 59 个参数，分布如下：
  - basic：22 个（15 核心 + 7 采样）
  - advanced：27 个（含 5 个思考控制 + 6 个推测解码 + 多模态/视频/KV 扩展）
  - server：10 个
- 每个参数定义包含：`key, group, type, flag, default, subcategory, dependsOn, ggufField, invert_flag` 等字段。
- **8 种控件类型**：`text` / `int_slider` / `int_entry` / `float_slider` / `dropdown` / `checkbox` / `file` / `dir`。
- **ggufField 映射**：参数可声明 `ggufField` 映射到 `GgufModelInfo` 的字段，参数行内联显示模型内置值；`buildSuggestions` 从元数据推导建议参数，点击可一键应用。映射按实际用途分类（2026-09 梳理）：仅**确定性事实映射**（`nextn_predict_layers → spec_type` 采样推荐等）与**启发式规则**（量化权重 → KV q8_0 等）进入建议；**纯参考信息**（`context_length` 训练上限、`rope.freq_base` 等）只在行内/信息卡展示，不产生建议（`-c` 默认 0 = 从模型加载，逐项建议属混淆源）；`cache_type_k/v`/`jinja`/`alias` 已移除语义错挂的 ggufField。
- **显存占用估算与性能目标**：core `devices.ts`（`--list-devices` 显存探测）+ `vram-estimate.ts`（KV 内存模型与显存/内存双侧占用 `estimateOccupancy`、无 OOM 最大上下文求解 `solveMaxContext`）+ `target-recommend.ts`（四档性能目标联动建议），经 `system:estimateVram` 暴露；参数页状态条「显存占用(估算)」stat 与目标选择器为唯一 UI 入口（详见前端 §7.3 / core-modules §4 模块表）。

### 5.2 参数双轨机制（临时会话 / 预设）

参数**没有独立启用/禁用状态**——命令行发射规则是「值 ≠ 默认值才发射」（checkbox 恒发射、空串跳过、依赖不满足跳过，详见 [core-modules.md](core-modules.md) §4.3）；旧版 `_enabled` JSON 启用机制已随双轨逻辑移除（`buildCommand` 读到 legacy `_enabled` 直接忽略）。

- **临时轨道（会话）**：所有参数编辑自动持久化到 `~/.llama_launcher/settings.json` 的 `session_values` + `session_baseline`（`autoSave` watch 800ms 节流，**只写 settings、永不写预设文件**）；应用启动时经 `restoreSession` 恢复上次会话（参数值 + 基线一并还原）。
- **预设轨道**：`<models_dir>/presets/*.json` 仅在用户显式「保存预设」时写入；应用预设（`applyPreset`）以「预设名 + 参数快照」建立新会话基线（`markBaseline`）。
- **基线**：`SessionBaseline { preset_name, values }`——`hasChanges`（分组"已修改"蓝点 / 侧栏橙点）有基线时相对基线快照逐键对比，无基线时对比出厂默认。基线不再以徽章展示（2026-09 移除，与「已调整」统计重复）；「恢复基线」（`restoreBaseline`，resetAll 后回写基线快照）与「清除会话」（`clearSession`，带确认；保留模型选择）入口保留在参数页状态条。
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

- **通用依赖联动清理** `syncDependencies()`：遍历所有声明 `dependsOn` 的参数，依赖不满足时重置为默认值并禁用（判定与 `ParamRow.dependencyMet` 一致：依赖参数须"生效" + 值须满足 values/notValues）——**"生效"语义与命令构建器 `isDependencyMet` 统一**：checkbox 依赖源按布尔判定（勾选即生效，默认值为 true 的 `cache_prompt` 也因此正确判定，不因"值=默认"误判不满足），其余类型按"值 ≠ 默认值"判定（默认值 = 未启用）；**例外**：`file` / `dir` 类型保留用户已选路径不重置（避免误清大段路径输入）。仅在被修改的 key 是依赖源（`DEP_SOURCE_KEYS`）时触发，避免"先填下游值、后选依赖源"被误清。
- **依赖分组**：
  - `spec_draft_model` / `spec_draft_ngl` / `spec_cache_type_k/v` → 依赖 `spec_type` 为外部草稿类型（`draft-simple`/`draft-eagle3`/`draft-dflash`/`draft-dspark`）
  - `spec_draft_n_max` / `n_min` → 依赖 `spec_type` 非空且非 `none`（MTP/ngram 也适用）
  - `reasoning_effort` / `reasoning_budget` / `reasoning_format` / `reasoning_budget_message` → 依赖 `reasoning` 非 `off`
  - `cache_reuse` → 依赖 `cache_prompt` 为 `true`
- **推测解码草稿数联动** `set('spec_type', ...)`：选择投机采样类型时自动应用该类型的推荐最大草稿数（`spec_draft_n_max`，映射 `SPEC_DRAFT_N_MAX_BY_TYPE`：draft-simple/eagle3/dspark=8、draft-dflash=15、draft-mtp=5、ngram-*=5）并启用——仅选类型不配草稿数无法达到该方式最佳效率；同时保持 `n_min ≤ n_max`（切换类型或手动调小 `n_max` 时钳制 `n_min`）。关闭（none/空）时经 `syncDependencies` 清空草稿数。
- **DFlash/草稿模型自动检测** `detectDraftModel()`：模型切换时检测同目录 dflash/draft 文件——dflash 文件自动配置 `spec_type=draft-dflash` + `flash_attn=on` + `spec_draft_n_max=15`（Muse-Glimmer DFlash 每 block 预测 16 位置：1 条件位 + 15 草稿 token）；普通 draft 文件设 `draft-simple`；用户已选类型时尊重不覆盖。
- **切回外部草稿类型自动重新检测**：`set('spec_type', ...)` 检测到新值为外部草稿类型且 `spec_draft_model` 为空时（被切到 draft-mtp/ngram 时联动清空），自动重新调用 `detectDraftModel` 填入路径；路径已有值时不重复检测。

### 5.5 二进制升级后的参数固定流程（re-pin）

**背景**：仓库固定 `docs/params/llama-server-help-out.txt`（`llama-server --help` 原始输出）作为参数文档基线与同步校验的对照源；`scripts/generate-params-doc.cjs` 在 `docs/params/LLAMA_SERVER_PARAMS.md` 头部标注来源二进制版本。应用不随捆绑二进制发布（引擎目录由用户自选），固定 help 只是文档基线，但升级引擎后必须重走本流程，否则参数表/文档与真实后端脱节。

**升级 llama.cpp 二进制后的固定步骤**：

1. **替换基线 help**：新二进制导出帮助 → 覆盖 `docs/params/llama-server-help-out.txt`
   ```
   node -e "const{execFileSync}=require('child_process');const fs=require('fs');const out=execFileSync('.\\llama-bXXX-bin-win-vulkan-x64\\llama-server.exe',['--help'],{encoding:'utf8',maxBuffer:1024*1024*64});fs.writeFileSync('docs/params/llama-server-help-out.txt',out)"
   ```
   ⚠ 勿用 PowerShell `>` 重定向：PS5.1/部分环境会写 **UTF-16**（含 BOM/空字节），
   文档生成器按 UTF-8 读取会整段漏解析（b10734 升级踩坑，2026-09-01 改为 Node spawn 落盘）。
2. **更新版本标注**：`scripts/generate-params-doc.cjs` 中硬编码的来源版本串（如 `b10734`）改为新版本号（文档头"来源"行）。
3. **漂移审计**（flag 增删 / 默认值变化 / 应用参数缺失）：
   ```
   node scripts/verify-help-drift.cjs docs/params/llama-server-help-out.txt
   ```
   flag 级漂移时退出码非 0（CI 可拦截）；默认值变化只提示不失败，需人工决策是否跟随。
4. **更新 `packages/shared/src/params/definitions.ts`**：按审计结果新增/移除参数、同步下拉 `options`（allowed values）、调整默认值（默认值变更需结合实测结论决策，例如 b10429 将 `--load-mode` 默认改为 `auto` 时，应用按 `docs/archive/experiments/plan-kv-split-cli-test.md` 实测结论保留 `none`）。
5. **重建 shared**：`pnpm --filter @llama-launcher/shared build`（core 测试依赖 `dist`，不重建会测试不一致）。
6. **重新生成参数文档**：`node scripts/generate-params-doc.cjs`。
7. **校验一致**：`node scripts/verify-params-sync.cjs`（应输出 `✅ 完全一致`）。
8. **IPC 通道如有变更**：同步 `packages/shared/src/types/ipc.ts` 与 preload 生成，跑 `pnpm lint`（含 `verify-ipc-sync.cjs`）。
9. **回归**：`pnpm lint` + `pnpm test`。
10. **记录**：`docs/CHANGELOG.md` [Unreleased] 补充条目。

**实测参考（2026-08-15，b10429→b10502）**：flag 集合 415 个完全一致（应用 55 个 flag 全部存在于新 help），唯一语义变化为 `--load-mode` 默认 `mmap`→`auto`（b10502 新增 auto 模式）→ 应用下拉补入 `auto` 选项，默认保持实测推荐的 `none`。此流程即本次审计的完整回放。

**实测参考（2026-09-01，b10502→b10734）**：flag 级漂移审计**移除 0、应用 flag 缺失 0**（全部顶格安全）；`--help` 落盘改用 Node spawn（修 PowerShell UTF-16 重定向坑，见步骤 1）；新增 9 参数入表（参数表 49 → **58**，含 `--lazy-mode`、`-ncffn`、`--kv-unified-per-slot`、`-mmdev`、`--video-fps` 等）。详见 [CHANGELOG.md](CHANGELOG.md) [Unreleased]「参数基线升级至 llama.cpp b10734」。
