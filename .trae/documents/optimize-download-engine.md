# 优化模型下载引擎实现计划

## 背景与目标

当前 `packages/core/src/download-manager.ts` 的下载引擎存在以下效率瓶颈：

1. **单连接下载**：每个文件只建立一条 HTTPS 连接，无法充分利用高带宽网络。
2. **无连接复用**：每个请求新建 TCP/TLS 连接，握手开销大。
3. **无背压处理**：`res.on('data')` 中直接 `stream.write(chunk)`，大文件下载时可能堆积内存。
4. **失败即放弃**：网络抖动会直接导致任务失败，没有自动重试与段内续传。
5. **无法跨会话续传**：取消或异常退出后，仅保留部分文件；下次启动时若服务器不支持 Range 会从头下载。

本计划旨在通过**分段多连接下载、连接池 keep-alive、背压控制、自动重试与元数据续传**等手段提升下载速率与稳定性，同时保持现有 IPC 事件、类型与 UI 行为不变。

## 范围

**包含：**

* `packages/core/src/download-manager.ts` 核心重构

* `apps/desktop/src/main/index.ts` 应用退出时优雅暂停下载并保留元数据

* `packages/core/tests/download-manager.test.ts` 新增单元测试

**不包含（按用户决策）：**

* 不新增用户可调的下载设置项（连接数、重试次数使用内部默认值）

* 不改动 `packages/shared/src/types/settings.ts`、设置 Store、设置 UI 及 i18n

* 不改动 ModelScope 搜索/推荐逻辑（属于另一个目标）

## 默认参数

| 参数                            | 默认值    | 说明            |
| ----------------------------- | ------ | ------------- |
| `MAX_CONNECTIONS_PER_FILE`    | 4      | 单文件最大连接数      |
| `SEGMENT_THRESHOLD_BYTES`     | 100 MB | 文件大于此值才分段     |
| `MIN_SEGMENT_SIZE_BYTES`      | 8 MB   | 每段最小大小，防止分段过细 |
| `MAX_RETRIES`                 | 3      | 每段最大重试次数      |
| `RETRY_BASE_MS`               | 1000   | 退避基数          |
| `MAX_RETRY_DELAY_MS`          | 30000  | 最大退避延迟        |
| `KEEP_ALIVE_MAX_SOCKETS`      | 64     | 全局最大 socket 数 |
| `KEEP_ALIVE_MAX_FREE_SOCKETS` | 32     | 空闲 socket 上限  |

## 实现方案

### 1. 连接池（`https.Agent`）

在 `DownloadManager` 中维护一个私有 `https.Agent`：

```ts
private agent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 60000,
  scheduling: 'fifo',
});
```

所有 `https.request` 均传入该 agent，实现同一域名多任务/多段之间的 TCP 连接复用。`dispose()` 中调用 `agent.destroy()`。

### 2. 下载前探测（Probe）

任务启动后、分段前，对最终 URL 发起一次 `HEAD` 请求（跟随重定向），获取：

* 文件总大小 `totalSize`

* 是否支持 Range（`Accept-Ranges: bytes` 且返回 206）

* 最终 URL

若服务器返回 200 或不支持 Range，则回退到单连接顺序下载。

### 3. 分段策略

满足以下条件时启用分段：

* `totalSize` 已知

* `totalSize >= SEGMENT_THRESHOLD_BYTES`

* 服务器支持 Range

分段数计算：

```ts
n = min(MAX_CONNECTIONS_PER_FILE, floor(totalSize / MIN_SEGMENT_SIZE_BYTES))
n = max(1, n)
```

第 `i` 段范围：

```ts
start = floor(i * totalSize / n)
end   = floor((i + 1) * totalSize / n) - 1
lastSegment.end = totalSize - 1
```

### 4. 分段写入

* 下载开始前若启用分段，先用 `fs.truncateSync(localPath, totalSize)` 预分配空文件。

* 每段使用 `fs.createWriteStream(localPath, { flags: 'r+', start: segment.start + segment.downloaded })` 写入固定区间。

* 每段写入时校验 `position + chunk.length <= segment.end + 1`，超限时立即失败，防止文件污染。

* 单连接回退时沿用现有 `flags: 'a'` 续传逻辑。

### 5. 背压处理

```ts
res.on('data', (chunk) => {
  const ok = stream.write(chunk);
  if (!ok) res.pause();
});
stream.on('drain', () => res.resume());
```

每段独立管理背压，避免内存无限增长。

### 6. 重试与段内续传

可重试错误：

* 网络错误：`ECONNRESET`、`ETIMEDOUT`、`EPIPE`、`ECONNREFUSED`

* HTTP 状态码：`5xx`、`429`、`408`

不可重试错误：`400`、`403`、`404`、`416`、磁盘写入错误。

退避策略：

```ts
delay = min(MAX_RETRY_DELAY_MS, RETRY_BASE_MS * 2^attempt) + random(0, 500)
```

