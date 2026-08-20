import { describe, it, expect, afterEach } from 'vitest';
import {
  setHfMirrorHost,
  getHfMirrorHost,
  isHfMirrorHostname,
  buildHfDownloadUrl,
  setHfTransport,
  listHfFiles,
} from '../src/huggingface-client.js';

describe('HuggingFace 镜像源配置', () => {
  afterEach(() => {
    setHfMirrorHost(''); // 复位默认，避免影响其他用例
  });

  it('默认镜像为 hf-mirror.com', () => {
    expect(getHfMirrorHost()).toBe('hf-mirror.com');
  });

  it('setHfMirrorHost 生效并去除协议前缀/尾部斜杠', () => {
    setHfMirrorHost('https://mirror.example.com/');
    expect(getHfMirrorHost()).toBe('mirror.example.com');
  });

  it('空字符串复位默认镜像', () => {
    setHfMirrorHost('mirror.example.com');
    setHfMirrorHost('');
    expect(getHfMirrorHost()).toBe('hf-mirror.com');
  });

  it('isHfMirrorHostname 精确/子域匹配且忽略大小写', () => {
    setHfMirrorHost('hf-mirror.com');
    expect(isHfMirrorHostname('hf-mirror.com')).toBe(true);
    expect(isHfMirrorHostname('cdn.hf-mirror.com')).toBe(true);
    expect(isHfMirrorHostname('HF-MIRROR.COM')).toBe(true);
    expect(isHfMirrorHostname('modelscope.cn')).toBe(false);
    expect(isHfMirrorHostname('not-hf-mirror.com')).toBe(false);
  });

  it('自定义镜像后下载 URL 与传输判定同步生效', () => {
    setHfMirrorHost('mirror.example.com');
    expect(buildHfDownloadUrl('org', 'model', 'a.gguf')).toContain('mirror.example.com');
    expect(isHfMirrorHostname('mirror.example.com')).toBe(true);
  });

  it('listHfFiles 提取 LFS oid 作为 sha256（非 sha256 为 null）', async () => {
    setHfTransport({
      get: async () => ({
        status: 200,
        location: null,
        body: JSON.stringify([
          { path: 'model.gguf', size: 10, type: 'file', lfs: { oid: 'sha256:' + 'AB'.repeat(32).toLowerCase() } },
          { path: 'plain.bin', size: 5, type: 'file' },
          { path: 'weird.gguf', size: 7, type: 'file', lfs: { oid: 'sha1:deadbeef' } },
        ]),
      }),
    });
    const result = await listHfFiles('org', 'model');
    const byPath = (p: string) => result.files.find((f) => f.path === p);
    expect(byPath('model.gguf')?.sha256).toBe('ab'.repeat(32));
    expect(byPath('plain.bin')?.sha256).toBeNull();
    expect(byPath('weird.gguf')?.sha256).toBeNull();
  });
});
