# 优化下载功能：性能 + 暂停/恢复 + 量化标签

## 背景

用户反馈当前下载引擎速度不如普通 HTTP 下载（浏览器/curl），且缺少单任务暂停/恢复功能，并希望对不同量化模型文件进行标签分类。当前 `download-manager.ts` 已实现分段多连接、断点续传元数据，但存在以下问题：

1. **性能瓶颈**：
   - `recomputeDownloadedSize()` 在每个 chunk 的 `res.on('data')` 中调用 `segments.reduce()`（[download-manager.ts:759, 864](file:///d:/DEV/llama_launcher/packages/core/src/download-manager.ts)），高频数据下产生不必要 CPU 开销。
   - `fs.existsSync(task.localPath)` 在每个段请求创建写入流时同步调用（[download-manager.ts:736, 843](file:///d:/DEV/llama_launcher/packages/core/src/download-manager.ts)），同步 I/O 在热路径上。
   - 写入流使用默认 `highWaterMark`（16KB），高带宽下载时频繁触发 pause/resume 背压循环。
   - `fs.truncateSync` 预分配产生稀疏文件，在 NTFS 上可能增加随机写碎片。

2. **缺少单任务暂停/恢复**：只有 `pauseAll()`（应用退出用），没有 `pauseDownload(id)` / `resumeDownload(id)`，无对应 IPC 通道和 UI 按钮。

3. **缺少量化标签**：`categorizeFile()`（[model-relevance.ts:9](file:///d:/DEV/llama_launcher/packages/shared/src/model-relevance.ts)）只按扩展名分类，不解析 Q4_K_M / FP16 / INT4 等量化标识；`ModelScopeFile` 无 `quantization` 字段；UI 只显示 `cat-gguf/safetensors/bin/other` 类别徽标。

## 实现方案

### 1. 下载引擎性能优化

**文件**：`packages/core/src/download-manager.ts`

#### 1.1 消除每 chunk 的 `recomputeDownloadedSize`

在 `res.on('data')` 中直接递增 `task.downloadedSize`，不再调用 `recomputeDownloadedSize`：

```ts
res.on('data', (chunk: Buffer) => {
  // ... 边界校验 ...
  const ok = stream.write(chunk);
  if (!ok) res.pause();
  segment.downloaded += chunk.length;
  task.downloadedSize += chunk.length;  // 直接递增，避免 reduce
});
```

`recomputeDownloadedSize` 仍保留，仅在 `loadMeta` 加载元数据后一次性计算（[download-manager.ts:603](file:///d:/DEV/llama_launcher/packages/core/src/download-manager.ts)）。

#### 1.2 移除热路径中的 `fs.existsSync`

在 `executeDownload` 中维护一个 `fileInitialized` 标记（通过闭包传递给段请求），避免每个段请求都调用 `fs.existsSync`：

```ts
const fileExists = fs.existsSync(task.localPath);
// 传给 runSegmentRequest，用于决定 flags
```

实际上更简单的做法：**统一使用 `r+` 模式**，在 `executeDownload` 开始时确保文件存在（`fs.openSync` + `fs.closeSync`），之后所有段都用 `r+`。对于单段下载也用 `r+`（文件已创建）。

#### 1.3 提高写入流 `highWaterMark`

```ts
const stream = fs.createWriteStream(task.localPath, {
  flags,
  start,
  highWaterMark: 4 * 1024 * 1024,  // 4MB，减少背压触发频率
});
```

#### 1.4 移除 `fs.truncateSync` 预分配

不再预分配整个文件大小。改为在 `executeDownload` 开始时创建空文件（`fs.openSync(localPath, 'w')` + `fs.closeSync`），让文件随段写入自然增长。多段模式下各段用 `r+` + `start` 写入各自区间，未写入区域为稀疏空洞（可接受）。

> 注：不移除 probe 探测请求——它是 1 字节 GET，开销可忽略（~200ms），但对决定是否分段至关重要。对于大文件（>100MB），200ms 相比几分钟下载时间无关紧要。

#### 1.5 `failTask` 保存元数据

在 `failTask` 中先保存一次元数据（如果段存在），确保失败后可从最近进度恢复：

```ts
private failTask(id: string, error: string) {
  const task = this.tasks.get(id);
  if (!task) return;
  this.saveMeta(id);  // 新增：失败前保存进度
  this.stopSpeedTracker(id);
  this.stopMetaTimer(id);
  // ... 其余不变 ...
}
```

### 2. 单任务暂停/恢复

#### 2.1 `DownloadManager` 新增方法

**文件**：`packages/core/src/download-manager.ts`

```ts
/** 暂停单个下载任务 */
pauseDownload(id: string): boolean {
  const task = this.tasks.get(id);
  if (!task) return false;
  if (task.status !== 'downloading' && task.status !== 'queued') return false;

  this.saveMeta(id);
  this.destroySegments(id);
  this.stopSpeedTracker(id);
  this.stopMetaTimer(id);

  if (task.status === 'downloading') {
    this.activeCount--;
  }
  task.status = 'paused';
  task.speed = 0;

  this.emit('progress', { id, downloadedSize: task.downloadedSize, totalSize: task.totalSize, speed: 0, status: 'paused' });
  this.tryStartNext();
  return true;
}

/** 恢复下载任务（含 error 状态的重试） */
resumeDownload(id: string): boolean {
  const task = this.tasks.get(id);
  if (!task) return false;
  if (task.status !== 'paused' && task.status !== 'error') return false;

  task.status = 'queued';
  task.error = '';
  this.tryStartNext();
  return true;
}
```

`executeDownload` 会通过 `loadMeta` 自动加载暂停时保存的元数据，从断点继续。

#### 2.2 新增 IPC 通道

**文件**：`packages/shared/src/types/ipc.ts` + `apps/desktop/src/preload/index.cjs`

在 `IPC` 对象中新增（两处必须同步，`verify-ipc-sync.cjs` 会检查）：

```ts
DOWNLOAD_PAUSE: 'download:pause',
DOWNLOAD_RESUME: 'download:resume',
```

#### 2.3 IPC 处理器

**文件**：`apps/desktop/src/main/ipc-handlers.ts`（在 `DOWNLOAD_CANCEL` 处理器后）

```ts
ipcMain.handle(IPC.DOWNLOAD_PAUSE, (_e, id: string) => {
  return { ok: true, data: downloadManager.pauseDownload(id) };
});
ipcMain.handle(IPC.DOWNLOAD_RESUME, (_e, id: string) => {
  return { ok: true, data: downloadManager.resumeDownload(id) };
});
```

#### 2.4 Preload 暴露

**文件**：`apps/desktop/src/preload/index.cjs`（`download` 对象内）

```js
pause: (id) => invoke(IPC.DOWNLOAD_PAUSE, id),
resume: (id) => invoke(IPC.DOWNLOAD_RESUME, id),
```

#### 2.5 UI Store + 卡片按钮

**文件**：`packages/ui/src/stores/download.ts`

```ts
async function pauseTask(id: string) {
  try { await window.api.download.pause(id); } catch {}
}
async function resumeTask(id: string) {
  try { await window.api.download.resume(id); } catch }
```

**文件**：`packages/ui/src/components/common/DownloadCard.vue`（`task-actions` 区域）

调整按钮显示逻辑：
- `downloading` / `queued`：显示「暂停」+「取消」
- `paused`：显示「恢复」+「取消」
- `error`：显示「重试」+「取消」（重试 = resume）
- `completed`：显示「打开目录」

#### 2.6 i18n

**文件**：`packages/shared/src/i18n/zh.ts` + `en.ts`

```ts
btn_pause_download: '暂停' / 'Pause',
btn_resume_download: '恢复' / 'Resume',
btn_retry_download: '重试' / 'Retry',
```

### 3. 量化标签分类

#### 3.1 解析函数

**文件**：`packages/shared/src/model-relevance.ts`

新增 `parseQuantization(fileName: string): string`，从文件名提取量化标识：

```ts
/** 从文件名解析量化类型标签 */
export function parseQuantization(fileName: string): string {
  const lower = fileName.toLowerCase();
  // GGUF 量化：Q4_K_M, Q5_K_S, Q6_K, Q8_0, IQ2_XX, IQ3_M, IQ4_XS, IQ4_NL, F16, F32
  const ggufMatch = lower.match(/[-_](q\d+_[a-z0-9]+(?:_[a-z0-9]+)*|iq\d+_[a-z0-9]+|f\d{2}|bf16|fp16|fp32)\b/);
  if (ggufMatch) return ggufMatch[1].toUpperCase().replace(/_/g, '_');
  // Safetensors / 其他：FP8, FP16, BF16, INT4, INT8
  const stMatch = lower.match(/[-_](fp8|fp16|bf16|int4|int8|fp32)\b/);
  if (stMatch) return stMatch[1].toUpperCase();
  return '';
}
```

匹配示例：
- `qwen2.5-7b-instruct-q4_k_m.gguf` → `Q4_K_M`
- `qwen_3_4b_fp8_mixed.safetensors` → `FP8`
- `model-q8_0.gguf` → `Q8_0`
- `model.F16.gguf` → `F16`

#### 3.2 类型扩展

**文件**：`packages/shared/src/types/download.ts`

`ModelScopeFile` 新增字段：

```ts
export interface ModelScopeFile {
  // ... 现有字段 ...
  /** 量化类型标签（如 Q4_K_M、FP16、INT4），无则为空 */
  quantization: string;
}
```

#### 3.3 填充量化字段

**文件**：`packages/core/src/modelscope-client.ts`（`listModelFiles` 中 `map` 回调）

```ts
const files: ModelScopeFile[] = (resp.Data.Files || [])
  .filter(...)
  .map((f: any) => {
    const filePath: string = f.Path ?? f.Name ?? '';
    return {
      // ... 现有字段 ...
      quantization: parseQuantization(filePath.split('/').pop() ?? ''),
    };
  });
```

需从 `@llama-launcher/shared` 导入 `parseQuantization`。

#### 3.4 UI 徽标

**文件**：`packages/ui/src/components/common/DownloadCard.vue`

在文件列表项的 `.file-cat` 徽标后新增量化徽标：

```html
<span v-if="f.quantization" class="file-quant">{{ f.quantization }}</span>
```

样式（在 `.file-cat` 样式后）：

```scss
.file-quant {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  border-radius: 3px;
  padding: 1px 5px;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.14);
  font-family: var(--font-mono);
  letter-spacing: 0.3px;
}
```

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/download-manager.ts` | 性能优化 + `pauseDownload`/`resumeDownload` + `failTask` 保存元数据 |
| `packages/shared/src/types/ipc.ts` | 新增 `DOWNLOAD_PAUSE` / `DOWNLOAD_RESUME` 通道 |
| `apps/desktop/src/preload/index.cjs` | 同步新增通道 + `pause`/`resume` 方法 |
| `apps/desktop/src/main/ipc-handlers.ts` | 新增 pause/resume 处理器 |
| `packages/ui/src/stores/download.ts` | 新增 `pauseTask` / `resumeTask` |
| `packages/ui/src/components/common/DownloadCard.vue` | 暂停/恢复/重试按钮 + 量化徽标 |
| `packages/shared/src/model-relevance.ts` | 新增 `parseQuantization` |
| `packages/shared/src/types/download.ts` | `ModelScopeFile` 新增 `quantization` 字段 |
| `packages/core/src/modelscope-client.ts` | `listModelFiles` 填充 `quantization` |
| `packages/shared/src/i18n/zh.ts` + `en.ts` | 新增 `btn_pause_download` / `btn_resume_download` / `btn_retry_download` |
| `packages/core/tests/download-manager.test.ts` | 新增 pause/resume 测试用例 |

## 验证

### 单元测试

```bash
pnpm --filter @llama-launcher/core test
```

新增测试：
- `pauseDownload` 后任务状态为 `paused`，文件和元数据保留。
- `resumeDownload` 后任务状态为 `queued`，从断点继续下载。
- 量化解析：`parseQuantization('model-q4_k_m.gguf')` === `'Q4_K_M'`。

### 全量验证

```bash
pnpm lint   # 含 IPC 同步检查（46 → 48 通道）
pnpm build
pnpm test
```

### 手动验证

1. `pnpm dev` → 进入模型下载页。
2. 下载一个 >100MB 的模型文件，观察速度是否改善。
3. 下载过程中点击「暂停」，确认进度保留、状态为「已暂停」。
4. 点击「恢复」，确认从断点继续。
5. 开始下载后关闭应用，重新打开，确认可从断点恢复。
6. 查看文件列表，确认不同量化文件显示对应标签（Q4_K_M、FP8 等）。
7. 失败任务点击「重试」可恢复下载。
