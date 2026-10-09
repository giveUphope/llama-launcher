# 核心模块详解

> 语言：中文 · [English](../en/core-modules.md)
> 范围：核心业务模块：进程管理、启动编排、命令构建、模型扫描、GGUF 元数据、在线下载、路径解析。
> 索引：[README.md](../../README.md) · 相关：[params-system.md](params-system.md) · [desktop-main.md](desktop-main.md)

### 4.1 进程管理 (process.ts)

`LlamaServerProcess` 类（extends `EventEmitter`），封装 `child_process.spawn`：

- **`start(opts)`**：spawn 子进程，配置 `windowsHide: true`、`shell: false`，避免额外 shell 层。

- **按行缓冲**：stdout/stderr 按行切分，通过 `output` 事件发射 `OutputEntry { kind, data, ts }`，避免半行输出污染日志。

- **`kill()`**：Windows 平台用 `taskkill /F /T /PID` 杀整个进程树（防止子进程残留），其他平台对负 pid（进程组）发 `SIGKILL`（立即终止；`SIGTERM` 优雅终止仅用于 `terminate()` 两阶段流程）。**杀完刻意不把句柄置 null**——置了就等于宣布「进程已死」，而 `taskkill` 返回时子进程往往还没派发 `exit`；上层用 `isRunning()` 决定「等 exit 再 start」还是「直接 start」，在这里谎报 `false` 会让连点两下「重启」并发拉起第二个 llama-server。死亡由 `exit` 事件收口（`Launcher` 的 exit 处理负责清 `this.proc`）。

- **两阶段终止体系**：`LlamaServerProcess.terminate()`（SIGTERM 优雅 → 超时升级 killTree）、`killSync()`（同步强杀：杀树 → 轮询确认 → 仍存活则重试 → 最后无条件按可执行文件名兜底扫杀，供 `before-quit` 用）、`forceKill()`（杀树后 400ms 短轮询，**只有** PID 定向终止未能确认死亡时才 `sweepByName()` 按名扫杀；没有 PID 句柄时不做全局按名扫杀，免得 `taskkill /F /IM` 误伤用户自启的同名实例）。**`forceStop()` 在 `Launcher` 上**（置 `stopRequested` 后调 `proc.forceKill()`；供 Electron `before-quit` 经 `launcher-bridge.disposeSync()` 调用），不在 process.ts。本节的引用一律只写文件与函数名、不写行号——这些函数在同文件里来回挪过位，写死行号等于埋一条会自己过期的指针。

- **`isRunning()`**：判断条件为 `proc !== null && exitCode === null && signalCode === null && !killed`。`signalCode` 一项是为类 Unix 补的（Linux CI 实测）：那里 killTree 走 `process.kill(pid, SIGKILL)` 直接系统调用，进程死于信号时 Node 语义是 `exitCode` 保持 null、`killed` 不置位、只有 `signalCode` 有值——缺了这一判据，死进程会被谎报成「在跑」，`restart()` 于是给一个 `exit` 早已派发过的死句柄挂 `once('exit')`，重启永久挂死。Windows 侥幸不踩：`taskkill /F` 退出的进程总带非零退出码。

### 4.2 启动编排 (launcher.ts)

`Launcher` 类（extends `EventEmitter`），实现状态机：

- **状态机**：`stopped → starting → running → stopping → stopped`（`stopping` 是 2026-10-06 补上的一态：`stop()` **先出声再去杀**——没有它时界面在进程真死之前一直显示「运行中」，停止/重启按钮全程可点，连点重启会并发拉起第二个进程）

- **`start(opts)`**：调用 `buildCommand` 构建命令 → 创建 `LlamaServerProcess` → 监听 `output` 事件，匹配到 "listening" 关键词后切换到 `running`（首次检出同时记下就绪时刻 `readyAt`，见下）。开始新一轮时清空上一轮的停止事实、就绪时刻与回读结论。

- **通用 listening 检测**：匹配同时包含 `"listening"` 与（`"http"` 或 `"server"`）的行，兼容所有版本的 llama-server 输出格式。

- **`stop()`**：**先 `setStatus('stopping')` 再调用 `proc.kill()`**；`stop()`/`stopSync()`/`forceStop()` 都会先置 `stopRequested`，使随后的 exit 被记为「用户主动停」——Windows 下 `taskkill /F` 给出的退出码不是 0，只靠退出码分不出「用户停的」与「自己崩的」。

- **停止事实 `ServerStopInfo`**：`Launcher` 在退出/失败时记录 `{ reason: 'exited' | 'spawn_failed' | 'stopped_by_user', code, signal, hadBeenReady, at }`，随 `status` 事件一起下发（`code` 里 `process.ts` 用于归一「被信号杀死」的 `-1` 会还原为 `null`）。界面据此把 `stopped` 细分为「已停止 / 启动失败 / 异常退出」——**渲染层不再从日志文字推断进程死活**：llama-server 正常运行期也会为拒绝一个越界请求打 `E srv  send_error: ... error: request ... exceeds the available context size` 这样的行，旧的「最近 80 行含 error 字样即判崩溃」会把活着的服务显示成「异常退出」（2026-09-25 移除）。

- **`restart(opts)`**：先 `stop`，等 `exit` 事件后再 `start`，确保端口释放；运行中重启**只排队一次**（`restartArmed`），连点不会挂上两个 `once('exit')` 并发拉起第二个进程。

- **就绪时刻 `readyAt`**：本轮首次检出 listening 的 epoch ms（后续再打 listening 行不覆盖），随 `ServerInfo` 与 `status` 事件两路下发；`stopping` 期间仍有值（进程还在，时长还在走），本轮 exit 归零、新一轮 `start` 清空、迟到的旧句柄退出不得改写。界面「已运行时长」由它派生——渲染层只知道「自己什么时候看见 running」，服务已运行而用户第一次进概览页、或渲染层重载时那个时刻比真就绪晚得多，自记起点会让时长永远显示「—」或从进页面那刻起算（2026-10 实测缺陷）。

- **`getStatus()`**：返回 `ServerInfo { status, pid, host, port, url, values, stop, envOverrides, propsCheck, readyAt }`（`values` 为本次启动的参数快照，供服务页展示运行时详情；`stop`/`propsCheck`/`readyAt` 均与状态事件同源，`refreshStatus()` 不会拿到比事件旧的事实；`envOverrides` 见 §4.11，`propsCheck` 见 §4.11）。

