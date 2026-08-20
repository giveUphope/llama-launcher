# 模型下载模块优化计划

## Context

当前模型下载模块仅支持 ModelScope 单一来源,大文件下载效率与容错性有改进空间。本次优化围绕 8 个方向展开,目标是:① 新增 HuggingFace 镜像(hf-mirror.com)支持以加速访问;② 改善交互(拖拽输入);③ 提升传输效率(HTTP/2 多路复用、动态分段);④ 增强鲁棒性(失败诊断、元数据迁移、事件节流);⑤ 改善推荐准确性(多因子评分)。

所有修改遵循现有架构约束:`shared` 为类型单一来源、preload 必须保持 CommonJS、IPC 常量需双向同步(但 `verify-ipc-sync.cjs` 只校验常量名/值,不校验函数签名,因此可自由扩展 handler 参数)。

---

## 实现步骤

### 1. HuggingFace 镜像支持(hf-mirror.com)

**新增文件**:`packages/core/src/huggingface-client.ts`

镜像 `modelscope-client.ts` 的模式,实现:
- `listHfFiles(namespace, name): Promise<ModelScopeFileListResult>` — 调用 `GET https://hf-mirror.com/api/models/{ns}/{name}/tree/main?recursive=true`,返回 `[{ path, size, type, lfs? }]`。复用 `shared` 的 `categorizeFile` / `parseQuantization` / `formatFileSize` 将结果映射为现有 `ModelScopeFile[]` 结构(复用类型,避免新增)。
- `buildHfDownloadUrl(namespace, name, filePath): string` — 返回 `https://hf-mirror.com/{ns}/{name}/resolve/main/{filePath}`。
- 内部 `request()` 复用 modelscope-client 的 HTTPS+重定向模式。

**修改 `packages/shared/src/types/download.ts`**:
- `StartDownloadRequest` 新增 `source: 'modelscope' | 'huggingface'`(必填)。
- `DownloadTask` 新增 `source: 'modelscope' | 'huggingface'`(用于 UI 显示来源徽标 + 元数据持久化)。
- 新增 `DownloadSource` 类型别名,统一引用。

**修改 `packages/core/src/download-manager.ts`**:
- `startDownload()` 将 `req.source` 存入 task。
- 新增 `private buildDownloadUrlForTask(task): string` 分发器,根据 `task.source` 调用 `buildDownloadUrl`(modelscope)或 `buildHfDownloadUrl`(huggingface)。替换 `executeDownload()` L633 和 `saveMeta()` L513 中的直接 `buildDownloadUrl` 调用。

**修改 `apps/desktop/src/main/ipc-handlers.ts`**:
- `DOWNLOAD_LIST_FILES` handler 扩展为 `(_e, namespace, name, source)`,source 默认 `'modelscope'`。根据 source 分发到 `listModelFiles` 或 `listHfFiles`。

**修改 `apps/desktop/src/preload/index.cjs`**:
- `download.listFiles` 改为 `(namespace, name, source) => invoke(IPC.DOWNLOAD_LIST_FILES, namespace, name, source)`。

**修改 `packages/ui/src/components/common/DownloadCard.vue`**:
- `onSelectModel()` 调用 `listFiles(path, name, parsedInfo?.source ?? 'modelscope')`。
- `onDownloadSelected()` 构造 `StartDownloadRequest` 时传入 `source: parsedInfo.value?.source === 'huggingface' ? 'huggingface' : 'modelscope'`。
- 文件列表区标题旁显示来源徽标(`ModelScope` / `HF Mirror`)。
- 当 `source === 'huggingface'` 时,隐藏"在 ModelScope 打开"按钮,改为"在 HF Mirror 打开"。

---

### 2. URL 输入框拖拽支持

