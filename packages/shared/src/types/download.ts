// 在线模型下载相关类型定义

import type { QuantizationInfo } from '../model-relevance.js';

/** 下载来源平台 */
export type DownloadSource = 'modelscope' | 'huggingface';

/** 下载失败类型(用于友好诊断提示) */
export type DownloadErrorType =
  | 'network' // 网络层错误(ECONNRESET/ETIMEDOUT/EPIPE 等)
  | 'http_4xx' // HTTP 4xx(403/404/408/429 等)
  | 'http_5xx' // HTTP 5xx(500/502/503/504)
  | 'range_unsupported' // 服务器不支持 Range
  | 'disk_full' // 磁盘空间不足(ENOSPC)
  | 'file_locked' // 文件被占用(EBUSY/EPERM/EACCES)
  | 'redirect_loop' // 重定向次数过多
  | 'segment_overflow' // 段收到超出预期的数据
  | 'checksum_mismatch' // 下载文件校验和不匹配
  | 'canceled' // 用户取消
  | 'unknown'; // 未知错误

/** URL 解析结果 */
export interface ParsedModelUrl {
  /** 原始 URL */
  raw: string;
  /** 来源平台 */
  source: 'lmstudio' | 'huggingface' | 'modelscope' | 'unknown';
  /** 模型作者/命名空间（如 google、Qwen） */
  author: string;
  /** 模型名称（不含作者前缀，如 gemma-4-26b-a4b-qat） */
  modelName: string;
  /** 完整 ID（author/modelName） */
  modelId: string;
  /** 仓库内完整文件路径（如 text_encoders/qwen3vl_4b_fp8_scaled.safetensors），无则空字符串；用于跳转到对应文件页 */
  filePath: string;
  /** 链接尾部文件名（filePath 的 basename，如 qwen3vl_4b_fp8_scaled.safetensors），用于下载推荐；无则为空 */
  fileName: string;
}

/** ModelScope 搜索结果项 */
export interface ModelScopeSearchItem {
  /** 模型 ID（namespace/name） */
  id: string;
  /** 命名空间/作者 */
  path: string;
  /** 模型名称 */
  name: string;
  /** 中文显示名（可能为空） */
  chineseName: string;
  /** 描述 */
  description: string;
  /** 下载量 */
  downloads: number;
  /** 收藏数 */
  stars: number;
  /** 许可证 */
  license: string;
  /** 库类型（transformer/safetensors/pytorch/gguf 等） */
  libraries: string[];
  /** 架构 */
  architectures: string[];
  /** 模型类型 */
  modelType: string[];
  /** 仓库大小（字节） */
  storageSize: number;
  /** 任务类型 */
  tasks: string[];
}

/** ModelScope 搜索响应 */
export interface ModelScopeSearchResult {
  models: ModelScopeSearchItem[];
  totalCount: number;
}

/** ModelScope 仓库文件项 */
export interface ModelScopeFile {
  /** 文件名 */
  name: string;
  /** 仓库内相对路径 */
  path: string;
  /** 文件大小（字节），目录为 0 */
  size: number;
  /** 类型：blob=文件，tree=目录 */
  type: 'blob' | 'tree';
  /** 是否为 LFS 大文件 */
  isLfs: boolean;
  /** 是否为 .gguf 文件（前端筛选便利字段，保留以兼容既有逻辑） */
  isGguf: boolean;
  /** 文件 SHA-256（hex，小写；来自源 API 如 HF LFS oid，无则 null），用于下载完整性校验 */
  sha256?: string | null;
  /** 文件类别：gguf / safetensors / bin / other */
  category: 'gguf' | 'safetensors' | 'bin' | 'other';
  /** 人类可读大小（如 18.5 GB） */
  sizeStr: string;
  /** 量化标签信息（从文件名解析得到）；非量化文件为 null */
  quantization: QuantizationInfo | null;
}

/** ModelScope 文件列表响应 */
export interface ModelScopeFileListResult {
  files: ModelScopeFile[];
  namespace: string;
  name: string;
}

/** 下载任务状态 */
export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'canceled';

/** 下载任务(UI 侧完整状态) */
export interface DownloadTask {
  /** 任务唯一 ID */
  id: string;
  /** 模型 ID(namespace/name) */
  modelId: string;
  /** 文件在仓库中的路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 文件总大小(字节) */
  totalSize: number;
  /** 已下载大小(字节) */
  downloadedSize: number;
  /** 下载速度(字节/秒) */
  speed: number;
  /** 状态 */
  status: DownloadStatus;
  /** 下载来源平台 */
  source: DownloadSource;
  /** 本地保存路径（最终文件名；下载完成时由 partPath 改名而来） */
  localPath: string;
  /** 下载中的临时文件路径（.part 后缀，不被模型管理扫描检出；完成后改名到 localPath） */
  partPath: string;
  /** 错误信息(status=error 时有值) */
  error: string;
  /** 错误类型(status=error 时有值,用于友好诊断提示) */
  errorType: DownloadErrorType | null;
  /** 创建时间戳 */
  createdAt: number;
  /** 完成时间戳 */
  completedAt: number | null;
}

/** 下载进度推送 payload */
export interface DownloadProgressPayload {
  id: string;
  downloadedSize: number;
  totalSize: number;
  speed: number;
  status: DownloadStatus;
}

/** 下载完成推送 payload */
export interface DownloadCompletePayload {
  id: string;
  localPath: string;
  modelId: string;
  fileName: string;
  /** 完成时计算的 SHA-256（hex，小写）；计算失败（如文件被占用）时为 null */
  checksum?: string | null;
}

/** 下载错误推送 payload */
export interface DownloadErrorPayload {
  id: string;
  error: string;
  /** 错误类型,用于友好诊断提示 */
  errorType: DownloadErrorType;
}

/** 启动下载请求 */
export interface StartDownloadRequest {
  modelId: string;
  namespace: string;
  name: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  /** 模型目录(settings.models_dir) */
  modelsDir: string;
  /** 下载来源平台 */
  source: DownloadSource;
  /** 期望的 SHA-256（hex，小写，来自源 API 如 HF LFS oid）；提供时完成校验不匹配会以 checksum_mismatch 失败 */
  expectedChecksum?: string | null;
}