### 4.3 命令构建 (command-builder.ts)

- **文件分工**：argv 拼装本身在 **`packages/shared/src/params/command.ts`**（`buildArgv` / `argvFromPreviewOptions` / `formatCommand` / `tokenizeArgs` / `quoteArg`），本文件只剩 `buildCommand`（叠一层 `exePath` 存在性校验）与 `previewCommand`。规则放 shared 是因为命令有两个消费方——执行方（core spawn 子进程）与展示方（服务页预览、浏览器 mock，后者没有 node 文件系统）；规则一旦对展示方不可达，那边就只能各抄一份简化版并静默失真（2026-09-26 mock 预览失准即此因）。`scripts/verify-params-sync.cjs` 第 ⑤ 项把「第二处拼装 flag 的代码」判为 fail。

- **`buildCommand(opts)`**：校验 `exePath` 存在性后委托 `buildArgv`，生成 `[exePath, '-m', modelPath, ...flags]` 数组。

- **发射规则**（无独立启用机制；`values._enabled` 为 legacy 字段，读取时直接忽略）：值**不等于引擎缺省 `engineDefault`** 才发射 flag（基准来自 `shared/params/engine-baseline.ts`，不是界面初值 `default`；`sentinel` 列出的值表示「不指定」，恒不发射）；checkbox 勾选发 `flag`、取消发 `invert_flag`（无 `invert_flag` 且 default false 的常开开关取消时不发射，如 `--metrics`）；空串跳过；`dependsOn` 依赖不满足跳过；`model` 恒附 `-m`（空模型不附）。

- **checkbox**：有 `invert_flag` 时 true 发 `flag`、false 发 `invert_flag`（如 `--jinja` / `--no-jinja`）；无 `invert_flag` 的常开开关（default false）仅 true 时发射。

- **float\_slider**：保留 2 位小数，避免浮点精度问题导致命令字符串不稳定。

- **spec\_type**：`draft-model` 向后兼容映射为 `draft-simple`。

### 4.4 模型扫描 (models-scanner.ts)

- **`scanModels(dir, opts)`**：递归扫描 `.gguf` 文件（异步 `fs/promises` 并行遍历，不阻塞主进程），跳过文件名含 `mmproj` / `projector` / `multimodal` 关键词的文件（多模态投影器）与 `dflash` / `draft` 关键词的草稿模型文件。目录条目用 `withFileTypes` 的 `Dirent` 判类型（仅对返回的 `.gguf` 才 `stat` 取大小）。缓存按**目录**为键，指纹是该目录及其每个子目录的 `mtime+ctime`（上限 200 个目录指纹、8 条结果），任一子树变更都能被感知而不再只比对顶层目录 mtime；`invalidateScanCache(changedPath?)` 传变化文件的绝对路径时只失效覆盖该路径的条目（`MODELS_WATCH` 已按此传参，单个 `.gguf` 变动不再清空全部缓存导致整树重扫），不传/非绝对路径则保守全清。

- **目录不存在**：抛出 `DIR_NOT_FOUND` 错误码，`createIfMissing` 选项可自动创建目录。

- **`detectMmproj(modelPath)`**：在模型同目录查找 mmproj 文件，优先匹配文件名含 `"mmproj"` 的文件，用于自动关联多模态投影器。

- **`detectDraftModel(modelPath)`**：在模型同目录查找草稿模型文件（文件名含 `dflash` / `draft` 的 `.gguf`），优先选择含 `"dflash"` 的文件，用于自动关联 DFlash/推测解码草稿模型。

- **`removeModelFile(modelPath, modelsDir)`**：按模型文件移除。先判断模型所在目录内容——目录下存在其他内容（其他量化版本、用户创建的非 gguf 文件、子目录等）时**仅删除选中的模型文件**，保留其余内容；目录下无其他内容时删除模型文件 + 相关伴随 GGUF（mmproj/projector/multimodal 关键词的 `.gguf/.bin`、dflash/draft/mtp 关键词的 `.gguf`），空目录一并移除（返回 `removedDir`，供每模型参数集清理按目录前缀匹配）。安全约束：仅允许删除 modelsDir 内部路径，拒绝删除 modelsDir 本身。

### 4.5 GGUF 元数据读取 (gguf-meta.ts)

- **流式读取**：`BufferReader` 按 64KB 块按需加载文件内容，内存占用恒定，可读取数 GB 的模型文件。

- **数组跳过策略**：固定大小数组按 `count × elementSize` 一次性 `skipBytes`；字符串数组（`tokenizer.ggml.tokens` 常 10 万~25 万元素）走 `skipStringArray()`——游标仍在已加载块内时直接 `readUInt32LE` 取长度并前移，只在跨块时回到异步 `skipString()`。此前逐元素 `await` 会产生同量级的微任务与 8 字节 Buffer 分配，把主进程事件循环灌满、饿死同进程的 IPC 回包。实测（合成 20 万 token / 3.4 MB 头部）解析耗时 **48–53ms → 5.0–5.8ms**。

- **IPC 载荷裁剪**：`MODELS_READ_GGUF_META` 不回传 `info.metadata`（完整 KV 映射）与 `chat_template` 原文（截断至 200 字符）——渲染层只用派生字段与「有无模板」的勾选（`ModelMetaCard`）。

- **版本兼容**：支持 GGUF v1 / v2 / v3，校验魔数 `0x46554747`（"GGUF" ASCII）。

- **跳过 ARRAY 类型**：tokenizer 等数组数据可达数 MB，仅跳过不读入内存。

- **提取** **`GgufModelInfo`**：包含 60 个字段（架构、上下文长度、量化、采样参数、rope 基准、组织/许可证/数据集/分词器等）。

- **`buildSuggestions(info)`**：基于元数据推导建议参数，共 **11 条规则**：`temperature` / `top_k` / `top_p` / `min_p` / `repeat_penalty` / `presence_penalty` / `spec_type` / `alias` / `cache_type_k` / `cache_type_v` / `flash_attn`（仅建议有元数据依据且偏离当前值的项；纯参考信息如 `context_length` 训练上限不产生建议——`-c 0` 即"从模型加载"，`ctx_size` 建议已于 2026-09-03 移除；主模型守卫：非 model 类型/clip 附件不产生建议）。

- **LRU 缓存**：上限 32 条，按 `filePath:mtimeMs:size` 为键，文件变更时自动失效。

### 4.6 在线下载 (download-manager.ts + modelscope-client.ts + url-parser.ts)

