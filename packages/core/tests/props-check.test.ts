// /props 回读对账的回归用例。夹具是 2026-09-26 从真机 b11178 实例（用户当前会话，
// 35B-IQ1_M + --temp 1 --top-k 20 --top-p 0.95 --ui --slots）GET /props 抓到的原样字段——
// 用真实回读形状，而不是我想象中的形状：float32 噪声、seed 的 uint32 环绕、
// model_path 的双反斜杠这三处只要猜一次就永远对不上真引擎。
import { describe, it, expect } from 'vitest';
import { ENGINE_BASELINE_BUILD, MODEL_KEY, PARAMS, PROPS_FIELD_MAP, checkEngineProps, engineDefaultOf, readPropsPath, sameParamValue } from '@llama-launcher/shared';
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
  props_endpoint: false,
  parallel: -1,
};

/* ------------------------------------------------------------------ *
 * 2026-10 真机取证夹具（三份，全部原样裁剪，非构造）
 * 机器：AMD RX 7900 XTX + Vulkan；端口 8099（不碰用户自己的 8080）；收尾只杀自己起的 PID。
 * 每次抓取都核对过：/props 的叶路径恒为 70 个，三份抓取的**键集完全相同**。
 *
 * re-pin 注意（AGENTS.md「回读校验」条的既有纪律）：下面两个 build_info 都是真机原样串，
 * **不要**改成 `${ENGINE_BASELINE_BUILD}-…`——它们是实测数据而不是「当前基线」的第二个副本。
 * 基线挪到更新的构建后，这两份会自然变成「比基线旧」的形状，本文件没有任何断言依赖它们等于基线
 * （唯一依赖基线相等性的断言在 baselineDrift 用例里，那条已从常量派生）。
 * ------------------------------------------------------------------ */

/** A. b11408（上一代基线引擎，2026-10-09 re-pin 到 b11524 后已比基线旧；字段/断言不含漂移语义，夹具按真机原样保留）+ Qwen3.8-27B-UD-Q2_K_XL，命令行只多发了 `-c 4096`，未发 --props */
const B11408_NO_PROPS = {
  total_slots: 4,
  model_alias: 'D:/LLMmodels/unsloth/Qwen3.8-27B-GGUF/Qwen3.8-27B-UD-Q2_K_XL.gguf',
  model_ftype: 'Q2_K - Medium',
  model_path: 'D:/LLMmodels/unsloth/Qwen3.8-27B-GGUF/Qwen3.8-27B-UD-Q2_K_XL.gguf',
  endpoint_slots: true,
  endpoint_props: false,
  endpoint_metrics: false,
  ui: true,
  build_info: 'b11408-9f12cd4a4',
  default_generation_settings: {
    params: {
      seed: 4294967295,
      temperature: 1,
      top_k: 20,
      top_p: 0.949999988079071,
      min_p: 0.05000000074505806,
      repeat_penalty: 1,
      presence_penalty: 0,
      // 下面两条与我们的 flag 同名却不同义（发了 flag 它们也不动）——props-mapping.ts 的「评估后不收」有账
      reasoning_format: 'none',
      'speculative.types': 'none',
    },
    n_ctx: 4096,
  },
};

/** B. 同一引擎、同一模型的第二次抓取，命令行多发了 `--props --reasoning-format deepseek --spec-type ngram-mod --seed 4321 --temp 0.55`
 *  与 A 相比只有 4 个值变了：endpoint_props(false→true)、seed、temperature、media_marker（每次随机，不比对）。 */
const B11408_PROPS_ON = {
  ...B11408_NO_PROPS,
  endpoint_props: true,
  default_generation_settings: {
    ...B11408_NO_PROPS.default_generation_settings,
    params: {
      ...B11408_NO_PROPS.default_generation_settings.params,
      seed: 4321,
      temperature: 0.550000011920929,
    },
  },
};

/** C. 更旧的引擎 `llama-prism-b10754-2459f68-bin-win-vulkan-x64` + Ternary-Bonsai-2-27B-PQ2_0（`-c 4096`）
 *  这份就是「引擎比基线旧 ⇒ 必须告警」那一支的真机证据（此前本机只有一个引擎，未验证）。 */
