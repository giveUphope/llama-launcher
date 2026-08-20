# 显存/内存分层方案 CLI 验证计划（KV 分层 + 长上下文 + 速度不降速）

> 状态：**验证完成**（2026-08-15）。本文档是"分层架构改造"的前置验证方案，实测结论见 §5c，改造建议见 §8。
> 原则：全程 CLI（llama-cli / llama-server）实测，以实测数据为准；任何一步不允许再导致系统级 OOM。

## 1. 目标与验收标准

最终目的：**无法完整放入显存（权重+KV）的模型，在分层架构下实现长上下文，且生成速度不掉档。**

| 验收项 | 标准 |
|---|---|
| 长上下文可用 | 目标上下文（如 128K）能加载、能完成 ≥256 token 生成、输出文本连贯（无乱码/NaN 崩溃） |
| 内存放下 | 显存占用 ≤ 24GB 扣除系统余量；系统内存峰值 ≤ 32GB 扣除系统余量（运行期进程 RSS + 驱动开销） |
| 速度不降速 | 分层配置的解码 tok/s 与"全显存基准"对比，**区分两层代价**：①上下文变长导致 attention 规模增长的固有代价；②KV 溢出/转移机制引入的额外代价。给出两个数字，判定分层机制本身是否有明显额外代价 |
| 可落地 | CLI 结果与 llama-server 运行时（即应用实际启动的进程）行为一致（补一次 server 冒烟对拍） |

## 2. 实际环境基线（硬约束，方案必须满足）

| 项 | 值 | 影响 |
|---|---|---|
| GPU | AMD RX 7900 XTX，Vulkan0 = 24560 MiB（Vulkan1 为核显，勿选） | 显存预算按 ~24GB 计，需留 ~1-2GB 给驱动/合成器 |
| 系统内存 | 31.16 GB 总，测试前可用需 ≥ 20GB | 权重加载瞬态（--no-mmap 直读缓冲）≈ 权重大小（17GB） |
| CPU | 16 逻辑核 | `-t 16` |
| 后端 | Vulkan（b10429，Clang 20） | 首次运行需编译着色器（30-60s+），后续快；无 nvidia-smi，显存分布以**加载日志 buffer size 行**为准 |
| 模型 | `Qwen3.8-27B-UD-Q4_K_XL.gguf` 17GB（密集，主目标）；`Qwen3.6-35B-A3B-UD-IQ1_M.gguf` 11GB（MoE，应能完整放下）；`Muse-Glimmer-30B-kquant-17gb.gguf` 16GB（备选） | 27B 权重 17GB → 显存剩余 ~5GB → 长上下文 KV 必然溢出 → 分层必测对象 |
| Shell | Git Bash on Windows | 长命令可能被挂到后台；命令里 `$` 会被 bash 吃掉（PowerShell 用单引号） |

## 3. 已踩坑教训 → 固化为安全协议（不允许再犯）

1. **mmap 默认开 → 系统级 OOM 宕机**：mmap 下 17GB 权重页常驻内存并计入提交量，32GB 内存被吃满直接冻结。
   → 所有测试 **必须 `--no-mmap`**（权重直读缓冲、上传显存后释放），显存侧用 `-ngl 999`。
2. **KV 必须量化**：f16 KV 在"权重 17GB + 长上下文"下无意义。基准与方案统一 **q8_0 KV**（保质量），q4_0 作为更激进选项。
3. **`--fit` 语义**：`--fit on`（默认）只按**设备（显存）内存**调整参数，**不保护系统内存**；且它只调"未显式设置"的参数。显式 `-c` 大值 + fit on 时 fit 可能不缩 ctx → 仍需靠 `-cram` 限额保护内存。
   → 显式长 ctx 测试用 `--fit off` + `-cram N`（内存有上限）；"不显式给 ctx"的对照用 fit on 观察 fit 自选 ctx。
