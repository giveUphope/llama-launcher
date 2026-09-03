/**
 * llama-bench 离线体检：spawn 随引擎分发的 llama-bench.exe，对未启动服务的模型文件
 * 直接测 pp512（prefill）/ tg128（decode），`-o json` 输出解析为汇总。
 *
 * 作业生命周期由主进程管理（单模型单作业、状态轮询）；本模块只负责单次运行与解析。
 * 输出为 JSON 数组（每测试组合一个对象）：n_prompt>0 且 n_gen=0 的行是 prefill，
 * n_prompt=0 且 n_gen>0 的行是 decode，avg_ts 即 tok/s。
 */
import { spawn } from 'node:child_process';
import type { LlamaBenchSummary } from '@llama-launcher/shared';

/** llama-bench JSON 输出的行对象（仅声明解析所需字段） */
export interface LlamaBenchRowRaw {
  n_prompt: number;
  n_gen: number;
  avg_ts: number;
  stddev_ts?: number;
  n_gpu_layers?: number;
  backends?: string;
  model_type?: string;
  test_time?: string;
}

/** 解析 llama-bench JSON 输出（容错：非法 JSON / 非数组 / 字段缺失行跳过） */
export function parseLlamaBenchJson(text: string): LlamaBenchRowRaw[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (r): r is LlamaBenchRowRaw =>
      typeof r === 'object' && r !== null &&
      typeof (r as LlamaBenchRowRaw).n_prompt === 'number' &&
      typeof (r as LlamaBenchRowRaw).n_gen === 'number' &&
      typeof (r as LlamaBenchRowRaw).avg_ts === 'number',
  );
}

/** 从行集合汇总 prefill / decode 速度（取首个命中行） */
export function summarizeBenchRows(modelPath: string, rows: LlamaBenchRowRaw[]): LlamaBenchSummary {
  const pp = rows.find((r) => r.n_prompt > 0 && r.n_gen === 0) ?? null;
  const tg = rows.find((r) => r.n_prompt === 0 && r.n_gen > 0) ?? null;
  return {
    modelPath,
    ppTokS: pp ? pp.avg_ts : null,
    tgTokS: tg ? tg.avg_ts : null,
    ngl: (pp ?? tg)?.n_gpu_layers ?? null,
    backend: (pp ?? tg)?.backends ?? null,
    modelType: (pp ?? tg)?.model_type ?? null,
    testedAt: new Date().toISOString(),
  };
}

export interface LlamaBenchRunOptions {
  /** llama-bench.exe 绝对路径 */
  exePath: string;
  modelPath: string;
  /** 卸载层数（默认 99 = 全卸载） */
  ngl?: number;
  /** prompt 长度（默认 512） */
  promptTokens?: number;
  /** 生成 token 数（默认 128） */
  genTokens?: number;
  /** 超时毫秒（默认 10 分钟：大模型加载占大头） */
  timeoutMs?: number;
}

/**
 * 运行一次体检并返回汇总。
 * @throws 进程启动失败、超时、非零退出（错误信息取 stderr 末行 `llama_bench: error: ...`）或输出无法解析
 */
export function runLlamaBench(opts: LlamaBenchRunOptions): Promise<LlamaBenchSummary> {
  const args = [
    '-m', opts.modelPath,
    '-ngl', String(opts.ngl ?? 99),
    '-p', String(opts.promptTokens ?? 512),
    '-n', String(opts.genTokens ?? 128),
    '-r', '1',
    '-o', 'json',
  ];
  return new Promise<LlamaBenchSummary>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(opts.exePath, args, { windowsHide: true });
    } catch (e: any) {
      reject(new Error(e?.message ?? 'spawn failed'));
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error('llama-bench timed out'));
    }, opts.timeoutMs ?? 600_000);

    child.stdout?.on('data', (d: Buffer) => { out += String(d); });
    child.stderr?.on('data', (d: Buffer) => { err += String(d); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(e.message));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const m = err.match(/llama_bench: error: (.+)/);
        reject(new Error(m ? m[1].trim() : `llama-bench exited with code ${code}`));
        return;
      }
      const rows = parseLlamaBenchJson(out);
      if (rows.length === 0) {
        reject(new Error('llama-bench output could not be parsed'));
        return;
      }
      resolve(summarizeBenchRows(opts.modelPath, rows));
    });
  });
}