**修改 `packages/ui/src/components/common/DownloadCard.vue`**:
- 新增 `isDragging` ref,控制拖拽高亮样式。
- 在 `.url-row` 容器上添加 `@dragover.prevent`、`@dragenter.prevent="onDragEnter"`、`@dragleave.prevent="onDragLeave"`、`@drop.prevent="onDrop"`。
- `onDrop(e)`: 优先取 `e.dataTransfer.getData('text/uri-list')`,退化为 `getData('text/plain')`,trim 后赋给 `urlInput`,并自动调用 `onParseUrl()`。
- `onDragEnter/Leave` 用计数器避免子元素切换导致的闪烁(标准 dragenter/leave 抖动问题)。
- CSS: `.url-row.dragging` 加 `border-color: var(--accent)` + `background: var(--bg-active)`。

仅支持 URL 文本(用户已确认),不支持本地文件拖入。

---

### 3. HTTP/2 会话池

**新增文件**:`packages/core/src/http2-pool.ts`

```typescript
export class Http2SessionPool {
  private sessions = new Map<string, http2.ClientHttp2Session>(); // key = authority
  /** 发起 GET 请求,返回 { stream, headers, statusCode } */
  request(url: URL, headers: Record<string, string>): Promise<{
    stream: stream.Readable;
    headers: IncomingHttpHeaders;
    statusCode: number;
  }>;
  /** 关闭所有会话 */
  destroy(): void;
}
```

设计要点:
- 按 `authority`(如 `hf-mirror.com:443`)缓存 `http2.connect()` 会话。
- 会话 `error`/`close` 时从 Map 移除,下次请求自动重建。
- `request()` 内部:获取/创建会话 → `session.request(headers)` → 返回 Duplex 流。
- 不在池内处理重定向(重定向涉及跨 authority,由调用方决定跟随)。
- ALPN 协商失败时抛出明确错误,由调用方决定是否回退 https(本次不实现回退,hf-mirror/modelscope 均支持 h2)。

**修改 `packages/core/src/download-manager.ts`**:
- 新增 `private http2Pool = new Http2SessionPool()`。
- `probe()` 保持 `https.request`(仅需 1 次请求,重定向处理简单,无需 h2 收益)。
- `runSegmentRequest()` 和 `followSegmentRedirect()`:替换 `https.request` 为 `this.http2Pool.request(finalUrl, headers)`,直接拿 readable stream 接 `stream.on('data')`。删除 `agent` 字段引用(段请求不再用 https.Agent)。
- `dispose()` 增加 `this.http2Pool.destroy()`。
- 保留 `https.Agent` 给 probe 用,或也改为 http2(本次保留 https.Agent 给 probe,降低风险)。

**关键风险与处理**:
- h2 会话在长时间空闲后可能被服务端关闭 → `request()` 检测到 session `closed`/`destroyed` 时自动重建。
- 段内重定向(`followSegmentRedirect`)跨 authority 时,旧 session 自动释放,新 session 按新 authority 获取。

---

### 4. 推荐文件算法优化

**修改 `packages/shared/src/model-relevance.ts`**:

重写 `recommendFileName()`,引入多因子评分。新增内部函数:

```typescript
interface RecommendableFile { name: string; size?: number; category?: FileCategory; quantization?: QuantizationInfo | null; }

function scoreFileForRecommendation(file: RecommendableFile, keyword: string): number {
  // 1. 基础相关性(复用 scoreRelevance,0~1,权重 0.5)
  // 2. 类别偏好:gguf=1.0, safetensors=0.8, bin=0.6, other=0.3(权重 0.2)
  //    llama.cpp 优先 GGUF
  // 3. 量化偏好:Q4_K_M/Q5_K_M=1.0, Q6_K/Q8_0=0.85, Q3=0.7, Q2=0.5, FP8/BF16=0.6, 无量化=0.5(权重 0.2)
  //    Q4_K_M 是 llama.cpp 社区公认的甜点
  // 4. 关键词量化提示:若 keyword 含 "q4"/"fp8" 等且文件 quant 匹配,额外 +0.3(权重 0.1)
  // 5. 大小惩罚:size > 30GB 扣 0.1,size > 60GB 扣 0.2(避免推荐极端大文件)
}
```

