import { describe, it, expect } from 'vitest';
import { parseModelUrl } from '../src/url-parser.js';

describe('parseModelUrl', () => {
  it('解析 ModelScope 文件直链，捕获尾部文件名', () => {
    const r = parseModelUrl(
      'https://modelscope.cn/models/Qwen/Qwen3-4B/resolve/master/qwen3-4b-fp8.safetensors',
    );
    expect(r).not.toBeNull();
    expect(r!.source).toBe('modelscope');
    expect(r!.author).toBe('Qwen');
    expect(r!.modelName).toBe('Qwen3-4B');
    expect(r!.modelId).toBe('Qwen/Qwen3-4B');
    expect(r!.fileName).toBe('qwen3-4b-fp8.safetensors');
    expect(r!.filePath).toBe('qwen3-4b-fp8.safetensors');
  });

  it('解析 HuggingFace blob 路径中的文件名', () => {
    const r = parseModelUrl(
      'https://huggingface.co/Qwen/Qwen3-4B/blob/main/model.safetensors',
    );
    expect(r).not.toBeNull();
    expect(r!.source).toBe('huggingface');
    expect(r!.author).toBe('Qwen');
    expect(r!.modelName).toBe('Qwen3-4B');
    expect(r!.fileName).toBe('model.safetensors');
  });

  it('解析 LM Studio 模型页（无尾部文件）', () => {
    const r = parseModelUrl('https://lmstudio.ai/models/google/gemma-4-26b-a4b-qat');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('lmstudio');
    expect(r!.author).toBe('google');
    expect(r!.modelName).toBe('gemma-4-26b-a4b-qat');
    expect(r!.fileName).toBe('');
  });

  it('解析直接输入的 author/model', () => {
    const r = parseModelUrl('Qwen/Qwen3-4B');
    expect(r).not.toBeNull();
    expect(r!.author).toBe('Qwen');
    expect(r!.modelName).toBe('Qwen3-4B');
    expect(r!.fileName).toBe('');
  });

  it('解析直接输入的 author/model/path/file', () => {
    const r = parseModelUrl('Qwen/Qwen3-4B/sub/qwen_3_4b_fp8_mixed.safetensors');
    expect(r).not.toBeNull();
    expect(r!.author).toBe('Qwen');
    expect(r!.modelName).toBe('Qwen3-4B');
    expect(r!.fileName).toBe('qwen_3_4b_fp8_mixed.safetensors');
    expect(r!.filePath).toBe('sub/qwen_3_4b_fp8_mixed.safetensors');
  });

  it('解析 HF blob 子目录文件,保留完整仓库内路径', () => {
    const r = parseModelUrl(
      'https://huggingface.co/Comfy-Org/Krea-2/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
    );
    expect(r).not.toBeNull();
    expect(r!.source).toBe('huggingface');
    expect(r!.author).toBe('Comfy-Org');
    expect(r!.modelName).toBe('Krea-2');
    expect(r!.modelId).toBe('Comfy-Org/Krea-2');
    expect(r!.fileName).toBe('qwen3vl_4b_fp8_scaled.safetensors');
    expect(r!.filePath).toBe('text_encoders/qwen3vl_4b_fp8_scaled.safetensors');
  });

  it('解析 hf-mirror.com 镜像链接为 huggingface 源', () => {
    const r = parseModelUrl(
      'https://hf-mirror.com/Comfy-Org/Krea-2/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
    );
    expect(r).not.toBeNull();
    expect(r!.source).toBe('huggingface');
    expect(r!.author).toBe('Comfy-Org');
    expect(r!.modelName).toBe('Krea-2');
    expect(r!.modelId).toBe('Comfy-Org/Krea-2');
    expect(r!.fileName).toBe('qwen3vl_4b_fp8_scaled.safetensors');
    expect(r!.filePath).toBe('text_encoders/qwen3vl_4b_fp8_scaled.safetensors');
  });

  it('解析带 www 前缀的 ModelScope URL（含点号模型名）', () => {
    const r = parseModelUrl('https://www.modelscope.cn/models/Qwen/Qwen3.8-27B');
    expect(r).not.toBeNull();
    expect(r!.source).toBe('modelscope');
    expect(r!.author).toBe('Qwen');
    expect(r!.modelName).toBe('Qwen3.8-27B');
    expect(r!.modelId).toBe('Qwen/Qwen3.8-27B');
    expect(r!.fileName).toBe('');
  });

  it('忽略 tree 路径中的引用段与子目录', () => {
    const r = parseModelUrl(
      'https://modelscope.cn/models/Qwen/Qwen3-4B/tree/main/sub/qwen3-4b-fp16.bin',
    );
    expect(r).not.toBeNull();
    expect(r!.fileName).toBe('qwen3-4b-fp16.bin');
    expect(r!.filePath).toBe('sub/qwen3-4b-fp16.bin');
  });

  it('无法识别的链接返回 null', () => {
    expect(parseModelUrl('not a url')).toBeNull();
    expect(parseModelUrl('https://example.com/foo')).toBeNull();
  });

  it('空/空白输入返回 null（不抛错）', () => {
    expect(parseModelUrl('')).toBeNull();
    expect(parseModelUrl('   ')).toBeNull();
    expect(parseModelUrl(null as unknown as string)).toBeNull();
  });

  it('大写模型文件扩展名（.GGUF）同样识别为尾部文件', () => {
    const result = parseModelUrl('https://huggingface.co/org/model/resolve/main/Model.FP8.GGUF');
    expect(result?.fileName).toBe('Model.FP8.GGUF');
    expect(result?.filePath).toBe('Model.FP8.GGUF');
  });
});