const B10754_OLDER_ENGINE = {
  ...B11408_NO_PROPS,
  model_alias: 'D:/LLMmodels/prism-ml/Ternary-Bonsai-2-27B-gguf/Ternary-Bonsai-2-27B-PQ2_0.gguf',
  model_ftype: 'PQ2_0 - 2.13 bpw (group 128)',
  model_path: 'D:/LLMmodels/prism-ml/Ternary-Bonsai-2-27B-gguf/Ternary-Bonsai-2-27B-PQ2_0.gguf',
  build_info: 'b10754-2459f68b5',
};

/** 「没人动过参数」的启动形态：全部 PARAMS 初值 + 真机这次实际发的 `-c 4096` */
function valuesAtUiDefaults(modelPath: string, over: PresetValues = {}): PresetValues {
  const base = Object.fromEntries(PARAMS.map((p) => [p.key, p.default]));
  return { ...base, model: modelPath, ctx_size: 4096, ...over } as PresetValues;
}

/**
 * 给「每一项都接得上线」那条守卫把值改成「必然算已发射」的形态。
 * 判「发没发」的是 shared 的发射基准（engineDefaultOf + sameParamValue），守卫不能凭猜，
 * 所以这里复用同一对函数：与引擎缺省同值（= 不会出现在命令行上）就换一个必然不同的值，其余原样。
 */
function probeValue(m: (typeof PROPS_FIELD_MAP)[number]): unknown {
  const base = sentValues[m.param];
  const def = PARAMS.find((p) => p.key === m.param);
  if (def === undefined || !sameParamValue(base, engineDefaultOf(def))) return base;
  switch (m.kind) {
    case 'num':
      return Number(engineDefaultOf(def)) + 7;
    case 'bool':
      return base !== true;
    case 'seed':
      return 12345;
    case 'path':
      return `${String(base) || 'probe.gguf'}`;
    default:
      return `${String(base)}_probe`;
  }
}