`recommendFileName()` 改为:精确匹配优先(保留),否则按 `scoreFileForRecommendation` 取最高分(>0 才返回)。

**修改 `packages/ui/src/components/common/DownloadCard.vue`**:
- `recommendFileName` 调用点(L88, L171)传入完整 file 对象数组(含 size/category/quantization),而非仅 `{ name }`。
- 由于 `recommendFileName` 签名从 `{ name }[]` 扩展为 `RecommendableFile[]`,需同步更新 shared 导出的类型。

---

### 5. 并发与段数动态调整

**修改 `packages/core/src/download-manager.ts`**:
- 删除模块常量 `MAX_CONNECTIONS_PER_FILE = 4`。
- 新增 `computeSegmentCount(totalSize: number): number`:
  - `< 100MB` → 1
  - `< 1GB` → 2
  - `< 5GB` → 4
  - `< 20GB` → 6
  - `>= 20GB` → 8
- `createSegments()` 用 `computeSegmentCount(totalSize)` 替换 `MAX_CONNECTIONS_PER_FILE`,保留 `MIN_SEGMENT_SIZE_BYTES` 作为下限保护。
- `maxConcurrent` 改为可设置:新增 `setMaxConcurrent(n: number)` 方法,默认 3。`ipc-handlers.ts` 在注册下载 IPC 前从 settings 读取并调用。

**修改 `packages/shared/src/types/settings.ts`**:
- `AppSettings` 新增 `download_max_concurrent: number`。

**修改 `packages/core/src/settings-store.ts`**:
- `getDefaultSettings()` 新增 `download_max_concurrent: 3`。

**修改 `apps/desktop/src/main/ipc-handlers.ts`**:
- 初始化时 `downloadManager.setMaxConcurrent(settings.download_max_concurrent ?? 3)`。
- `SETTINGS_SAVE` handler 保存后同步调用 `downloadManager.setMaxConcurrent(newSettings.download_max_concurrent)`。

**修改 `packages/ui/src/components/layout/TopBar.vue`**(或设置入口):
- 在现有设置区(主题/语言旁)新增"最大并发下载"数字输入(1-5),绑定 `settings.download_max_concurrent`,变更时保存。

---

### 6. 失败诊断优化

**修改 `packages/shared/src/types/download.ts`**:
```typescript
export type DownloadErrorType =
  | 'network' | 'http_4xx' | 'http_5xx' | 'range_unsupported'
  | 'disk_full' | 'file_locked' | 'redirect_loop'
  | 'segment_overflow' | 'canceled' | 'unknown';
```
- `DownloadErrorPayload` 新增 `errorType: DownloadErrorType`。
- `DownloadTask` 新增 `errorType: DownloadErrorType | null`。

**修改 `packages/core/src/download-manager.ts`**:
- 新增 `classifyError(err: unknown, httpStatus?: number): DownloadErrorType`:
  - `ENOSPC` → `disk_full`
  - `EBUSY/EPERM/EACCES` → `file_locked`
  - `ECONNRESET/ETIMEDOUT/EPIPE/ECONNREFUSED/ENOTFOUND/EAI_AGAIN` → `network`
  - HTTP 408/429 → `http_4xx`(可重试)
  - HTTP 403/404 → `http_4xx`(不可重试)
  - HTTP 500/502/503/504 → `http_5xx`
  - `'Server does not support Range'` → `range_unsupported`
  - `'Too many redirects'` → `redirect_loop`
  - `'Segment received more data'` → `segment_overflow`
  - 其余 → `unknown`
- `failTask()` 调用 `classifyError` 填充 `task.errorType`,并传入 `DownloadErrorPayload.errorType`。
- `runSegmentRequest` reject 时附带 `statusCode`,便于分类。

