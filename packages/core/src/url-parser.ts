// 解析 LM Studio / HuggingFace / ModelScope 模型页 URL
// 提取作者(namespace)、模型名，并尽量捕获链接尾部文件名（用于下载推荐）

import type { ParsedModelUrl } from '@llama-launcher/shared';

/** 已知模型文件扩展名（用于判定 URL 尾部是否为具体文件） */
const MODEL_FILE_RE = /\.(gguf|safetensors|bin|pt|pth|onnx|ggml)$/i;

function looksLikeModelFile(seg: string): boolean {
  return MODEL_FILE_RE.test(seg);
}

/**
 * 从模型名之后的路径段中提取尾部文件的完整仓库内路径。
 * 忽略 blob / tree / resolve 动词及其紧跟的引用段（main / master / 分支名）。
 * 例：[resolve, master, sub, model-fp8.safetensors] -> "sub/model-fp8.safetensors"
 *     [blob, main, text_encoders, qwen3vl_4b_fp8_scaled.safetensors] -> "text_encoders/qwen3vl_4b_fp8_scaled.safetensors"
 * 仅当尾段（或其前某段）为已知模型文件扩展名时返回；否则返回空字符串。
 */
function extractTrailingPath(rest: string[]): string {
  let segs = rest;
  if (segs.length >= 1 && /^(blob|tree|resolve)$/i.test(segs[0])) {
    segs = segs.slice(1);
    if (segs.length >= 1 && !looksLikeModelFile(segs[0])) {
      segs = segs.slice(1);
    }
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    if (looksLikeModelFile(segs[i])) {
      return segs.slice(0, i + 1).join('/');
    }
  }
  return '';
}

/** 同时返回完整文件路径与 basename（fileName） */
function splitFilePath(rest: string[]): { filePath: string; fileName: string } {
  const filePath = extractTrailingPath(rest);
  const fileName = filePath ? filePath.split('/').pop()! : '';
  return { filePath, fileName };
}

/**
 * 解析模型页 URL，提取来源平台、作者、模型名、尾部文件名。
 *
 * 支持的 URL 格式：
 * - LM Studio:  https://lmstudio.ai/models/{author}/{model}
 * - HuggingFace: https://huggingface.co/{author}/{model}
 * - HF Mirror:   https://hf-mirror.com/{author}/{model}（huggingface.co 的 1:1 镜像）
 * - ModelScope:  https://www.modelscope.cn/models/{author}/{model}
 *                https://modelscope.cn/models/{author}/{model}
 *
 * 也支持直接输入 `{author}/{model}`，或带仓库内路径/文件的
 * `{author}/{model}[/.../{file}]`（如 .../qwen_3_4b_fp8_mixed.safetensors）。
 */
export function parseModelUrl(raw: string): ParsedModelUrl | null {
  const input = raw.trim();
  if (!input) return null;

  // 直接输入 author/model[...] 格式
  if (!input.startsWith('http')) {
    const parts = input.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const author = parts[0];
    const modelName = parts[1];
    const { filePath, fileName } = splitFilePath(parts.slice(2));
    return {
      raw: input,
      source: 'unknown',
      author,
      modelName,
      modelId: `${author}/${modelName}`,
      filePath,
      fileName,
    };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  // LM Studio: lmstudio.ai/models/{author}/{model}
  if (host.includes('lmstudio.ai')) {
    const modelsIdx = segments.indexOf('models');
    if (modelsIdx === -1 || segments.length < modelsIdx + 2) return null;
    const author = segments[modelsIdx + 1];
    const modelName = segments[modelsIdx + 2];
    if (!author || !modelName) return null;
    const { filePath, fileName } = splitFilePath(segments.slice(modelsIdx + 3));
    return {
      raw: input,
      source: 'lmstudio',
      author,
      modelName,
      modelId: `${author}/${modelName}`,
      filePath,
      fileName,
    };
  }

  // HuggingFace: huggingface.co/{author}/{model}
  // hf-mirror.com 是 huggingface.co 的 1:1 镜像,URL 结构完全一致,
  // 统一识别为 huggingface 源(后续搜索/下载均走镜像,避免网络限制)
  if (host.includes('huggingface.co') || host.includes('hf-mirror.com')) {
    if (segments.length < 2) return null;
    const author = segments[0];
    const modelName = segments[1];
    if (!author || !modelName) return null;
    const { filePath, fileName } = splitFilePath(segments.slice(2));
    return {
      raw: input,
      source: 'huggingface',
      author,
      modelName,
      modelId: `${author}/${modelName}`,
      filePath,
      fileName,
    };
  }

  // ModelScope: modelscope.cn/models/{author}/{model}
  if (host.includes('modelscope.cn')) {
    const modelsIdx = segments.indexOf('models');
    if (modelsIdx === -1 || segments.length < modelsIdx + 2) return null;
    const author = segments[modelsIdx + 1];
    // ModelScope URL 中模型名可能带后缀路径，取第一个段
    const modelName = segments[modelsIdx + 2];
    if (!author || !modelName) return null;
    const { filePath, fileName } = splitFilePath(segments.slice(modelsIdx + 3));
    return {
      raw: input,
      source: 'modelscope',
      author,
      modelName,
      modelId: `${author}/${modelName}`,
      filePath,
      fileName,
    };
  }

  return null;
}
