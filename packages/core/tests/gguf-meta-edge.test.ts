import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGgufMetadata, clearGgufCache } from '../src/gguf-meta.js';

/** GGUF 值类型（与 shared 的 GgufValueType 对齐）。 */
const VT = {
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5,
  FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
} as const;

function ggufString(s: string): Buffer {
  const strBuf = Buffer.from(s, 'utf-8');
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(strBuf.length));
  return Buffer.concat([lenBuf, strBuf]);
}

function ggufKV(key: string, valueType: number, valueBuf: Buffer): Buffer {
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32LE(valueType);
  return Buffer.concat([ggufString(key), typeBuf, valueBuf]);
}

function u32(v: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }
function i64(v: number): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; }
function f64(v: number): Buffer { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; }
function u64(v: number): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }

/** 自由指定版本与计数宽度的文件头组装器。 */
function buildGguf(version: number, tensorCount: Buffer, kvCount: Buffer, kvPairs: Buffer[]): Buffer {
  const magic = Buffer.alloc(4);
  magic.writeUInt32LE(0x46554747); // "GGUF" LE
  const ver = Buffer.alloc(4);
  ver.writeUInt32LE(version);
  return Buffer.concat([magic, ver, tensorCount, kvCount, ...kvPairs]);
}

function buildGgufV3(kvPairs: Buffer[]): Buffer {
  return buildGguf(3, u64(0), u64(kvPairs.length), kvPairs);
}