**修改 `packages/shared/src/i18n/zh.ts` + `en.ts`**:
- 新增 `dl_err_network` / `dl_err_http_4xx` / `dl_err_http_5xx` / `dl_err_range_unsupported` / `dl_err_disk_full` / `dl_err_file_locked` / `dl_err_redirect_loop` / `dl_err_segment_overflow` / `dl_err_unknown` 9 条友好提示(含 remediation 建议,如"磁盘空间不足,请清理后重试")。

**修改 `packages/ui/src/components/common/DownloadCard.vue`**:
- `onError` handler 同步更新 `task.errorType`。
- 任务卡片 error 行:优先显示 `i18n.t('dl_err_' + errorType)`,原始 `task.error` 收进 tooltip。

---

### 7. 元数据兼容性优化

**修改 `packages/core/src/download-manager.ts`**:
- `META_VERSION` 升至 `2`。
- `DownloadMeta` 接口新增字段:
  - `source: 'modelscope' | 'huggingface'`
  - `checksum?: string | null`(预留,本次不实现校验)
  - `createdAt: number`
- 新增 `migrateMeta(raw: any): DownloadMeta | undefined`:
  - `raw.version === 1` → 补 `source: 'modelscope'`(v1 时代只有 ModelScope)、`checksum: null`、`createdAt: 0`,version 升 2。
  - `raw.version === 2` → 原样返回。
  - 其他 → `undefined`(不识别)。
- `loadMeta()` 调用 `migrateMeta` 替代直接校验 `meta.version !== META_VERSION`。迁移后的元数据会在下次 `saveMeta` 时以 v2 落盘。
- `saveMeta()` 写入 v2 全字段(含 `source` 从 `task.source` 取、`createdAt` 从 `task.createdAt` 取)。
- 续传时 `executeDownload` 根据 `meta.source` 校验 `task.source` 一致性(不一致则视为元数据失效,从头开始,避免跨源混用)。

---

### 8. 事件节流优化

**修改 `packages/core/src/download-manager.ts`**:

当前问题:`data` 事件每次 chunk(可达每秒数百次)都更新 `task.downloadedSize`,但该字段仅在 1s speedTracker 间隔被读取。per-chunk mutation 是无谓开销。

优化:
- **移除** `runSegmentRequest` / `followSegmentRedirect` 中 `task.downloadedSize += chunk.length`(L811, L917)。仅保留 `segment.downloaded += chunk.length`。
- `startSpeedTracker()` 间隔改为 500ms(更顺滑),内部调用 `this.recomputeDownloadedSize(id)`(已存在,L617-622)从所有段汇总 `task.downloadedSize`,再算速度并 emit progress。
- 段完成(`downloadSegment` 成功返回)、`pauseDownload`、`cancelDownload`、`failTask` 前,显式调用 `recomputeDownloadedSize(id)` 确保最终值准确。
- `speedTracker` 的 `lastBytes` 取自 `recomputeDownloadedSize` 后的 `task.downloadedSize`,保证速度计算基于汇总值。

效果:`task.downloadedSize` mutation 频率从 O(chunks/sec) 降至 O(2/sec),大文件下载时主进程 CPU 占用显著降低;UI 进度刷新 0.5s 一次更顺滑。

---

## 文件变更清单

| 文件 | 变更类型 | 涉及的优化项 |
|---|---|---|
| `packages/core/src/huggingface-client.ts` | 新增 | #1 |
| `packages/core/src/http2-pool.ts` | 新增 | #3 |
| `packages/core/src/download-manager.ts` | 修改 | #1 #3 #5 #6 #7 #8 |
| `packages/core/src/modelscope-client.ts` | 不变 | — |
| `packages/core/src/settings-store.ts` | 修改 | #5 |
| `packages/shared/src/types/download.ts` | 修改 | #1 #6 |
| `packages/shared/src/types/settings.ts` | 修改 | #5 |
| `packages/shared/src/model-relevance.ts` | 修改 | #4 |
| `packages/shared/src/i18n/zh.ts` | 修改 | #6 |
| `packages/shared/src/i18n/en.ts` | 修改 | #6 |
| `apps/desktop/src/main/ipc-handlers.ts` | 修改 | #1 #5 |
| `apps/desktop/src/preload/index.cjs` | 修改 | #1 |
| `packages/ui/src/components/common/DownloadCard.vue` | 修改 | #1 #2 #4 #6 |
| `packages/ui/src/components/layout/TopBar.vue` | 修改 | #5 |

