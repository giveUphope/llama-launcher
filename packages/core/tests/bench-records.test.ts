import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { LlamaBenchJobState } from '@llama-launcher/shared';
import { BENCH_RECORDS_MAX, loadBenchRecords, saveBenchRecords } from '../src/bench-records.js';

// 体检记录落盘的回归用例。这一整块此前不存在：结果只在主进程的内存 Map 里，
// 应用一关就没了，用户重开看到的是空徽章——所以这里重点钉「重启后还在」。

let tmpDir: string;
let file: string;

function mkRec(modelPath: string, testedAtMs: number): LlamaBenchJobState {
  return {
    modelPath,
    state: 'done',
    summary: {
      modelPath,
      ppTokS: 900,
      tgTokS: 100,
      ngl: 99,
      backend: 'Vulkan',
      modelType: 'qwen3 8B Q8_0',
      testedAt: new Date(testedAtMs).toISOString(),
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rec-'));
  file = path.join(tmpDir, 'bench-records.json');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('bench-records 落盘与回灌', () => {
  it('没有文件时返回空数组（首次启动不该报错）', () => {
    expect(loadBenchRecords(file)).toEqual([]);
  });

  it('done 与 error 终态往返后内容一致', () => {
    const done = mkRec(`${tmpDir}/a.gguf`, 1_700_000_000_000);
    const failed: LlamaBenchJobState = { modelPath: `${tmpDir}/b.gguf`, state: 'error', error: 'llama-bench timed out' };
    saveBenchRecords([done, failed], file);
    const back = loadBenchRecords(file);
    expect(back).toHaveLength(2);
    expect(back.find((r) => r.modelPath === done.modelPath)?.summary?.ppTokS).toBe(900);
    expect(back.find((r) => r.modelPath === failed.modelPath)?.error).toBe('llama-bench timed out');
  });

  it('半截 JSON 读回空数组，不抛错', () => {
    fs.writeFileSync(file, '[{"modelPath":"a",', 'utf-8');
    expect(loadBenchRecords(file)).toEqual([]);
  });

  it('running 与缺 summary 的 done 属于坏数据，读回时被丢弃', () => {
    fs.writeFileSync(
      file,
      JSON.stringify([
        { modelPath: 'x', state: 'running' },
        { modelPath: 'y', state: 'done' },
        { state: 'done' },
        mkRec('z', 1_700_000_000_000),
      ]),
      'utf-8',
    );
    expect(loadBenchRecords(file).map((r) => r.modelPath)).toEqual(['z']);
  });

  it('同一路径多次记录只留最后写入的那条', () => {
    const older = mkRec('same.gguf', 1_600_000_000_000);
    const newer = mkRec('same.gguf', 1_700_000_000_000);
    if (newer.summary) newer.summary.ppTokS = 1234;
    saveBenchRecords([older, newer], file);
    const back = loadBenchRecords(file);
    expect(back).toHaveLength(1);
    expect(back[0].summary?.ppTokS).toBe(1234);
  });

  it('超过上限时按 testedAt 留下最近的 BENCH_RECORDS_MAX 条', () => {
    const recs: LlamaBenchJobState[] = [];
    for (let i = 0; i < BENCH_RECORDS_MAX + 5; i++) recs.push(mkRec(`m${i}.gguf`, 1_700_000_000_000 + i * 1000));
    saveBenchRecords(recs, file);
    const back = loadBenchRecords(file);
    expect(back).toHaveLength(BENCH_RECORDS_MAX);
    // 最旧的 5 条（m0..m4）应已被丢掉，最新的必须留着
    const paths = new Set(back.map((r) => r.modelPath));
    expect(paths.has('m0.gguf')).toBe(false);
    expect(paths.has('m4.gguf')).toBe(false);
    expect(paths.has(`m${BENCH_RECORDS_MAX + 4}.gguf`)).toBe(true);
  });

  it('原子写不留 .tmp（配置目录清理器会把 .tmp 当残留删掉）', () => {
    saveBenchRecords([mkRec('a.gguf', 1_700_000_000_000)], file);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(() => JSON.parse(fs.readFileSync(file, 'utf-8'))).not.toThrow();
  });
});