**`DownloadManager`**（单例，extends `EventEmitter`）：

- **多任务并发**：`maxConcurrent = 3`，超出排队。

- **多段并行下载**：动态段数算法 `computeSegmentCount` 按文件大小递增（<100MB→1 段、<1GB→2、<5GB→4、<20GB→6、≥20GB→8），再与 `SEGMENT_TARGET_SIZE`(100MB) 计算的目标段数取 `max`、与 `MIN_SEGMENT_SIZE_BYTES`(8MB) 的上限取 `min`，上限 32 段；worker 队列模型让并发 worker 数等于段数，每完成一段自动认领下一段，消除尾段瓶颈。`highWaterMark = 2MB`（`WRITE_STREAM_HWM`，见 `download-manager.ts`——2026-09-19 由 16MB 下调，减少下载期内存驻留与背压延迟）。

- **断点续传**：检测已存在文件大小，携带 `Range` header；分段进度持久化为 `.llama_dl.jsonl` **事件日志**（append-only：start/segment/done 三类事件），失败/暂停后重放事件恢复分段状态；旧版 `.llama_dl.json`（单 JSON 快照）由 `migrateLegacyMeta` 一次性自动迁移。

- **临时文件命名**：下载中写入 `<file>.part`（`PART_SUFFIX`），完整性校验通过后同目录改名成最终 `.gguf`。未完整下载的文件始终是 `.part` 后缀，不会被模型管理扫描/监听当成 `.gguf` 检出（旧版本直接写目标文件名的未完成 `.gguf` 在续传时自动迁移为 `.part`）；完成改名触发模型目录监听，模型此时才出现在列表中。

- **暂停/恢复**：`pauseDownload(id)` 保存元数据并销毁活动请求；`resumeDownload(id)` 从 `paused`/`error` 状态恢复，支持失败重试。暂停**保留期望校验和**——续传重下完成后仍做强校验（2026-10-09 前：暂停即消费，恢复后的完成路径降级为信息性哈希）。

- **完整性校验（强校验）**：源 API 提供 SHA-256（HF LFS oid）时，完成前流式整读比对（恒定内存），不匹配以 `checksum_mismatch` 失败；失败即**丢弃断点**（删续传日志与 `.part`）并回填期望值——重试是干净的全量重下且仍过强校验，坏内容再次被拦、不会静默改名落盘（2026-10-09 前：期望值先消费后判失败，重试第一次原样空转、第二次静默丢强校验）。`startDownload` 返回**任务快照**（去重命中时即既有任务的真实状态，渲染层据此采纳，不产生「永远排队中」僵尸行）。

- **HTTP 重定向跟随**：自动处理 30x 重定向（探测与段请求均支持）。

- **可注入传输层**：`DownloadTransport` 接口支持注入 Electron `net` 模块传输（Chromium 网络栈），仅 `hf-mirror.com` 走注入传输，其余源（ModelScope 等）走 `node:https`，规避 BoringSSL TLS 指纹被拒问题。

- **目录结构**：`models_dir/作者/模型仓库名/fileName`。

- **进度推送**：每 **120ms**（`PROGRESS_INTERVAL_MS`）从所有段汇总 `downloadedSize` 并 emit `progress`，让进度条按真实到字节连续推进；**速率/ETA 另按 500ms 窗口（`SPEED_SAMPLE_MS`）采样并做 EMA(α=0.5) 平滑**——两个节奏刻意解耦（120ms 样本噪声大，同频会让速度剧烈跳动）。完成/失败时 emit `complete` / `error`；`errorType` 字段供前端显示友好诊断。

- **状态机**：`queued → downloading → completed`；可中断为 `paused` / `error` / `canceled`。

**`modelscope-client`**：匿名访问 ModelScope API，搜索模型、列出仓库文件。文件项包含 `quantization` 字段（由 `parseQuantization` 从文件名解析）。

**`huggingface-client`**：通过 `hf-mirror.com` 镜像访问 HuggingFace API（`/api/models/{ns}/{name}/tree/main?recursive=true`），列出仓库文件。支持可注入传输（`HfHttpTransport` / `setHfTransport`），Electron 主进程注入基于 `net` 模块的传输以规避 BoringSSL TLS 指纹被 hf-mirror.com 拒绝的问题。**重定向行为随传输而变**：core 默认传输（`node:https`）不自动跟随，由 `request()` 手动跟随（最多 5 跳，每跳用 `pathname + search` 重拼回当前镜像 host，保持在镜像域内）；而主进程注入的 `net` 传输用 `redirect: 'follow'`（Electron net 的 `'manual'` 模式不返回 3xx 而是抛 `Redirect was cancelled`），重定向由 Chromium 自动跟随、**可能离开镜像 host**，此时 `request()` 的 3xx 分支只是兜底、实际不会触发（见 `apps/desktop/src/main/hf-transport.ts`）。镜像 host 可配置（`setHfMirrorHost`，由 settings 的 `hf_mirror_host` 驱动），可自建反代。3 次指数退避重试。

**`url-parser`**：解析 LM Studio / HuggingFace / ModelScope 三种来源的模型 URL。`huggingface.co` 与 `hf-mirror.com` 均识别为 `source: 'huggingface'`，DownloadCard 跳过 ModelScope 搜索直接走 HF 镜像链路。

**`parseQuantization`**（shared/model-relevance.ts）：从文件名识别量化标签（Q4\_K\_M / IQ3\_XS / FP8 / BF16 / INT4 等），返回 `{ label, bits, family }`。用于文件列表与下载任务的徽标展示。

### 4.7 路径解析 (paths.ts)

- **开发模式查找 llama-server**：扫描项目根目录下 `llama-*-bin-*` 目录，不限制版本号。

- **多版本选最新**：存在多个版本时按目录名降序排序，选最新版本。

- **生产模式**：返回空字符串，由用户在「应用设置」页选择引擎目录，内联检测机制自动查找 `llama-server.exe`。

- **`legacyModelsPresetsDir(modelsDir)`**：返回 `modelsDir/presets`——**两代历史**预设目录之一（迁移源）；每模型参数集活目录恒为 `MODEL_PARAMS_DIR`（`~/.llama_launcher/model-params`），参数存储已与模型目录解耦。

- **伴随标签**：`detectCompanionTags`（**定义在 `models-scanner.ts:111`**，非 paths.ts）为扫描结果标注伴随文件标签（多模态投影器 / 草稿模型是否存在），写入 `ModelInfo.tags` 供前端展示。

