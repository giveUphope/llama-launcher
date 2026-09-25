import { describe, it, expect } from 'vitest';
import { buildCommand } from '../src/command-builder.js';
import {
  PARAMS, engineDefaultOf, isSentinelValue, sameParamValue,
  type ParamDef,
} from '@llama-launcher/shared';

// 表驱动测试：直接从 definitions.ts（唯一事实源）生成用例，
// 新增/修改参数时零成本获得结构约束与发射行为覆盖（DeepSeek 验证文化 → 数据即测试）。
// 使用真实存在的可执行文件路径，通过 buildCommand 的存在性校验。
const EXE_PATH = process.execPath;

/** 全部参数的界面初值（= 启动器基线），用于「默认状态下应发射什么」的快照断言。 */
const PARAMS_DEFAULTS: Record<string, string | number | boolean> = Object.fromEntries(
  PARAMS.map((p) => [p.key, p.default]),
);

/** 该值是否会被发射规则跳过（空串 / 哨兵 / 等于引擎缺省）。 */
function wouldSkip(p: ParamDef, v: string | number | boolean): boolean {
  if (p.type === 'checkbox') return false; // checkbox 恒定发射，不参与本判定
  if (v === '') return true;
  if (isSentinelValue(p, v)) return true;
  return sameParamValue(v, engineDefaultOf(p));
}

/**
 * 生成该参数「一定会发射」的取值（用于断言发射行为）。
 * 注意基准是 **engineDefault（引擎缺省）而不是 default（界面初值）**：
 * 后者的本意常常是启动器的基线推荐（q8_0 / none / off），拿它当"不该发射"的基准，
 * 就等于把推荐值永久挡在命令行之外——2026-09-25 修掉的正是这个混淆。
 * 返回 null 表示该参数没有任何可发射的取值（由下面的结构断言兜住）。
 */
function emittableValue(p: ParamDef): string | number | boolean | null {
  if (p.type === 'checkbox') return !p.default;
  const pick = <T>(list: T[]): T | undefined => list.find((v) => !wouldSkip(p, v as string | number | boolean));
  if (p.type === 'dropdown') return pick((p.options ?? []).map(String));
  if (p.type === 'int_entry' || p.type === 'int_slider' || p.type === 'float_slider') {
    const base = Number(engineDefaultOf(p));
    const step = p.step ?? 1;
    const cands = [base + step * 3, base - step * 3, base + 1, 1, 7, 4096]
      .filter((n) => Number.isFinite(n))
      .filter((n) => (p.min === undefined || n >= p.min) && (p.max === undefined || n <= p.max));
    if (p.type === 'float_slider') cands.forEach((n, i) => { cands[i] = Math.round(n * 100) / 100; });
    return pick(cands);
  }
  if (p.type === 'file') return 'C:/models/test.gguf';
  if (p.type === 'dir') return 'C:/models';
  return pick(['test-value', 'on']);
}

/** 该参数的引擎缺省值（发射判定的跳过基准）。 */
function engineDefault(p: ParamDef): string | number | boolean {
  return engineDefaultOf(p);
}

