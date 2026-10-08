import { describe, it, expect } from 'vitest';
import {
  PARAMS,
  sameParamValue,
  isSentinelValue,
  isUnsetValue,
  engineDefaultOf,
  type ParamDef,
} from '@llama-launcher/shared';

function def(key: string): ParamDef {
  const p = PARAMS.find((d) => d.key === key);
  if (!p) throw new Error(`param not found: ${key}`);
  return p;
}

/**
 * 发射判定三件套的直接边界用例。这三个函数是「值 == 引擎缺省 ⇒ 不发射」规则的地基，
 * 既有测试都经由 buildCommand 间接覆盖，这里把分支本身钉住。
 */
describe('sameParamValue（宽松相等：help/表单可能一边数字一边字符串）', () => {
  it('数字与数字字符串相等：4 == "4"、0.8 == "0.8"、-1 == "-1"', () => {
    expect(sameParamValue(4, '4')).toBe(true);
    expect(sameParamValue(0.8, '0.8')).toBe(true);
    expect(sameParamValue(-1, '-1')).toBe(true);
  });

  it('两边都无法转数字时退化为字符串比较：true == "true"，"abc" != "abd"', () => {
    expect(sameParamValue(true, 'true')).toBe(true);
    expect(sameParamValue('abc', 'abc')).toBe(true);
    expect(sameParamValue('abc', 'abd')).toBe(false);
  });

  it('数字路径是精确比较：0.30000000000000004 != 0.3（float32 容差在对账层，不在这里）', () => {
    expect(sameParamValue(0.1 + 0.2, 0.3)).toBe(false);
    expect(sameParamValue(0.57, 0.57)).toBe(true);
  });

  it('空串在数字路径上等于 0：这就是发射判定必须先查 isUnsetValue 的原因', () => {
    // Number('') === 0 → 若先比相等，空串会把「引擎缺省 0」的参数误判成已指定
    expect(sameParamValue('', 0)).toBe(true);
  });
});

describe('isSentinelValue（显式哨兵：交引擎决定，即使 ≠ 引擎缺省也不发射）', () => {
  it('chat_template 的哨兵 none：true；engineDefault 本身（model-metadata）不是哨兵', () => {
    expect(isSentinelValue(def('chat_template'), 'none')).toBe(true);
    expect(isSentinelValue(def('chat_template'), 'model-metadata')).toBe(false);
  });

  it('kv_unified_per_slot 的哨兵 0（UI 的「不设上限」）：true；其他数字 false', () => {
    expect(isSentinelValue(def('kv_unified_per_slot'), 0)).toBe(true);
    expect(isSentinelValue(def('kv_unified_per_slot'), 100)).toBe(false);
  });

  it('未登记哨兵的参数一律 false（哪怕值等于引擎缺省——那是 engineDefault 的职责）', () => {
    expect(isSentinelValue(def('temperature'), 0.8)).toBe(false);
    expect(isSentinelValue(def('ctx_size'), 0)).toBe(false);
  });

  it('哨兵匹配走宽松相等：字符串数字哨兵对数字值也命中', () => {
    expect(isSentinelValue(def('kv_unified_per_slot'), '0')).toBe(true);
  });
});

describe('isUnsetValue（空串 = 不指定，所有类型统一不发射）', () => {
  it('空串 true；数字 0 / 字符串 none / 布尔 false 都不是「未指定」', () => {
    expect(isUnsetValue('')).toBe(true);
    expect(isUnsetValue(0)).toBe(false);
    expect(isUnsetValue('none')).toBe(false);
    expect(isUnsetValue(false)).toBe(false);
  });
});

describe('engineDefaultOf（发射基准；未登记回退 default，缺登记由门禁兜）', () => {
  it('登记过的参数取 engineDefault：temperature → 0.8（而 UI 初值可能是别的推荐值）', () => {
    expect(engineDefaultOf(def('temperature'))).toBe(0.8);
    expect(engineDefaultOf(def('cache_type_k'))).toBe('f16');
  });

  it('未登记的参数回退 p.default（防御性回退，正常应由门禁拦截缺登记）', () => {
    const synthetic = { key: 'not_in_baseline', default: 'fallback-value' } as ParamDef;
    expect(engineDefaultOf(synthetic)).toBe('fallback-value');
  });
});
