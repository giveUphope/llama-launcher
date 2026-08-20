// 下载管理器:多任务并发下载,支持进度推送、断点续传、嵌套目录创建
// 目录层级:models_dir/author/modelName(file without .gguf)/file.gguf

/**
 * 下载中临时文件后缀：下载过程写入 `<file>.part`，完成后才改名成最终的 `.gguf`。
 * 未完整下载的文件始终以 .part 结尾，不会被模型管理扫描/监听当成 .gguf 检出，
 * 避免模型列表出现无法正常运行的损坏模型。
 */
const PART_SUFFIX = '.part';

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientRequest, RequestOptions, IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import type {
  StartDownloadRequest,
  DownloadTask,
  DownloadStatus,
  DownloadSource,
  DownloadErrorType,
  DownloadProgressPayload,
  DownloadCompletePayload,
  DownloadErrorPayload,
} from '@llama-launcher/shared';
import { buildDownloadUrl } from './modelscope-client.js';
import { buildHfDownloadUrl, isHfMirrorHostname } from './huggingface-client.js';
import {
  appendDownloadEvent,
  deleteDownloadLog,
  migrateLegacyMeta,
  replayDownloadLog,
} from './download-log.js';
import { isRetryableError, retryDelayMs } from './retry.js';

/**
 * 下载传输抽象。
 *
 * 设计动机:与 huggingface-client 的 HfHttpTransport 相同 —— Electron 33 内置 Node
 * 使用 BoringSSL,其 TLS ClientHello 会被 hf-mirror.com 直接 RST,导致 `node:https`
 * 与 `node:http2` 在 Electron 主进程内 100% 失败。系统 Node(OpenSSL)则正常。
 *
 * 解决:在 Electron 主进程启动时注入基于 Electron `net` 模块(Chromium 网络栈,
 * TLS 指纹同 Chrome)的传输实现。测试/非 Electron 环境使用默认的 `node:https` 传输。
 *
 * 与 HfHttpTransport 的区别:下载需要流式响应(文件可达 20GB+),故返回 Readable
 * 而非完整 body 字符串;另提供 cancel() 以便 pause/cancel 时中止底层请求。
 */
export interface DownloadTransport {
  /**
   * 发起单次 GET 请求(不跟随重定向,由调用方处理)。
   * @param url 完整 URL
   * @param headers 请求头(如 Range、User-Agent)
   * @param timeoutMs 超时毫秒
   * @returns statusCode 状态码;headers 响应头;body 响应体可读流(调用方负责消费/销毁);cancel 中止底层请求
   */
  request(
    url: string,
    headers: Record<string, string>,
    timeoutMs?: number,
  ): Promise<{
    statusCode: number;
    headers: IncomingHttpHeaders;
    body: Readable;
    cancel(): void;
  }>;
}