### 4.8 设置与每模型参数集存储 (settings-store.ts / model-params-store.ts / model-params-repository.ts / config-doctor.ts)

- **`settings-store.ts`**：`loadSettings()` / `saveSettings(settings)` / `getDefaultSettings()` / `healSettingsFile()`（供启动诊疗调用，见下）。持久化到 `~/.llama_launcher/settings.json`，写入为**原子替换**（`.tmp` + rename）+ **CAS 合并守卫**（写入前读取磁盘值作基线，其他实例的更新不丢），加载时逐字段归一化，损坏文件自动备份 `settings.json.bak`。schema 版本由 `SETTINGS_VERSION` 管理（变更走 `migrateSettings`）。含 `hf_mirror_host` 时同步 `setHfMirrorHost` 驱动镜像链路。字段全清单见 [data-persistence.md](data-persistence.md) §10。

- **`model-params-store.ts`（文件层）**：`modelParamsKey(modelPath)`（存储键 = 清洗后的模型文件名 + 规范化路径 sha1 前 8 位）/ `listModelParams(dir)` / `readModelParams(dir, modelPath)` / `writeModelParams(dir, params)` / `deleteModelParams(dir, modelPath)` / `parseModelParams(raw)`（垃圾清理器判孤儿/损坏用）/ `normalizeValues`。只负责「按模型路径派生键读写一个 JSON」与形状容错，不知道目录在哪、也不知道业务规则；mtime+原始字节双指纹解析记忆化保留。

- **`model-params-repository.ts`（领域层）**：`ModelParamsRepository` 接口 + `createModelParamsRepository(dir)`（测试可注入目录）/ `getModelParamsRepository()`（活目录单例）。业务对每模型参数的全部读写都走这层——`load(modelPath)`（未存储返回 null；**搬家重识别**：精确键未命中时按存储原路径的文件名找回并换键重写）/ `save(modelPath, values)`（upsert，渲染层 800ms 节流调用）/ `clear(modelPath)` / `deleteForModel(modelPath)`（路径前缀匹配，移除模型时同步清理）。**预设迁移**：`migratePresetsToModelParams(fromDir, toDir)` 把两代历史预设（`<models_dir>/presets` 与 `~/.llama_launcher/presets`）一次性并入活目录（同模型多条取 `saved_at` 最新——准确说：**同一来源目录内**比较 `saved_at`，两个历史位置按「模型目录版 → 集中目录版」依次执行，后一次写入会覆盖同名模型先前落下的参数集；迁入后源文件删除，无绑定/损坏文件原地保留；幂等，IPC 注册时执行一次）。上层（IPC/UI）不接触目录、键派生与文件布局——换存储介质只需换掉本层实现。详见 [data-persistence.md](data-persistence.md) §10。

- **`config-doctor.ts`（启动诊疗，2026-10-09 起）**：`runConfigDoctor()` 聚合入口（路径可注入供单测）——settings 侧委托 `healSettingsFile()`（损坏/形状非法 → 备份 `.bak` 后**立即重置为全新默认文件**；合法文件走 migrate + normalize，规范化结果与磁盘逐字节不一致才原子写回；**文件不存在时不代写**，返回 null 表示「没得可诊」），model-params 侧 `healModelParamsFile()`（损坏/形状非法 → 备份 `.bak` 并移出活集，回落出厂默认；`values` 里已删参数的残留键按 `PARAMS` 键集剥除写回）。两条纪律：**幂等**——内容与规范形一致时绝不写盘（不搅动 mtime 与读取缓存）；**不产文案**——报告 `ConfigDoctorReport` 只含 issue 种类与计数，主进程用 `tr()` 组装成应用日志（键 `applog_config_doctor_*` / `cfg_issue_*`）。调用点在 `app.whenReady` 内、`registerIpcHandlers()` **之前**（先把盘上的配置修干净，再让任何 IPC 去读它）。判据见 `packages/core/tests/config-doctor.test.ts`（临时目录注入：干净不动 / 版本随迁 + 未知键剥离一次写回且复跑必干净 / 损坏重置 / 形状非法 / 首启不代写 / 残留清理 / 聚合入口）。

### 4.9 可重试错误判定与指数退避 (retry.ts)

download-manager 与 huggingface-client 共用的网络韧性层（收敛两份近似实现，新增网络调用零成本复用）：

- `isRetryableError(err)`：`code/statusCode` 命中瞬时网络错误码（`ECONNRESET`/`ETIMEDOUT`/`EPIPE`/`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`）或可重试 HTTP 状态（408/429/500/502/503/504），或消息命中关键词（`timeout`/`econnreset`/`socket hang up`/`network` 等）。

- `retryDelayMs(attempt, baseMs=1000, maxMs=30000)`：`base × 2^attempt + 抖动(0–500ms)`，封顶 `maxMs`。huggingface-client 的重试即每跳递增 attempt。

### 4.10 下载续传事件日志 (download-log.ts)

下载任务断点续传的 **JSONL 事实源**（对应 DSH 的 append-only 会话日志理念）：

- 事件三型：`start`（含段布局，重放作基线）/ `segment`（段进度，append 落盘）/ `done`（终态，仅供诊断）。

- `appendDownloadEvent(localPath, event)` 追加一行（写入失败静默，不影响下载正确性）；`replayDownloadLog(localPath)` 以最后合法 `start` 为基线投影重建段进度（段进度越界行跳过，单调取最大值）；`deleteDownloadLog` 完成/取消时清理；`migrateLegacyMeta` 把旧版 `.llama_dl.json`（v1/v2 快照）一次性转换并删除旧文件（`.jsonl` 已存在则不覆盖）。

- 后缀常量：`DOWNLOAD_LOG_SUFFIX='.llama_dl.jsonl'`、`LEGACY_META_SUFFIX='.llama_dl.json'`（trash-cleaner 也按此识别下载残留）。
- **终态的 `errorType` 在恢复时归一化**：done 记录的 `errorType` 必须落在 `DOWNLOAD_ERROR_TYPES`（`shared` 的运行时成员表，联合类型由它派生）内才采信，脏值一律丢弃；旧日志（该字段加入前写的）只有 `error` 原文，`status==='error'` 时用 `classifyError(errorText)` 补分类——否则渲染端 `errorDisplay` 会退回显示未翻译的英文原文（`DownloadCard` 的 raw 回退分支）。

