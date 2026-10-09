import { MODEL_KEY, PARAMS } from './definitions.js';
import { ENGINE_BASELINE_BUILD, engineDefaultOf, isSentinelValue, sameParamValue } from './engine-baseline.js';
import type { ParamDef, PresetValues } from '../types/index.js';

/**
 * 引擎回读校验：服务就绪后从 `GET /props` 读回**引擎实际生效值**，与启动器发出的值对账。
 *
 * 为什么要它：发射规则「值等于引擎缺省就不发」有两个看不见的前提——引擎默认值可能与我们
 * 登记的基线不符（跨版本漂移），以及用户环境里可能有 `LLAMA_ARG_*` 改写缺省值（b11178 起
 * 57/60 个应用参数带该通道；现行 b11524 基线实测 70 个参数里 67 个，不带通道的三条是
 * `-mmdev`、`-s`、`--api-key`）。这两条一旦破了，界面照样显示旧值，命令里也看不出来。
 * 回读是目前唯一能**证实**「引擎收到了什么」的手段。
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
  /** 只有我们真的发了值才可比（如 `-a` 空值时引擎自己派生别名，比对必假报） */
  onlyWhenSent?: boolean;
  /**
   * 「没发时引擎会拿**模型文件**里的推荐值顶上」这一类：GGUF 自带 `general.sampling.*` 时，
   * 未发射的采样项回读到的就是模型给的数（真机实测见 PROPS_FIELD_MAP 里那一组六行）。
   * 这时「回读 ≠ 我们的缺省」有两个合法来源——模型推荐值、`envChannel` 那条环境变量——
   * 光看 /props 分不出是哪一个。所以只在**该 env 通道确实被设过**时才报不一致，
   * 其余情况计为 skipped：不许在无法归因时谎报「参数没生效」，也不顺手把 env 覆写的检测一起废掉。
   */
  modelDerived?: { envChannel: string };
  /** 不在 PARAMS 表里的项（如 model 走 MODEL_KEY + `-m` 特例通道）在此补旗标，否则报不出人话 */
  flag?: string;
  /**
   * 某些项在特定搭配下引擎会自行改写，比对必假报——`-c` 的生效值会被 `--fit` 按显存重算，
   * 所以 fit 开着时不比 n_ctx。这是数据而非分支，加参数不用再改本文件。
   */
  skipWhen?: { param: string; in: readonly string[] };
  /**
   * 依据**回读侧**事实跳过比对：有些字段引擎给的不是我们发的那个量。
   * `default_generation_settings.n_ctx` 就是其一——b11408 真机实测（同一 `-c 4096`）：
   * `-np 4` 回读 1024、`-np 1` 回读 4096，即它给的是**每槽** ctx（`n_ctx ÷ 槽数`，整数除），
   * 不是 `-c` 的总值。槽数 > 1 时任何直接相等比对都会稳定假报「参数没生效」。
   * 乘回去也不可行：4097 ÷ 4 = 1024（向下取整），乘回 4096 ≠ 发出值，仍是假报。
   */
  skipWhenProps?: { path: string; gt: number };
}

