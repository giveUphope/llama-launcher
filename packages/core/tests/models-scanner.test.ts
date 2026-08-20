import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanModels, invalidateScanCache, detectMmproj, detectDraftModel, removeModelFile } from '../src/models-scanner.js';

describe('scanModels', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `llama-launcher-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('finds .gguf files recursively', async () => {
    const subDir = join(testDir, 'sub');
    mkdirSync(subDir);
    writeFileSync(join(testDir, 'a.gguf'), 'a');
    writeFileSync(join(subDir, 'b.gguf'), 'b');
    writeFileSync(join(testDir, 'readme.txt'), 'text');

    const models = await scanModels(testDir);
    expect(models.map((m) => m.name)).toEqual(['a.gguf', 'b.gguf']);
  });

  it('excludes mmproj/projector/multimodal and dflash/draft files from scan results', async () => {
    writeFileSync(join(testDir, 'model.gguf'), 'm');
    writeFileSync(join(testDir, 'mmproj-F16.gguf'), 'mmproj');
    writeFileSync(join(testDir, 'projector.bin'), 'proj');
    writeFileSync(join(testDir, 'multimodal.gguf'), 'mm');
    // 草稿模型文件也应被排除
    writeFileSync(join(testDir, 'dflash-1.5b.gguf'), 'df');
    writeFileSync(join(testDir, 'draft-small.gguf'), 'd');

    const models = await scanModels(testDir);
    // 只保留真正的模型文件，mmproj 类和草稿模型文件均被排除
    expect(models.map((m) => m.name)).toEqual(['model.gguf']);
  });

  it('returns empty array for empty directory', async () => {
    expect(await scanModels(testDir)).toEqual([]);
  });

  it('excludes dflash/draft draft model files from scan results', async () => {
    writeFileSync(join(testDir, 'main-model.gguf'), 'main');
    writeFileSync(join(testDir, 'dflash-1.5b.gguf'), 'df');
    writeFileSync(join(testDir, 'my-draft-v2.gguf'), 'd');
    writeFileSync(join(testDir, 'DFLASH-large.gguf'), 'DF'); // 大写也应匹配

    const models = await scanModels(testDir);
    // 草稿模型文件被排除，只保留主模型
    expect(models.map((m) => m.name)).toEqual(['main-model.gguf']);
  });

  it('throws DIR_NOT_FOUND for missing directory', async () => {
    await expect(scanModels(join(testDir, 'missing'))).rejects.toMatchObject({
      code: 'DIR_NOT_FOUND',
      dir: join(testDir, 'missing'),
    });
  });

  it('creates directory when createIfMissing is true', async () => {
    const { existsSync } = require('node:fs');
    const missingDir = join(testDir, 'newdir');
    expect(existsSync(missingDir)).toBe(false);

    const models = await scanModels(missingDir, { createIfMissing: true });
    expect(models).toEqual([]);
    expect(existsSync(missingDir)).toBe(true);
  });

  it('throws DIR_NOT_FOUND for empty string directory', async () => {
    await expect(scanModels('')).rejects.toMatchObject({
      code: 'DIR_NOT_FOUND',
      dir: '',
    });
  });

  it('throws DIR_NOT_FOUND when dir is missing and createIfMissing not set', async () => {
    const missingDir = join(testDir, 'no-create');
    await expect(scanModels(missingDir, { createIfMissing: false })).rejects.toMatchObject({
      code: 'DIR_NOT_FOUND',
    });
    // 确认未创建目录
    expect(existsSync(missingDir)).toBe(false);
  });

  it('caches scan results and serves cache hits', async () => {
    writeFileSync(join(testDir, 'a.gguf'), 'a');
    const first = await scanModels(testDir);
    const second = await scanModels(testDir);
    expect(second).toEqual(first);
    expect(second.map((m) => m.name)).toEqual(['a.gguf']);
  });

  it('invalidateScanCache forces a fresh scan', async () => {
    writeFileSync(join(testDir, 'a.gguf'), 'a');
    await scanModels(testDir);
    invalidateScanCache();
    writeFileSync(join(testDir, 'b.gguf'), 'b');
    const fresh = await scanModels(testDir);
    expect(fresh.map((m) => m.name)).toEqual(['a.gguf', 'b.gguf']);
  });
});

describe('detectMmproj', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `llama-launcher-mmproj-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns empty string for empty model path', () => {
    expect(detectMmproj('')).toBe('');
  });

  it('returns empty string when no mmproj file exists in same dir', () => {
    const modelPath = join(testDir, 'model.gguf');
    writeFileSync(modelPath, 'model');
    expect(detectMmproj(modelPath)).toBe('');
  });

  it('detects mmproj .gguf file in same dir', () => {
    const modelPath = join(testDir, 'model.gguf');
    const mmprojPath = join(testDir, 'mmproj.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(mmprojPath, 'mmproj');
    expect(detectMmproj(modelPath)).toBe(mmprojPath);
  });

  it('detects projector .bin file in same dir', () => {
    const modelPath = join(testDir, 'model.gguf');
    const projPath = join(testDir, 'projector.bin');
    writeFileSync(modelPath, 'model');
    writeFileSync(projPath, 'proj');
    expect(detectMmproj(modelPath)).toBe(projPath);
  });

  it('detects multimodal prefixed file', () => {
    const modelPath = join(testDir, 'model.gguf');
    const mmPath = join(testDir, 'multimodal.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(mmPath, 'mm');
    expect(detectMmproj(modelPath)).toBe(mmPath);
  });

  it('prioritizes files containing "mmproj" over other keywords', () => {
    const modelPath = join(testDir, 'model.gguf');
    const projPath = join(testDir, 'projector.bin');
    const mmprojPath = join(testDir, 'mmproj.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(projPath, 'proj');
    writeFileSync(mmprojPath, 'mmproj');
    expect(detectMmproj(modelPath)).toBe(mmprojPath);
  });

  it('excludes the model file itself', () => {
    // 模型文件名包含 mmproj 关键词时不应误判为 mmproj 文件
    const modelPath = join(testDir, 'mmproj-model.gguf');
    writeFileSync(modelPath, 'model');
    expect(detectMmproj(modelPath)).toBe('');
  });

  it('returns empty string when model dir does not exist', () => {
    expect(detectMmproj(join(testDir, 'missing', 'model.gguf'))).toBe('');
  });

  it('ignores non-gguf/non-bin files with mmproj keyword', () => {
    const modelPath = join(testDir, 'model.gguf');
    const txtPath = join(testDir, 'mmproj.txt');
    writeFileSync(modelPath, 'model');
    writeFileSync(txtPath, 'txt');
    expect(detectMmproj(modelPath)).toBe('');
  });
});

describe('detectDraftModel', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `llama-launcher-draft-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns empty string for empty model path', () => {
    expect(detectDraftModel('')).toBe('');
  });

  it('returns empty string when no draft file exists in same dir', () => {
    const modelPath = join(testDir, 'model.gguf');
    writeFileSync(modelPath, 'model');
    expect(detectDraftModel(modelPath)).toBe('');
  });

  it('detects dflash .gguf file in same dir', () => {
    const modelPath = join(testDir, 'model.gguf');
    const draftPath = join(testDir, 'dflash-1.5b.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(draftPath, 'draft');
    expect(detectDraftModel(modelPath)).toBe(draftPath);
  });

  it('detects draft keyword in filename', () => {
    const modelPath = join(testDir, 'model.gguf');
    const draftPath = join(testDir, 'draft-model.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(draftPath, 'draft');
    expect(detectDraftModel(modelPath)).toBe(draftPath);
  });

  it('prioritizes "dflash" over "draft" keyword', () => {
    const modelPath = join(testDir, 'model.gguf');
    const draftPath = join(testDir, 'draft-small.gguf');
    const dflashPath = join(testDir, 'dflash-1.5b.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(draftPath, 'd');
    writeFileSync(dflashPath, 'df');
    expect(detectDraftModel(modelPath)).toBe(dflashPath);
  });

  it('excludes the model file itself', () => {
    // 模型文件名包含 draft 关键词时不应误判为草稿文件
    const modelPath = join(testDir, 'draft-model.gguf');
    writeFileSync(modelPath, 'model');
    expect(detectDraftModel(modelPath)).toBe('');
  });

  it('excludes mmproj files even if they contain draft keyword', () => {
    const modelPath = join(testDir, 'model.gguf');
    const mmprojDraftPath = join(testDir, 'mmproj-draft.gguf');
    writeFileSync(modelPath, 'model');
    writeFileSync(mmprojDraftPath, 'mmproj-draft');
    expect(detectDraftModel(modelPath)).toBe('');
  });

  it('returns empty string when model dir does not exist', () => {
    expect(detectDraftModel(join(testDir, 'missing', 'model.gguf'))).toBe('');
  });

  it('only detects .gguf files (not .bin)', () => {
    const modelPath = join(testDir, 'model.gguf');
    const draftBinPath = join(testDir, 'dflash.bin');
    writeFileSync(modelPath, 'model');
    writeFileSync(draftBinPath, 'draft');
    expect(detectDraftModel(modelPath)).toBe('');
  });
});

describe('伴随文件标签（tags）', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `llama-launcher-tags-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('目录含 mmproj + dflash 伴随文件时模型带对应标签', async () => {
    const modelDir = join(testDir, 'org', 'model-a');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'model-a.gguf'), 'm');
    writeFileSync(join(modelDir, 'mmproj-F16.gguf'), 'p');
    writeFileSync(join(modelDir, 'dflash-1.5b.gguf'), 'd');

    const models = await scanModels(testDir);
    const model = models.find((m) => m.name === 'model-a.gguf');
    expect(model?.tags).toContain('mmproj');
    expect(model?.tags).toContain('dflash');
    expect(model?.tags).not.toContain('draft');
  });

  it('目录含普通 draft 伴随文件时标签为 draft；无伴随文件则无标签', async () => {
    const draftDir = join(testDir, 'org', 'model-b');
    mkdirSync(draftDir, { recursive: true });
    writeFileSync(join(draftDir, 'model-b.gguf'), 'm');
    writeFileSync(join(draftDir, 'draft-small.gguf'), 'd');
    const plainDir = join(testDir, 'org', 'model-c');
    mkdirSync(plainDir, { recursive: true });
    writeFileSync(join(plainDir, 'model-c.gguf'), 'm');

    const models = await scanModels(testDir);
    const withDraft = models.find((m) => m.name === 'model-b.gguf');
    expect(withDraft?.tags).toEqual(['draft']);
    const plain = models.find((m) => m.name === 'model-c.gguf');
    expect(plain?.tags ?? []).toEqual([]);
  });
});