### 4.11 引擎回读对账 (server-props.ts)

- **作用**：服务进入 `running` 后向 `http://<displayHost>:<port>/props` 发一次 GET，把引擎**实际生效值**与启动器发出的值逐项对账；结果 `PropsCheck` 由 `Launcher.runPropsCheck` 以**补发一次同状态事件**的方式下发（回读是异步的，不阻塞状态迁移）。
- **映射表与比对规则都在 shared**（`params/props-mapping.ts` 的 `PROPS_FIELD_MAP` 与纯函数 `checkEngineProps`）：渲染层只拿数据出文案，符合「数据层不产文案」。
- **覆盖面**：映射 **15 项**（model / alias / ctx_size / temperature / top_k / top_p / min_p / repeat_penalty / presence_penalty / seed / ui / slots_endpoint / metrics / props_endpoint / parallel）。同一份真机 b11178 夹具按**现行规则**重算是 **9 项校验 + 6 项跳过 + 0 项不一致**（校验到的是 model / alias / temperature / top_k / seed / ui / slots_endpoint / metrics / props_endpoint；跳过的是 ctx_size（多槽⇒每槽值）+ 四个「值等于引擎缺省因而没上命令行」的采样项）。**其余约 55 项引擎根本不回读**，所以界面只在真的不一致时出声，绝不暗示"全部核对过"。
- **`modelDerived`：没发射时，「回读 ≠ 我们的缺省」有两个合法来源，分不出就不许出声**（2026-10-06 真机抓到）。GGUF 自带 `general.sampling.*` 时，引擎会拿模型推荐值顶掉缺省——实测（b11408 + Qwen3.8-27B-UD-Q2_K_XL，命令行未发 `--temp`/`--top-k`）回读 `temperature=1`、`top_k=20`，而引擎缺省是 0.8/40。这条差值既可能来自模型，也可能来自 `LLAMA_ARG_TEMPERATURE` 这类环境覆写，`/props` 本身给不出答案。所以这六项（成员清单 = `gguf-meta.ts` 里那六个源键，不是凭猜）标上 `modelDerived: { envChannel }`：**只有主进程检出的 `envOverrides` 命中该通道才参与比对**，否则计入 skipped。判据两头都钉住了——没命中不许假报，命中了不许哑掉（`Launcher` 把名单透传给 `verifyEngineProps` 的那条链路有独立用例，漏透传就红）。留作对照的是 `seed`：help 里它**没有** env 通道、模型也没有对应源键，所以"没发也比"仍然成立，「不发射时引擎做的是不是那个缺省值」这个前提还有人守。
- **`skipWhen` 是数据不是分支**：`ctx_size` ↔ `n_ctx` 在 `--fit` 为 `on`/`auto` 时不参与比对——引擎会按显存重算上下文长度，比了必假报。这类"引擎会自行改写的项"用表内声明表达，加参数不必再改判定代码。
- **复检由「页面真的可见」驱动，自动且自适应退避（2026-10-06 起）**：`Launcher.recheckProps()` 由 `server:status(refresh:true)` 调用，触发点是「卡片 `onActivated` → `server.enterPropsWatch()`」（概览状态卡与设置页的引擎提示行 `GeneralPanel` 各持一份幂等 release）、`status` 变 running、`host`/`port` 改动、窗口聚焦（`launcher-bridge` 的 `win.on('focus')` 直接调核心，渲染层在自己被聚焦前拿不到这个信号），（原先还有一个手动「重新校验」按钮作逃生阀，2026-10-06 按用户标注删除：自动刷新已覆盖该链路，按钮只剩操作摩擦；状态行也改成**没事不出声**——核对通过、还没轮到回读这些常态都不再显示提示）。节拍器在**渲染层**、核心零定时器：可见期间按 `15s×2^n` 退避、封顶 60s，结论指纹（`mismatched`/`error`/`baselineDrift`，**不含 `checkedAt`**）一变立刻回快档，`onDeactivated` 计数归零即清表——**后台页一个请求都不发**。这与 2026-09-25 删掉的「盲轮询」不是一回事：被删的是「无人看也敲、没在跑也敲、结论没变也敲」，本方案三闸门齐备，只保留「外部 `POST /props` 在本机没有事件源」那一处必需的下限节拍（与概览的外部实例探测同一条理由：那类事实本机没有可订阅的事件源，只能靠问）。之所以非要有个节拍：引擎参数只可能被外部 `POST /props` 改动，每分钟盲敲端口既抓不到规律也无事可报；而「有人在看的时候才要新鲜结论」正是可事件化的信号。**结果有序列化差异才补发同状态事件**（无变化不产生跨桥噪声），`PropsCheck.checkedAt` 随结果下发供界面标注新鲜度。
- **基线版本漂移也走这条链路**：`PropsCheck.baselineDrift` 比对 `/props` 的 `build_info` 与 `ENGINE_BASELINE_BUILD`，不一致时预览卡提示"参数基线可能已过期"——这张表是某版本 help 的快照，引擎一升级，那约 50 项不可回读参数的判定基准就不再可信，而这是**唯一**能在运行期发现此事的途径（开发期由 `verify-params-sync` ⑥ 守声明处一致）。
- **三处归一不做就天天假报**（都是真机抓到的形状）：float32 噪声（发 `0.95` 回读 `0.949999988079071`，容差 `PROPS_NUM_TOL = 1e-4`）；seed 的 uint32 环绕（发 `-1` 回读 `4294967295`）；Windows 路径分隔符与大小写（回读带双反斜杠，走 `normPath`）。
- **`onlyWhenSent` 项**（model / alias / parallel）：我们没发值时引擎会自行派生（别名取文件名、`-np -1` 自算槽数），此时比对必假报，一律计为 skip。
- **取数失败不等于不一致**：`error='unreachable' | 'bad_payload'` 且 `mismatched` 保持空——一次偶发网络失败不该让界面谎报"参数没生效"，那正是本项目一直在消灭的那类问题。
- **不需要为此开 `--props`**：该 flag 只控制 POST /props 改全局属性，`GET /props` 默认可读（实测 `endpoint_props=false` 时仍返回完整 JSON）。
- **`envOverrides` 从哪来**：`Launcher.start()` 里调 `detectLlamaEnvOverrides(process.env)`（`shared/params/engine-baseline.ts`）检出本次启动存在的 `LLAMA_ARG_*` 变量名，随 `ServerInfo.envOverrides` 下发，并在**设置页引擎目录行下方**明说「这些改写不会出现在命令行里」——它同时是 `modelDerived` 六项比对的前提（未发射的采样项只有在同名 env 通道被检出时才参与对账，否则计入跳过）。