重试时按 `segment.start + segment.downloaded` 重新发起 Range 请求。

### 7. 断点续传元数据

路径：`<localPath>.llama_dl.json`

内容示例：

```json
{
  "version": 1,
  "url": "https://www.modelscope.cn/...",
  "totalSize": 53687091200,
  "segments": [
    { "start": 0, "end": 13421772799, "downloaded": 1200000000 },
    { "start": 13421772800, "end": 26843545599, "downloaded": 0 }
  ]
}
```

* 每段状态变化时异步写入，使用 `tmp + rename` 避免写坏。

* `startDownload` 检测到元数据存在时：校验结构、版本、URL、总大小、段范围；任一失败则删除元数据与部分文件重新下载。

* 任务完成时删除元数据；用户取消时删除部分文件 + 元数据。

### 8. 进度聚合

* `DownloadTask.downloadedSize` = 所有 `segment.downloaded` 之和。

* 复用现有 `startSpeedTracker`（每秒计算速度并推送 `progress` 事件）。

* UI 端 `DownloadCard.vue` 与 `download.ts` store 无需改动。

### 9. 取消与退出

* `cancelDownload(id)`：销毁该任务所有段请求与写入流，删除部分文件和元数据，触发 `tryStartNext()`。

* 新增 `pauseAll()`：销毁所有活动请求和写入流，停止速度统计，**保留**部分文件与元数据，供下次启动续传。

* `apps/desktop/src/main/index.ts` 的 `before-quit`、`will-quit`、SIGTERM/SIGINT 信号处理中调用 `getDownloadManager().pauseAll()`。

## 文件变更清单

### 修改文件

1. **`packages/core/src/download-manager.ts`**

   * 新增内部常量与 `https.Agent`

   * 新增 `DownloadSegment` 内部类（或同一文件内的类）

   * 新增 `probe()`、`saveMeta()`、`loadMeta()`、`pauseAll()` 等方法

   * 重构 `executeDownload()` 为探测 → 分段/单连接 → 调度执行

   * 在 `res.on('data')` 中加入背压处理

   * `failTask` 支持按错误类型决定是否重试

2. **`apps/desktop/src/main/index.ts`**

   * 导入 `getDownloadManager`

   * 在 `before-quit`、`will-quit`、信号处理器中调用 `getDownloadManager().pauseAll()`

### 新增文件

1. **`packages/core/tests/download-manager.test.ts`**

   * 使用 Node 内置 `http.createServer` 搭建本地服务器

   * 覆盖：分段下载、Range 不支持回退、断点续传、重试、取消、元数据保留

## 测试与验证

### 单元测试

```bash
pnpm --filter @llama-launcher/core test
```

新增测试用例：

1. 大文件被正确分成多段，最终文件内容与服务器文件一致。
2. 服务器返回 200 时回退为单连接下载，文件完整。
3. 模拟中断后保留 `.llama_dl.json`，重启任务只下载剩余部分。
4. 服务器前 N 次返回 500，第 N+1 次成功，任务最终完成。
5. 调用 `cancelDownload` 后部分文件与元数据均被删除。
6. 调用 `pauseAll()` 后请求被销毁，但文件与元数据保留。

### 手动验证

1. `pnpm dev` 进入「模型下载」页。
2. 选择 1–5 GB 的模型文件开始下载。
3. 观察下载速度是否提升；可用系统网络监控查看连接数是否大于 1。
4. 点击取消，确认部分文件与 `.llama_dl.json` 被删除。
5. 重新下载同一文件，确认从 0 开始。
6. 开始下载后直接关闭应用窗口，确认 `.llama_dl.json` 与部分文件保留。
7. 重新打开应用并再次开始同一文件下载，确认从上次进度续传。
8. 运行 `pnpm lint` 与 `pnpm test`，确认 IPC 同步与类型检查通过。

## 风险与回退

| 风险                           | 影响        | 回退方案                                   |
| ---------------------------- | --------- | -------------------------------------- |
| ModelScope CDN 对多连接限速或返回 200 | 下载失败或文件损坏 | 探测到非 206 即单连接回退；运行中收到 200 删除已下载段并单连接重下 |
| Windows 多写流锁/反病毒占用           | 写入报错      | 捕获 `EBUSY`/`EPERM`，重试后仍失败则降级为单连接顺序下载   |
| 元数据与实际文件不一致                  | 续传可能损坏    | 启动时严格校验 totalSize、段范围、文件大小，失败则删除重来     |
| 某一段反复失败耗尽重试                  | 整个任务失败    | 保留部分文件与元数据，用户可重新触发续传                   |
| 服务器返回不完整 Range               | 文件污染      | 每段写入时校验区间上限，超限立即失败                     |
| 连接池过大导致端口耗尽                  | 其他网络功能异常  | `maxSockets` 限制为 64，单文件最大 4 连接         |