describe('removeModelFile（按模型文件移除）', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `llama-launcher-rm-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('目录存在其他量化版本时仅删除选中的模型文件，其余保留', () => {
    const modelDir = join(testDir, 'org', 'model-a');
    mkdirSync(modelDir, { recursive: true });
    const q4 = join(modelDir, 'model-q4.gguf');
    const q8 = join(modelDir, 'model-q8.gguf');
    writeFileSync(q4, 'm4');
    writeFileSync(q8, 'm8');

    const res = removeModelFile(q4, testDir);
    expect(res.ok).toBe(true);
    expect(existsSync(q4)).toBe(false); // 选中文件已删
    expect(existsSync(q8)).toBe(true); // 其他量化版本保留
    expect(existsSync(modelDir)).toBe(true); // 目录保留
  });

  it('目录存在用户创建的非 gguf 文件时仅删除选中的模型文件', () => {
    const modelDir = join(testDir, 'org', 'model-b');
    mkdirSync(modelDir, { recursive: true });
    const model = join(modelDir, 'model-b.gguf');
    const readme = join(modelDir, 'readme.txt');
    writeFileSync(model, 'm');
    writeFileSync(readme, 'notes');

    const res = removeModelFile(model, testDir);
    expect(res.ok).toBe(true);
    expect(existsSync(model)).toBe(false);
    expect(existsSync(readme)).toBe(true); // 用户文件保留
    expect(existsSync(modelDir)).toBe(true);
  });

  it('目录存在子目录时仅删除选中的模型文件，子目录保留', () => {
    const modelDir = join(testDir, 'org', 'model-c');
    mkdirSync(modelDir, { recursive: true });
    const model = join(modelDir, 'model-c.gguf');
    const sub = join(modelDir, 'notes');
    mkdirSync(sub, { recursive: true });
    writeFileSync(model, 'm');

    const res = removeModelFile(model, testDir);
    expect(res.ok).toBe(true);
    expect(existsSync(model)).toBe(false);
    expect(existsSync(sub)).toBe(true); // 子目录视为其他内容，保留
  });

  it('目录无其他内容时删除模型文件 + mmproj/mtp/dflash 伴随文件及空目录', () => {
    const modelDir = join(testDir, 'org', 'model-d');
    mkdirSync(modelDir, { recursive: true });
    const model = join(modelDir, 'model-d.gguf');
    const mmproj = join(modelDir, 'mmproj-F16.gguf');
    const mtp = join(modelDir, 'model-d-mtp-0.1.gguf');
    const dflash = join(modelDir, 'dflash-1.5b.gguf');
    writeFileSync(model, 'm');
    writeFileSync(mmproj, 'p');
    writeFileSync(mtp, 't');
    writeFileSync(dflash, 'd');

    const res = removeModelFile(model, testDir);
    expect(res.ok).toBe(true);
    expect(res.removedDir).toBe(modelDir);
    expect(existsSync(model)).toBe(false);
    expect(existsSync(mmproj)).toBe(false);
    expect(existsSync(mtp)).toBe(false);
    expect(existsSync(dflash)).toBe(false);
    expect(existsSync(modelDir)).toBe(false); // 空目录一并移除
    expect(existsSync(join(testDir, 'org'))).toBe(true); // 上级目录保留
  });

  it('目录仅含模型文件时删除文件与空目录', () => {
    const modelDir = join(testDir, 'org', 'model-e');
    mkdirSync(modelDir, { recursive: true });
    const model = join(modelDir, 'model-e.gguf');
    writeFileSync(model, 'm');

    const res = removeModelFile(model, testDir);
    expect(res.ok).toBe(true);
    expect(res.removedDir).toBe(modelDir);
    expect(existsSync(modelDir)).toBe(false);
  });

  it('模型文件直接在模型根目录时不删除根目录', () => {
    const model = join(testDir, 'root-model.gguf');
    writeFileSync(model, 'm');

    const res = removeModelFile(model, testDir);
    expect(res.ok).toBe(true);
    expect(res.removedDir).toBeUndefined();
    expect(existsSync(model)).toBe(false);
    expect(existsSync(testDir)).toBe(true); // 模型根目录本身保留
  });

  it('拒绝越界路径与不存在的文件', () => {
    const outside = join(tmpdir(), 'outside-model-file.gguf');
    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(outside, 'x');
    expect(removeModelFile(outside, testDir).ok).toBe(false);
    rmSync(outside, { force: true });

    expect(removeModelFile(join(testDir, 'missing.gguf'), testDir).ok).toBe(false);
    expect(removeModelFile('', testDir).ok).toBe(false);
    expect(removeModelFile(join(testDir, 'a.gguf'), '').ok).toBe(false);
  });
});