- **单测必须注入 `propsFetcher`**：默认实现走全局 fetch，不注入就会真去请求本机 8080 上用户正在跑的实例（`launcher.test.ts` 的 14 处 `new Launcher(` 已全部注入桩，一处不剩）。

### 4.12 进程清理日志 (cleanup-logger.ts)

进程清理专用日志器：统一 `[cleanup:level]` 前缀 + 时间戳，四级（debug/info/warn/error），供 process-registry 的窗口关闭清理链路记录每一步 terminate / sweep 结果；`setCleanupLogLevel` 可调最低输出级别（开发可设 debug）。不引入外部依赖，仅封装 console。注意与 **`apps/desktop/src/main/app-log.ts`** 的区别：后者是**应用日志缓冲**（环形 2000 条 + `logs:*` IPC 推送到「日志」页），记录应用生命周期事件，不是进程清理调试日志。

### 4.13 应用生成文件清理 (trash-cleaner.ts)

「设置 → 关于 → 配置清理」的数据源（`system:detectTrash` / `system:cleanTrash` 委托），覆盖应用全部落盘位置：

- **双根扫描**：配置目录 `~/.llama_launcher/`（`settings.json` 白名单永不清理、`.bak/.tmp` 残留、**参数集活目录 `model-params/`** 的 `.tmp|*.bak` 残留/孤儿/损坏检测、`stats.jsonl`、根目录损坏 JSON）+ 模型目录（`*.part`、续传日志；参数集已独立成目录，模型目录不再有参数扫描，两代历史遗留的预设目录不列入清理）。

- **强校验**：路径必须严格位于声明根内且非符号链接；`cleanTrash` 对每个传入项按声明 `kind` 复核根归属与内容（孤儿参数集清理时刻重读，模型重新出现即放弃删除）；活动/暂停/可重试下载任务占用的路径由 `DownloadManager.getProtectedPaths()` 传入保护集，双重排除；未识别文件一律不列入（保守策略）。

- **逐项失败明细（2026-10-08）**：`CleanResult.failures` 为 `failed` 计数的展开——每项带 `path` 与固定枚举 `reason`（`revalidated` 复核未过 / `symlink` 符号链接 / `unsupported` 非 regular 文件 / `error` 删除抛错，此时 `detail` 携带系统原始报错文本）；渲染端按枚举 i18n 翻译（数据层不产文案）。

- 保护与完整 kind 清单见 [data-persistence.md](data-persistence.md) §10「应用生成文件全清单」。

### 4.14 关键类与函数索引

跨包的主要导出速查表（详见各模块章节）：

**`packages/core/src`（业务逻辑核心，`index.ts`** **统一 re-export）**