describe('checkEngineProps（/props 回读对账）', () => {
  it('真机回读原样比对：零假报，且确实校验到了映射表里的可核项', () => {
    const r = checkEngineProps(REAL_PROPS, sentValues);
    expect(r.error).toBeNull();
    expect(r.mismatched).toEqual([]);
    // uint32 环绕（seed）与路径归一（model）两处必须生效，否则天天报错。
    // top_p 在这里是「未发射」形态（0.95 == 引擎缺省），按 modelDerived 规则归入 skipped，
    // float32 噪声的容忍改由下面那条专门用例守——别把这条当成归一失效。
    expect(r.checked).toContain('seed');
    expect(r.checked).toContain('model');
    expect(r.checked).not.toContain('top_p');
    expect(r.buildInfo).toBe('b11178-f9af9be21');
  });

  it('float32 噪声要容忍：发出去的 0.57 回读 0.570000022649955 不许报，差出容差才报', () => {
    const noisy = {
      ...REAL_PROPS,
      default_generation_settings: {
        params: { ...REAL_PROPS.default_generation_settings.params, presence_penalty: 0.570000022649955 },
      },
    };
    // 0.57 != 引擎缺省 0 ⇒ 真的上了命令行，所以这一项必须被核（不能借 modelDerived 蒙混跳过）
    const r = checkEngineProps(noisy, { ...sentValues, presence_penalty: 0.57 });
    expect(r.checked).toContain('presence_penalty');
    expect(r.mismatched).toEqual([]);
    // 判别对照：容差不是万金油，超出 PROPS_NUM_TOL 的差必须报出来
    const far = checkEngineProps(noisy, { ...sentValues, presence_penalty: 0.58 });
    expect(far.mismatched.map((m) => m.param)).toEqual(['presence_penalty']);
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
    // top_k 用 100 而不是 40：40 正是引擎缺省，按发射规则它不会出现在命令行上，
    // 那种差值现在归「模型自带的 general.sampling.top_k」（见 modelDerived 那组用例）
    const r = checkEngineProps(REAL_PROPS, { ...sentValues, top_k: 100, ui: false });
    const byParam = Object.fromEntries(r.mismatched.map((m) => [m.param, m]));
    expect(byParam.top_k).toMatchObject({ flag: '--top-k', sent: 100, actual: 20 });
    expect(byParam.ui).toMatchObject({ flag: '--ui', sent: false, actual: true });
  });

  it('采样族被 env 改写时在这里现形（我们没发射、界面显示缺省值，引擎却用了别的值）', () => {
    const shifted = {
      ...REAL_PROPS,
      default_generation_settings: { params: { ...REAL_PROPS.default_generation_settings.params, temperature: 0.5 } },
    };
    // 名单命中该参数的 env 通道 ⇒ 差值有唯一可归因的来源，必须报
    const r = checkEngineProps(shifted, { ...sentValues, temperature: 0.8 }, 0, ['LLAMA_ARG_TEMPERATURE']);
    expect(r.mismatched.map((m) => m.param)).toContain('temperature');
    // 同一份差值、名单里没有这个通道 ⇒ 来源可能是模型自带的 general.sampling.temp，
    // 无法归因就不许出声（真机上这一条会把整批「模型推荐采样」误报成「参数没生效」）
    const silent = checkEngineProps(shifted, { ...sentValues, temperature: 0.8 });
    expect(silent.mismatched.map((m) => m.param)).not.toContain('temperature');
    expect(silent.checked).not.toContain('temperature');
    // 对照：别的通道命中，不能替 temperature 出声（判据不是「有没有 env 覆写」那种粗粒度）
    const otherChannel = checkEngineProps(shifted, { ...sentValues, temperature: 0.8 }, 0, ['LLAMA_ARG_TOP_K']);
    expect(otherChannel.mismatched.map((m) => m.param)).not.toContain('temperature');
  });

  it('payload 非对象时全部计成 skipped 并标 bad_payload，不产生任何不一致', () => {
    const r = checkEngineProps('<html>not json</html>', sentValues);
    expect(r.error).toBe('bad_payload');
    expect(r.checked).toEqual([]);
    expect(r.mismatched).toEqual([]);
    expect(r.skipped).toBe(PROPS_FIELD_MAP.length);
  });

  it('单槽时 n_ctx 参与校验，不一致要报出（b11408 真机 -np 1 实测形状）', () => {
    const single = {
      ...REAL_PROPS,
      total_slots: 1,
      default_generation_settings: { ...REAL_PROPS.default_generation_settings, n_ctx: 4096 },
    };
    const ok = checkEngineProps(single, { ...sentValues, ctx_size: 4096, fit: 'off' });
    expect(ok.checked).toContain('ctx_size');
    expect(ok.mismatched).toEqual([]);
    const bad = checkEngineProps(single, { ...sentValues, ctx_size: 8192, fit: 'off' });
    expect(bad.mismatched.map((m) => m.param)).toEqual(['ctx_size']);
  });

  it('多槽时不比 n_ctx——b11408 真机实测它回读的是**每槽**值（同一 -c 4096：-np 4 → 1024、-np 1 → 4096），比了必假报', () => {
    // 夹具 REAL_PROPS 的 total_slots 是 4：这条同时守住「不假报」与「不参与」
    const r = checkEngineProps(REAL_PROPS, { ...sentValues, ctx_size: 1024, parallel: 4, fit: 'off' });
    expect(r.checked).not.toContain('ctx_size');
    expect(r.mismatched.map((m) => m.param)).not.toContain('ctx_size');
    // 反证：若把发出值乘回槽数去比（1024×4=4096 ≠ 引擎给的每槽 1024），才会去报不一致——
    // 乘回不可行还因为 4097÷4 向下取整成 1024，任何算术补偿都会重新制造假报
    const noGate = checkEngineProps({ ...REAL_PROPS, total_slots: 1 }, { ...sentValues, ctx_size: 1024, fit: 'off' });
    expect(noGate.mismatched.map((m) => m.param)).toContain('ctx_size');
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

  it('baselineDrift 只在引擎比基线旧时出声（2026-10-06 起方向性，新引擎不 nag）', () => {
    // 「相等 ⇒ 不报漂移」这条分支必须拿当前基线来验，否则每次 re-pin 都会假失败（b11243 那轮即撞上）。
    // 夹具的 build_info 是真机抓到的原样串，按历史保留；它现在确实比基线旧，就如实断言漂移。
    expect(
      checkEngineProps({ ...REAL_PROPS, build_info: `${ENGINE_BASELINE_BUILD}-fc07d781e` }, sentValues).baselineDrift,
    ).toBeNull();
    expect(checkEngineProps(REAL_PROPS, sentValues).baselineDrift).toEqual({
      engineBuild: 'b11178',
      baselineBuild: ENGINE_BASELINE_BUILD,
    });
    // 引擎比基线新：刻意不再出声。基线始终钉在本项目已核对的最新版，抢先升级的用户
    // 每个都收到一条「基线过期」只会让这条告警被无视掉。这条断言钉的是**代价**，
    // 不是漏检——真要恢复双向告警，改 driftOf 并同步本用例与 §5.5 的「当前实测」段。
    const newer = checkEngineProps({ ...REAL_PROPS, build_info: 'b11999-deadbeef' }, sentValues);
    expect(newer.baselineDrift).toBeNull();
    // 没有 build_info（老引擎/被裁剪）时不猜，保持安静
    expect(checkEngineProps({ ...REAL_PROPS, build_info: '' }, sentValues).baselineDrift).toBeNull();
  });

  it('映射表的每一项都取得到 /props 值，且参数 key 真实存在（防改名后静默空转）', () => {
    // model 不在 PARAMS 表里：它走 MODEL_KEY + `-m` 特例通道，是这里的唯一合法例外
    const keys = new Set<string>([...PARAMS.map((p) => p.key), MODEL_KEY]);
    for (const m of PROPS_FIELD_MAP) {
      expect(keys.has(m.param), `映射表引用了不存在的参数 ${m.param}`).toBe(true);
      // ① propsPath 有没有失效——直接在夹具上走一遍取数。必须用实现里同一个函数：测试另抄一份
      //    路径遍历，就会和实现各说各话（取不到值说明 propsPath 写错或引擎不再回读该字段）。
      expect(readPropsPath(REAL_PROPS, m.propsPath), `propsPath=${m.propsPath} 在夹具上取不到值`).not.toBeUndefined();
      // ② 这一项在「我们真的发了值」时确实进入比对。带闸门 / onlyWhenSent 的项先把条件放开再测：
      //    本用例守的是接线，不守跳过规则（跳过规则各有自己的用例，两者不互相顶包）。
      const probeProps = m.skipWhenProps
        ? { ...REAL_PROPS, [m.skipWhenProps.path]: 1 }
        : REAL_PROPS;
      const probe = checkEngineProps(probeProps, { ...sentValues, [m.param]: probeValue(m) });
      expect(probe.checked, `${m.param} 未能参与比对（propsPath=${m.propsPath} 取不到值？）`).toContain(m.param);
    }
  });
});

describe('props_endpoint → endpoint_props（本轮新增，真机两态各抓过一次）', () => {
  /** 只取 param 列表：这份夹具的采样项是模型推荐值（见下方「已修」用例），别让它们盖住本用例的结论 */
  const paramsOf = (r: { mismatched: { param: string }[] }) => r.mismatched.map((m) => m.param);

  it('未发 --props：引擎回读 endpoint_props=false，与界面值相等 → 该项参与校验且不算不一致', () => {
    const r = checkEngineProps(B11408_NO_PROPS, valuesAtUiDefaults(B11408_NO_PROPS.model_path));
    expect(r.checked).toContain('props_endpoint');
    expect(paramsOf(r)).not.toContain('props_endpoint');
  });

  it('发了 --props：引擎回读 endpoint_props=true（真机第二份抓取）→ 同样一致', () => {
    const r = checkEngineProps(
      B11408_PROPS_ON,
      valuesAtUiDefaults(B11408_PROPS_ON.model_path, { props_endpoint: true, seed: 4321, temperature: 0.55 }),
    );
    expect(r.checked).toContain('props_endpoint');
    expect(paramsOf(r)).not.toContain('props_endpoint');
  });

  it('反证①：界面显示开了 --props 而引擎回读 false → 必须报出 --props 不一致', () => {
    const r = checkEngineProps(B11408_NO_PROPS, valuesAtUiDefaults(B11408_NO_PROPS.model_path, { props_endpoint: true }));
    expect(r.mismatched).toContainEqual({ param: 'props_endpoint', flag: '--props', sent: true, actual: false });
  });

  it('反证②（env 通道）：界面没开而 LLAMA_ARG_ENDPOINT_PROPS 把它打开 → 报不一致，方向不能反', () => {
    const r = checkEngineProps(B11408_PROPS_ON, valuesAtUiDefaults(B11408_PROPS_ON.model_path, { props_endpoint: false }));
    expect(r.mismatched).toContainEqual({ param: 'props_endpoint', flag: '--props', sent: false, actual: true });
  });

  it('反证③（新守卫自己得会红）：把 endpoint_props 从夹具里抹掉 → 该项退回 skipped，而不是默默算通过', () => {
    const noKey = { ...B11408_NO_PROPS } as Record<string, unknown>;
    delete noKey.endpoint_props;
    const r = checkEngineProps(noKey, valuesAtUiDefaults(B11408_NO_PROPS.model_path, { props_endpoint: true }));
    expect(r.checked).not.toContain('props_endpoint');
    expect(paramsOf(r)).not.toContain('props_endpoint');
  });
});

describe('baselineDrift：引擎比基线旧 ⇒ 告警（2026-10 真机确证，此前本机只有基线那一个引擎）', () => {
  /** 与那份 b10754 抓取相配的值表（「没人动过参数」的启动形态） */
  const olderValues = () => valuesAtUiDefaults(B10754_OLDER_ENGINE.model_path);

  it('b10754 真机 payload 判出 baselineDrift = { engineBuild: b10754, baselineBuild: 当前基线 }', () => {
    const r = checkEngineProps(B10754_OLDER_ENGINE, olderValues());
    expect(r.buildInfo).toBe('b10754-2459f68b5'); // 真机原样串，按抓到的保留
    expect(r.baselineDrift).toEqual({ engineBuild: 'b10754', baselineBuild: ENGINE_BASELINE_BUILD });
    // 这份夹具必须真的比基线旧，否则 re-pin 之后本用例会悄悄什么也不断（基线值由常量派生，不写死）
    expect(Number('10754')).toBeLessThan(Number(ENGINE_BASELINE_BUILD.slice(1)));
    // 控制组：只把 build_info 换成当前基线，同一份 payload 立刻安静 ⇒ 告警确实只由构建号触发
    expect(
      checkEngineProps({ ...B10754_OLDER_ENGINE, build_info: `${ENGINE_BASELINE_BUILD}-2459f68b5` }, olderValues()).baselineDrift,
    ).toBeNull();
  });

  it('经 verifyEngineProps（注入假 fetcher）也带得出漂移——取数层没把它吞掉', async () => {
    const r = await verifyEngineProps({
      baseUrl: 'http://127.0.0.1:8099',
      values: olderValues(),
      fetcher: async () => ({ ok: true, json: B10754_OLDER_ENGINE }),
    });
    expect(r.error).toBeNull();
    expect(r.baselineDrift).toEqual({ engineBuild: 'b10754', baselineBuild: ENGINE_BASELINE_BUILD });
  });
});

describe('评估后故意不收的候选（真机反证，防止下一个人凭同名键重新塞进映射）', () => {
  it('reasoning_format / spec_type / chat_template 都不在映射表里', () => {
    for (const key of ['reasoning_format', 'spec_type', 'chat_template', 'cors_credentials', 'lazy_mode']) {
      expect(PROPS_FIELD_MAP.some((m) => m.param === key), `${key} 不该进映射`).toBe(false);
    }
  });

  it('真机反证：发了 --reasoning-format deepseek 与 --spec-type ngram-mod，/props 那两个同名键仍是 "none"', () => {
    const pr = B11408_PROPS_ON.default_generation_settings.params;
    expect(pr.reasoning_format).toBe('none');
    expect(pr['speculative.types']).toBe('none');
    // 因此若把它们映射过去，界面上每次启动都会假报「没生效」——这里断言的是「不映射 ⇒ 不出声」
    const r = checkEngineProps(B11408_PROPS_ON, { ...sentValues, reasoning_format: 'deepseek', spec_type: 'ngram-mod' });
    expect(r.mismatched.map((m) => m.param)).not.toContain('reasoning_format');
    expect(r.mismatched.map((m) => m.param)).not.toContain('spec_type');
  });

  it('已修（2026-10-06 真机撞出的假报）：模型自带 general.sampling.* 时，未发射的采样项不再被判成不一致', () => {
    // 夹具 A 的命令行没发 --temp/--top-k（界面初值 == 引擎缺省 0.8/40 故不上命令行），引擎用模型推荐值
    // 1.0/20 顶上。修法是给这六行标 modelDerived（PROPS_FIELD_MAP 里带真机实测注释的那一组）。
    const r = checkEngineProps(B11408_NO_PROPS, valuesAtUiDefaults(B11408_NO_PROPS.model_path));
    const six = ['temperature', 'top_k', 'top_p', 'min_p', 'repeat_penalty', 'presence_penalty'];
    expect(r.mismatched.map((m) => m.param)).toEqual([]);
    for (const key of six) {
      expect(r.checked, `${key} 未发射且没有 env 覆写时不该参与比对`).not.toContain(key);
    }
    // env 名单命中其中一条 ⇒ 那一条必须重新出声（模型推荐值这个解释被排除了）
    const withEnv = checkEngineProps(
      B11408_NO_PROPS,
      valuesAtUiDefaults(B11408_NO_PROPS.model_path),
      0,
      ['LLAMA_ARG_TOP_K'],
    );
    expect(withEnv.checked).toContain('top_k');
    expect(withEnv.mismatched.map((m) => m.param)).toEqual(['top_k']);
    expect(withEnv.checked, '别的项不能跟着一起出声').not.toContain('temperature');
  });

  it('发出去时照样比：把值改成与引擎缺省不同（= 真的上了命令行），这两行必须重新核', () => {
    // 这一条是上一条的判别对照：如果六行是「整行失效」，下面也会安静——它不安静，说明 skip 的
    // 成因确实是「没发射」，而不是我们把这项放弃了。
    const r = checkEngineProps(
      B11408_NO_PROPS,
      valuesAtUiDefaults(B11408_NO_PROPS.model_path, { temperature: 1, top_k: 20, top_p: 0.95 + 0.05, min_p: 0.3, repeat_penalty: 1.1, presence_penalty: 0.5 }),
    );
    for (const key of ['temperature', 'top_k', 'top_p', 'min_p', 'repeat_penalty', 'presence_penalty']) {
      expect(r.checked, `${key} 发了值就必须被核`).toContain(key);
    }
    // 引擎那边是模型推荐值 1/20/0.95/0.05，我们发了 0.95+0.05 / 0.3 / 1.1 / 0.5 ⇒ 四项必须报出来
    expect(r.mismatched.map((m) => m.param).sort()).toEqual(
      ['min_p', 'presence_penalty', 'repeat_penalty', 'top_p'].sort(),
    );
  });

  it('结构钉：六个 general.sampling.* 可派生项都带 modelDerived + env 通道（少一个就回到假报）', () => {
    // 成员清单的来源是 packages/core/src/gguf-meta.ts 里那六个源键（该模块据此生成「模型内置建议」），
    // 也就是「引擎可能拿模型文件顶掉缺省」的那一类。那边增源键时这里要同步，否则新那一个会假报。
    for (const key of ['temperature', 'top_k', 'top_p', 'min_p', 'repeat_penalty', 'presence_penalty']) {
      const envChannel = PROPS_FIELD_MAP.find((m) => m.param === key)?.modelDerived?.envChannel;
      expect(envChannel, `${key} 必须标明它的 env 通道，否则无法归因`).toMatch(/^LLAMA_ARG_[A-Z0-9_]+$/);
    }
    // 对照：seed 不属于这一类（模型文件没有对应源键，help 里那条也没有 env 通道），
    // 它保持「没发也比」，「不发射时引擎做的是不是那个缺省值」才有人守着
    const seed = PROPS_FIELD_MAP.find((m) => m.param === 'seed');
    expect(seed?.modelDerived).toBeUndefined();
    expect(seed?.onlyWhenSent).toBeUndefined();
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
    const before = Date.now();
    const r = await verifyEngineProps({
      baseUrl: '', values: sentValues,
      fetcher: async () => { called++; return { ok: true, json: REAL_PROPS }; },
    });
    expect(called).toBe(0);
    expect(r.error).toBe('unreachable');
    expect(r.checked).toEqual([]);
    expect(r.mismatched).toEqual([]);
    expect(r.skipped).toBe(PROPS_FIELD_MAP.length);
    // checkedAt 是契约的一部分：界面靠它标注新鲜度（复检改为按需触发后，没有周期可推断）
    expect(r.checkedAt).toBeGreaterThanOrEqual(before);
    expect(checkEngineProps(REAL_PROPS, sentValues).checkedAt).toBe(0); // 纯对账不自造时刻
  });
});