4. **残留进程**：取消/崩溃后 llama-cli.exe 可能残留并占 20GB+。每次运行前后：`taskkill //IM llama-cli.exe //F`（只杀测试进程，不碰 llama-server）+ 检查可用内存。
5. **显存分配失败**：Vulkan 缓冲分配失败一般**报错退出**（不冻结系统）；冻结只源于内存耗尽。因此只要内存被 `-cram` 限额 + `--no-mmap` 兜住，显存侧可以放心测。
6. **速度测量口径**：解码速度取 llama-server `/completion` 响应中的 `timings.predicted_per_second`（生成阶段稳态，与应用 bench-client 同一口径）；固定 prompt、≥256 token、必要时重复取均值。
7. **llama-cli 在本环境不可用（实测两次均异常）**：生成后进入交互模式等待 stdin，harness 的 stdin 管道不关闭 → 进程永不退出、持续占内存（mmap 时 RSS 21GB / no-mmap 时 ~10.6GB），表现为"无限循环占用"；加 `</dev/null` 仍异常。
   → **弃用 llama-cli，全部改用 llama-server + curl**（无交互、无 stdin、日志干净，且本就是应用实际运行时）。
8. **取消/超时必然残留子进程**（实测 3 次僵尸，RSS 6-21GB，需 `Stop-Process -Force` 才能清掉）。任何测试必须是**自含生命周期脚本**：单脚本内 `start → /health 轮询 → /completion → Stop-Process -Force`，并加 `trap ... EXIT` 兜底；脚本结束前强制回收、确认无残留。
9. **"Loading model..." 进度条污染日志**：`\r` 重绘占数 MB 输出；加载 10.6GB 在系统抖动时需数分钟（属预期）。解析用 `grep -a`；加载阶段同步采样进程 RSS（每 5s），既验证 --no-mmap 加载后宿主缓冲是否释放，也监控峰值。

## 4. 待验证的关键机制与未知点

| 机制 | 参数 | 作用 | 待验证点 |
|---|---|---|---|
| KV 量化 | `-ctk/-ctv q8_0/q4_0` | KV 体积降 2-4 倍 | 量化后 KV/每 token 大小（由加载日志推导） |
| 显存 KV 预算 | `-kvo`（默认）/`-nkvo` | KV 整体在显存 / 整体在内存 | 27B 全显存时 KV 预算还剩多少 |
| KV 分层（核心） | `-cram N`（PR #16391）+ `-kvu` + `--cache-idle-slots` | KV 块级溢出到系统内存，热块留显存 | **单序列长上下文下是否真的溢出、何时转移、溢出后 tok/s 如何**（未知，实测为准） |
| 上下文有界 | `--context-shift` | 无限生成时 KV 不无限涨 | 长上下文 + 长生成时是否必要 |
| 权重分层 | `-ngl N` / `-ncmoe` | 部分层/专家放内存 | MoE 模型专家进内存后速度 |
| 自动适配 | `--fit`（默认 on）、`--fit-target` | 放不下时自动缩参数 | fit 自选 ctx 是多少（对照"放不下"证据） |
| 加载模式 | `--load-mode mmap/mlock`（本版已弃用 `--mmap/--mlock`） | 权重页管理 | 确认 no-mmap 路线即可，不做更多变体 |

## 5. 测试矩阵（按序执行；统一 llama-server + curl，自含生命周期脚本）

### C0 元数据探针 ✅ 已完成（GGUF 头解析，零内存）
- 方法：只读 GGUF 头部（自定义 node 脚本），不加载模型
- 结果：
  - **27B（qwen35）**：65 层 / KV 头 4 / head_dim 256 / 默认 ctx 262144 / 文件 16.69GiB → **KV q8_0 ≈ 130 KiB/每 token**
  - **MoE 35B-A3B（qwen35moe）**：41 层 / KV 头 2 / head_dim 256 / 默认 ctx 262144 / 文件 10.59GiB → **KV q8_0 ≈ 41 KiB/每 token**
- 预算推算：27B 全显存后 KV 预算 ≈ 24560 − 16900（权重）− ~1500（compute）≈ **5.5GB** → q8 KV 上限 ≈ **44K ctx**（32K 放得下；64K 溢出 ~3GB；128K 溢出 ~11.5GB；128K q4_0 溢出 ~4GB）
- 校准（进行中）：llama-server 加载 MoE 模型（10.6GB 瞬态），验证 --no-mmap 加载后宿主缓冲释放、真实 buffer 分布、RSS 采样

### C1 基准：全显存 + 32K 上下文（"放得下"速度参照）
- server：`-c 32768 -ngl 999 -ctk/-ctv q8_0 -fa on --no-mmap -cram 8192 --fit on`
- 预期：q8 KV 4.3GB ≤ 5.5GB 预算 → 全显存无溢出；记录解码 tok/s（completion timings）