| 文件                      | 主要导出                                                                                                                                                            | 说明                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `paths.ts`              | `CONFIG_DIR`/`SETTINGS_FILE`/`MODEL_PARAMS_DIR`/`LEGACY_PRESETS_DIR`、`legacyModelsPresetsDir(modelsDir)`、`basenameSafe`                                        | 路径常量与解析；开发模式自动查找 `llama-*-bin-*` 最新目录 |
| `settings-store.ts`     | `loadSettings` / `saveSettings` / `getDefaultSettings` / `healSettingsFile`                                                                                        | 设置读写（CAS + 原子替换，§4.8）+ 启动诊疗的 settings 侧 |
| `config-doctor.ts`      | `runConfigDoctor` / `healModelParamsFile` / `ConfigDoctorReport` / `ConfigIssueKind`                                                                               | 配置诊疗：settings + model-params 逐文件诊断修复，报告只含 issue 种类与计数（§4.8） |
| `model-params-store.ts` | `modelParamsKey`/`listModelParams`/`readModelParams`/`writeModelParams`/`deleteModelParams`/`parseModelParams`/`normalizeValues`                                | 每模型参数集文件层（键派生/容错/记忆化，§4.8）      |
| `model-params-repository.ts` | `ModelParamsRepository`、`createModelParamsRepository`/`getModelParamsRepository`/`migratePresetsToModelParams`                                             | 每模型参数集领域层（load/save/clear/搬家重识别/预设迁移，§4.8） |
| `models-scanner.ts`     | `scanModels` / `detectMmproj` / `detectDraftModel` / `removeModelFile` / `invalidateScanCache` / `ensureDir`                                                    | .gguf 递归扫描 + 伴随检测 + 移除（§4.4）          |
| `command-builder.ts`    | `buildCommand` / `previewCommand`（argv 本体在 `shared/params/command.ts`）                                                                                                              | 启动命令构建的执行侧包装（§4.3）              |
| `server-props.ts`       | `verifyEngineProps` / `defaultPropsFetcher` / `PropsFetcher`                                                                                                                              | 就绪后 `GET /props` 回读，与发出的值对账（§4.11）  |
| `process.ts`            | `LlamaServerProcess` / `killProcessTree` / `SimpleProcessInfo` / `findDevSessionRoot` / `pickTurboDevRoot`                                                      | 子进程封装 + 两阶段终止（§4.1）                   |
| `launcher.ts`           | `Launcher`（`start`/`stop`/`restart`/`getStatus`）                                                                                                                | 启动编排状态机（§4.2）                         |
| `gguf-meta.ts`          | `readGgufMetadata` / `estimateModelParams` / `estimateQuantFromSize` / `nameContainsLabel` / `clearGgufCache`                                                   | GGUF 流式读取 + 建议推导（§4.5）                |
| `devices.ts`            | `listDevices` / `parseListDevicesOutput` / `serverExeName` / `candidateServerExes` / `resolveServerExe`                                                  | 显存探测：spawn `llama-server --list-devices`，解析每设备总/空闲 MiB（逐行容错，超时不抛出）。**探测用 exe 的解析有回退链**（`server_exe` → 其同目录 → `llama_dir` 根 → 一级子目录 → 开发态仓库根 `llama-*-bin-*`）并逐个校验存在——引擎目录改名/搬走时不再静默返回空；去重忽略分隔符差异（win32 `path.join` 出反斜杠、settings 存正斜杠） |
| `vram-estimate.ts`      | `estimateVram` / `estimateOccupancy` / `solveMaxContext` / `kvLayersOf` / `kvBytesPerTokenOf` / `KV_DTYPE_BYTES`                                                 | GGUF KV 内存模型 + 显存/内存双侧占用估算 + 无 OOM 最大上下文求解（联合预算） |
| `target-recommend.ts`   | `recommendForTarget`（四档 `PerfTarget`：max-context / balanced / latency / memory）                                                                              | 性能目标联动建议：按目标 dtype 在显存(+内存)预算内推算无 OOM 上下文与 KV 档位/卸载层数/MTP 策略。理由**不含文案**——下发 `reasonKey` + 仅含数值/枚举的 `reasonArgs`，渲染端 `t(reasonKey, reasonArgs)` 翻译（本模块曾内置 `TARGET_LABEL` 与中文模板串，英文界面直出中文，2026-09-21 硬编码审计后移出） |
| `llama-bench.ts`        | `runLlamaBench` / `parseLlamaBenchJson` / `summarizeBenchRows`                                                                                                   | llama-bench 离线体检：pp512/tg128 实测 prefill/decode（`-o json` 解析） |
| `bench-records.ts`      | `loadBenchRecords` / `saveBenchRecords` / `BENCH_RECORDS_MAX`                                                                                                    | 体检结果跨重启落盘（`~/.llama_launcher/bench-records.json`）：原子写不留 `.tmp`、缺失或半截 JSON 读回空数组、同一路径只留最近一条、超过 300 条按 `testedAt` 丢最旧的。主进程启动时用它回灌结果缓存，界面沿用 `system:benchLlamaStatus` 取回，**不为此新开 IPC 通道** |
| `url-parser.ts`         | `parseModelUrl`                                                                                                                                                 | 模型 URL 来源解析（§4.6）                     |
| `modelscope-client.ts`  | `searchModels` / `listModelFiles`（均走 `requestWithRetry` 指数退避重试）/ `buildDownloadUrl` / `buildModelPageUrl` / `formatFileSize`（别名 re-export shared `formatBytes`） | ModelScope API（§4.6）                  |
| `huggingface-client.ts` | `listHfFiles` / `buildHfDownloadUrl` / `buildHfModelPageUrl` / `setHfTransport` / `setHfMirrorHost` / `getHfMirrorHost` / `isHfMirrorHostname`                  | HF 镜像客户端（§4.6）                        |
| `download-manager.ts`   | `DownloadManager`（单例 `getDownloadManager`）/ `setDownloadTransport` / `DownloadTransport`                                                                        | 多任务断点续传（§4.6）                         |
| `download-log.ts`       | `appendDownloadEvent` / `replayDownloadLog` / `deleteDownloadLog` / `migrateLegacyMeta`                                                                         | 续传事件日志（§4.10）                         |
| `retry.ts`              | `isRetryableError` / `retryDelayMs`                                                                                                                             | 重试判定与退避（§4.9）                        |
| `error-classify.ts`     | `classifyError(err, httpStatus?)`                                                                                                                              | 把底层错误归类为 `DownloadErrorType`（下载失败诊断 + 旧日志恢复补齐类型）。单独成模块：`download-manager` 依赖 `download-log`，而 `download-log` 恢复时也要分类，反向引用会成环 |
| `types.ts`              | `LauncherEvent`                                                                                                                                                | 启动器事件名联合（`output` / `status` / `exit` / `error` / `command`） |
| `trash-cleaner.ts`      | `detectTrash` / `detectTrashAsync` / `cleanTrash` / `cleanTrashAsync`（`TrashScanOptions`；IPC 侧一律用异步版）                                              | 应用生成文件清理（§4.13）                       |
| `cleanup-logger.ts`     | `cleanupLogger`（debug/info/warn/error）/ `setCleanupLogLevel`                                                                                                    | 进程清理日志（§4.12）                         |

**`packages/shared/src`（类型/参数/i18n 唯一来源）**

| 文件                      | 主要导出                                                                                                                               | 说明                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `types/`                | `IPC`（56 通道）、`AppSettings`、`ParamDef`、`ModelParams`、`ServerInfo`、`OutputEntry`、`ModelInfo`、`GgufModelInfo`、`DownloadTask`、`TrashItem`、`HardwareOccupancy`/`VramEstimateResult`/`PerfTarget` 等 | 全部跨包类型（[data-persistence.md](data-persistence.md) §9） |
| `params/definitions.ts` | `PARAMS`（70：basic 27 / advanced 29 / server 14）/ `PARAM_GROUPS`（3 组）/ `MODEL_KEY` / `APP_VERSION` / `APP_NAME` / `APP_REPO_URL` + `LLAMA_CPP_RELEASES_URL` / `DEFAULT_HOST` + `DEFAULT_PORT` + `PORT_MIN` + `PORT_MAX` + `isValidPort()`（网络四项全部由 `host`/`port` 两条目派生）                  | 参数表唯一来源（[params-system.md](params-system.md)）。① 网络默认值与端口边界唯一来源：主进程/core/渲染层的回退值与范围校验一律引此，不再各写 `'127.0.0.1'` / `?? 8080` / `> 65535`（默认值曾散落 7 处、端口上界曾散落 5 处，漏改即出现「UI 探 8080、服务起在别端口」的假占用告警或「参数页允许、启动检查拒绝」的分裂）；② 对外链接唯一来源（llama.cpp 发布页曾在 AboutPanel 与 GeneralPanel 各写一份完整 URL）         |
| `params/engine-baseline.ts` | `PARAM_ENGINE_BASELINE`（`engineDefault` / `sentinel` / `note`）/ `engineDefaultOf` / `isSentinelValue` / `sameParamValue` / `ENGINE_BASELINE_BUILD` / `LLAMA_ENV_PREFIX` / `detectLlamaEnvOverrides` | 引擎缺省基线表：发射基准的唯一来源，与 `docs/params/llama-server-help-out.txt` 的 `(default: X)` 由 `verify-params-sync.cjs` 对拍（[params-system.md](params-system.md) §5.5） |
| `params/command.ts`     | `buildArgv` / `argvFromPreviewOptions`                                                                                                                    | 参数表 → argv 的**唯一**发射实现；执行方（core）与展示方（服务页预览、浏览器 mock）共用同一份，别处再抄一份会被门禁 ⑤ 判 fail（§4.3） |
| `params/props-mapping.ts` | `PROPS_FIELD_MAP`（15 项）/ `checkEngineProps`                                                                                                              | `/props` 回读的字段映射与比对规则（纯函数，含归一化与 `modelDerived`/`onlyWhenSent` 判据，§4.11） |
| `hosts.ts`              | `MODELSCOPE_HOST` / `DEFAULT_HF_MIRROR_HOST` / `normalizeMirrorHost(raw)` / `HF_SOURCE_HOST_SUFFIXES` + `MODELSCOPE_HOST_SUFFIX`                                                            | 下载源主机名与镜像回退唯一来源（core 客户端与 UI「在浏览器打开」外链共用，分叉会让下载走自建镜像而外链仍跳默认站）。**识别后缀与建站 host 分列两套**：建站用 `www.modelscope.cn`，粘贴 URL 的站点判定须用不含 www 的 `modelscope.cn` 后缀，否则裸域链接判为无法识别        |
| `settings-limits.ts`    | `DOWNLOAD_CONCURRENCY_DEFAULT/MIN/MAX/OPTIONS` + `clampDownloadConcurrency(n)`                                                                      | 应用设置的取值边界唯一来源：core 的 zod schema 与下载器钳制、设置页下拉同源（`ui ↛ core`，故常量必须在 shared）        |
| `i18n/`                 | `tr` / `trAt(lang, …)` / `setLang` + zh/en 字典                                                                                                        | 双语 UI 文案（`trAt` 供需要显式语言的纯函数使用，如 `time-format`；文案一律在此，数据层只发 key）                                              |
| `model-name.ts`         | `modelBaseName(modelPath)`                                                                                                         | 模型显示名/别名派生（alias 自动填充）                                |
| `model-relevance.ts`    | `categorizeFile` / `parseQuantization` / 相关性评分                                                                                     | 文件分类 + 量化标签解析（下载徽标）                                   |
| `format.ts`             | `formatBytes` / `formatDuration` 等跨包格式化                                                                                                        | 「单位 → 可读文本」的唯一收敛处（原先分散在 modelscope 客户端、下载卡、清理卡、服务页四处各写一份）；MB 起 2 位小数是硬要求，好让分类大小与总数肉眼可加 |
| `time-format.ts`        | `formatRelativeTime(input, lang)`                                                                                                  | 人性化时间格式化                                              |

