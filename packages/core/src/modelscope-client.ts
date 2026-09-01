// ModelScope 公开 API 客户端
// 调研结果：所有公开模型 API 均可匿名访问，无需 token

import https from 'node:https';
import type { RequestOptions } from 'node:http';
import type {
  ModelScopeSearchResult,
  ModelScopeSearchItem,
  ModelScopeFileListResult,
  ModelScopeFile,
} from '@llama-launcher/shared';
import { categorizeFile, parseQuantization, scoreRelevance, formatBytes } from '@llama-launcher/shared';
import { isRetryableError, retryDelayMs } from './retry.js';

const API_BASE = 'www.modelscope.cn';
const TIMEOUT_MS = 15000;

/** 发起 HTTPS GET/PUT 请求，返回 JSON 解析结果 */
function request(
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'llama-launcher/1.0',
    };
    if (data) {
      headers['Content-Length'] = Buffer.byteLength(data).toString();
    }
    const options: RequestOptions = {
      hostname: API_BASE,
      path,
      method,
      headers,
      timeout: TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      // 跟随重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, `https://${API_BASE}`);
        request(method, redirectUrl.pathname + redirectUrl.search, body).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(text));
        } catch (err) {
          reject(new Error(`Failed to parse JSON response: ${(err as Error).message}`));
        }
      });
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** 重试上限（对齐 huggingface-client：指数退避，最多 3 次） */
const MAX_ATTEMPTS = 3;

/** request + 指数退避重试（瞬时网络错误/可重试 HTTP 码命中 isRetryableError；
 *  搜索与文件列表均为幂等读，安全重试） */
async function requestWithRetry(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await request(method, path, body);
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
    }
  }
  throw lastErr;
}

/** 格式化文件大小为人类可读字符串（统一收敛到 shared formatBytes，保留原导出名） */
const formatFileSize = formatBytes;
export { formatFileSize };

/**
 * 搜索 ModelScope 模型
 * @param author 模型作者/命名空间（如 google、Qwen）
 * @param modelName 模型名关键词（如 gemma-4-26b）
 */
export async function searchModels(
  author: string,
  modelName: string,
): Promise<ModelScopeSearchResult> {
  // ModelScope 搜索 API 使用 PUT 方法
  // Path 字段精确匹配命名空间，Name 字段模糊匹配模型名
  const body = {
    PageNumber: 1,
    PageSize: 20,
    Path: author,
    Name: modelName,
  };

  const resp = await requestWithRetry('PUT', '/api/v1/dolphin/models', body);

  if (!resp || !resp.Success || !resp.Data || !resp.Data.Model) {
    return { models: [], totalCount: 0 };
  }

  const models: ModelScopeSearchItem[] = (resp.Data.Model.Models || []).map((m: any) => ({
    id: `${m.Path}/${m.Name}`,
    path: m.Path,
    name: m.Name,
    chineseName: m.ChineseName ?? '',
    description: m.Description ?? '',
    downloads: m.Downloads ?? 0,
    stars: m.Stars ?? 0,
    license: m.License ?? '',
    libraries: m.Libraries ?? [],
    architectures: m.Architectures ?? [],
    modelType: m.ModelType ?? [],
    storageSize: m.StorageSize ?? 0,
    tasks: (m.Tasks ?? []).map((t: any) => t.Name ?? ''),
  }));

  // 按与关键词的相关性排序（相关性相同则按下载量降序），提升推荐结果的相关性
  models.sort((a, b) => {
    const sa = scoreRelevance(`${a.name} ${a.path}`, modelName);
    const sb = scoreRelevance(`${b.name} ${b.path}`, modelName);
    if (sb !== sa) return sb - sa;
    return (b.downloads ?? 0) - (a.downloads ?? 0);
  });

  return {
    models,
    totalCount: resp.Data.Model.TotalCount ?? 0,
  };
}

/**
 * 获取 ModelScope 模型仓库的文件列表
 * @param namespace 命名空间/作者
 * @param name 模型名
 */
export async function listModelFiles(
  namespace: string,
  name: string,
): Promise<ModelScopeFileListResult> {
  const path = `/api/v1/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/repo/files?Revision=master&Recursive=true`;
  const resp = await requestWithRetry('GET', path);

  if (!resp || !resp.Success || !resp.Data || !resp.Data.Files) {
    return { files: [], namespace, name };
  }

  const files: ModelScopeFile[] = (resp.Data.Files || [])
    .filter((f: any) => f.Type === 'blob')
    .map((f: any) => {
      const filePath: string = f.Path ?? f.Name ?? '';
      const name: string = f.Name ?? filePath.split('/').pop() ?? '';
      return {
        name,
        path: filePath,
        size: f.Size ?? 0,
        type: 'blob' as const,
        isLfs: f.IsLFS ?? false,
        isGguf: filePath.toLowerCase().endsWith('.gguf'),
        category: categorizeFile(filePath),
        sizeStr: formatFileSize(f.Size ?? 0),
        quantization: parseQuantization(name),
      };
    });

  return { files, namespace, name };
}

/**
 * 构造 ModelScope 文件下载 URL
 * @param namespace 命名空间
 * @param name 模型名
 * @param filePath 文件在仓库中的路径
 */
export function buildDownloadUrl(namespace: string, name: string, filePath: string): string {
  return `https://${API_BASE}/api/v1/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/repo?Revision=master&FilePath=${encodeURIComponent(filePath)}`;
}

/**
 * 构造 ModelScope 模型页面 URL（用于浏览器跳转）
 */
export function buildModelPageUrl(namespace: string, name: string): string {
  return `https://${API_BASE}/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}
