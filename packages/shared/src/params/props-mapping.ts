import { MODEL_KEY, PARAMS } from './definitions.js';
import { engineDefaultOf, isSentinelValue, sameParamValue } from './engine-baseline.js';
import type { PresetValues } from '../types/index.js';

/**
 * 引擎回读校验：服务就绪后从 `GET /props` 读回**引擎实际生效值**，与启动器发出的值对账。
 *
 * 为什么要它：发射规则「值等于引擎缺省就不发」有两个看不见的前提——引擎默认值可能与我们
 * 登记的基线不符（跨版本漂移），以及用户环境里可能有 `LLAMA_ARG_*` 改写缺省值（b11178 起
 * 57/60 个应用参数带该通道）。这两条一旦破了，界面照样显示旧值，命令里也看不出来。
 * 回读是 presently 唯一能**证实**「引擎收到了什么」的手段。
 *
 * 只覆盖能被 `/props` 如实反映的参数（见下表），其余在结果里计成 skipped——
 * 界面必须说「已回读校验 N 项」而不是让人误以为全部核对过。
 * 判读口径是数据（参数 key + 数值），中文文案由渲染层出，见 AGENTS.md「数据层不产文案」。
 */

/** 单个可比对项：param = 我们的参数 key；props 是从 /props 取值的路径；kind 决定归一化方式 */
export interface PropsFieldMap {
  param: string;
  propsPath: string;
  kind: 'num' | 'bool' | 'seed' | 'path' | 'text';
  /** 只有我们真的发了值才可比（如 -a 空值时引擎会自己派生别名，比对必假报） */
  onlyWhenSent?: boolean;
  /** 不在 PARAMS 表里的项（如 model 走 MODEL_KEY + `-m` 特例通道）在此补旗标，否则报不出人话 */
  flag?: string;
}

export const PROPS_FIELD_MAP: readonly PropsFieldMap[] = [
  { param: MODEL_KEY, propsPath: 'model_path', kind: 'path', onlyWhenSent: true, flag: '-m' },
  { param: 'alias', propsPath: 'model_alias', kind: 'text', onlyWhenSent: true },
  { param: 'temperature', propsPath: 'default_generation_settings.params.temperature', kind: 'num' },
  { param: 'top_k', propsPath: 'default_generation_settings.params.top_k', kind: 'num' },
  { param: 'top_p', propsPath: 'default_generation_settings.params.top_p', kind: 'num' },
  { param: 'min_p', propsPath: 'default_generation_settings.params.min_p', kind: 'num' },
  { param: 'repeat_penalty', propsPath: 'default_generation_settings.params.repeat_penalty', kind: 'num' },
  { param: 'presence_penalty', propsPath: 'default_generation_settings.params.presence_penalty', kind: 'num' },
  { param: 'seed', propsPath: 'default_generation_settings.params.seed', kind: 'seed' },
  { param: 'ui', propsPath: 'ui', kind: 'bool' },
  { param: 'slots_endpoint', propsPath: 'endpoint_slots', kind: 'bool' },
  { param: 'metrics', propsPath: 'endpoint_metrics', kind: 'bool' },
  { param: 'parallel', propsPath: 'total_slots', kind: 'num', onlyWhenSent: true },
];

/** 数值容差：引擎内部按 float32 存采样值，0.95 回读是 0.949999988079071，不容差就天天假报 */
export const PROPS_NUM_TOL = 1e-4;

export interface PropsMismatch {
  param: string;
  flag: string;
  sent: string | number | boolean;
  actual: string | number | boolean;
}

export interface PropsCheck {
  /** 实际比对过的参数 key */
  checked: string[];
  mismatched: PropsMismatch[];
  /** 映射不到 / 引擎没回读 / 我们没发值而跳过 count */
  skipped: number;
  /** /props 的 build_info（b11178-f9af9be21 这类串），供界面注明校验依据的引擎构建 */
  buildInfo: string;
  /** 取不到 /props 时不判为不一致，只标状态，避免服务未就绪或网络异常时误报 */
  error: 'unreachable' | 'bad_payload' | null;
}

function readPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Windows 路径比对：分隔符与大小写都归一（实测 model_path 带双反斜杠，我们发的是正斜杠） */
function normPath(v: string): string {
  return v.replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim().toLowerCase();
}

/** 归一 seed：引擎把 -1 当「随机」并以 uint32 回报 4294967295 */
function normSeed(v: number): number {
  return v < 0 ? v >>> 0 : v;
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return null;
}

function describe(v: unknown): string | number | boolean {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

/**
 * 对账主函数（纯函数，不发网络请求）。
 * 判不一致的前提是「这一项我们真的能表达」：值等于引擎缺省基线而不发射的项仍要参与比对——
 * 它正是检验「不发射时引擎做的是不是那个缺省值」的地方，env 覆写也在这里现形。
 */
export function checkEngineProps(props: unknown, values: PresetValues): PropsCheck {
  const checked: string[] = [];
  const mismatched: PropsMismatch[] = [];
  let skipped = 0;
  if (props === null || typeof props !== 'object') {
    return { checked, mismatched, skipped: PROPS_FIELD_MAP.length, buildInfo: '', error: 'bad_payload' };
  }
  const p = props as Record<string, unknown>;
  const buildInfo = typeof p.build_info === 'string' ? p.build_info : '';

  for (const m of PROPS_FIELD_MAP) {
    const def = PARAMS.find((x) => x.key === m.param);
    const flag = def?.flag ?? m.flag ?? m.param;
    const sent = values[m.param];
    if (sent === undefined) {
      skipped++;
      continue;
    }
    if (m.onlyWhenSent) {
      // 「没发」的三种形态：空串、声明的哨兵、等于引擎缺省基线（这三种下引擎会自己派生值）
      const notSent =
        sent === '' ||
        (def !== undefined && (isSentinelValue(def, sent) || sameParamValue(sent, engineDefaultOf(def))));
      if (notSent) {
        skipped++;
        continue;
      }
    }
    const actual = readPath(p, m.propsPath);
    if (actual === undefined || actual === null) {
      skipped++;
      continue;
    }

    let equal: boolean;
    switch (m.kind) {
      case 'num': {
        const a = asNumber(sent);
        const b = asNumber(actual);
        equal = a !== null && b !== null && Math.abs(a - b) <= PROPS_NUM_TOL;
        break;
      }
      case 'seed': {
        const a = asNumber(sent);
        const b = asNumber(actual);
        equal = a !== null && b !== null && normSeed(a) === normSeed(b);
        break;
      }
      case 'bool': {
        const a = toBool(sent);
        const b = toBool(actual);
        equal = a !== null && b !== null && a === b;
        break;
      }
      case 'path': {
        equal = normPath(String(sent)) === normPath(String(actual));
        break;
      }
      default: {
        equal = String(sent).trim() === String(actual).trim();
      }
    }
    checked.push(m.param);
    if (!equal) {
      mismatched.push({ param: m.param, flag, sent: describe(sent), actual: describe(actual) });
    }
  }
  return { checked, mismatched, skipped, buildInfo, error: null };
}

/** 取不到 /props 时的结果形状（与 checkEngineProps 同构，渲染层只认一种结构） */
export function propsCheckUnavailable(error: PropsCheck['error']): PropsCheck {
  return { checked: [], mismatched: [], skipped: PROPS_FIELD_MAP.length, buildInfo: '', error };
}