**`apps/desktop/src/main`（Electron 主进程）**

| 文件                      | 主要导出                                                                                                                                                                                                                                          | 说明                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `index.ts`              | 入口逻辑（单实例锁 / `registerIpcHandlers` / `installHfTransport` + `installDownloadTransport` / `createMainWindow` / `launcherBridge`）                                                                                                                | 生命周期入口（[desktop-main.md](desktop-main.md) §6.1）     |
| `window.ts`             | `createMainWindow`（几何持久化，500ms 防抖）                                                                                                                                                                                                            | 窗口管理（§6.2）                                          |
| `ipc/index.ts`          | `registerIpcHandlers`（`ipcRegistrars` 装配 8 个域）                                                                                                                                                                                                | IPC 注册（§6.3，清单见 [ipc-channels.md](ipc-channels.md)） |
| `ipc/*.ts`              | `registerSettingsIpc` / `registerModelsIpc` / `registerModelParamsIpc` / `registerServerIpc` / `registerSystemIpc` / `registerWindowIpc` / `registerDownloadIpc` / `registerLogsIpc`；`models-watcher.ts` 的 `watchModelsDir`/`notifyModelsChanged` | 各功能域处理器                                             |
| `launcher-bridge.ts`    | `launcherBridge`（单例跨窗口共享 Launcher + 5000 条输出缓冲 + 16ms 批量推送 + `disposeSync`）                                                                                                                                                                   | 启动桥接（§6.4）                                          |
| `app-exit.ts`           | `requestExit` / `minimizeToTray` / `handleWindowClose` / `handleCloseDialogResult` / `isQuitting`                                                                                                                                             | 关闭行为分流 + 弹窗一问一答（§6.6）                               |
| `app-log.ts`            | `logApp` / `getAppLogs` / `clearAppLogs`                                                                                                                                                                                                      | 应用日志环形缓冲（2000 条）                                    |
| `process-registry.ts`   | `ProcessRegistry` / `processRegistry`（`associate`/`cleanupWindow`/`cleanupAll`/`countFor`/`listAlivePids`）                                                                                                                                    | 窗口↔进程关联 + 两阶段终止（§6.7）                               |
| `tray.ts`               | `createTray(win)`                                                                                                                                                                                                                             | 系统托盘保活（§6.8）                                        |
| `hf-transport.ts`       | `installHfTransport`                                                                                                                                                                                                                          | 注入 Electron `net` 传输（§4.6）                          |
| `download-transport.ts` | `installDownloadTransport`                                                                                                                                                                                                                    | 注入流式下载传输（§4.6）                                      |

**`packages/ui/src`（Vue 3 前端）**

| 目录             | 主要导出                                                                                                                                                                                                                                                             | 说明                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `stores/`      | `settings` / `i18n` / `params`（双轨）/ `server` / `download` / `appLog`                                                                                                                                                                                             | Pinia store（[frontend.md](frontend.md) §7.2） |
| `composables/` | `useIPC` / `useTheme` / `useStartServer` / `useConfirm` / `useFilePicker` / `useUrlHistory` / `useVramEstimate`                                                                                                     | IPC 调用与逻辑封装                                  |
| `features/`    | dashboard / models / service / params / logs / settings / webui 各 `FeatureDef` + `navItems`/`featureRoutes` 聚合                                                                                                                                                   | 功能注册表（侧栏导航 + 路由装配，§7.1）                      |
| `pages/`       | `DashboardPage` / `ModelsPage` / `ServicePage` / `ParamsPage` / `LogsPage` / `SettingsPage` / `WebUiPage`                                                                                                                                                        | 7 页面（§7.3）                                   |
| `components/`  | common（`PageFrame`/`Card`/`Icon`/`ToolTip`/`StatusTag`/`DownloadCard`/`ModelMetaCard`/`ConfirmModal`/`CloseDialog`/`FileBrowserModal`…）、layout（`Sidebar`/`TopBar`/`StatusBar`/`WebUiFrame`…）、service（`ServiceStatusCard`/`CommandPreviewCard`/`ParamSummaryCard`）、models（`LocalModelsPanel`/`LibraryPanel`）、settings（4 面板 + `TrashCleanCard` 目录清理卡，2026-10-08 自 service/ 迁入 settings/）、params 6 控件 + `ParamRow` | 组件库（§7.4）                                    |