**IPC 常量**:不新增通道(`DOWNLOAD_LIST_FILES` 复用,仅扩展参数),`verify-ipc-sync.cjs` 不受影响。

---

## 实施顺序

1. **shared 类型层**:`download.ts`(source/errorType)、`settings.ts`(max_concurrent)、`model-relevance.ts`(推荐算法) — 无依赖,先改。
2. **i18n**:zh/en 错误类型文案。
3. **core 客户端**:`huggingface-client.ts`(新)、`http2-pool.ts`(新)。
4. **core 下载管理器**:`download-manager.ts` 集中改造(分发器、h2、动态分段、错误分类、元数据 v2、事件节流)。
5. **main/preload**:`ipc-handlers.ts`(listFiles 分发、maxConcurrent 同步)、`index.cjs`(listFiles 签名)。
6. **UI**:`DownloadCard.vue`(拖拽、来源徽标、错误显示、推荐入参)、`TopBar.vue`(并发设置)。

---

## 验证方案

### 类型与 lint
- `pnpm lint` — 含 `turbo run lint` + `verify-ipc-sync.cjs`,必须通过。
- `pnpm --filter @llama-launcher/core lint` / `pnpm --filter @llama-launcher/ui lint` — 分包类型检查。

### 单元测试
- `pnpm test` — 现有 Vitest 测试必须通过。
- 建议为 `computeSegmentCount`、`classifyError`、`migrateMeta`、`scoreFileForRecommendation` 补充单元测试(放在 `packages/core` 或 `packages/shared` 既有测试目录)。

### 端到端手动验证
1. **HF 镜像下载**:粘贴 `https://huggingface.co/Qwen/Qwen3-4B` → 确认文件列表从 hf-mirror.com 拉取 → 下载一个 .gguf 文件 → 确认下载 URL 指向 hf-mirror.com → 速度对比 ModelScope 应有提升。
2. **ModelScope 兼容**:粘贴 ModelScope 链接 → 确认仍走 modelscope.cn,无回归。
3. **拖拽输入**:从浏览器地址栏拖拽 HF/ModelScope 模型页 URL 到输入框 → 自动填入并触发解析。
4. **HTTP/2**:下载大文件(>1GB)时用 Fiddler/Wireshark 或 Node `--inspect` 确认段请求复用单一 h2 会话(同 origin 仅 1 条 TCP)。
5. **动态分段**:下载 100MB / 1GB / 10GB / 50GB 文件,确认段数分别为 1 / 2 / 4-6 / 8。
6. **失败诊断**:断网下载 → `errorType: 'network'`;下载到磁盘满 → `errorType: 'disk_full'`;UI 显示友好提示而非原始错误。
7. **元数据兼容**:用 v1 元数据文件(可手动构造)启动续传 → 确认迁移到 v2 且续传成功;跨 source 续传(元数据 source=modelscope,task source=huggingface)→ 确认从头开始。
8. **事件节流**:下载大文件时观察主进程 CPU 占用,对比优化前后应下降;UI 进度条 0.5s 刷新一次,无卡顿。
9. **并发设置**:在设置区调整 max_concurrent 为 1/3/5,启动多任务,确认并发数匹配。
10. **打包验证**:`pnpm dist` 后启动打包应用,确认下载功能正常(尤其 h2 在打包环境下的行为)。