### C2 对照"放不下"（安全失败态）
- server：`-c 262144 -ngl 999 -ctk/-ctv q8_0 -fa on --no-mmap --fit on`（不设 -cram）
- 预期：fit 压缩 ctx 或分配失败退出（不冻结）；记录 fit 自选 ctx 或失败日志 → "长上下文放不下"证据

### C3 方案：长上下文 + KV 分层（核心验证）
- server：`-c 131072 --fit off -ctk/-ctv q8_0 -fa on -cram 8192 --no-mmap -ngl 999`
- 预期：加载成功，KV 显存/内存分层；128K 生成 256 token 连贯；tok/s vs C1
- 变体：C3a q4_0 KV；C3b 65536；若 128K 不可行记录实际上限

### C4 速度隔离
- 27B 32K（全显存，C1）vs 27B 64K/128K（分层，C3）→ 拆"上下文固有代价"与"分层代价"
- 补充：MoE 全显存 128K（q8 KV 5.4GB ≤ 预算）作"全显存长上下文"参照系

### C5 MoE 完整放入
- 35B-A3B：`-c 131072 q8 KV 全显存` 验证完整放入 + 长上下文成立

### C6 与 C1/C3 同源（server 即应用运行时）
- 不再单独对拍；应用 bench-client 解析的 timings 与本方案同一字段

## 5b. 标准测试脚本模板（自含生命周期）

```bash
# 每步：清理 → 启动 → 轮询 /health → completion → 强制回收
powershell -NoProfile -Command 'Get-Process | Where-Object {$_.ProcessName -like "llama*"} | ForEach-Object { Stop-Process -Id $_.Id -Force }'
"$BIN" -m "$M" ... --host 127.0.0.1 --port 17801 > "$LOG" 2>&1 &
SRV=$!
trap 'powershell -NoProfile -Command "Stop-Process -Id $SRV -Force -ErrorAction SilentlyContinue"' EXIT
# 轮询 /health（≤300s），期间每 5s 采样 RSS 到 $RSS
# curl /completion {"prompt": "...", "n_predict": 256} → 解析 timings.predicted_per_second
# 结束：Stop-Process -Force + 复查无残留 + 报告 free RAM
```

## 6. 数据采集与判定方法

- 每个配置：llama-server 日志存 /tmp/tN.log，grep 关键行：`n_ctx`、`buffer size`、`KV buffer`、`compute buffer`；生成结果存 /tmp/cN.json，取 `timings.predicted_per_second`（解码 tok/s）与 `total_predicted`；输出文本保存用于连贯性检查
- 内存：运行前/后 PowerShell 查 `FreePhysicalMemory`；加载期每 5s 采样进程 RSS（验证 --no-mmap 宿主缓冲释放：加载完成后 RSS 应显著回落）
- 显存：以加载日志 buffer size 为准（Vulkan 无 nvidia-smi）
- 稳定性：C1/C3 的 tok/s 各跑 1 次（时间有限），若两次差异 >10% 再补跑取均值
- 每步前后清理：`Get-Process -Name llama* | Stop-Process -Force`（脚本内置 + trap 兜底）；可用内存 < 24GB 时先等待/告警

## 7. 风险与回退

| 风险 | 表现 | 对策 |
|---|---|---|
| 显存不足 | 分配失败报错退出 | 属预期行为，记录失败配置，换 q4_0 KV / 降 ctx |
| 内存峰值 | RSS 接近 32GB | `-cram` 限额 + `--no-mmap`；预检查可用内存；绝不再裸跑 mmap |
| 系统冻结 | 无响应 | 唯一允许的根因是内存耗尽；协议已防。若再发生立即停止并复盘协议漏洞 |
| -cram 对单序列不生效 | C3 仍显存分配失败 | 记录 → 尝试 `-nkvo`（KV 全内存）→ 评估"慢但可用"是否满足用户预期 |

## 5c. 验证结果（实测汇总，2026-08-15）

**关键发现：两个模型都是混合架构（~75% recurrent 层 + 少量 attention 层），KV 极小，长上下文内存增长极慢。**

### Qwen3.8-27B（qwen35，16.69GiB 权重，q8 KV，fa on，no-mmap，Vulkan RX 7900 XTX 24GB）

