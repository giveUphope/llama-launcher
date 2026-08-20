# 核心模块详解

> 范围：核心业务模块：进程管理、启动编排、命令构建、模型扫描、GGUF 元数据、在线下载、路径解析、性能测试。
> 索引：[README.md](README.md) · 相关：[params-system.md](params-system.md) · [desktop-main.md](desktop-main.md)

### 4.1 进程管理 (process.ts)

`LlamaServerProcess` 类（extends `EventEmitter`），封装 `child_process.spawn`：

- **`start(opts)`**：spawn 子进程，配置 `windowsHide: true`、`shell: false`，避免额外 shell 层。
- **按行缓冲**：stdout/stderr 按行切分，通过 `output` 事件发射 `OutputEntry { kind, data, ts }`，避免半行输出污染日志。
- **`kill()`**：Windows 平台用 `taskkill /F /T /PID` 杀整个进程树（防止子进程残留），其他平台用 `SIGTERM`。
- **`isRunning()`**：判断条件为 `exitCode === null && !killed`。

### 4.2 启动编排 (launcher.ts)

`Launcher` 类（extends `EventEmitter`），实现状态机：

- **状态机**：`stopped → starting → running → stopped`
- **`start(opts)`**：调用 `buildCommand` 构建命令 → 创建 `LlamaServerProcess` → 监听 `output` 事件，匹配到 "listening" 关键词后切换到 `running`。
- **通用 listening 检测**：匹配同时包含 `"listening"` 与（`"http"` 或 `"server"`）的行，兼容所有版本的 llama-server 输出格式。
- **`stop()`**：调用 `proc.kill()`。
- **`restart(opts)`**：先 `stop`，等 `exit` 事件后再 `start`，确保端口释放。
- **`getStatus()`**：返回 `ServerInfo { status, pid, host, port, url }`。

### 4.3 命令构建 (command-builder.ts)

- **`buildCommand(opts)`**：校验 `exePath` 存在性，生成 `[exePath, '-m', modelPath, ...flags]` 数组。
- **启用状态机制**：从 `values._enabled`（JSON 字符串）解析启用的参数集合，未启用的参数跳过，不发射 flag。
- **向后兼容**：当无 `_enabled` 时，回退到"等于默认值则跳过"的旧逻辑。
- **checkbox**：总是发射 `flag`（true）或 `invert_flag`（false），保证开关状态显式传递。
- **float_slider**：保留 2 位小数，避免浮点精度问题导致命令字符串不稳定。
- **spec_type**：`draft-model` 向后兼容映射为 `draft-simple`。

### 4.4 模型扫描 (models-scanner.ts)

- **`scanModels(dir, opts)`**：递归扫描 `.gguf` 文件（异步 `fs/promises` 并行遍历，不阻塞主进程），跳过文件名含 `mmproj` / `projector` / `multimodal` 关键词的文件（多模态投影器）与 `dflash` / `draft` 关键词的草稿模型文件。结果按 `dir:mtimeMs` 缓存（上限 8 条），`invalidateScanCache()` 用于 `MODELS_WATCH` 失效。
- **目录不存在**：抛出 `DIR_NOT_FOUND` 错误码，`createIfMissing` 选项可自动创建目录。
- **`detectMmproj(modelPath)`**：在模型同目录查找 mmproj 文件，优先匹配文件名含 `"mmproj"` 的文件，用于自动关联多模态投影器。
- **`detectDraftModel(modelPath)`**：在模型同目录查找草稿模型文件（文件名含 `dflash` / `draft` 的 `.gguf`），优先选择含 `"dflash"` 的文件，用于自动关联 DFlash/推测解码草稿模型。
- **`removeModelFile(modelPath, modelsDir)`**：按模型文件移除。先判断模型所在目录内容——目录下存在其他内容（其他量化版本、用户创建的非 gguf 文件、子目录等）时**仅删除选中的模型文件**，保留其余内容；目录下无其他内容时删除模型文件 + 相关伴随 GGUF（mmproj/projector/multimodal 关键词的 `.gguf/.bin`、dflash/draft/mtp 关键词的 `.gguf`），空目录一并移除（返回 `removedDir`，供预设清理按目录前缀匹配）。安全约束：仅允许删除 modelsDir 内部路径，拒绝删除 modelsDir 本身。

