# 待优化清单（DeepSeek / DSH 设计借鉴）

> 基于两轮技术分析整理：① DeepSeek 模型/工程侧设计哲学（MoE 负载均衡、MLA 缓存复用、MTP 预取、DualPipe 重叠、FP8 资源效率、双源容错、验证文化）；② DeepSeek Harness（DSH，开源 `deepseek-ai/deepseek-harness`）的工程实现（Cordis 微内核、Typert 契约生成、JSONL 事实源 + 投影、观察→守卫→原子写、spill、token-meter 等）。
>
> 每个条目均包含 **现状（事实）**、**参照模式（事实）** 与 **优化预期（收益）**，全部可溯源到仓库源码或 DSH 源码。改完条目请在本文件标记状态并更新 [docs/CHANGELOG.md](../CHANGELOG.md)。

## 概览

| # | 条目 | 优先级 | 收益类型 | 预计工作量 |
|---|------|--------|----------|-----------|
| 1 | 下载校验和（checksum）落地 | 🔥 高 | 数据完整性 | 2–4h |
| 2 | 设置/预设文件原子写 + schema 校验 + 版本迁移 | 🔥 高 | 数据完整性/健壮性 | 2–3h |
| 3 | 下载任务状态改 JSONL 事实源 + 投影 | 🔥 高 | 崩溃恢复/状态一致 | 4–8h |
| 4 | IPC 桩生成替代双写 + 事后校验 | 🔥 高 | 契约结构性防漂移 | 2–3h |
| 5 | GGUF 元数据读取去阻塞（缓存已存在，补 worker 化） | 🟡 中 | 主进程响应性 | 2–4h |
| 6 | 模型目录扫描异步化 + 缓存 | 🟡 中 | 主进程响应性 | 1–2h |
| 7 | 服务日志/大输出 spill 上限 + 统一 fetch helper | 🟡 中 | IPC 防卡顿/去重 | 2–3h |
| 8 | 参数依赖清理规则声明化 + 稳定态不变量测试 | 🟡 中 | 状态正确性 | 2–3h |
| 9 | 实时指标面板（复用 bench /metrics 解析） | 🟡 中 | 可观测性 | 3–5h |
| 10 | 参数表驱动测试生成 | 🟢 低 | 测试覆盖 | 1–2h |
| 11 | 下载/运行统计 JSONL（token-meter 模式） | 🟢 低 | 可观测性 | 1–2h |
| 12 | 自定义镜像源配置（双源分发延伸） | 🟢 低 | 可用性 | 1–2h |

---

## 1. 下载校验和（checksum）落地

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`pnpm --filter @llama-launcher/core test` 全绿（download-manager 新增完成时计算/期望不匹配 2 例）；`pnpm lint` 全绿。完成时流式计算 SHA-256 并随 `DownloadCompletePayload.checksum` 上报；`StartDownloadRequest.expectedChecksum` 提供时比对，不匹配以 `checksum_mismatch` 显式失败（i18n 已加中英文文案）。
- **补充（2026-08-14）**：源 API 校验和已接入——HF tree API 的 LFS `oid`（形如 `sha256:<hex>`）经 `extractSha256` 提取为 `ModelScopeFile.sha256`，DownloadCard 启动下载时透传为 `expectedChecksum`，HF 下载自动完整性校验（新增 hf-client 用例）。
- **补充（2026-08-14，遗留补齐）**：「文件已存在且大小达标」的早完成路径同样比对 `expectedChecksum`——不匹配以 `checksum_mismatch` 显式失败（不再把损坏文件静默当作已完成），匹配则立即完成并随 `complete` 上报 checksum（新增 2 例测试）。`DownloadMeta.checksum` 预留字段随 #3 的持久化重构一并移除（校验在完成时流式计算，不落盘）。
- **来源**：DeepSeek 模型侧（官方权重发布均带 SHA-256）＋ DSH 数据完整性理念