/** 期望的发射结果（不含 exePath）。 */
function expectedArgs(p: ParamDef, v: string | number | boolean): string[] {
  if (p.type === 'checkbox') {
    return v ? [p.flag] : p.invert_flag ? [p.invert_flag] : [];
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
  const out: Record<string, string | number | boolean> = { [p.key]: emittableValue(p) ?? p.default };
  if (!p.dependsOn) return out;
  const depDef = PARAMS.find((x) => x.key === p.dependsOn!.key);
  if (!depDef) return out;
  let depValue: string | number | boolean;
  if (p.dependsOn.values && p.dependsOn.values.length > 0) {
    depValue = p.dependsOn.values[0];
  } else if (depDef.type === 'dropdown' && depDef.options && depDef.options.length > 0) {
    // 避开 notValues 与依赖源的界面默认值（依赖判定看的是"用户有没有动过"，用 default 而非 engineDefault）
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
  it('每个非 checkbox 参数都至少有一个会发射的取值（防止选项被引擎缺省/哨兵吃光）', () => {
    for (const p of PARAMS) {
      if (p.type === 'checkbox') continue;
      expect(emittableValue(p), `${p.key} 无可发射取值（options 全等于引擎缺省或全是哨兵）`).not.toBeNull();
    }
  });

  it('每个参数在依赖满足时按其类型发射 flag（及值）', () => {
    for (const p of PARAMS) {
      const v = emittableValue(p) ?? p.default;
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: buildValuesWithDeps(p),
      });
      const expected = expectedArgs(p, v);
      for (const arg of expected) {
        expect(cmd, `${p.key}: missing ${arg}`).toContain(arg);
      }
    }
  });

  it('值等于【引擎缺省】时不发射任何 flag（checkbox 除外：始终发射 flag/invert_flag）', () => {
    for (const p of PARAMS) {
      if (p.type === 'checkbox') continue;
      const cmd = buildCommand({
        exePath: EXE_PATH,
        modelPath: '',
        values: { [p.key]: engineDefault(p) },
      });
      expect(cmd, `${p.key} 值=引擎缺省却发射了`).toEqual([EXE_PATH]);
    }
  });

  it('显式哨兵值不发射（UI 用它表示「不指定」）', () => {
    const cases: Array<[string, string | number]> = [
      ['chat_template', 'none'], // 引擎默认取模型自带模板，none 与之等价
      ['kv_unified_per_slot', 0], // help 默认 unset
      ['reasoning', ''], // 空串统一视为不指定
    ];
    for (const [key, v] of cases) {
      const p = PARAMS.find((x) => x.key === key)!;
      const cmd = buildCommand({ exePath: EXE_PATH, modelPath: '', values: { [key]: v } });
      expect(cmd, `${key}=${String(v)} 不该发射 ${p.flag}`).toEqual([EXE_PATH]);
    }
  });

  // 2026-09-25 的坑：这 4 项是 definitions.ts 文件头记录的「基线推荐值」，
  // 旧规则拿界面初值当发射基准，于是它们从未进过命令行——引擎一直按自己的缺省跑。
  it('基线推荐值必须真的发射（-ctk/-ctv q8_0、--load-mode none、--fit off）', () => {
    const cmd = buildCommand({ exePath: EXE_PATH, modelPath: '', values: { ...PARAMS_DEFAULTS } });
    expect(cmd).toContain('--load-mode');
    expect(cmd[cmd.indexOf('--load-mode') + 1]).toBe('none');
    expect(cmd).toContain('--fit');
    expect(cmd[cmd.indexOf('--fit') + 1]).toBe('off');
    expect(cmd).toContain('-ctk');
    expect(cmd[cmd.indexOf('-ctk') + 1]).toBe('q8_0');
    expect(cmd).toContain('-ctv');
    expect(cmd[cmd.indexOf('-ctv') + 1]).toBe('q8_0');
  });

  it('默认状态下的发射集合固定（新增参数/改默认值都会在这里显式暴露）', () => {
    // 直接从 buildCommand 取默认状态发射的 flag 集合作快照：checkbox 默认 false 且无 invert_flag
    // 的参数（--metrics / --props / --swa-full）不发射任何东西，映射容易写错，故不自己推。
    const cmd = buildCommand({ exePath: EXE_PATH, modelPath: '', values: PARAMS_DEFAULTS });
    const emitted = cmd.slice(1).filter((t) => String(t).startsWith('-')).sort();
    // 9 项来自 checkbox（恒定发射），4 项是启动器覆盖引擎缺省的基线推荐
    expect(emitted).toEqual([
      '--cache-prompt', '--fit', '--jinja', '--load-mode', '--mmproj-offload',
      '--no-context-shift', '--no-kv-unified', '--slots', '--ui',
      '-cb', '-ctk', '-ctv', '-kvo',
    ]);
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