### 4.5 GGUF 元数据读取 (gguf-meta.ts)

- **流式读取**：`BufferReader` 按 64KB 块按需加载文件内容，内存占用恒定，可读取数 GB 的模型文件。
- **版本兼容**：支持 GGUF v1 / v2 / v3，校验魔数 `0x46554747`（"GGUF" ASCII）。
- **跳过 ARRAY 类型**：tokenizer 等数组数据可达数 MB，仅跳过不读入内存。
- **提取 `GgufModelInfo`**：包含 59 个字段（架构、上下文长度、量化、采样参数、组织/许可证/数据集/分词器等）。
- **`buildSuggestions(info)`**：基于元数据推导 20+ 类建议参数（含上下文长度、聊天模板、采样温度/Top-K/Top-P/Min-P/重复惩罚/Mirostat/Typical 等）。
- **LRU 缓存**：上限 32 条，按 `filePath:mtimeMs:size` 为键，文件变更时自动失效。

### 4.6 在线下载 (download-manager.ts + modelscope-client.ts + url-parser.ts)

**`DownloadManager`**（单例，extends `EventEmitter`）：

- **多任务并发**：`maxConcurrent = 3`，超出排队。
- **多段并行下载**：动态段数算法 `computeSegmentCount` 按文件大小递增（<100MB→1 段、<1GB→2、<5GB→4、<20GB→6、≥20GB→8），再与 `SEGMENT_TARGET_SIZE`(50MB) 计算的目标段数取 `max`、与 `MIN_SEGMENT_SIZE_BYTES`(8MB) 的上限取 `min`，上限 32 段；worker 队列模型让并发 worker 数等于段数，每完成一段自动认领下一段，消除尾段瓶颈。`highWaterMark = 4MB` 减少写入系统调用。
- **断点续传**：检测已存在文件大小，携带 `Range` header；分段元数据持久化到 `.llama_dl.json`（v2 含 `source`/`createdAt`），失败/暂停后按段恢复。
- **临时文件命名**：下载中写入 `<file>.part`（`PART_SUFFIX`），完整性校验通过后同目录改名成最终 `.gguf`。未完整下载的文件始终是 `.part` 后缀，不会被模型管理扫描/监听当成 `.gguf` 检出（旧版本直接写目标文件名的未完成 `.gguf` 在续传时自动迁移为 `.part`）；完成改名触发模型目录监听，模型此时才出现在列表中。
- **暂停/恢复**：`pauseDownload(id)` 保存元数据并销毁活动请求；`resumeDownload(id)` 从 `paused`/`error` 状态恢复，支持失败重试。
- **HTTP 重定向跟随**：自动处理 30x 重定向（探测与段请求均支持）。
- **可注入传输层**：`DownloadTransport` 接口支持注入 Electron `net` 模块传输（Chromium 网络栈），仅 `hf-mirror.com` 走注入传输，其余源（ModelScope 等）走 `node:https`，规避 BoringSSL TLS 指纹被拒问题。
- **目录结构**：`models_dir/作者/模型仓库名/fileName`。
- **进度推送**：每 500ms 更新速度，emit `progress` / `complete` / `error` 事件；`errorType` 字段供前端显示友好诊断。
- **状态机**：`queued → downloading → completed`；可中断为 `paused` / `error` / `canceled`。

**`modelscope-client`**：匿名访问 ModelScope API，搜索模型、列出仓库文件。文件项包含 `quantization` 字段（由 `parseQuantization` 从文件名解析）。

**`huggingface-client`**：通过 `hf-mirror.com` 镜像访问 HuggingFace API（`/api/models/{ns}/{name}/tree/main?recursive=true`），列出仓库文件。支持可注入传输（`HfHttpTransport` / `setHfTransport`），Electron 主进程注入基于 `net` 模块的传输以规避 BoringSSL TLS 指纹被 hf-mirror.com 拒绝的问题；`redirect: 'follow'` 自动跟随 302 到 CDN。3 次指数退避重试。