export const PROPS_FIELD_MAP: readonly PropsFieldMap[] = [
  { param: MODEL_KEY, propsPath: 'model_path', kind: 'path', onlyWhenSent: true, flag: '-m' },
  { param: 'alias', propsPath: 'model_alias', kind: 'text', onlyWhenSent: true },
  {
    param: 'ctx_size',
    propsPath: 'default_generation_settings.n_ctx',
    kind: 'num',
    onlyWhenSent: true,
    skipWhen: { param: 'fit', in: ['on', 'auto'] },
    // 引擎给的是每槽 ctx（见 PropsFieldMap.skipWhenProps 的真机实测），多槽下不比
    skipWhenProps: { path: 'total_slots', gt: 1 },
  },
  // 这六行是「引擎可能按**模型文件**取值」的一类：GGUF 自带 general.sampling.* 时，我们没发 flag
  // 它就用模型推荐值。真机实测（b11408 + Qwen3.8-27B-UD-Q2_K_XL，命令行未发 --temp/--top-k）回读
  // temperature=1、top_k=20，而引擎缺省是 0.8/40 —— 加这段之前界面会假报「--temp 没生效」。
  // 成员清单不是凭猜：就是 packages/core/src/gguf-meta.ts 里那六个源键（该模块据此生成「模型内置
  // 建议」），改那边要同步这里。envChannel 逐字取自 docs/params/llama-server-help-out.txt 的
  // `(env: LLAMA_ARG_*)` 标注——留着它是因为 env 覆写和模型推荐值在 /props 上长得一模一样，
  // 只有主进程报上来的 envOverrides 命中该通道时才有资格判成不一致（否则一律 skip）。
  { param: 'temperature', propsPath: 'default_generation_settings.params.temperature', kind: 'num', modelDerived: { envChannel: 'LLAMA_ARG_TEMPERATURE' } },
  { param: 'top_k', propsPath: 'default_generation_settings.params.top_k', kind: 'num', modelDerived: { envChannel: 'LLAMA_ARG_TOP_K' } },
  { param: 'top_p', propsPath: 'default_generation_settings.params.top_p', kind: 'num', modelDerived: { envChannel: 'LLAMA_ARG_TOP_P' } },
  { param: 'min_p', propsPath: 'default_generation_settings.params.min_p', kind: 'num', modelDerived: { envChannel: 'LLAMA_ARG_MIN_P' } },
  { param: 'repeat_penalty', propsPath: 'default_generation_settings.params.repeat_penalty', kind: 'num', modelDerived: { envChannel: 'LLAMA_ARG_REPEAT_PENALTY' } },
  { param: 'presence_penalty', propsPath: 'default_generation_settings.params.presence_penalty', kind: 'num', modelDerived: { envChannel: 'LLAMA_ARG_PRESENCE_PENALTY' } },
  // seed 不属于这一类：help 里这条**没有** env 通道（实测 `--seed` 行无 `(env: ...)` 标注），
  // 模型文件也没有对应源键，所以未发射时回读到的必然是引擎缺省——留着它才能验「不发射时引擎做的是不是那个缺省值」
  { param: 'seed', propsPath: 'default_generation_settings.params.seed', kind: 'seed' },
  { param: 'ui', propsPath: 'ui', kind: 'bool' },
  { param: 'slots_endpoint', propsPath: 'endpoint_slots', kind: 'bool' },
  { param: 'metrics', propsPath: 'endpoint_metrics', kind: 'bool' },
  // `--props` 与 `endpoint_props` 是同一个开关的两面（help: "enable changing global properties via POST /props"，
  // 环境通道 LLAMA_ARG_ENDPOINT_PROPS 也叫这名字）。真机两态各抓过一次（b11408 + Qwen3.8-27B-UD-Q2_K_XL，
  // `-c 4096`）：不发 --props ⇒ endpoint_props=false，发 --props ⇒ true。两次抓取的 **70 个叶路径键集完全相同**，
  // 值只差 4 个：endpoint_props、seed 与 temperature（那轮我另发了 --seed/--temp）、media_marker（每次启动随机，不比对）
  // ——没有别的字段被 --props 顺带改写，所以这项比对不受搭配影响，也不需 onlyWhenSent：
  // 没发时引擎报 false，正是要拿来验 env 覆写（LLAMA_ARG_ENDPOINT_PROPS）的地方。
  { param: 'props_endpoint', propsPath: 'endpoint_props', kind: 'bool' },
  { param: 'parallel', propsPath: 'total_slots', kind: 'num', onlyWhenSent: true },
];