describe('readGgufMetadata - 结构边界（gguf-meta.test.ts 未覆盖的非法/极端输入）', () => {
  let testDir: string;

  beforeEach(() => {
    clearGgufCache();
    testDir = join(tmpdir(), `llama-gguf-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('版本号不支持（GGUF v4）→ 明确报错，而不是按 v3 猜着解析', async () => {
    // v4 若静默当成 v3 读，uint32/uint64 计数宽度错位会把后续字节全读歪
    const kv = ggufKV('general.architecture', VT.STRING, ggufString('llama'));
    const filePath = join(testDir, 'v4.gguf');
    writeFileSync(filePath, buildGguf(4, u64(0), u64(1), [kv]));

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/Unsupported GGUF version: 4/);
  });

  it('头部声明 2 条元数据但文件在半途截断 → 报 Unexpected end，不产出半份信息', async () => {
    const kv1 = ggufKV('general.architecture', VT.STRING, ggufString('llama'));
    // kvCount 写 2，实际只带 1 条：第二条在读键名长度时越过文件末尾
    const filePath = join(testDir, 'truncated.gguf');
    writeFileSync(filePath, buildGguf(3, u64(0), u64(2), [kv1]));

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/Unexpected end of GGUF file/);
  });

  it('GGUF v1（uint32 计数宽度）正确读取', async () => {
    const kv = ggufKV('general.architecture', VT.STRING, ggufString('llama'));
    const filePath = join(testDir, 'v1.gguf');
    // v1 的 tensor_count / metadata_kv_count 各占 4 字节
    writeFileSync(filePath, buildGguf(1, u32(0), u32(1), [kv]));

    const result = await readGgufMetadata(filePath);
    expect(result.info.version).toBe(1);
    expect(result.info.architecture).toBe('llama');
  });

  it('未知值类型（type=99）→ 明确报错', async () => {
    const kv = ggufKV('custom.weird', 99, Buffer.alloc(4));
    const filePath = join(testDir, 'bad-type.gguf');
    writeFileSync(filePath, buildGgufV3([kv]));

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/Unknown GGUF value type: 99/);
  });

  it('字符串长度字段超限（>10MB）→ 拒绝读取（健全性校验先于读内容）', async () => {
    // 键名正常；值的长度字段写成 11MB——文件本身只有几十字节，
    // 该校验必须在读内容之前生效，否则会先尝试分配 11MB 缓冲
    const key = ggufString('general.name');
    const type = Buffer.alloc(4);
    type.writeUInt32LE(VT.STRING);
    const hugeLen = Buffer.alloc(8);
    hugeLen.writeBigUInt64LE(BigInt(11 * 1024 * 1024));
    const filePath = join(testDir, 'huge-string.gguf');
    writeFileSync(filePath, buildGgufV3([Buffer.concat([key, type, hugeLen])]));

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/GGUF string too large/);
  });

  it('字符串数组声明的长度越出文件末尾 → Skip past end of file', async () => {
    // 数组声明 1 个字符串、长度写 100，但文件在长度字段后只剩 4 字节：
    // skipStringArray 的块内快速路径必须同样被越界守卫拦住
    const arrType = u32(VT.STRING);
    const arrLen = u64(1);
    const elemLen = Buffer.alloc(8);
    elemLen.writeBigUInt64LE(BigInt(100));
    const kv = ggufKV('tokenizer.ggml.tokens', VT.ARRAY, Buffer.concat([arrType, arrLen, elemLen]));
    const filePath = join(testDir, 'array-overflow.gguf');
    writeFileSync(filePath, buildGgufV3([kv]));

    await expect(readGgufMetadata(filePath)).rejects.toThrow(/Skip past end of file/);
  });

  it('INT64 / FLOAT64 值类型正确读出（含负数与大数）', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('custom.big_i64', VT.INT64, i64(-5000000000)),
      ggufKV('custom.big_f64', VT.FLOAT64, f64(0.15625)),
      ggufKV('custom.big_u64', VT.UINT64, u64(1 << 30)),
    ];
    const filePath = join(testDir, 'wide-types.gguf');
    writeFileSync(filePath, buildGgufV3(kvPairs));

    const result = await readGgufMetadata(filePath);
    expect(result.info.metadata['custom.big_i64']).toBe(-5000000000);
    expect(result.info.metadata['custom.big_f64']).toBeCloseTo(0.15625);
    expect(result.info.metadata['custom.big_u64']).toBe(1 << 30);
  });
});

describe('readGgufMetadata - 结果缓存（mtime+size 键控，clearGgufCache 可清）', () => {
  let testDir: string;

  beforeEach(() => {
    clearGgufCache();
    testDir = mkdtempSync(join(tmpdir(), 'llama-gguf-cache-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('同文件同指纹二次读取直接命中缓存（同一结果对象），clear 后重新解析', async () => {
    const kvPairs = [
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Cache Probe')),
    ];
    const filePath = join(testDir, 'cached.gguf');
    writeFileSync(filePath, buildGgufV3(kvPairs));

    const first = await readGgufMetadata(filePath);
    const second = await readGgufMetadata(filePath);
    // 引用相等 ⇒ 走的是缓存而非重新 IO（重解析会产出新对象）
    expect(second).toBe(first);

    clearGgufCache();
    const third = await readGgufMetadata(filePath);
    expect(third).not.toBe(first);
    expect(third.info.name).toBe('Cache Probe'); // 内容一致：解析是确定性的
  });

  it('文件内容变化（大小不同 ⇒ 键不同）→ 重新解析出新内容，不返回旧结果', async () => {
    const filePath = join(testDir, 'mutated.gguf');
    writeFileSync(filePath, buildGgufV3([
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('Before')),
    ]));
    const before = await readGgufMetadata(filePath);

    // 写入不同长度的内容 ⇒ stat.size 必然变化，缓存键随之失效
    writeFileSync(filePath, buildGgufV3([
      ggufKV('general.architecture', VT.STRING, ggufString('llama')),
      ggufKV('general.name', VT.STRING, ggufString('After-Edit')),
      ggufKV('general.size_label', VT.STRING, ggufString('7B')),
    ]));
    const after = await readGgufMetadata(filePath);

    expect(after).not.toBe(before);
    expect(after.info.name).toBe('After-Edit');
  });
});