**`url-parser`**：解析 LM Studio / HuggingFace / ModelScope 三种来源的模型 URL。`huggingface.co` 与 `hf-mirror.com` 均识别为 `source: 'huggingface'`，DownloadCard 跳过 ModelScope 搜索直接走 HF 镜像链路。

**`parseQuantization`**（shared/model-relevance.ts）：从文件名识别量化标签（Q4_K_M / IQ3_XS / FP8 / BF16 / INT4 等），返回 `{ label, bits, family }`。用于文件列表与下载任务的徽标展示。

### 4.7 路径解析 (paths.ts)

- **开发模式查找 llama-server**：扫描项目根目录下 `llama-*-bin-*` 目录，不限制版本号。
- **多版本选最新**：存在多个版本时按目录名降序排序，选最新版本。
- **生产模式**：返回空字符串，由用户在模型管理页选择引擎目录，内联检测机制自动查找 `llama-server.exe`。
- **`resolvePresetsDir(modelsDir)`**：返回 `modelsDir/presets`，预设文件存储在模型目录下的 presets 子目录。

### 4.8 性能测试 (bench-client.ts + BenchPanel.vue)

「参数设置 → 性能测试」标签封装了 llama-server 在线实测能力：

- **数据来源**（经 b10360 源码确认）：`llama-bench` 等 CLI **不支持 DFlash/推测解码评测**（零 spec/draft 支持），故采用运行中 llama-server 的 `--metrics` 端点（Prometheus）+ completion 响应 `timings`：
  - `llamacpp:prompt_tokens_seconds` / `llamacpp:predicted_tokens_seconds`（tok/s gauge）
  - `llamacpp:spec_decode_num_accepted_tokens_total` / `spec_decode_num_draft_tokens_total`（DFlash 接受率，与日志 `draft acceptance` 同源）
  - completion `timings`：`prompt_per_second` / `predicted_per_second` / `draft_n` / `draft_n_accepted`（单次请求准确值）
- **`bench-client.ts`**（主进程）：用 Electron `net` 模块发 HTTP（无 CORS 限制，支持 `api_key` Bearer 鉴权）；`fetchMetrics` 解析 Prometheus 文本，`runBench` 发非流式 `/v1/chat/completions` 读 timings，`runBenchConcurrent` 并行发 `concurrency` 个请求并聚合（tok/s 求和 = 多槽聚合吞吐，部分失败时聚合成功请求并记录 `failed`，全部失败抛错；并发请求超时放宽至 120s 以容纳槽位排队）。
- **`BenchPanel.vue`**（渲染进程）：
  - **动态参数**：`activeTuneParams` 跟随参数配置页已启用项，复用参数控件（SliderParam/IntEntryParam/DropdownParam/CheckboxParam/TextParam），交互与值完全一致
  - **智能启动检测**：服务未运行自动启动、运行中参数一致（含 `_enabled`）复用不重启、不一致则 `server.restart()`（core 等旧进程 exit 后启动新进程，避免 stop→start 竞态）
  - **`waitRunning` 两阶段等待**：restart 场景先等状态离开 running（旧进程退出）再等重新 running（新进程加载完成），避免旧 running 残留导致新进程模型未加载完就发请求；连续轮询 `stopped` + `pid === null` 判定启动失败（模型/参数配置错误），不长时间卡在等待
  - **单并发 + 多并发一体测试**：一次「运行测试」依次执行单并发（1 个请求）与多并发（并发数跟随 `-np`/parallel 值，>1 时取该值否则 4，上限 8）两个场景，历史表追加两条记录（多并发行带 ×N 后缀，部分请求失败时标注失败数）；不新增任何按钮/控件
  - **测试历史表格**：每次运行自动追加记录（含 `_enabled` 快照），展示生成/提示 tok/s、DFlash 接受率、生成 tokens、已启用参数摘要；内存态，关闭应用清空，可手动清空
  - **IPC**：`server:bench`（单并发 + 多并发两阶段）