/**
 * 评估后**故意不进**映射表的候选（每条都有真机反证，别再凭同名的键重新评估一遍）：
 *
 * - `reasoning_format` → `default_generation_settings.params.reasoning_format`：发 `--reasoning-format deepseek`
 *   后 /props 仍回读 `"none"`（b11408 实测）。`params.reasoning_format` 是**每次请求**的 chat 参数默认值，
 *   不是服务端 flag 的结果，与我们的取值不是一回事——塞进去就等于每次启动假报「--reasoning-format 没生效」。
 * - `spec_type` → `default_generation_settings.params["speculative.types"]`：发 `--spec-type ngram-mod` 后仍回读
 *   `"none"`（b11408 实测），同上。另注意该键是**字面含点号**的单个 JSON 键，现有 `readPropsPath` 按 `.` 下钻取不到，
 *   真要支持得先改取键方式。
 * - `chat_template` → 顶层 `chat_template`：/props 给的是**渲染用的模板原文**（数千字符），我们发的是模板名/路径，
 *   量纲不同，无法相等比对。
 * - `cors_credentials` 等 CORS 族 → `cors_proxy_enabled`：那是 webui 的 CORS 代理开关，与 `--cors-*` 无关。
 * - `reasoning` / `reasoning_effort` → `reasoning_in_content` / `chat_template_caps.supports_reasoning_effort`：
 *   前一个是引擎按模板+格式**派生**出的结果，后一个是模板能力声明，都不是我们发出的值。
 * - `lazy_mode` → `is_sleeping`：运行期睡眠状态，不是配置值。
 *
 * 另有一条**本轮真机撞见的假报**（已修，见上面六行的 `modelDerived`）：GGUF 自带 `general.sampling.*`
 * 时，引擎会在我们**没发**该 flag 的前提下用模型推荐值改写采样项。实测 b11408 + Qwen3.8-27B-UD-Q2_K_XL
 * （命令行无 `--temp` / `--top-k`）回读 `temperature: 1`、`top_k: 20`、`top_p: 0.949999988079071`、
 * `min_p: 0.05000000074505806`，而界面初值是引擎缺省 0.8 / 40；该模型头部实有键
 * `general.sampling.temp` / `top_k` / `top_p` / `min_p` / `temperature`（直接扫 GGUF 元数据得到）。
 * 今后再加采样类映射时，照那六行的写法标 `modelDerived: { envChannel }`，**不要**图省事写
 * `onlyWhenSent`：后者会把「env 覆写在回读里现形」这个别处没有的能力一并跳掉。
 */

/** 数值容差：引擎内部按 float32 存采样值，0.95 回读是 0.949999988079071，不容差就天天假报 */
export const PROPS_NUM_TOL = 1e-4;

export interface PropsMismatch {
  param: string;
  flag: string;
  sent: string | number | boolean;
  actual: string | number | boolean;
}

export interface PropsBaselineDrift {
  /** 引擎自报构建（`/props` 的 build_info 里的 bNNNN） */
  engineBuild: string;
  /** 本表所钉基线构建（ENGINE_BASELINE_BUILD） */
  baselineBuild: string;
}

export interface PropsCheck {
  /** 实际比对过的参数 key */
  checked: string[];
  mismatched: PropsMismatch[];
  /** 映射不到 / 引擎没回读 / 我们没发值而跳过 count */
  skipped: number;
  /** /props 的 build_info（b11178-f9af9be21 这类串），供界面注明校验依据的引擎构建 */
  buildInfo: string;
  /**
   * 本次回读发生的时刻（`Date.now()`）。校验是**按需**触发的（就绪 / 页签可见 / 手动），
   * 不是周期轮询，所以界面要能让用户判断这条结论有多新——新鲜度必须显式，
   * 否则"上次校验通过"会被读成"现在也一致"。
   */
  checkedAt: number;
  /**
   * 引擎构建 ≠ 参数基线构建时非空：这张表是某个版本 help 的快照，一旦引擎升级，
   * 47 个不可回读参数的判定基准就可能已经过期——不比对就会重演「拿旧尺子量新引擎」。
   */
  baselineDrift: PropsBaselineDrift | null;
  /** 取不到 /props 时不判为不一致，只标状态，避免服务未就绪或网络异常时误报 */
  error: 'unreachable' | 'bad_payload' | null;
}

/** 从 build_info（`b11178-f9af9be21`）取构建号；取不到返回 null（不猜） */
export function parseBuildNumber(buildInfo: string): string | null {
  const m = String(buildInfo ?? '').match(/\bb(\d{3,6})\b/);
  return m ? `b${m[1]}` : null;
}

/**
 * 基线漂移只在**引擎比基线旧**时出声。
 *
 * 这张基线表是「本项目已核对过的最新引擎 help」快照，且每次 re-pin 都钉到当时最新版；
 * 用户拿更旧的框架跑，那批不可回读参数的缺省判定才真的可能失效。
 * 引擎比基线新时不再 nag：那只代表上游又前进了而我们还没重钉，逐个抢先升级的用户都
 * 收到一条「基线过期」只会让这条告警被无视——§5.5 第 1 条讲的正是同一件事。
 * 解析不出构建号时按「不提示」处理（不猜）。
 */
