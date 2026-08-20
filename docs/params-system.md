# 参数系统

> 范围：参数系统：参数定义（definitions.ts）、启用机制、依赖联动与推测解码自动检测、参数控件组件。
> 索引：[README.md](README.md) · 相关：[core-modules.md](core-modules.md)（命令构建）· [frontend.md](frontend.md)（参数页）

### 5.1 参数定义 (shared/params/definitions.ts)

- **`PARAM_GROUPS`**：3 组 — `basic`（基础）/ `advanced`（高级）/ `server`（服务）。
- **`PARAMS`**：共 49 个参数，分布如下：
  - basic：20 个（13 核心 + 7 采样）
  - advanced：19 个（含 5 个思考控制参数 + 6 个推测解码参数）
  - server：10 个
- 每个参数定义包含：`key, group, type, flag, default, subcategory, dependsOn, ggufField, invert_flag` 等字段。
- **8 种控件类型**：`text` / `int_slider` / `int_entry` / `float_slider` / `dropdown` / `checkbox` / `file` / `dir`。
- **ggufField 映射**：参数可声明 `ggufField` 映射到 `GgufModelInfo` 的字段，参数行内联显示模型内置值；`buildSuggestions` 从元数据推导建议参数，点击可一键应用。

### 5.2 参数启用机制

- `_enabled` key 编码为 **JSON 字符串**存入 `PresetValues`，记录每个参数是否被用户显式启用。
- 用户修改参数值时，若与默认值不同则**自动勾选启用**。
- **基线启用参数** `BASELINE_ENABLED_KEYS`（`cache_type_k` / `cache_type_v` / `load_mode` / `fit` / `kv_unified`）：初始化与 `resetAll` 时即启用并下发到命令行（实测推荐内存配置：KV 量化 q8_0、`--load-mode none`、`--fit off`、`--no-kv-unified`，依据 `docs/plan-kv-split-cli-test.md`），**不计入分组"已修改"蓝点**；用户可手动取消勾选，预设自带的 `_enabled` 会覆盖基线状态。
- `MODEL_KEY`（`model`）和 `mmproj` 为特殊 key，不参与自动勾选，始终传递。

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

- **通用依赖联动清理** `syncDependencies()`：遍历所有声明 `dependsOn` 的参数，依赖不满足时重置为默认值并禁用（判定与 `ParamRow.dependencyMet` 一致：依赖参数须启用 + 值须满足 values/notValues）。仅在被修改的 key 是依赖源（`DEP_SOURCE_KEYS`）时触发，避免"先填下游值、后选依赖源"被误清。
- **依赖分组**：
  - `spec_draft_model` / `spec_draft_ngl` / `spec_cache_type_k/v` → 依赖 `spec_type` 为外部草稿类型（`draft-simple`/`draft-eagle3`/`draft-dflash`/`draft-dspark`）
  - `spec_draft_n_max` / `n_min` → 依赖 `spec_type` 非空且非 `none`（MTP/ngram 也适用）
  - `reasoning_budget` / `format` / `budget_message` → 依赖 `reasoning` 非 `off`
  - `cache_reuse` → 依赖 `cache_prompt` 为 `true`
- **推测解码草稿数联动** `set('spec_type', ...)`：选择投机采样类型时自动应用该类型的推荐最大草稿数（`spec_draft_n_max`，映射 `SPEC_DRAFT_N_MAX_BY_TYPE`：draft-simple/eagle3/dspark=8、draft-dflash=15、draft-mtp=5、ngram-*=5）并启用——仅选类型不配草稿数无法达到该方式最佳效率；同时保持 `n_min ≤ n_max`（切换类型或手动调小 `n_max` 时钳制 `n_min`）。关闭（none/空）时经 `syncDependencies` 清空草稿数。
- **DFlash/草稿模型自动检测** `detectDraftModel()`：模型切换时检测同目录 dflash/draft 文件——dflash 文件自动配置 `spec_type=draft-dflash` + `flash_attn=on` + `spec_draft_n_max=15`（Muse-Glimmer DFlash 每 block 预测 16 位置：1 条件位 + 15 草稿 token）；普通 draft 文件设 `draft-simple`；用户已选类型时尊重不覆盖。
- **切回外部草稿类型自动重新检测**：`set('spec_type', ...)` 检测到新值为外部草稿类型且 `spec_draft_model` 为空时（被切到 draft-mtp/ngram 时联动清空），自动重新调用 `detectDraftModel` 填入路径；路径已有值时不重复检测。

### 5.5 二进制升级后的参数固定流程（re-pin）

**背景**：仓库固定 `docs/params/llama-server-help-out.txt`（`llama-server --help` 原始输出）作为参数文档基线与同步校验的对照源；`scripts/generate-params-doc.cjs` 在 `docs/params/LLAMA_SERVER_PARAMS.md` 头部标注来源二进制版本。应用不随捆绑二进制发布（引擎目录由用户自选），固定 help 只是文档基线，但升级引擎后必须重走本流程，否则参数表/文档与真实后端脱节。

**升级 llama.cpp 二进制后的固定步骤**：

1. **替换基线 help**：新二进制导出帮助 → 覆盖 `docs/params/llama-server-help-out.txt`
   ```
   <新二进制目录>/llama-server.exe --help > docs/params/llama-server-help-out.txt
   ```
2. **更新版本标注**：`scripts/generate-params-doc.cjs` 中硬编码的来源版本串（如 `b10502`）改为新版本号（文档头"来源"行）。
3. **漂移审计**（flag 增删 / 默认值变化 / 应用参数缺失）：
   ```
   node scripts/verify-help-drift.cjs docs/params/llama-server-help-out.txt
   ```
   flag 级漂移时退出码非 0（CI 可拦截）；默认值变化只提示不失败，需人工决策是否跟随。
4. **更新 `packages/shared/src/params/definitions.ts`**：按审计结果新增/移除参数、同步下拉 `options`（allowed values）、调整默认值（默认值变更需结合实测结论决策，例如 b10429 将 `--load-mode` 默认改为 `auto` 时，应用按 `docs/plan-kv-split-cli-test.md` 实测结论保留 `none`）。
5. **重建 shared**：`pnpm --filter @llama-launcher/shared build`（core 测试依赖 `dist`，不重建会测试不一致）。
6. **重新生成参数文档**：`node scripts/generate-params-doc.cjs`。
7. **校验一致**：`node scripts/verify-params-sync.cjs`（应输出 `✅ 完全一致`）。
8. **IPC 通道如有变更**：同步 `packages/shared/src/types/ipc.ts` 与 preload 生成，跑 `pnpm lint`（含 `verify-ipc-sync.cjs`）。
9. **回归**：`pnpm lint` + `pnpm test`。
10. **记录**：`docs/CHANGELOG.md` [Unreleased] 补充条目。

**实测参考（2026-08-15，b10429→b10502）**：flag 集合 415 个完全一致（应用 55 个 flag 全部存在于新 help），唯一语义变化为 `--load-mode` 默认 `mmap`→`auto`（b10502 新增 auto 模式）→ 应用下拉补入 `auto` 选项，默认保持实测推荐的 `none`。此流程即本次审计的完整回放。
