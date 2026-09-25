import { checkEngineProps, propsCheckUnavailable, type PresetValues, type PropsCheck } from '@llama-launcher/shared';

/** 注入点：单测传假实现，运行期用 Electron/Node 的全局 fetch（主进程侧发起，渲染层不碰网络） */
export type PropsFetcher = (url: string, timeoutMs: number) => Promise<{ ok: boolean; json: unknown }>;

const DEFAULT_TIMEOUT_MS = 2500;

/** 默认传输：全局 fetch + 超时；任何异常都收敛成 ok:false，由调用方判为「不可校验」而非「不一致」 */
export const defaultPropsFetcher: PropsFetcher = async (url, timeoutMs) => {
  if (typeof globalThis.fetch !== 'function') return { ok: false, json: null };
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return { ok: false, json: null };
  return { ok: true, json: await res.json() };
};

/**
 * 就绪后回读 `GET /props` 并与发出的参数对账。
 * 注意 `--props` 只控制 POST /props 能否改全局属性，**GET 默认可读**（b11178 实测
 * endpoint_props=false 时 GET 仍返回完整 JSON），所以不需要为校验额外开该端点。
 */
export async function verifyEngineProps(opts: {
  baseUrl: string;
  values: PresetValues;
  timeoutMs?: number;
  fetcher?: PropsFetcher;
}): Promise<PropsCheck> {
  const fetcher = opts.fetcher ?? defaultPropsFetcher;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!opts.baseUrl) return propsCheckUnavailable('unreachable');
  try {
    const res = await fetcher(`${opts.baseUrl.replace(/\/$/, '')}/props`, timeoutMs);
    if (!res.ok || res.json === null || typeof res.json !== 'object') return propsCheckUnavailable('unreachable');
    return checkEngineProps(res.json, opts.values);
  } catch {
    // 服务已停/网络异常/JSON 解析失败都不该被读成"参数没生效"
    return propsCheckUnavailable('unreachable');
  }
}