function driftOf(buildInfo: string): PropsBaselineDrift | null {
  const engine = parseBuildNumber(buildInfo);
  if (!engine || engine === ENGINE_BASELINE_BUILD) return null;
  const engineNum = Number(engine.slice(1));
  const baselineNum = Number(ENGINE_BASELINE_BUILD.slice(1));
  if (!(engineNum < baselineNum)) return null;
  return { engineBuild: engine, baselineBuild: ENGINE_BASELINE_BUILD };
}

/**
 * 按 `.` 下钻取 /props 字段。导出是给回归用例当尺子用（判「propsPath 有没有失效」必须用实现
 * 同一个取数函数，测试另抄一份遍历就会和实现各说各话）；注意它按段切分，**字面含点号的单个键**
 * （如 `speculative.types`）取不到——这正是映射表不收那条的理由之一。
 */
export function readPropsPath(obj: unknown, path: string): unknown {
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
 * 「我们没发这一项」的三种形态：空串、声明的哨兵、等于引擎缺省基线。
 * 与命令行发射规则同一对判据（isSentinelValue / sameParamValue / engineDefaultOf），
 * 不许在这里另抄一份发射判定——那是本仓库明令禁止的「第二套实现」。
 */
function isNotSent(def: ParamDef | undefined, sent: unknown): boolean {
  if (sent === '') return true;
  if (def === undefined) return false;
  return isSentinelValue(def, sent as string | number | boolean) || sameParamValue(sent, engineDefaultOf(def));
}

/**
 * 对账主函数（纯函数，不发网络请求）。
 * 判不一致的前提是「这一项我们真的能表达」：值等于引擎缺省基线而不发射的项仍要参与比对——
 * 它正是检验「不发射时引擎做的是不是那个缺省值」的地方，env 覆写也在这里现形。
 * 唯一的例外是 `modelDerived` 那一类（模型文件也能顶掉缺省，两边长得一样），它们只在
 * `envOverrides` 命中自己的 env 通道时才出声。
 * @param envOverrides 主进程检出的 `LLAMA_ARG_*` 环境变量名（`Launcher.envOverrides` 已有这份数据）
 */
export function checkEngineProps(props: unknown, values: PresetValues, checkedAt = 0, envOverrides: readonly string[] = []): PropsCheck {
  const checked: string[] = [];
  const mismatched: PropsMismatch[] = [];
  let skipped = 0;
  if (props === null || typeof props !== 'object') {
    return { checked, mismatched, skipped: PROPS_FIELD_MAP.length, buildInfo: '', checkedAt, baselineDrift: null, error: 'bad_payload' };
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
    // 引擎在这些搭配下会自行改写该值（如 --fit 按显存重算 n_ctx），比对必假报
    if (m.skipWhen && m.skipWhen.in.includes(String(values[m.skipWhen.param]))) {
      skipped++;
      continue;
    }
    // 回读侧事实决定不比（如多槽下 n_ctx 是每槽值，与发出的总量不同量纲）
    if (m.skipWhenProps) {
      const gate = readPropsPath(p, m.skipWhenProps.path);
      if (typeof gate === 'number' && gate > m.skipWhenProps.gt) {
        skipped++;
        continue;
      }
    }
    // 「没发」的两种处置：onlyWhenSent 一律不比；modelDerived 只在它的 env 通道被设过时才比
    // （没设过时回读值可能来自模型文件，与 env 覆写在 /props 上无法区分，此时出声就是谎报）
    if (m.onlyWhenSent && isNotSent(def, sent)) {
      skipped++;
      continue;
    }
    if (m.modelDerived && isNotSent(def, sent) && !envOverrides.includes(m.modelDerived.envChannel)) {
      skipped++;
      continue;
    }
    const actual = readPropsPath(p, m.propsPath);
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
  return { checked, mismatched, skipped, buildInfo, checkedAt, baselineDrift: driftOf(buildInfo), error: null };
}

/** 取不到 /props 时的结果形状（与 checkEngineProps 同构，渲染层只认一种结构） */
export function propsCheckUnavailable(error: PropsCheck['error'], checkedAt = 0): PropsCheck {
  return { checked: [], mismatched: [], skipped: PROPS_FIELD_MAP.length, buildInfo: '', checkedAt, baselineDrift: null, error };
}