| ctx | KV buffer | 显存总需求 | 解码 tok/s | 备注 |
|---|---|---|---|---|
| 32K | 1088 MiB | ~22.0GB | **37.1** | 全显存，余 5GB |
| 128K | 4352 MiB | ~21.5GB | **36.9** | 全显存 |
| 262K（cram 8192） | 8704 MiB | ~25.7GB | **36.6** | 超出 1.1GB 由 AMD 驱动 GTT 换页到内存（RSS 5.2GB），**-cram 未参与** |
| 262K（cram 0） | 8704 MiB | ~25.7GB | **36.6** | 与 cram 8192 完全一致 → -cram 在此卡无效（驱动已接管） |
| 262K（fit on） | 8704 MiB | ~25.7GB | **25.7** | ⚠ fit 中止残留导致劣化，见下 |

- **32K→262K 速度零降速（37.1→36.6，-1.3%）**；262K 输出 256 token 连贯
- 加载后进程 RSS 仅 ~1GB（权重不在系统内存）；262K 时 RSS 5.2GB = GTT 换页部分
- `--fit on` + 显式 `-c 262144`：fit 拒绝修改用户参数并中止（"n_gpu_layers already set by user... abort"），**留下劣化状态（25.7 vs 36.6）**→ 显式 ctx 时应 `--fit off`

### Qwen3.6-35B-A3B（qwen35moe，10.59GiB 权重，q8 KV，fa on，no-mmap）

| ctx | KV buffer | 显存总需求 | 解码 tok/s | 备注 |
|---|---|---|---|---|
| 8K | 85 MiB | ~10.7GB | 165.7 | 全显存 |
| 262K | 2720 MiB | ~14.1GB | **163.9** | 完整放入，零降速，RSS 0.76GB |

- KV 单位成本：27B ≈ 34 KiB/token（q8），MoE ≈ 10.9 KiB/token（q8）——远小于纯 attention 模型理论值（27B 理论 ~141 KiB/token），因为大部分层是 recurrent 无 KV

### 用户原始 OOM 根因（结论）
f16 KV（2× q8 体积）+ 默认 mmap（权重页常驻系统内存）+ 262K 级长上下文叠加：显存需求 ~35GB → 驱动换页 10GB+ 进 32GB 系统内存 + mmap 权重常驻 → 系统冻结。**修复 = KV 量化（q8/q4）+ `--no-mmap`（--load-mode none）+ fa on**，无需 -cram 分层。

### 补充测试（覆盖度补测，2026-08-15，27B 模型）

| # | 配置 | ctx | KV | KV buffer | 显存总需求 | RSS | tok/s | 结论 |
|---|---|---|---|---|---|---|---|---|
| T1 | q4_0 KV | 262K | q4_0 | 4608 MiB | ~22.7GB **全显存** | - | **38.9** | q4_0 最优：262K 零换页且最快 |
| T2 | f16 KV（旧默认） | 128K | f16 | 8192 MiB | ~26GB（换页1.5） | 6.1GB | 39.9 | f16 128K 尚可；262K f16（16.4GB KV）才致命 |
| T3 | `-nkvo` | 262K | q8(CPU) | 8704 MiB CPU | ~17GB | 10.3GB | **13.7 + 乱码** | KV 全内存：慢 2.7x 且输出错误 → **不可用** |
| T4 | `-ngl 45` | 262K | q8 | CPU2720+GPU5984 | ~21GB | 8.9GB | **7.8** | 权重分层：慢 4.7x → 密集模型禁用 |
| T5 | `-ub 2048` | 128K | q8 | 4352 MiB | compute 1137 MiB | - | 19.9 | 大 ubatch：峰值内存 4.4x + 解码慢 46% → 保持 512 |

**速度横向对比（27B，decode）**：f16 39.9 ≈ q4 38.9 > q8 36.6~37.1（差异在噪声内 ±8%，KV 量化主要省内存不省速度）；**`-nkvo` 13.7（不可用）、`-ngl45` 7.8（不可用）**。

### 覆盖度矩阵（参数 ↔ 状态 ↔ 对向导的意义）

