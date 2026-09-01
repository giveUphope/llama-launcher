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
    // 跳过空串：buildCommand 的 shouldSkip 会因 `v === ''` 跳过发射，
    // 取空串会导致「期望发射」与「实际不发射」不一致（典型例子：chat_template 默认 none，
    // options 含 '' 占位但生产代码不发射）。优先选「非默认且非空串」选项。
    const alt = options.find((o) => o !== String(p.default) && o !== '');
    if (alt !== undefined) return alt;
    // 兜底：default 本身就是空串、或除空串外只有一个选项时，用 default；
    // 测试只断言「flag 必须出现」或「不发射任何 flag」两种语义之一，default 走第二条。
    return String(p.default);
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

/**
 * 为带 dependsOn 的参数构造一个"依赖满足"的 values 对象。
 * dependsOn.values 存在时取第一个选项；notValues 存在时取依赖源默认值之外的字符串；
 * 无约束时直接给一个非默认值。同时设置被测参数本身。
 */
function buildValuesWithDeps(p: ParamDef): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { [p.key]: nonDefaultValue(p) };
  if (!p.dependsOn) return out;
  const depDef = PARAMS.find((x) => x.key === p.dependsOn!.key);
  if (!depDef) return out;
  let depValue: string | number | boolean;
  if (p.dependsOn.values && p.dependsOn.values.length > 0) {
    depValue = p.dependsOn.values[0];
  } else if (depDef.type === 'dropdown' && depDef.options && depDef.options.length > 0) {
    // 避开 notValues 与默认值，选一个合法的选项
    const exclude = new Set([
      String(depDef.default),
      ...(p.dependsOn.notValues ?? []).map(String),
    ]);
    const alt = depDef.options.find((o) => !exclude.has(String(o)));
    depValue = alt ?? depDef.options[0];
  } else {
    depValue = 'yes';
  }
  out[p.dependsOn.key] = depValue;
  return out;
}

describe('按参数类型发射行为（表驱动）', () => {
  it('每个参数在依赖满足时按其类型发射 flag（及值）', () => {
    for (const p of PARAMS) {
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: buildValuesWithDeps(p),
      });
      const expected = expectedArgs(p, nonDefaultValue(p));
      for (const arg of expected) {
        expect(cmd, `${p.key}: missing ${arg}`).toContain(arg);
      }
    }
  });

  it('每个参数值等于默认值时不发射任何 flag（checkbox 除外：始终发射 flag/invert_flag）', () => {
    for (const p of PARAMS) {
      if (p.type === 'checkbox') continue;
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: { [p.key]: p.default },
      });
      expect(cmd, p.key).toEqual([EXE_PATH]);
    }
  });

  it('checkbox 即使值等于默认也按 flag/invert_flag 规则发射', () => {
    for (const p of PARAMS) {
      if (p.type !== 'checkbox') continue;
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: { [p.key]: p.default },
      });
      // 默认 true → 发射 flag；默认 false 且有 invert_flag → 发射 invert_flag；
      // 默认 false 且无 invert_flag → 不发射（与现有语义一致）
      const expected = p.default ? [EXE_PATH, p.flag] : (!p.invert_flag ? [EXE_PATH] : [EXE_PATH, p.invert_flag]);
      expect(cmd, p.key).toEqual(expected);
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