/** 默认 Node https 传输(测试 / 非 Electron 环境用) */
const nodeHttpsDownloadTransport: DownloadTransport = {
  request(url, headers, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (e) {
        reject(e);
        return;
      }
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers,
          agent: false,
          timeout: timeoutMs,
        },
        (res) => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: res,
            cancel: () => req.destroy(),
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Request timeout (${timeoutMs}ms) for ${url}`)));
      req.on('error', reject);
      req.end();
    });
  },
};

/** 当前注入的下载传输(默认 Node https) */
let _downloadTransport: DownloadTransport = nodeHttpsDownloadTransport;

/**
 * 注入下载传输。Electron 主进程启动时(app.whenReady 后)调用,注入基于 `net`
 * 模块的实现以绕开 BoringSSL 指纹被 hf-mirror.com reset 的问题。
 */
export function setDownloadTransport(t: DownloadTransport): void {
  _downloadTransport = t;
}

/**
 * 判断是否对该 URL 使用注入传输(Electron net 模块)。
 * 仅 hf-mirror.com 镜像走传输:Electron 33 的 BoringSSL ClientHello 会被该域 RST,
 * 必须用 Chromium 网络栈(TLS 指纹同 Chrome);其余源(modelscope.cn 等)接受
 * BoringSSL,继续走 node:https(HTTP/1.1),保证兼容性与测试 mock 可用。
 */
function shouldUseTransport(url: URL): boolean {
  // 当前配置的镜像源（默认 hf-mirror.com，可经 settings.hf_mirror_host 自定义）
  // 必须走注入传输(Electron net,Chromium 网络栈),否则 BoringSSL 指纹被 RST;
  // 其余源(modelscope 等)走 node:https(HTTP/1.1),保持测试 mock 兼容
  return isHfMirrorHostname(url.hostname);
}

/** 下载事件类型 */
export type DownloadEvent =
  | { type: 'progress'; payload: DownloadProgressPayload }
  | { type: 'complete'; payload: DownloadCompletePayload }
  | { type: 'error'; payload: DownloadErrorPayload };

/** 下载段 */
interface Segment {
  /** 段起始字节(含) */
  start: number;
  /** 段结束字节(含);Infinity 表示未知大小 */
  end: number;
  /** 本段已下载字节数 */
  downloaded: number;
  /** 当前重试次数 */
  retryCount: number;
  /** 当前活动的请求流(https ClientRequest 或 h2 响应流,均有 destroy()) */
  req?: { destroy(): void };
  /** 当前活动的写入流 */
  stream?: fs.WriteStream;
  /** 工作队列标记:true 表示已被某个 worker 认领,正在下载 */
  busy?: boolean;
}

/** 探测结果 */
interface ProbeResult {
  /** 最终 URL(跟随重定向后) */
  finalUrl: URL;
  /** 文件总大小 */
  totalSize: number;
  /** 是否支持 Range */
  supportsRange: boolean;
}

// ---------------- 默认配置 ----------------

/** 单文件最小分段大小 */
const MIN_SEGMENT_SIZE_BYTES = 8 * 1024 * 1024;
/** 段目标大小:每段约 100MB,使段数 >> worker 数,worker 完成一段后取下一段,消除尾段瓶颈。
 *  50MB→100MB:5GB 文件从 100 段(capped 32)变为 50 段(capped 32),段大小从 160MB→160MB 不变;
 *  但 1-2GB 文件段数减半,减少段切换开销(关闭/打开 write stream + 新 HTTP 请求)。 */
const SEGMENT_TARGET_SIZE = 100 * 1024 * 1024;
/** 段数上限:防止超大文件产生过多段(元数据膨胀/请求开销) */
const SEGMENT_MAX_COUNT = 32;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
/** 速度统计/进度推送间隔(节流:从 1s 降至 500ms 更顺滑) */
const PROGRESS_INTERVAL_MS = 500;

// ---------------- 辅助函数 ----------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 根据文件总大小动态计算分段数
 * - < 100MB → 1 段(小文件无需多段)
 * - < 1GB → 2 段
 * - < 5GB → 4 段
 * - < 20GB → 6 段
 * - >= 20GB → 8 段(大文件充分利用带宽)
 */
function computeSegmentCount(totalSize: number): number {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  if (totalSize < 100 * MB) return 1;
  if (totalSize < 1 * GB) return 2;
  if (totalSize < 5 * GB) return 4;
  if (totalSize < 20 * GB) return 6;
  return 8;
}

/**
 * 错误分类:将底层错误归类为友好诊断类型
 * @param err 原始错误
 * @param httpStatus HTTP 状态码(可选,来自段请求 reject 时附带)
 */
function classifyError(err: unknown, httpStatus?: number): DownloadErrorType {
  if (!err) return 'unknown';
  const code = (err as any)?.code ?? (err as any)?.statusCode;
  const message = ((err as Error)?.message ?? String(err)).toLowerCase();

  // 磁盘空间不足
  if (code === 'ENOSPC') return 'disk_full';
  // 文件被占用(Windows 常见)
  if (['EBUSY', 'EPERM', 'EACCES'].includes(code)) return 'file_locked';
  // 网络层错误
  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return 'network';
  }
  // HTTP 状态码分类
  if (httpStatus) {
    if (httpStatus >= 500 && httpStatus < 600) return 'http_5xx';
    if (httpStatus >= 400 && httpStatus < 500) return 'http_4xx';
  }
  if (typeof code === 'number') {
    if (code >= 500 && code < 600) return 'http_5xx';
    if (code >= 400 && code < 500) return 'http_4xx';
  }
  // 消息匹配
  if (message.includes('does not support range')) return 'range_unsupported';
  if (message.includes('too many redirects')) return 'redirect_loop';
  if (message.includes('more data than expected')) return 'segment_overflow';
  if (message.includes('timeout') || message.includes('network')) return 'network';
  return 'unknown';
}

/**
 * 流式计算文件 SHA-256（hex，小写），恒定内存（不整读大文件）。
 * 读取失败（文件被占用/被删除）返回 null，调用方按「无法校验」处理而非失败。
 */
function computeFileSha256(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', () => resolve(null));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ---------------- 下载管理器 ----------------

/** 下载管理器:单例,管理所有下载任务 */
export class DownloadManager extends EventEmitter {
  private tasks = new Map<string, DownloadTask>();
  private activeRequests = new Map<string, ClientRequest>();
  private writeStreams = new Map<string, fs.WriteStream>();
  private speedTrackers = new Map<
    string,
    {
      lastBytes: number;
      lastTime: number;
      interval: NodeJS.Timeout;
      /** EMA 平滑速度:消除单次采样的 burst/idle 跳动,显示更稳定 */
      smoothedSpeed: number;
    }
  >();
  private taskSegments = new Map<string, Segment[]>();
  /** 每任务期望校验和(来自 startDownload 请求,源 API 提供时生效) */
  private expectedChecksums = new Map<string, string | null>();
  private maxConcurrent = 3;
  private activeCount = 0;

  /** HTTPS Agent(probe 与段下载的 HTTP/1.1 分支:modelscope.cn 等,非 hf-mirror) */
  private agent = new https.Agent({
    keepAlive: true,
    maxSockets: 64,
    maxFreeSockets: 32,
    timeout: 60000,
    scheduling: 'fifo',
  });

  /** 设置最大并发任务数(由 settings.download_max_concurrent 驱动) */
  setMaxConcurrent(n: number): void {
    if (typeof n !== 'number' || n < 1) return;
    this.maxConcurrent = Math.min(5, Math.max(1, Math.floor(n)));
    // 设置后立即尝试启动队列中的任务(可能允许更多任务并发)
    this.tryStartNext();
  }

  /**
   * 根据任务来源构造下载 URL(分发器)
   * ModelScope 任务走 modelscope.cn,HuggingFace 任务走 hf-mirror.com
   */
  private buildDownloadUrlForTask(task: DownloadTask): string {
    const parts = task.modelId.split('/');
    const namespace = parts[0];
    const name = parts.slice(1).join('/');
    if (task.source === 'huggingface') {
      return buildHfDownloadUrl(namespace, name, task.filePath);
    }
    return buildDownloadUrl(namespace, name, task.filePath);
  }

  /** 获取所有任务列表 */
  getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 获取单个任务 */
  getTask(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  /** 清除已完成/已取消/已失败的任务 */
  clearFinished(): DownloadTask[] {
    const finishedStatuses: DownloadStatus[] = ['completed', 'canceled', 'error'];
    for (const [id, task] of this.tasks) {
      if (finishedStatuses.includes(task.status)) {
        // 防御性清理：确保残留段、流句柄不会继续占用资源
        this.destroySegments(id);
        this.stopSpeedTracker(id);
        this.expectedChecksums.delete(id);
        this.taskSegments.delete(id);
        this.tasks.delete(id);
      }
    }
    return this.getAllTasks();
  }

  /**
   * 启动一个下载任务
   * 目录结构:models_dir/作者/模型仓库名/fileName
   * 同一模型仓库的所有文件(权重、mmproj 等)都放在同一子目录下
   */
  async startDownload(req: StartDownloadRequest): Promise<string> {
    const id = randomUUID();

    // 计算目标目录:模型目录/作者/模型仓库名(而非文件名)
    // 这样同一模型仓库的权重文件和多模态文件会放在同一目录下
    const targetDir = path.join(req.modelsDir, req.namespace, req.name);

    // 创建嵌套目录
    fs.mkdirSync(targetDir, { recursive: true });

    const localPath = path.join(targetDir, req.fileName);
    const partPath = localPath + PART_SUFFIX;

    // 去重：同一目标文件已有 queued/downloading/paused 任务时返回其 ID，避免重复下载写冲突
    for (const [, existingTask] of this.tasks) {
      if (
        existingTask.localPath === localPath &&
        (existingTask.status === 'queued' || existingTask.status === 'downloading' || existingTask.status === 'paused')
      ) {
        return existingTask.id;
      }
    }

    // 来源(默认 modelscope,向后兼容)
    const source: DownloadSource = req.source === 'huggingface' ? 'huggingface' : 'modelscope';

    // 检查断点续传:下载中文件写入 partPath(.part),优先检查它。
    // 旧版本把未完成的 .gguf 直接写在目标路径,会导致模型管理提前检出损坏文件——
    // 检测到未完整的目标文件时先迁移为 part 文件再续传(完整文件走下方快路径)。
    let downloadedSize = 0;
    if (fs.existsSync(partPath)) {
      downloadedSize = fs.statSync(partPath).size;
    } else if (fs.existsSync(localPath)) {
      downloadedSize = fs.statSync(localPath).size;
      if (downloadedSize < (req.fileSize || Infinity)) {
        fs.renameSync(localPath, partPath);
      }
    }
    // 若已下载完整(目标文件或 part 文件大小达标),直接标记完成
    if (downloadedSize >= req.fileSize && req.fileSize > 0) {
      // part 临时文件已完整(上次完成前异常退出):改名到目标路径后走完成快路径
      if (!fs.existsSync(localPath) && fs.existsSync(partPath)) {
        fs.renameSync(partPath, localPath);
      }
      const task: DownloadTask = {
        id,
        modelId: req.modelId,
        filePath: req.filePath,
        fileName: req.fileName,
        totalSize: req.fileSize,
        downloadedSize: req.fileSize,
        speed: 0,
        status: 'completed',
        source,
        localPath,
        partPath,
        error: '',
        errorType: null,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      this.tasks.set(id, task);
      // 已有文件也做完整性校验:提供期望校验和且不匹配时,标记 error 而非静默完成
      let checksum: string | null = null;
      if (req.expectedChecksum) {
        checksum = await computeFileSha256(localPath);
        if (checksum && checksum !== req.expectedChecksum) {
          task.status = 'error';
          task.error = `Checksum mismatch: expected ${req.expectedChecksum}, got ${checksum}`;
          task.errorType = 'checksum_mismatch';
          task.completedAt = null;
          this.emit('error', {
            id,
            error: task.error,
            errorType: 'checksum_mismatch',
          } satisfies DownloadErrorPayload);
          return id;
        }
      }
      // 清理可能残留的续传日志(文件已完整,日志无意义)
      deleteDownloadLog(localPath);
      this.emit('complete', {
        id,
        localPath,
        modelId: req.modelId,
        fileName: req.fileName,
        checksum,
      } satisfies DownloadCompletePayload);
      return id;
    }

    const task: DownloadTask = {
      id,
      modelId: req.modelId,
      filePath: req.filePath,
      fileName: req.fileName,
      totalSize: req.fileSize,
      downloadedSize,
      speed: 0,
      status: 'queued',
      source,
      localPath,
      partPath,
      error: '',
      errorType: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    this.tasks.set(id, task);
    this.expectedChecksums.set(id, req.expectedChecksum ?? null);

    // 尝试开始下载(若并发已满,保持 queued 状态)
    this.tryStartNext();

    return id;
  }

  /** 取消下载任务 */
  cancelDownload(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    // 已完成/已取消的任务无需再处理；error 任务允许取消（清理残留文件，避免后续冲突）
    if (task.status === 'completed' || task.status === 'canceled') {
      return false;
    }

    // 保存取消前的状态，用于 activeCount 判断（之后会被覆盖为 'canceled'）
    const prevStatus = task.status;

    // 停止所有段（error 任务已在 failTask 中清理，此处安全空转）
    this.destroySegments(id);

    // 停止速度统计（error 任务已在 failTask 中清理，此处安全空转）
    this.stopSpeedTracker(id);

    // 汇总一次 downloadedSize(取消前确保进度准确)
    this.recomputeDownloadedSize(id);

    // 删除部分下载文件与事件日志
    this.deletePartials(task.partPath);
    deleteDownloadLog(task.localPath);
    this.expectedChecksums.delete(id);
    this.taskSegments.delete(id);

    task.status = 'canceled';
    task.speed = 0;
    this.emit('progress', {
      id,
      downloadedSize: task.downloadedSize,
      totalSize: task.totalSize,
      speed: 0,
      status: 'canceled',
    } satisfies DownloadProgressPayload);

    // activeCount 仅对 downloading 状态的任务计过数：
    // queued 未计、paused 已在 pauseDownload 中递减、error 已在 failTask 中递减
    if (prevStatus === 'downloading') {
      this.activeCount--;
    }
    this.tryStartNext();
    return true;
  }

  /** 暂停所有活动下载并保留断点元数据（应用退出时调用） */
  pauseAll(): void {
    for (const [id, task] of this.tasks) {
      if (task.status !== 'downloading' && task.status !== 'queued') continue;

      // 汇总一次 downloadedSize,并把当前各段进度追加为事件(确保暂停后崩溃不丢进度)
      this.recomputeDownloadedSize(id);
      this.logCurrentProgress(id);

      // 停止所有段
      this.destroySegments(id);
      this.stopSpeedTracker(id);

      if (task.status === 'downloading') {
        this.activeCount--;
      }
      task.status = 'paused';
      task.speed = 0;

      this.emit('progress', {
        id,
        downloadedSize: task.downloadedSize,
        totalSize: task.totalSize,
        speed: 0,
        status: 'paused',
      } satisfies DownloadProgressPayload);
    }
  }

  /** 暂停单个下载任务 */
  pauseDownload(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status !== 'downloading' && task.status !== 'queued') return false;

    // 汇总一次 downloadedSize,并把当前各段进度追加为事件(确保暂停后崩溃不丢进度)
    this.recomputeDownloadedSize(id);
    this.logCurrentProgress(id);
    this.destroySegments(id);
    this.stopSpeedTracker(id);

    if (task.status === 'downloading') {
      this.activeCount--;
    }
    task.status = 'paused';
    task.speed = 0;

    this.emit('progress', {
      id,
      downloadedSize: task.downloadedSize,
      totalSize: task.totalSize,
      speed: 0,
      status: 'paused',
    } satisfies DownloadProgressPayload);

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

  /** 尝试启动队列中的下一个任务 */
  private tryStartNext() {
    if (this.activeCount >= this.maxConcurrent) return;

    for (const [, task] of this.tasks) {
      if (task.status === 'queued') {
        void this.executeDownload(task.id);
        return;
      }
    }
  }

  /** 探测下载 URL，获取最终 URL、总大小、Range 支持情况(按域名分流) */
  private probe(downloadUrl: string): Promise<ProbeResult> {
    const url = new URL(downloadUrl);
    // hf-mirror.com 必须走注入传输(Electron net),否则 BoringSSL 指纹被 RST;
    // 其余源(modelscope 等)走 node:https,保持测试 mock 兼容
    if (shouldUseTransport(url)) {
      return this.probeViaTransport(url);
    }
    return this.probeViaHttps(url);
  }

  /** 通过注入传输探测(Electron net 模块,用于 hf-mirror.com) */
  private async probeViaTransport(startUrl: URL): Promise<ProbeResult> {
    let url = startUrl;
    for (let depth = 0; depth <= 5; depth++) {
      // 重定向跨域到非 hf-mirror:切换到 https 分支
      if (!shouldUseTransport(url)) {
        return this.probeViaHttps(url);
      }
      const { statusCode, headers, body } = await _downloadTransport.request(url.href, {
        'User-Agent': 'llama-launcher/1.0',
        Range: 'bytes=0-0',
      });
      // 消费响应体(仅 1 字节,但仍需 drain 以释放连接)
      body.resume();

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        url = new URL(headers.location as string, url);
        continue;
      }

      const supportsRange = statusCode === 206;
      let totalSize = -1;
      if (statusCode === 206 && headers['content-range']) {
        const m = (headers['content-range'] as string).match(/\/(\d+)/);
        if (m) totalSize = parseInt(m[1], 10);
      } else if (headers['content-length']) {
        totalSize = parseInt(headers['content-length'] as string, 10);
      }

      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`HTTP ${statusCode}`);
      }

      return { finalUrl: url, totalSize, supportsRange };
    }
    throw new Error('Too many redirects');
  }

  /** 通过 node:https 探测(HTTP/1.1,modelscope 等非 hf-mirror 源) */
  private probeViaHttps(startUrl: URL): Promise<ProbeResult> {
    return new Promise((resolve, reject) => {
      const follow = (url: URL, depth: number) => {
        if (depth > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const options: RequestOptions = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'User-Agent': 'llama-launcher/1.0',
            Range: 'bytes=0-0',
          },
          agent: this.agent,
        };

        const req = https.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url);
            follow(redirectUrl, depth + 1);
            return;
          }

          // 消费掉响应体（虽然只有 1 字节，也可能为 0）
          res.resume();

          const supportsRange = res.statusCode === 206;
          let totalSize = -1;

          if (res.statusCode === 206 && res.headers['content-range']) {
            const m = res.headers['content-range'].match(/\/(\d+)/);
            if (m) totalSize = parseInt(m[1], 10);
          } else if (res.headers['content-length']) {
            totalSize = parseInt(res.headers['content-length'], 10);
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300) && res.statusCode !== 206) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          resolve({ finalUrl: url, totalSize, supportsRange });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Probe timeout')));
        req.end();
      };

      follow(startUrl, 0);
    });
  }

  /** 创建分段 */
  private createSegments(totalSize: number, supportsRange: boolean, downloadedSize: number): Segment[] {
    // 未知大小或不支持 Range:单段(从已下载位置继续)
    if (totalSize <= 0 || !supportsRange) {
      return [{ start: downloadedSize, end: totalSize - 1, downloaded: 0, retryCount: 0 }];
    }

    // 动态分段:按目标段大小计算段数(使段数 >> worker 数),
    // 再用最小段大小和最大段数兜底
    const desiredCount = computeSegmentCount(totalSize);
    const targetCount = Math.ceil(totalSize / SEGMENT_TARGET_SIZE);
    const maxByMinSize = Math.max(1, Math.floor(totalSize / MIN_SEGMENT_SIZE_BYTES));
    // 段数:不少于 worker 数(保证所有 worker 有活干),不大于 maxByMinSize/SEGMENT_MAX_COUNT
    const segmentCount = Math.min(
      Math.max(desiredCount, targetCount),
      maxByMinSize,
      SEGMENT_MAX_COUNT,
    );

    const segments: Segment[] = [];
    for (let i = 0; i < segmentCount; i++) {
      const start = Math.floor((i * totalSize) / segmentCount);
      const end =
        i === segmentCount - 1
          ? totalSize - 1
          : Math.floor(((i + 1) * totalSize) / segmentCount) - 1;
      segments.push({ start, end, downloaded: 0, retryCount: 0 });
    }

    return segments;
  }

  /** 确保本地文件存在（创建空文件，不预分配大小） */
  private ensureFileExists(localPath: string) {
    try {
      if (!fs.existsSync(localPath)) {
        const fd = fs.openSync(localPath, 'w');
        fs.closeSync(fd);
      }
    } catch (err) {
      throw new Error(`Failed to create file: ${errorMessage(err)}`);
    }
  }

  /**
   * 从事件日志重放续传点(投影)。
   * 旧版 `.llama_dl.json` 快照先一次性迁移为日志;重放后校验 URL/总大小/来源一致、
   * 本地文件大小与段进度吻合,任一不符视为无续传点(从头开始)。
   * 崩溃恢复窗口为 0:段进度逐事件落盘,不再依赖周期快照。
   * @param logPath 日志身份路径(最终文件名;日志文件名为 logPath + 日志后缀)
   * @param filePath 实际文件路径(下载中的 .part 临时文件,用于大小校验)
   */
  private loadDownloadLog(
    logPath: string,
    filePath: string,
    url: string,
    totalSize: number,
    source: DownloadSource,
  ): Segment[] | undefined {
    migrateLegacyMeta(logPath);
    const replay = replayDownloadLog(logPath);
    if (!replay) return undefined;

    // URL、总大小、来源必须一致,否则视为续传点失效(从头开始)
    if (replay.url !== url || replay.totalSize !== totalSize || replay.source !== source) {
      return undefined;
    }
    // 终态为已完成/已取消的日志不续传(文件存在性由调用方快路径处理)
    if (replay.status === 'completed' || replay.status === 'canceled') return undefined;

    let downloadedSum = 0;
    const segments: Segment[] = [];
    for (const s of replay.segments) {
      downloadedSum += s.downloaded;
      segments.push({
        start: s.start,
        end: s.end,
        downloaded: s.downloaded,
        retryCount: 0,
      });
    }

    // 校验本地文件大小与日志进度一致(允许预分配产生的稀疏文件)
    try {
      if (fs.existsSync(filePath)) {
        const size = fs.statSync(filePath).size;
        if (size < downloadedSum || size > totalSize) return undefined;
      } else {
        // 有日志但无文件,无法续传
        return undefined;
      }
    } catch {
      return undefined;
    }

    return segments;
  }

  /** 记录任务开始事件(含段布局)。仅对新建任务调用;重放续传的场景日志已存在,不重复记录。 */
  private logStart(id: string, segments: Segment[]): void {
    const task = this.tasks.get(id);
    if (!task) return;
    appendDownloadEvent(task.localPath, {
      type: 'start',
      ts: Date.now(),
      url: this.buildDownloadUrlForTask(task),
      totalSize: task.totalSize,
      source: task.source,
      createdAt: task.createdAt,
      segments: segments.map((s) => ({ start: s.start, end: s.end })),
    });
  }

  /** 记录段进度事件(段完成后调用,index 为段在布局中的下标)。 */
  private logSegmentDone(id: string, index: number, downloaded: number): void {
    const task = this.tasks.get(id);
    if (!task) return;
    appendDownloadEvent(task.localPath, {
      type: 'segment',
      ts: Date.now(),
      index,
      downloaded,
    });
  }

  /** 把当前所有段的进度追加为事件(暂停/失败前调用,保留在途字节,崩溃不丢)。 */
  private logCurrentProgress(id: string): void {
    const task = this.tasks.get(id);
    const segments = this.taskSegments.get(id);
    if (!task || !segments) return;
    segments.forEach((s, index) => {
      appendDownloadEvent(task.localPath, {
        type: 'segment',
        ts: Date.now(),
        index,
        downloaded: s.downloaded,
      });
    });
  }

  /** 记录终态事件(诊断用;重放时进度只依赖 segment 事件,不受 done 影响)。 */
  private logDone(
    id: string,
    status: 'completed' | 'canceled' | 'error' | 'paused',
    error?: string,
    errorType?: DownloadErrorType,
  ): void {
    const task = this.tasks.get(id);
    if (!task) return;
    appendDownloadEvent(task.localPath, {
      type: 'done',
      ts: Date.now(),
      status,
      error,
      errorType,
    });
  }

  /** 删除部分下载文件 */
  private deletePartials(localPath: string) {
    if (!fs.existsSync(localPath)) return;
    // Windows 上句柄释放可能有延迟，重试几次
    for (let i = 0; i < 20; i++) {
      try {
        fs.unlinkSync(localPath);
        return;
      } catch {
        // 短暂同步等待后重试
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  }

  /** 销毁任务的所有段请求与写入流 */
  private destroySegments(id: string) {
    const segments = this.taskSegments.get(id);
    if (segments) {
      for (const segment of segments) {
        if (segment.req) {
          segment.req.destroy();
          this.activeRequests.delete(id);
          segment.req = undefined;
        }
        if (segment.stream) {
          segment.stream.destroy();
          this.writeStreams.delete(id);
          segment.stream = undefined;
        }
      }
    }

    // 同时清理旧版单请求/单流记录（防御性）
    const req = this.activeRequests.get(id);
    if (req) {
      req.destroy();
      this.activeRequests.delete(id);
    }
    const stream = this.writeStreams.get(id);
    if (stream) {
      stream.destroy();
      this.writeStreams.delete(id);
    }
  }

  /** 重新计算并更新任务已下载大小 */
  private recomputeDownloadedSize(id: string) {
    const task = this.tasks.get(id);
    const segments = this.taskSegments.get(id);
    if (!task || !segments) return;
    task.downloadedSize = segments.reduce((sum, s) => sum + s.downloaded, 0);
  }

  /** 执行单个下载任务 */
  private async executeDownload(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

    task.status = 'downloading';
    this.activeCount++;
    this.startSpeedTracker(id);

    const downloadUrl = this.buildDownloadUrlForTask(task);

    try {
      // 1. 探测 URL
      const probe = await this.probe(downloadUrl);
      const totalSize = probe.totalSize > 0 ? probe.totalSize : task.totalSize;
      task.totalSize = totalSize;

      // 2. 从事件日志重放续传点(含旧版 .llama_dl.json 快照的一次性迁移)
      let segments = this.loadDownloadLog(task.localPath, task.partPath, downloadUrl, totalSize, task.source);
      if (segments) {
        this.taskSegments.set(id, segments);
        this.recomputeDownloadedSize(id);
      } else {
        // 无有效续传点:清理残留并从头开始,记录 start 事件(含段布局)
        deleteDownloadLog(task.localPath);
        this.deletePartials(task.partPath);
        task.downloadedSize = 0;
        segments = this.createSegments(totalSize, probe.supportsRange, task.downloadedSize);
        this.taskSegments.set(id, segments);
        this.logStart(id, segments);
      }

      // 4. 确保文件存在(多段需要 r+ 模式写入,文件必须已存在;写入 part 临时文件)
      this.ensureFileExists(task.partPath);

      // 5. 并发下载所有段(工作队列:worker 数 = 并发度,段数 > worker 数时
      //    worker 完成一段后自动取下一段,避免尾段单连接瓶颈导致速率骤降)
      await this.runSegmentWorkers(id, segments, probe.finalUrl);

      // 任务被 pause/cancel 中断:worker 队列已优雅退出,但目标状态已由对应方法设置,
      // 跳过完成逻辑(避免覆盖 canceled/paused 状态、误发 complete 事件、误删续传日志)
      if (task.status !== 'downloading') {
        // 取消:清理日志和临时文件(暂停需要保留以支持续传)
        if (task.status === 'canceled') {
          deleteDownloadLog(task.localPath);
          this.deletePartials(task.partPath);
        }
        this.taskSegments.delete(id);
        this.stopSpeedTracker(id);
        this.expectedChecksums.delete(id);
        return;
      }

      // 6. 完成清理:段进度已逐事件落盘,直接删除日志(文件已完整,日志无意义)
      deleteDownloadLog(task.localPath);
      this.taskSegments.delete(id);
      this.stopSpeedTracker(id);

      // 最终汇总一次,确保 downloadedSize 准确
      this.recomputeDownloadedSize(id);

      // 完整性校验:流式计算已下载文件的 SHA-256(恒定内存,不整读大文件);
      // 提供期望校验和(源 API,如 HF LFS oid)时比对,不匹配则显式失败,可归因而非静默
      const checksum = await computeFileSha256(task.partPath);
      const expected = this.expectedChecksums.get(id) ?? null;
      this.expectedChecksums.delete(id);
      if (expected && checksum && checksum !== expected) {
        this.failTask(
          id,
          `Checksum mismatch: expected ${expected}, got ${checksum}`,
          undefined,
          'checksum_mismatch',
        );
        return;
      }

      // 完整性校验通过:把 part 临时文件改名成最终的 .gguf(同目录重命名)。
      // 未完成阶段文件始终是 .part 后缀,模型管理扫描/监听不会检出损坏文件;
      // 改名动作触发模型目录监听,此时模型才出现在列表中
      if (fs.existsSync(task.localPath)) {
        fs.rmSync(task.localPath, { force: true });
      }
      fs.renameSync(task.partPath, task.localPath);

      task.status = 'completed';
      task.speed = 0;
      task.completedAt = Date.now();
      this.activeCount--;

      this.emit('progress', {
        id,
        downloadedSize: task.downloadedSize,
        totalSize: task.totalSize,
        speed: 0,
        status: 'completed',
      } satisfies DownloadProgressPayload);

      this.emit('complete', {
        id,
        localPath: task.localPath,
        modelId: task.modelId,
        fileName: task.fileName,
        checksum,
      } satisfies DownloadCompletePayload);

      this.tryStartNext();
    } catch (err) {
      this.destroySegments(id);
      // 仅在任务仍处于 downloading 状态时标记失败;
      // pause/cancel 已设置目标状态,异步错误不应覆盖
      const cur = this.tasks.get(id);
      if (cur && cur.status === 'downloading') {
        this.failTask(id, errorMessage(err), (err as any)?.statusCode);
      }
    }
  }

  /**
   * 启动段下载工作队列。
   * worker 数 = min(并发度, 待下载段数);段数 > worker 数时,worker 完成一段后
   * 自动从队列取下一段,保持所有连接持续工作到末尾,消除尾段单连接瓶颈。
   */
  private async runSegmentWorkers(id: string, segments: Segment[], finalUrl: URL): Promise<void> {
    const pendingCount = segments.filter((s) => s.start + s.downloaded <= s.end).length;
    if (pendingCount === 0) return;
    // worker 数 = min(计算并发度, 待下载段数)
    const totalSize = segments.length > 0 ? segments[segments.length - 1].end + 1 : 0;
    const concurrency = Math.min(computeSegmentCount(totalSize), pendingCount);
    const workers = Array.from({ length: concurrency }, () => this.downloadWorker(id, segments, finalUrl));
    await Promise.all(workers);
  }

  /** 工作队列 worker:循环认领下一段并下载,直到所有段完成或任务被中断 */
  private async downloadWorker(id: string, segments: Segment[], finalUrl: URL): Promise<void> {
    while (true) {
      const task = this.tasks.get(id);
      if (!task || task.status !== 'downloading') return;

      // 认领下一个未完成、未被其他 worker 占用的段
      const segment = segments.find((s) => !s.busy && s.start + s.downloaded <= s.end);
      if (!segment) return; // 所有段已完成或被认领

      segment.busy = true;
      try {
        await this.downloadSegment(id, segment, finalUrl);
        // 段下载完成:仅在任务仍处于 downloading 状态时追加进度事件;
        // 取消/暂停可能在 downloadSegment 返回前发生，此时不应写入 .jsonl（会被后续清理视为残留）
        if (this.tasks.get(id)?.status === 'downloading') {
          this.logSegmentDone(id, segments.indexOf(segment), segment.downloaded);
        }
      } finally {
        segment.busy = false;
      }
    }
  }

  /** 下载单个段（含重试） */
  private async downloadSegment(id: string, segment: Segment, finalUrl: URL): Promise<void> {
    // 已完成的段无需重新下载
    if (segment.start + segment.downloaded > segment.end) {
      return;
    }

    while (segment.retryCount <= MAX_RETRIES) {
      // 任务已不在 downloading 状态(被 pause/cancel/error),停止重试
      const task = this.tasks.get(id);
      if (!task || task.status !== 'downloading') return;
      try {
        await this.runSegmentRequest(id, segment, finalUrl);
        // 段进度事件由 downloadWorker 在成功返回后追加(append-only,无节流窗口)
        return;
      } catch (err) {
        segment.retryCount++;
        if (segment.retryCount > MAX_RETRIES || !isRetryableError(err)) {
          throw err;
        }
        const delayMs = retryDelayMs(segment.retryCount - 1, RETRY_BASE_MS, MAX_RETRY_DELAY_MS);
        await delay(delayMs);
      }
    }
  }

  /** 将段响应体写入文件(h2/https 共享写入逻辑,调用前已排除重定向) */
  private attachSegmentWriter(
    id: string,
    segment: Segment,
    res: Readable,
    statusCode: number,
    resHeaders: IncomingHttpHeaders,
    resolve: () => void,
    reject: (err: unknown) => void,
    errorSuffix: string,
  ): void {
    const task = this.tasks.get(id);
    if (!task) {
      res.resume();
      resolve();
      return;
    }

    const start = segment.start + segment.downloaded;
    const isFullFileSegment =
      start === 0 && (segment.end === Infinity || segment.end === task.totalSize - 1);

    if (statusCode < 200 || statusCode >= 300) {
      res.resume();
      reject(Object.assign(new Error(`HTTP ${statusCode}${errorSuffix}`), { statusCode }));
      return;
    }

    // 非全文件段必须收到 206;全文件段允许服务器回退到 200
    if (statusCode !== 206 && !(statusCode === 200 && isFullFileSegment)) {
      res.resume();
      reject(new Error(`Server does not support Range${errorSuffix}`));
      return;
    }

    // 打开写入流(统一使用 r+ 模式,文件已由 ensureFileExists 创建;写入 part 临时文件)
    // highWaterMark: 16MB —— 4MB 在多段并发写入时 pause/resume 周期过短(~200ms,5Hz),
    // 导致速度采样器(500ms)看到明显波动;16MB 将周期拉长至 ~800ms,大幅平滑速率曲线
    const stream = fs.createWriteStream(task.partPath, {
      flags: 'r+',
      start,
      highWaterMark: 16 * 1024 * 1024,
    });
    segment.stream = stream;
    this.writeStreams.set(id, stream);

    stream.on('error', (err) => reject(err));

    res.on('data', (chunk: Buffer) => {
      // position 基于 segment.start + segment.downloaded,避免续传双重计数
      const position = segment.start + segment.downloaded;
      if (segment.end !== Infinity && position + chunk.length > segment.end + 1) {
        stream.destroy();
        reject(new Error(`Segment received more data than expected${errorSuffix}`));
        return;
      }
      const ok = stream.write(chunk);
      if (!ok) res.pause();
      // 事件节流:仅更新 segment.downloaded,task.downloadedSize 由 speedTracker 周期性汇总
      segment.downloaded += chunk.length;
    });

    stream.on('drain', () => res.resume());

    res.on('end', () => {
      stream.end(() => {
        segment.stream = undefined;
        segment.req = undefined;
        this.writeStreams.delete(id);
        resolve();
      });
    });

    res.on('error', (err) => {
      segment.req = undefined;
      reject(err);
    });
  }

  /** 执行一次段请求:hf-mirror 走注入传输(Electron net),其余走 HTTP/1.1(https) */
  private runSegmentRequest(id: string, segment: Segment, finalUrl: URL): Promise<void> {
    return new Promise((resolve, reject) => {
      const task = this.tasks.get(id);
      if (!task) {
        resolve();
        return;
      }

      const start = segment.start + segment.downloaded;
      const end = segment.end;
      const range = end === Infinity ? `bytes=${start}-` : `bytes=${start}-${end}`;

      if (shouldUseTransport(finalUrl)) {
        // 传输分支(Electron net):绕开 BoringSSL 指纹被 hf-mirror.com reset 的问题;
        // Chromium 网络栈自带连接池,同 origin 多段共享连接,等效原 H2 多路复用
        _downloadTransport
          .request(finalUrl.href, { 'User-Agent': 'llama-launcher/1.0', Range: range })
          .then(({ statusCode, headers, body, cancel }) => {
            // 跟踪 cancel 句柄,便于 cancel/pause 时中止底层请求
            segment.req = { destroy: cancel };
            // 跟随重定向
            if (statusCode >= 300 && statusCode < 400 && headers.location) {
              const redirectUrl = new URL(headers.location as string, finalUrl);
              body.resume();
              segment.req = undefined;
              this.followSegmentRedirect(id, segment, redirectUrl, resolve, reject);
              return;
            }
            this.attachSegmentWriter(id, segment, body, statusCode, headers, resolve, reject, '');
          })
          .catch((err) => reject(err));
      } else {
        // HTTP/1.1 分支:兼容非 hf-mirror 源(modelscope 等)与测试 mock
        const req = https.request(
          {
            hostname: finalUrl.hostname,
            path: finalUrl.pathname + finalUrl.search,
            method: 'GET',
            headers: { 'User-Agent': 'llama-launcher/1.0', Range: range },
            agent: this.agent,
          },
          (res) => {
            segment.req = req;
            const statusCode = res.statusCode ?? 200;
            if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
              const redirectUrl = new URL(res.headers.location as string, finalUrl);
              res.resume();
              segment.req = undefined;
              this.followSegmentRedirect(id, segment, redirectUrl, resolve, reject);
              return;
            }
            this.attachSegmentWriter(id, segment, res, statusCode, res.headers, resolve, reject, '');
          },
        );
        req.on('error', reject);
        req.end();
      }
    });
  }

  /** 跟随段内重定向(按目标域名分流 传输/https) */
  private followSegmentRedirect(
    id: string,
    segment: Segment,
    redirectUrl: URL,
    resolve: () => void,
    reject: (err: unknown) => void,
  ) {
    const start = segment.start + segment.downloaded;
    const end = segment.end;
    const range = end === Infinity ? `bytes=${start}-` : `bytes=${start}-${end}`;

    if (shouldUseTransport(redirectUrl)) {
      _downloadTransport
        .request(redirectUrl.href, { 'User-Agent': 'llama-launcher/1.0', Range: range })
        .then(({ statusCode, headers, body, cancel }) => {
          segment.req = { destroy: cancel };
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            const nextUrl = new URL(headers.location as string, redirectUrl);
            body.resume();
            segment.req = undefined;
            this.followSegmentRedirect(id, segment, nextUrl, resolve, reject);
            return;
          }
          this.attachSegmentWriter(id, segment, body, statusCode, headers, resolve, reject, ' after redirect');
        })
        .catch((err) => reject(err));
    } else {
      const req = https.request(
        {
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + redirectUrl.search,
          method: 'GET',
          headers: { 'User-Agent': 'llama-launcher/1.0', Range: range },
          agent: this.agent,
        },
        (res) => {
          segment.req = req;
          const statusCode = res.statusCode ?? 200;
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            const nextUrl = new URL(res.headers.location as string, redirectUrl);
            res.resume();
            segment.req = undefined;
            this.followSegmentRedirect(id, segment, nextUrl, resolve, reject);
            return;
          }
          this.attachSegmentWriter(id, segment, res, statusCode, res.headers, resolve, reject, ' after redirect');
        },
      );
      req.on('error', reject);
      req.end();
    }
  }

  /** 启动速度统计定时器（每秒更新） */
  private startSpeedTracker(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;

    // EMA 平滑系数:0.5 让新样本占 50%、历史占 50%。
    // 0.3 过低导致段切换间隙(数百 ms)的降速需 1.5-2s 才能追上,呈现"有规律降速"假象;
    // 0.5 在平滑性与响应性间更平衡,2 个样本(1s)即可追上真实变化
    const EMA_ALPHA = 0.5;
    const tracker = {
      lastBytes: task.downloadedSize,
      lastTime: Date.now(),
      smoothedSpeed: 0,
      interval: setInterval(() => {
        const t = this.tasks.get(id);
        if (!t || t.status !== 'downloading') return;
        // 事件节流:周期性从所有段汇总 downloadedSize(而非 per-chunk 更新)
        this.recomputeDownloadedSize(id);
        const now = Date.now();
        const elapsed = (now - tracker.lastTime) / 1000;
        if (elapsed > 0) {
          const instantSpeed = (t.downloadedSize - tracker.lastBytes) / elapsed;
          // EMA:首次样本直接采用(避免从 0 缓慢爬升);后续按系数加权
          tracker.smoothedSpeed =
            tracker.smoothedSpeed === 0
              ? instantSpeed
              : EMA_ALPHA * instantSpeed + (1 - EMA_ALPHA) * tracker.smoothedSpeed;
        }
        tracker.lastBytes = t.downloadedSize;
        tracker.lastTime = now;
        t.speed = Math.round(tracker.smoothedSpeed);

        this.emit('progress', {
          id,
          downloadedSize: t.downloadedSize,
          totalSize: t.totalSize,
          speed: t.speed,
          status: 'downloading',
        } satisfies DownloadProgressPayload);
      }, PROGRESS_INTERVAL_MS),
    };
    this.speedTrackers.set(id, tracker);
  }

  /** 停止速度统计 */
  private stopSpeedTracker(id: string) {
    const tracker = this.speedTrackers.get(id);
    if (tracker) {
      clearInterval(tracker.interval);
      this.speedTrackers.delete(id);
    }
  }

  /** 标记任务失败（forcedType 用于绕过 classifyError 直接指定错误类型，如 checksum_mismatch） */
  private failTask(id: string, error: string, httpStatus?: number, forcedType?: DownloadErrorType) {
    const task = this.tasks.get(id);
    if (!task) return;

    // 失败前汇总一次 downloadedSize,并把当前段进度追加为事件 + 终态标记,便于后续恢复
    this.recomputeDownloadedSize(id);
    this.logCurrentProgress(id);
    this.logDone(id, 'error', error, forcedType ?? classifyError(error, httpStatus));
    this.stopSpeedTracker(id);

    const req = this.activeRequests.get(id);
    if (req) {
      req.destroy();
      this.activeRequests.delete(id);
    }

    const stream = this.writeStreams.get(id);
    if (stream) {
      stream.destroy();
      this.writeStreams.delete(id);
    }

    // 错误分类:将底层错误归类为友好诊断类型;forcedType 优先
    const errorType = forcedType ?? classifyError(error, httpStatus);

    task.status = 'error';
    task.error = error;
    task.errorType = errorType;
    task.speed = 0;
    this.activeCount--;

    this.emit('error', {
      id,
      error,
      errorType,
    } satisfies DownloadErrorPayload);

    this.emit('progress', {
      id,
      downloadedSize: task.downloadedSize,
      totalSize: task.totalSize,
      speed: 0,
      status: 'error',
    } satisfies DownloadProgressPayload);

    this.tryStartNext();
  }

  /** 销毁所有任务(应用退出时调用) */
  dispose() {
    this.pauseAll();
    this.agent.destroy();
    this.removeAllListeners();
  }
}

/** 下载管理器单例 */
let downloadManagerInstance: DownloadManager | null = null;

export function getDownloadManager(): DownloadManager {
  if (!downloadManagerInstance) {
    downloadManagerInstance = new DownloadManager();
  }
  return downloadManagerInstance;
}
