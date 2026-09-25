// /props 回读对账的回归用例。夹具是 2026-09-26 从真机 b11178 实例（用户当前会话，
// 35B-IQ1_M + --temp 1 --top-k 20 --top-p 0.95 --ui --slots）GET /props 抓到的原样字段——
// 用真实回读形状，而不是我想象中的形状：float32 噪声、seed 的 uint32 环绕、
// model_path 的双反斜杠这三处只要猜一次就永远对不上真引擎。
import { describe, it, expect } from 'vitest';
import { ENGINE_BASELINE_BUILD, MODEL_KEY, PARAMS, checkEngineProps, PROPS_FIELD_MAP, propsCheckUnavailable } from '@llama-launcher/shared';
import { verifyEngineProps } from '../src/server-props.js';
import type { PresetValues } from '@llama-launcher/shared';

const REAL_PROPS = {
  total_slots: 4,
  model_alias: 'Qwen3.6-35B-A3B-UD-IQ1_M',
  model_ftype: 'IQ1_M - 1.75 bpw',
  model_path: 'D:\\LLMmodels\\unsloth\\Qwen3.6-35B-A3B-MTP-GGUF\\Qwen3.6-35B-A3B-UD-IQ1_M.gguf',
  endpoint_slots: true,
  endpoint_props: false,
  endpoint_metrics: false,
  ui: true,
  build_info: 'b11178-f9af9be21',
  default_generation_settings: {
    params: {
      seed: 4294967295,
      temperature: 1.0,
      top_k: 20,
      top_p: 0.949999988079071,
      min_p: 0.05000000074505806,
      repeat_penalty: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      reasoning_format: 'none',
      speculative: { types: 'none' },
    },
    // n_ctx 是真机 /props 里 default_generation_settings 的兄弟键（实测 262144）
    n_ctx: 262144,
  },
};

/** 与上面那次启动对应的界面值（含未发射但参与校验的项） */
const sentValues: PresetValues = {
  model: 'D:/LLMmodels/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/Qwen3.6-35B-A3B-UD-IQ1_M.gguf',
  alias: 'Qwen3.6-35B-A3B-UD-IQ1_M',
  // 显式 -c 且 fit 关（fit 开着时引擎会按显存重算 n_ctx，比对必假报，见 skipWhen）
  ctx_size: 262144,
  fit: 'off',
  temperature: 1,
  top_k: 20,
  top_p: 0.95,
  min_p: 0.05,
  repeat_penalty: 1,
  presence_penalty: 0,
  seed: -1,
  ui: true,
  slots_endpoint: true,
  metrics: false,
  parallel: -1,
};