### 现状（事实）
- `packages/core/src/download-manager.ts`:151：`DownloadMeta.checksum: string | null`，注释为「校验和(预留字段,本次不实现校验)」——字段已预留但从未写入/校验。
- 下载完成后直接进入 `completed` 状态，无任何字节级完整性验证；分段下载（`Segment` 模型，段目标 100MB，`SEGMENT_MAX_COUNT=32`）在重试/断点续传后无法确认拼接结果与源文件一致。

### 参照模式（事实）
- DeepSeek/HuggingFace/ModelScope 模型仓库均提供官方 SHA-256；DSH 侧所有落盘数据都有完整性心智（`dsh-atomic-write` 保证写入非半成品）。
- DSH 模式可复用：校验作为下载管线的一个**可选阶段**（probe 时取 `X-Checksum` 头或镜像 API 的 sha256 字段），不破坏现有分段并发模型。

### 优化预期（收益）
- 将「下载损坏」从**静默失败**（用户加载模型失败后才察觉，无法归因）变为**显式可归因**：校验失败标记 `error` 并提示重新下载，且可精确定位是网络层（重试可解决）还是镜像源问题（需要换源）。
- 复用已预留字段，不新增持久化格式；对已下载文件可增量补算（后台逐段 SHA-256），无需重新下载。

### 涉及文件
`packages/core/src/download-manager.ts`（`DownloadMeta`、`Segment` 完成回调、`classifyError`）、`packages/shared/src/types/download.ts`

---

