import { describe, it, expect } from 'vitest';
import { buildCommand } from '../src/command-builder.js';
import { PARAMS, type ParamDef } from '@llama-launcher/shared';

// 表驱动测试：直接从 definitions.ts（唯一事实源）生成用例，
// 新增/修改参数时零成本获得结构约束与发射行为覆盖（DeepSeek 验证文化 → 数据即测试）。
// 使用真实存在的可执行文件路径，通过 buildCommand 的存在性校验。
const EXE_PATH = process.execPath;

/** 生成该参数类型的「非默认」合法值（用于断言发射行为）。 */
function nonDefaultValue(p: ParamDef): string | number | boolean {
  if (p.type === 'checkbox') {
    // 默认 true 的 checkbox（都有 invert_flag）用 false 测 invert；默认 false 用 true 测 flag
    return !p.default;
  }
  if (p.type === 'int_entry' || p.type === 'int_slider') {
    const d = Number(p.default);
    const max = p.max ?? Number.MAX_SAFE_INTEGER;
    return d + 1 <= max ? d + 1 : d - 1;
  }
  if (p.type === 'float_slider') {
    const d = Number(p.default);
    const step = p.step ?? 0.01;
    const max = p.max ?? Number.MAX_SAFE_INTEGER;
    return d + step <= max ? d + step : d - step;
  }
  if (p.type === 'dropdown') {
    const options = (p.options ?? []).map((o) => String(o));
    const alt = options.find((o) => o !== String(p.default));
    return alt ?? String(p.default);
  }
  if (p.type === 'file') return 'C:/models/test.gguf';
  if (p.type === 'dir') return 'C:/models';
  return 'test-value'; // text
}

/** 期望的发射结果（不含 exePath）。 */
function expectedArgs(p: ParamDef, v: string | number | boolean): string[] {
  if (p.type === 'checkbox') {
    return Boolean(v) ? [p.flag] : p.invert_flag ? [p.invert_flag] : [];
  }
  if (p.type === 'float_slider') {
    const rounded = Math.round(Number(v) * 100) / 100;
    return [p.flag, String(rounded)];
  }
  return [p.flag, String(v)];
}

describe('PARAMS 定义表结构（表驱动）', () => {
  it('参数 key 唯一且均带 flag', () => {
    const keys = PARAMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PARAMS) expect(p.flag, p.key).toBeTruthy();
  });

  it('int_entry / int_slider：min <= max 且 default 在范围内', () => {
    for (const p of PARAMS) {
      if (p.type !== 'int_entry' && p.type !== 'int_slider') continue;
      expect(p.min, p.key).toBeDefined();
      expect(p.max, p.key).toBeDefined();
      expect(p.min! <= p.max!, `${p.key} min>max`).toBe(true);
      const d = Number(p.default);
      expect(d >= p.min! && d <= p.max!, `${p.key} default ${d} outside [${p.min}, ${p.max}]`).toBe(true);
    }
  });

  it('float_slider：min < max 且 default 在范围内', () => {
    for (const p of PARAMS) {
      if (p.type !== 'float_slider') continue;
      expect(p.min, p.key).toBeDefined();
      expect(p.max, p.key).toBeDefined();
      expect(p.min! < p.max!, `${p.key} min>=max`).toBe(true);
      const d = Number(p.default);
      expect(d >= p.min! && d <= p.max!, `${p.key} default ${d} outside [${p.min}, ${p.max}]`).toBe(true);
    }
  });

  it('dropdown：选项非空且 default 在选项中', () => {
    for (const p of PARAMS) {
      if (p.type !== 'dropdown') continue;
      expect(p.options && p.options.length > 0, `${p.key} options empty`).toBe(true);
      expect(p.options!.map((o) => String(o)).includes(String(p.default)), `${p.key} default not in options`).toBe(true);
    }
  });

  it('checkbox：必有 flag；默认 true 的必须有 invert_flag', () => {
    for (const p of PARAMS) {
      if (p.type !== 'checkbox') continue;
      expect(p.flag, p.key).toBeTruthy();
      if (p.default === true) {
        expect(p.invert_flag, `${p.key} default true but no invert_flag`).toBeTruthy();
      }
    }
  });
});

describe('按参数类型发射行为（表驱动）', () => {
  it('每个参数显式启用时按其类型发射 flag（及值）', () => {
    for (const p of PARAMS) {
      const v = nonDefaultValue(p);
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: { [p.key]: v, _enabled: JSON.stringify({ [p.key]: true }) },
      });
      const expected = expectedArgs(p, v);
      expect(cmd, p.key).toEqual([EXE_PATH, ...expected]);
    }
  });

  it('每个参数未启用（_enabled=false）时不发射任何 flag', () => {
    for (const p of PARAMS) {
      const v = nonDefaultValue(p);
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: { [p.key]: v, _enabled: JSON.stringify({ [p.key]: false }) },
      });
      expect(cmd, p.key).toEqual([EXE_PATH]);
    }
  });

  it('float_slider 发射 2 位小数（无 float32 噪声）', () => {
    for (const p of PARAMS) {
      if (p.type !== 'float_slider') continue;
      const d = Number(p.default);
      const max = p.max ?? 0;
      // 带多位小数的值（钳制到范围内）
      const v = Math.min(max, d + 0.12345);
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: { [p.key]: v, _enabled: JSON.stringify({ [p.key]: true }) },
      });
      const idx = cmd.indexOf(p.flag);
      expect(idx, p.key).toBeGreaterThan(0);
      const emitted = cmd[idx + 1];
      expect(emitted, p.key).toBe(String(Math.round(v * 100) / 100));
    }
  });
});