describe('checkEngineProps（/props 回读对账）', () => {
  it('真机回读原样比对：零假报，且确实校验到了映射表里的可核项', () => {
    const r = checkEngineProps(REAL_PROPS, sentValues);
    expect(r.error).toBeNull();
    expect(r.mismatched).toEqual([]);
    // float32 与 uint32 两处归一必须生效，否则 top_p/seed 天天报错
    expect(r.checked).toContain('top_p');
    expect(r.checked).toContain('seed');
    expect(r.checked).toContain('model');
    expect(r.buildInfo).toBe('b11178-f9af9be21');
  });

  it('哨兵/未发值的项跳过而不是判不一致（-np auto 时引擎自算 4，比对必然假报）', () => {
    const r = checkEngineProps(REAL_PROPS, { ...sentValues, parallel: -1, alias: '' });
    expect(r.checked).not.toContain('parallel');
    expect(r.checked).not.toContain('alias');
    expect(r.mismatched).toEqual([]);
    expect(r.skipped).toBeGreaterThan(0);
  });

  it('显式 -np 4 时 total_slots 参与校验；不一致要报出', () => {
    const ok = checkEngineProps(REAL_PROPS, { ...sentValues, parallel: 4 });
    expect(ok.checked).toContain('parallel');
    expect(ok.mismatched).toEqual([]);
    const bad = checkEngineProps(REAL_PROPS, { ...sentValues, parallel: 8 });
    expect(bad.mismatched.map((m) => m.param)).toEqual(['parallel']);
  });

  it('真的不一致要逐项报出 flag / 发出值 / 实际值', () => {
    const r = checkEngineProps(REAL_PROPS, { ...sentValues, top_k: 40, ui: false });
    const byParam = Object.fromEntries(r.mismatched.map((m) => [m.param, m]));
    expect(byParam.top_k).toMatchObject({ flag: '--top-k', sent: 40, actual: 20 });
    expect(byParam.ui).toMatchObject({ flag: '--ui', sent: false, actual: true });
  });

  it('采样族被 env 改写时在这里现形（我们没发射、界面显示缺省值，引擎却用了别的值）', () => {
    const r = checkEngineProps(
      { ...REAL_PROPS, default_generation_settings: { params: { ...REAL_PROPS.default_generation_settings.params, temperature: 0.5 } } },
      { ...sentValues, temperature: 0.8 },
    );
    expect(r.mismatched.map((m) => m.param)).toContain('temperature');
  });

  it('payload 非对象时全部计成 skipped 并标 bad_payload，不产生任何不一致', () => {
    const r = checkEngineProps('<html>not json</html>', sentValues);
    expect(r.error).toBe('bad_payload');
    expect(r.checked).toEqual([]);
    expect(r.mismatched).toEqual([]);
    expect(r.skipped).toBe(PROPS_FIELD_MAP.length);
  });

  it('显式 -c 且 fit 关时 n_ctx 参与校验；不一致要报出', () => {
    const ok = checkEngineProps(REAL_PROPS, { ...sentValues, ctx_size: 262144, fit: 'off' });
    expect(ok.checked).toContain('ctx_size');
    expect(ok.mismatched).toEqual([]);
    const bad = checkEngineProps(REAL_PROPS, { ...sentValues, ctx_size: 8192, fit: 'off' });
    expect(bad.mismatched.map((m) => m.param)).toEqual(['ctx_size']);
  });

  it('fit 开着时不比 n_ctx——引擎会按显存重算，比了必假报', () => {
    const r = checkEngineProps(REAL_PROPS, { ...sentValues, ctx_size: 8192, fit: 'on' });
    expect(r.checked).not.toContain('ctx_size');
    expect(r.mismatched).toEqual([]);
  });

  it('-c 0（从模型加载）属未发值，不比', () => {
    const r = checkEngineProps(REAL_PROPS, { ...sentValues, ctx_size: 0, fit: 'off' });
    expect(r.checked).not.toContain('ctx_size');
    expect(r.mismatched).toEqual([]);
  });

  it('引擎构建与参数基线构建不一致时报 baselineDrift（防拿旧尺子量新引擎）', () => {
    expect(checkEngineProps(REAL_PROPS, sentValues).baselineDrift).toBeNull();
    const newer = checkEngineProps({ ...REAL_PROPS, build_info: 'b11999-deadbeef' }, sentValues);
    expect(newer.baselineDrift).toEqual({ engineBuild: 'b11999', baselineBuild: ENGINE_BASELINE_BUILD });
    // 没有 build_info（老引擎/被裁剪）时不猜，保持安静
    expect(checkEngineProps({ ...REAL_PROPS, build_info: '' }, sentValues).baselineDrift).toBeNull();
  });

  it('映射表的每一项都取得到 /props 值，且参数 key 真实存在（防改名后静默空转）', () => {
    // model 不在 PARAMS 表里：它走 MODEL_KEY + `-m` 特例通道，是这里的唯一合法例外
    const keys = new Set<string>([...PARAMS.map((p) => p.key), MODEL_KEY]);
    for (const m of PROPS_FIELD_MAP) {
      expect(keys.has(m.param), `映射表引用了不存在的参数 ${m.param}`).toBe(true);
      // 取不到值说明 propsPath 写错或引擎不再回读该字段——此时这项永远 skip，等于没在校验
      const probe = checkEngineProps(REAL_PROPS, { ...sentValues, [m.param]: m.param === 'parallel' ? 4 : sentValues[m.param] });
      expect(probe.checked, `${m.param} 未能参与比对（propsPath=${m.propsPath} 取不到值？）`).toContain(m.param);
    }
  });
});

describe('verifyEngineProps（取数失败不得判成不一致）', () => {
  it('fetch 抛错 → error=unreachable 且零不一致', async () => {
    const r = await verifyEngineProps({
      baseUrl: 'http://127.0.0.1:8080',
      values: sentValues,
      fetcher: async () => { throw new Error('ECONNREFUSED'); },
    });
    expect(r.error).toBe('unreachable');
    expect(r.mismatched).toEqual([]);
  });

  it('HTTP 非 2xx → unreachable；200 且 JSON 正常 → 走对账', async () => {
    const bad = await verifyEngineProps({
      baseUrl: 'http://127.0.0.1:8080', values: sentValues,
      fetcher: async () => ({ ok: false, json: null }),
    });
    expect(bad.error).toBe('unreachable');
    const good = await verifyEngineProps({
      baseUrl: 'http://127.0.0.1:9999/', values: sentValues,
      fetcher: async (url) => { expect(url).toBe('http://127.0.0.1:9999/props'); return { ok: true, json: REAL_PROPS }; },
    });
    expect(good.error).toBeNull();
    expect(good.mismatched).toEqual([]);
  });

  it('无 baseUrl（纯 .sock 配置）直接判不可校验，不发起请求', async () => {
    let called = 0;
    const r = await verifyEngineProps({
      baseUrl: '', values: sentValues,
      fetcher: async () => { called++; return { ok: true, json: REAL_PROPS }; },
    });
    expect(r).toEqual(propsCheckUnavailable('unreachable'));
    expect(called).toBe(0);
  });
});