## 2. 设置/预设文件原子写 + schema 校验 + 版本迁移

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`pnpm --filter @llama-launcher/core test` 全绿（settings-store 14 用例，新增损坏备份/字段归一化/版本补齐/原子写/**并发磁盘更新合并（CAS）** 5 例）；`pnpm lint` 全绿；损坏文件自动备份为 `settings.json.bak` 并回退默认。`saveSettings` 为「读磁盘基线 → 合并 → 归一化 → 原子写 → 失败重试」，多实例并发保存的互相覆盖消除。预设侧补版本化：`Preset.preset_version`（当前 1，旧文件补齐）+ `values` 形状校验（presets-store 17 用例）。
- **来源**：DSH `dsh-fs`（观察 → 守卫 → 原子写）、`dsh-atomic-write`

### 现状（事实）
- `packages/core/src/settings-store.ts`:25-35：`loadSettings` 直接 `JSON.parse` + `{ ...defaults, ...data }` 浅合并——**无字段类型校验**（`theme_mode` 可为任意字符串、`download_max_concurrent` 可为负数）、**无版本字段**。
- `settings-store.ts`:37-42：`saveSettings` 直接 `writeFileSync` 覆盖——非原子，崩溃/断电可能留下半个 JSON；多窗口或多实例并发保存会互相踩（read-modify-write 无守卫）。
- `packages/core/src/presets-store.ts`：预设文件同样直接写（与下载元数据 `migrateMeta` 的版本化模式不同步）。

### 参照模式（事实）
- DSH `dsh-fs/lib/types/types.d.ts`：每次写必须先 `stat` 取得 `FsVersion`，写操作携带 `replaceIfVersion`（版本不匹配拒绝）或 `createIfAbsent`（已存在拒绝）守卫——**CAS 语义**；失败是显式错误而非静默覆盖。
- DSH 侧落盘均为临时文件 + rename（`dsh-atomic-write`），不存在「读到半个文件」的窗口。
- 本仓库已有可复用的成熟先例：`download-manager.ts`:280-315 的 `migrateMeta`（v1→v2 版本迁移补默认值）。

### 优化预期（收益）
- 损坏/脏设置从「静默回退默认值（用户配置全丢且不知情）」变为「保留 `.bak` + 显式提示 + 逐字段归一化修复」。
- 多窗口/多实例并发保存的互相覆盖概率归零（写入前校验版本，冲突时合并重试而非盲写）。
- 与 `migrateMeta` 模式对齐后，未来新增设置字段（如自定义镜像源 #12）无需迁移脚本，一次模式复用。

### 涉及文件
`packages/core/src/settings-store.ts`、`packages/shared/src/types/settings.ts`（增加 `settings_version`）、`packages/core/src/presets-store.ts`

---

## 3. 下载任务状态改 JSONL 事实源 + 投影

- **状态**：✅ 已完成（2026-08-14）
- **验证**：新增 `packages/core/src/download-log.ts`（append-only 事件日志：`start` 含段布局 / `segment` 段进度逐事件落盘 / `done` 终态；`replayDownloadLog` 重放重建投影、`migrateLegacyMeta` 把旧版 `.llama_dl.json` 快照一次性迁移为日志、`deleteDownloadLog` 完成/取消时清理）；`download-manager.ts` 删除周期快照与节流定时器（`META_SAVE_INTERVAL_MS`/`META_SAVE_THROTTLE_MS`/`saveMeta*`/`loadMeta`），段完成/暂停/失败均追加事件，崩溃恢复窗口从 ≤5s 归零。`download-log.test.ts` 11 例 + download-manager 迁移/重放回归全过；`pnpm lint` 全绿。
- **来源**：DSH `dsh-session-persistence-jsonl`（append-only 日志为事实源）+ `dsh-session-query-sqlite` / `dsh-session-projection`（查询视图为投影，CQRS 式读写分离）

### 现状（事实）
- `packages/core/src/download-manager.ts`:141-155：`DownloadMeta` 是**内存状态 + 周期快照**双份；`META_SAVE_INTERVAL_MS = 5000`（第 181 行）、`META_SAVE_THROTTLE_MS = 3000`（第 183 行）节流写盘。
- 崩溃窗口：任意 5 秒内的段进度、已下载字节、重试计数全部丢失；恢复时只能从上次快照续传，且快照与内存状态存在漂移风险（段完成事件先改内存、后等节流落盘）。
- 应用退出（`clearFinished`/`destroySegments`）时若未触发保存，进度推送（500ms 节流）与落盘（5s）节奏不一致。

### 参照模式（事实）
- DSH 会话永不「覆盖」历史：每个事件 append 一行 JSONL（事实源），UI/查询从投影读取；崩溃后重放日志即可精确重建状态，**没有周期性快照窗口**。
- 本仓库已有事件化雏形：`DownloadEvent = progress | complete | error`（`download-manager.ts`:117-120），只需把「推送给 UI」扩展为「同时 append 日志」。

### 优化预期（收益）
- 崩溃恢复的状态丢失窗口从 **≤5s → 0**（逐事件持久化），且恢复逻辑从「解析快照 + 猜测」变为「重放事件流」，可精确到每个段。
- 消除内存/磁盘双份状态的漂移源：`getAllTasks()`/进度推送改为投影读取，单一事实源。
- 附带收益：获得免费的下载历史（可用于 #11 统计与「最近下载」UI）。

### 涉及文件
`packages/core/src/download-manager.ts`（`saveMeta`/`loadMeta`/段完成路径）、`packages/shared/src/types/download.ts`

---

## 4. IPC 桩生成替代双写 + 事后校验

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`node --check` 两个 preload 文件通过；`node scripts/generate-preload.cjs --check` 通过；`pnpm lint` 全绿（verify-ipc-sync 输出 `IPC constants in sync (51 channels, generated from shared)`）；`pnpm dist` 流程中 `copy-preload.cjs` 会先重新生成再复制两文件。
- **来源**：DSH `dsh-typert-protocol`（从类型声明**生成** host 方法 + client 调用，漂移在结构上不可能）

### 现状（事实）
- `packages/shared/src/types/ipc.ts`:1-53：51 个 IPC 通道常量（`IPC` 对象，`as const`）。
- `apps/desktop/src/preload/index.cjs`:6-58：**同一份 51 个常量逐字内联重复**（注释明言「与 packages/shared/src/types/ipc.ts 保持同步」）。
- 同步靠 `scripts/verify-ipc-sync.cjs` 事后比对——AGENTS.md 明确警告「改一个忘一个 lint 就挂」，即漂移是**预期内的常态风险**，校验只是兜底。

### 参照模式（事实）
- DSH `dsh-typert-protocol/lib/types/types.d.ts`：Typert 从服务声明生成两端代码与 wire 描述符（`InvocationDescriptor`），消费者永远不手写通道名；`RemoteResult<T> = {ok:true,value} | {ok:false,error}` 判别联合让错误折叠进类型系统。
- 结构上不存在「双写」，因此不存在「漂移」这个 bug 类别。

### 优化预期（收益）
- 结构性消除「改 IPC 忘同步」故障类别：preload 桩由共享清单生成（脚本 `generate-preload.cjs`，风格对齐现有 `generate-params-doc.cjs`），`verify-ipc-sync.cjs` 从「校验」退化为「检查生成物未过期」。
- 顺带把 preload 的 `invoke`/`on` 暴露面从手写模板变为**类型安全**的通道→载荷映射，UI 侧 `useIPC` 可获得按通道的请求/响应类型（向 DSH `RemoteResult` 折叠对齐）。
- 保持 CommonJS preload 约束不变（`index.cjs` 仍为产物，只是由脚本生成）。

### 涉及文件
`packages/shared/src/types/ipc.ts`、`apps/desktop/src/preload/index.cjs`、`scripts/verify-ipc-sync.cjs`（新增 `scripts/generate-preload.cjs`）

---

## 5. GGUF 元数据读取去阻塞（缓存已存在，补异步化）

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`readGgufMetadata` 改为异步（`fs/promises` + `FileHandle.read`，底层走线程池不阻塞事件循环）；gguf-meta 36 例全过。**未采用 worker 池的决策**：GGUF 头部解析是 I/O 密集（64KB 块按需读）而非 CPU 密集，异步 fs 已消除事件循环阻塞；worker 线程 + asar 打包（ESM worker）会引入打包复杂度与风险而收益为零，故不引入。
- **实施发现**：该运行时 `node:fs/promises` 不导出命名 `read`/`close`（仅 `open`/`stat`），改用 FileHandle 实例方法规避；`ipc-handlers` 的 `MODELS_READ_GGUF_META` handler 改 async；gguf-meta 测试 33 处加 `await`、3 处 `toThrow` 改 `rejects.toThrow`。
- **来源**：DeepSeek 模型侧 DualPipe（计算与 I/O 显式重叠）＋ DSH `dsh-code-runtime-worker-thread`（重活进 worker）

### 现状（事实）
- ✅ 缓存已实现：`packages/core/src/gguf-meta.ts`:614-671 —— `ggufCache`（key = `filePath:mtimeMs:size`，上限 `GGUF_CACHE_MAX=32`，LRU 简化版），命中即免 IO，这一条**无需再做**。
- ❌ 未命中路径仍同步阻塞：`readGgufMetadataUncached`（`gguf-meta.ts`:681-689）用 `openSync`/`readSync` 同步读，且经 `apps/desktop/src/main/ipc/models.ts` 的 `MODELS_READ_GGUF_META` 在**主进程事件循环**上执行——20GB 模型首次读取头部元数据（含大段 chat_template/tokenizer 跳过）期间主进程停顿。

### 参照模式（事实）
- DSH 把不可信的、可能长跑的执行放进 worker thread，宿主只做异步编排（`dsh-code-runtime-worker-thread/lib/worker.cjs`，结构化克隆线协议）；DeepSeek 训练/推理均把通信与计算调度重叠而非串行。
- 本仓库已有同类正确先例：`gguf-meta.ts` 的 `BufferReader` 按 64KB 块按需加载 + `skipBytes` 跳过 tokenizer 数组（第 87-200 行），说明作者已重视大文件内存，只是没有跨线程。

### 优化预期（收益）
- 首次读取（缓存未命中）不再阻塞主进程事件循环：对 10GB+ 模型，头部解析从「卡住整个 UI（秒级）」变为「异步等待，UI 可交互」。
- 缓存命中路径（切回同一模型、参数页/元数据卡复用）保持现状零 IO，收益即现。
- 实现可选：worker_thread 池（对齐 DSH）或 `fs/promises` 流式（改动更小）；建议以「不阻塞 + 保持可测试」为验收标准。

### 涉及文件
`packages/core/src/gguf-meta.ts`、`apps/desktop/src/main/ipc/models.ts`（`MODELS_READ_GGUF_META` handler）

---

## 6. 模型目录扫描异步化 + 缓存

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`pnpm --filter @llama-launcher/core test` 全绿（models-scanner 新增缓存命中/失效 2 例，28 例全过）；`pnpm lint` 全绿。UI 侧经 IPC invoke 天然异步，无签名改动。
- **来源**：DeepSeek 模型侧 MTP/预取（前瞻式工作）＋ DSH worker/异步化

### 现状（事实）
- `packages/core/src/models-scanner.ts`:57-79：`scanModels` 用 `readdirSync`/`statSync` **同步递归**遍历整个模型目录，经 `MODELS_SCAN` IPC 在主进程执行；目录含数百个 GGUF（每个几十 GB）时，stat 全量同步执行期间主进程阻塞。
- `apps/desktop/src/main/ipc/models.ts` 已有 `MODELS_WATCH`（`fs.watch` 递归 + 500ms 防抖），但扫描结果**无缓存**——每次切页/刷新都全量重扫。

### 参照模式（事实）
- DSH 的 fs 层是异步服务（`ctx.fs` 全异步 + `stat` 元数据先行，`dsh-fs/lib/types/types.d.ts` 中 `listDir` 只返回元数据不读内容）；DeepSeek 训练数据管道（3FS）强调数据供给不阻塞计算。
- 本仓库已有正确「结果失效」触发源（`MODELS_WATCH` 的防抖），缺的只是「缓存 + 异步遍历」这两半。

### 优化预期（收益）
- 主进程不再因全量 stat 卡顿：千级文件目录的扫描从「阻塞秒级」变为「异步增量」。
- 按 `(dir, dirMtime)` 缓存扫描结果，切页/刷新零重扫；`MODELS_WATCH` 事件仅失效受影响的缓存条目。
- 与 #7 的 spill 结合可避免超大目录列表一次性塞爆 IPC 通道。

### 涉及文件
`packages/core/src/models-scanner.ts`、`apps/desktop/src/main/ipc/models.ts`（`MODELS_SCAN`/`MODELS_WATCH`）

---

## 7. 服务日志/大输出 spill 上限 + 统一 fetch helper

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`pnpm --filter @llama-launcher/core test` 全绿（process.test.ts 新增超长行截断/无换行缓冲上限 2 例）；`pnpm lint` 全绿。单行输出 >8KB 截断并追加 `[truncated N bytes]` 标记，无换行缓冲 >64KB 强制输出；bench-client 收敛为 `requestText`/`requestJson` 统一 fetch helper（超时/网络错误/JSON 解析单点实现）。**补充（2026-08-14）**：重试判定与退避收敛到 `packages/core/src/retry.ts`（`isRetryableError` 合并 code/状态码/消息三种判定 + `retryDelayMs` 指数退避），`download-manager.ts` 与 `huggingface-client.ts` 复用，删除各自重复实现（新增 retry.test.ts 5 例）。
- **来源**：DSH `dsh-spill-local`（超长输出落盘）+ `dsh-output-retention`（保留上限策略）；DSH `dsh-client-connection`（fetch-shaped handler + interceptor 链，传输无关）

### 现状（事实）
- `packages/core/src/process.ts`:29-46：stdout/stderr 逐行拆包后 `emitOutput` 全量转发 IPC，**无单行长度上限、无总量上限**——llama-server 偶发超长输出行（错误栈/日志转储）会整体塞进 IPC 载荷。
- `apps/desktop/src/main/bench-client.ts`：`requestJson`（25-67 行）与 `fetchMetrics`（70-98 行）是**两段几乎相同的重复代码**（同构的超时/错误处理/JSON 解析），`isRetryableError`/退避逻辑又在 `download-manager.ts` 与 `huggingface-client.ts` 各写一份。

### 参照模式（事实）
- DSH 工具输出超限时**落盘并返回路径**（spill），且保留策略可配（output-retention）；`dsh-client-connection/lib/index.js`:22-71 把 API handler 写成 fetch-shaped，可跑在 HTTP 或 WebSocket 两种载体上，拦截器按 endpoint 匹配（`interceptor.matches(endpoint)`）。
- 本仓库已有传输抽象先例：`DownloadTransport`（`download-manager.ts`:38-56）与 `HfHttpTransport`（`huggingface-client.ts`:32-40）——但两者是两套相似接口（流式 vs 文本），未共享超时/重试/UA/镜像切换。

### 优化预期（收益）
- 单行 >4KB（或单任务累计超限）的输出行截断 + 附 spill 路径，杜绝超长行卡死 IPC/UI 渲染。
- 统一 fetch helper 后删除 `bench-client.ts` 内重复代码，超时/重试/UA/镜像域名切换收敛为一组拦截器，新增 API 调用（#9 指标面板、镜像源 #12）零成本接入。

### 涉及文件
`packages/core/src/process.ts`、`apps/desktop/src/main/bench-client.ts`、`packages/core/src/huggingface-client.ts`、`packages/core/src/download-manager.ts`（重试/错误分类收敛点）

---

## 8. 参数依赖清理规则声明化 + 稳定态不变量测试

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`pnpm --filter @llama-launcher/ui test` 全绿（params.test.ts 16 例，新增纯函数单测 5 例 + 稳定态 3 例）；`pnpm lint` 全绿。判定逻辑收敛为导出纯函数 `isDependencySatisfied` / `computeViolatedParams`（可独立测试），`syncDependencies` 只做遍历重置；新增「先填下游不误清」「draft-mtp 清 -md」「幂等收敛」用例。
- **来源**：DSH `dsh-compaction-basic`（有预算、带不变量的 region 选择：head 锚定、尾部保留、**绝不断开 tool-call/result 对**）

### 现状（事实）
- `packages/ui/src/stores/params.ts`:136-152：`syncDependencies`/`resetDep` 是**命令式遍历**所有声明 `dependsOn` 的参数；`DEP_SOURCE_KEYS`（72-74 行）的注释已记录痛点：「避免用户『先填下游值、后选依赖源』时中间态被误清」。
- `stores/params.ts`:120-122：依赖清理在 `set()` 内按 key 触发，依赖链的**收敛性**（一次清理是否到达稳定态、是否会级联误清）没有测试保证；现有 `params.test.ts` 覆盖了常规场景但无「来回切换依赖源」的中间态用例。

### 参照模式（事实）
- DSH compaction 把「清哪些」定义为**可验证的不变量**（`selectCompactableRange` 返回明确的 `{start,end}` 区间，且强制不变量「不断开 tool-call/result 对」），而不是在每次事件里打补丁式清理。
- 对应到参数系统：把「依赖不满足 ⇒ 该参数重置」声明为规则（`dependsOn` 已有，可扩展 `invalidWhen` 语义），并用**稳定态测试**验证任意操作序列后状态收敛。

### 优化预期（收益）
- 消灭「先填下游值、后选依赖源」导致的中间态误清（现状注释承认的已知问题）。
- 清理逻辑从命令式补丁变为声明式规则，新增参数依赖时只改定义不改逻辑。
- 通过「依赖源来回切换」的属性测试（现有 Vitest 基建），把这类回归从手工排查变为自动化。

### 涉及文件
`packages/ui/src/stores/params.ts`、`packages/ui/src/stores/params.test.ts`、`packages/shared/src/params/definitions.ts`（依赖声明扩展）

---

## 9. 实时指标面板（复用 bench /metrics 解析）

- **状态**：❌ 已实现后移除（2026-08-14）——产品决策：实际运行中未见有效计数，控制台「实时指标」卡片、`useServerMetrics`（含 6 例测试）、`launcher-bridge` 2s 采样推送、`server:metricsPush`/`server:benchMetrics` 通道（52 → 50）与对应 preload/类型/i18n 一并删除。`bench-client.fetchMetrics` 保留（性能测试 runBench 仍需 `/metrics` 累计值）；若未来需要运行态指标可复用该解析函数。
- **来源**：DeepSeek 服务侧可观测性（token/s、接受率监控）；llama.cpp `/metrics`（Prometheus）

### 现状（事实）
- `apps/desktop/src/main/bench-client.ts`:70-114 已实现 `/metrics` Prometheus 解析（`prompt_tokens_seconds`、`spec_decode_num_accepted_tokens_total`、`n_decode_total` 等）与 `SERVER_BENCH_METRICS` IPC（`ipc.ts`:21）——**解析能力已具备，但仅 bench 测试时调用**。
- `packages/ui/src/stores/server.ts` 有运行状态，但 Launch 页无持续指标展示；DFlash 推测解码接受率（已通过 `/metrics` 可得）在运行中不可见。

### 参照模式（事实）
- DeepSeek/llama.cpp 服务端均以 Prometheus 指标实时暴露运行质量；DSH 用 token-meter 持续计量。
- 本仓库只需把一次性 bench 解析改为**轮询面板**（2s 间隔，复用现有 IPC 与解析函数），无新协议。

### 优化预期（收益）
- 运行中实时可见：生成 tok/s、DFlash 接受率、累计 decode——直接回答用户「这个参数组合快不快/草稿模型有没有生效」。
- 与 #7 统一 fetch helper 后，轮询开销可控（超时/错误静默，与现有 `fetchMetrics` 的 try/catch 行为一致）。

### 涉及文件
`packages/ui/src/pages/LaunchPage.vue`（或新增指标面板组件）、`packages/ui/src/components/bench/BenchPanel.vue`（复用解析展示）、`apps/desktop/src/main/bench-client.ts`

---

## 10. 参数表驱动测试生成

- **状态**：✅ 已完成（2026-08-14）
- **验证**：新增 `packages/core/tests/command-builder-definitions.test.ts`（8 例全过）：从 `definitions.ts` 表驱动生成结构约束用例（key 唯一/flag 齐全/int·float 范围与默认值/dropdown 选项含默认/checkbox flag+invert_flag）与发射行为用例（56 参数逐一验证显式启用发射、未启用零发射、float 2 位小数）；`pnpm lint` 全绿。
- **来源**：DeepSeek 全链路验证文化（每个层级都有评测/验证）

### 现状（事实）
- `packages/core/src/command-builder.ts` 的测试（`packages/core/tests/command-builder.test.ts`）为**手工用例**，覆盖若干典型参数组合；`definitions.ts` 中 56 个参数的类型约束（int 钳制、float 2 位小数、dropdown 选项、checkbox flag 语义）没有逐参数验证。
- `scripts/verify-params-sync.cjs` 已做「定义 ↔ 文档 ↔ help 输出」三方对拍（golden-master 思想），但**不验证命令构建行为本身**。

### 参照模式（事实）
- DeepSeek 对每个发布做基准评测；DSH 的 typert 对每个生成契约做 codec 校验。数据表驱动的测试 = 数据即测试。

### 优化预期（收益）
- 新增/修改参数时自动获得该参数的全类型约束覆盖（无需手写用例），command-builder 回归风险归零。
- 与 `verify-params-sync.cjs` 形成互补：一个验「文档一致性」，一个验「运行时行为」。

### 涉及文件
`packages/core/tests/command-builder.test.ts`（新增 definitions-driven 用例生成）、`packages/shared/src/params/definitions.ts`

---

## 11. 下载/运行统计 JSONL（token-meter 模式）

- **状态**：❌ 已实现后移除（2026-08-14）——产品决策：展示内容无实际作用，界面「累计下载」、`download-stats.ts` 模块、`stats.jsonl` 落盘、`download:stats` IPC 通道（53 → 52）与对应 preload/类型/测试一并删除；下载完成路径不再追加统计行。若未来需要「最近下载/磁盘占用」类功能可参考 #3 的事件日志重新实现。
- **来源**：DSH `dsh-token-meter`（持续计量）、`dsh-session-telemetry-otel`

### 现状（事实）
- 下载完成的字节/耗时/平均速度只存在于任务内存态（`DownloadManager.speedTrackers`，`download-manager.ts`:335-344，EMA 平滑），任务清理后**历史归零**；应用无任何累计使用统计。
- `DownloadCompletePayload` 已含耗时与字节信息（`shared/src/types/download.ts`），缺的只是落盘聚合。

### 参照模式（事实）
- DSH 用 token-meter 对每次 LLM 调用计量并持久化，遥测可聚合；对应本地应用即「每次下载完成 append 一行统计」。

### 优化预期（收益）
- 「累计下载量 / 各源占比 / 平均速度」可在侧边栏或设置页展示，用户对磁盘占用有全局感知。
- 数据源即 #3 的 JSONL 事实源，零额外状态同步成本。

### 涉及文件
`packages/core/src/download-manager.ts`（完成事件处追加统计行）、`packages/ui`（展示入口）

---

## 12. 自定义镜像源配置（双源分发延伸）

- **状态**：✅ 已完成（2026-08-14）
- **验证**：`huggingface-client.test.ts` 5 例（默认/往返/复位/子域判定/URL 同步）；`settings-store.test.ts` 新增「loadSettings 接线镜像源」；设置字段 `hf_mirror_host`（ModelsPage 可编辑，i18n 中英文）；`shouldUseTransport` 与列表/下载 URL 全部跟随配置。`pnpm lint` 全绿。
- **来源**：DeepSeek 模型侧双源分发（HuggingFace + ModelScope，任何关键资源都有镜像/兜底路径）

### 现状（事实）
- `packages/core/src/huggingface-client.ts`:14：`MIRROR_HOST = 'hf-mirror.com'` 为**写死常量**；`download-manager.ts`:111-114 的 `shouldUseTransport` 按域名判定是否走 Electron `net` 传输——自定义 host 时两处都需要改码。
- `.npmrc` 已有 npmmirror 镜像配置（工程侧先例），但应用侧镜像不可配置。

### 参照模式（事实）
- DeepSeek 权重在 HF 与 ModelScope 双源发布；DSH 的 provider 可插拔（`dsh-llm-deepseek`/`dsh-llm-pi-ai` 同接口换实现）。
- 延伸：镜像 host 进设置（`AppSettings` 新增字段），传输选择逻辑改为「host 匹配任意已配置镜像」。

### 优化预期（收益）
- 受限网络/企业代理用户可指向自建镜像或内网缓存，下载可用性提升；行为对齐 `.npmrc` 既有镜像心智。
- 依赖 #2 的 settings 版本化（新增字段需迁移），故排期在 #2 之后。

### 涉及文件
`packages/core/src/huggingface-client.ts`、`packages/core/src/download-manager.ts`（`shouldUseTransport`）、`packages/shared/src/types/settings.ts`、`packages/ui`（设置入口）

---

## 实施顺序与验收

**建议顺序**：#4（IPC 桩生成）与 #2（设置原子写）先行——都是 2–3h 独立可验证的小改动，且为后续 #3/#12 提供基础设施；随后 #1（checksum）→ #5/#6（响应性）→ #3（事实源）→ 其余按需。

**通用验收标准**（每项改动后）：
1. `pnpm lint`（含 `verify-ipc-sync.cjs`）通过；
2. `pnpm test` 通过，且新增用例覆盖本次条目声明的不变量；
3. 手动验证路径写在本条目「状态」备注中（参照 `docs/style/STYLE_TODO.md` 的「修复效果验证方式」惯例）；
4. 涉及行为变更的条目同步更新 [docs/CHANGELOG.md](../CHANGELOG.md) 与相关主题文档（`data-persistence.md`/`desktop-main.md`）。

## 事实核查备注

- GGUF 元数据**缓存已存在**（`gguf-meta.ts`:614-671），#5 只补「未命中路径的 worker 化」，不做重复缓存。
- IPC 通道确为 **46 个**（`ipc.ts` 与 `preload/ipc-constants.cjs` 由 `generate-preload.cjs` 生成、`verify-ipc-sync.cjs` 校验产物未过期），与 `docs/ipc-channels.md` 一致。
- 下载续传已从周期快照改为 **事件日志**（`download-log.ts`，`.llama_dl.jsonl` append-only），崩溃恢复窗口为 0；旧 `.llama_dl.json` 快照由 `migrateLegacyMeta` 一次性迁移。