| 参数 | 状态 | 结论/备注 |
|---|---|---|
| `-c` ctx | ✅ 32K/128K/262K | 混合架构 262K 零降速；显存公式：KV = ctx × KV/token |
| `-ctk/-ctv` | ✅ f16 / q8_0 / q4_0 | q8 保质量省一半；q4 省 3/4 且 262K 全显存最快；推荐 q8 默认、q4 备用 |
| `-fa` | ✅ on（auto/off 未测） | 长上下文必备；auto 与 on 等价性待测 |
| `-ngl` | ✅ 999 / 45 | 密集模型部分分层 4.7x 慢 → 全量优先；MoE 用 -ncmoe 替代 |
| `--no-mmap`（load-mode none） | ✅ | 防权重页吃满内存（宕机根因）；mmap/mmap+mlock/dio 未测 |
| `-cram/-kvu` | ✅ 0/8192 | 本卡无效（驱动 GTT 先接管）；NVIDIA 卡场景待测 |
| `--fit` | ✅ on/off | on+显式-c 会中止留劣化（25.7 vs 36.6）→ 显式参数时 off |
| `-b/-ub` | ✅ 512/2048 | ubatch 决定摄入期峰值内存（4.4x）+ 解码速度（-46%）→ 保持默认 |
| `-nkvo` | ✅ | 混合模型上慢且乱码 → 不推荐 |
| `-np` slots | ⚠️ 仅默认 4 | KV 按槽位倍增（公式：KV_total = ctx × slots × KV/token）；未单独实测 |
| `-ncmoe/-cmoe` | ⬜ 未测 | MoE 专家进内存：仅取激活专家，代价小；建议后续补测 |
| draft/DFlash | ⬜ 未测 | draft 权重+KV 占显存（1.6GB 级）；需匹配 draft 文件；建议补测 |
| mmproj | ⬜ 未测 | 多模态投影 +885MB（--mmproj-offload on/off）；建议补测 |
| `--context-shift`/`--cache-reuse` | ⬜ 未测 | 超长生成 KV 有界化；非内存主旋钮 |
| KV 质量 / 长上下文召回 | ⬜ 未测 | 无 ppl 工具；建议后续对 q8/q4 各做一次 needle 测试 |
| 重复运行稳定性 | ⬜ 未测 | 每配置 1 次；差异 >10% 才补跑（当前均未见） |

**注**：所有结论基于 AMD RX 7900 XTX（驱动 GTT 透明换页）+ b10429 Vulkan + 两个混合架构模型。迁移到 NVIDIA 卡或纯 attention 模型时需复测（NVIDIA 不透明换页，`-cram` 才会真正参与）。

## 8. 与项目改造的衔接（验证结论 → 改动建议）

1. **KV 量化默认改为 q8_0**（`cache_type_k`/`cache_type_v` 默认值 f16 → q8_0）：27B@262K 从"35GB 需求（危险）"降为"25.7GB（轻松）"，收益最大。**q4_0 实测最优**（262K 全显存零换页、38.9 tok/s），可作"追求 262K 满上下文 + 零换页"的默认或备选。q8 保质量、q4 更省，速度差异在噪声内。
2. **--no-mmap 默认开 / 改用 --load-mode none**：防止权重页吃满系统内存（宕机直接原因）。注意本版本 `--mmap/--mlock` 已废弃，应迁移到 `--load-mode`（mmap/none/mmap+mlock/dio），参数表里旧的 mmap/mlock 项需更新。
3. **--fit 交互坑**：用户显式设置 ctx 时 fit 会中止且留劣化状态 → launcher 生成命令时：显式 ctx → `--fit off`；否则才 `--fit on`。
4. **-cram/-kvu/--cache-idle-slots 暂不加入 UI**：实测在本 AMD 卡上无效果（驱动 GTT 透明换页先于 llama.cpp 分层机制），且 32GB 内存下无风险。若未来支持 NVIDIA 卡（分配失败不换页），再暴露 `-cram` 作为兼容选项，并提示"NVIDIA 卡上 KV 溢出时启用"。
5. **长上下文默认放开**：混合架构模型 262K 全速零成本；launcher 的 ctx 上限（当前 262144）无需调整，但默认 KV 量化后用户可直接拉满。
6. **负面清单（实测不可用/不建议）**：`-nkvo`（KV 全内存：慢 2.7x + 混合模型输出乱码）、`-ngl N` 部分分层（密集模型慢 4.7x；MoE 应改用 `-ncmoe`）、大 `-ub`（峰值内存 4.4x + 解码 -46%，保持默认 512）。
7. 文档同步：新增参数默认值变化需更新 `docs/params/LLAMA_SERVER_PARAMS.md`（generate-params-doc.cjs）与 i18n；本文档验证结论归档后可从 docs 移除或保留为设计决策记录（建议保留至 `docs/design-decisions.md`）。
