import { existsSync } from 'node:fs';
import { PARAMS, type ParamDef } from '@llama-launcher/shared';
import type { AppSettings } from '@llama-launcher/shared';

/**
 * 启用状态编码到 PresetValues 中的保留 key（与 UI store 的 ENABLED_KEY 保持一致）。
 */
const ENABLED_KEY = '_enabled';

export interface BuildOptions {
  exePath: string;
  modelPath: string;
  values: Record<string, string | number | boolean>;
}

export interface PreviewOptions {
  values: Record<string, string | number | boolean>;
  settings: AppSettings;
}

/**
 * 从 values 中解析出 enabled 状态。
 * 如果 values 中不含 ENABLED_KEY（旧预设或向后兼容场景），视为所有参数已启用。
 */
function parseEnabled(values: Record<string, string | number | boolean>): Record<string, boolean> | null {
  const raw = values[ENABLED_KEY];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return null;
  }
}

export function buildCommand(opts: BuildOptions): string[] {
  if (!opts.exePath) {
    throw new Error('Server executable path is not configured');
  }
  if (!existsSync(opts.exePath)) {
    throw new Error(`Server executable does not exist: ${opts.exePath}`);
  }
  const cmd: string[] = [opts.exePath];
  if (opts.modelPath) cmd.push('-m', opts.modelPath);

  const enabledMap = parseEnabled(opts.values);

  for (const p of PARAMS) {
    const v = opts.values[p.key];
    if (v === undefined) continue;
    // 启用状态检查：如果 enabled 信息存在且该参数未启用，则跳过（使用 llama-server 内置默认值）
    if (enabledMap && enabledMap[p.key] !== true) continue;
    // 显式启用的参数：仅跳过空字符串（text/file/dir/dropdown），不再因"等于默认值"而跳过
    // 未提供 enabled 信息（旧预设兼容）：保持原有"等于默认值则跳过"的行为
    const explicitlyEnabled = !!(enabledMap && enabledMap[p.key] === true);
    if (shouldSkip(p, v, explicitlyEnabled)) continue;
    appendArg(cmd, p, v);
  }
  return cmd;
}

function shouldSkip(p: ParamDef, v: string | number | boolean, explicitlyEnabled: boolean): boolean {
  if (p.type === 'checkbox') return false; // checkbox always emits flag or invert_flag
  if (p.type === 'text' || p.type === 'file' || p.type === 'dir') {
    return v === '';
  }
  if (p.type === 'dropdown') {
    return v === '';
  }
  // int_entry / int_slider / float_slider
  // 显式启用的参数：即使值等于默认值也生成（用户明确要求生效）
  // 未显式启用（旧预设兼容场景）：值等于默认值则跳过
  if (explicitlyEnabled) return false;
  return v === p.default;
}

function appendArg(cmd: string[], p: ParamDef, v: string | number | boolean): void {
  if (p.type === 'checkbox') {
    const b = Boolean(v);
    if (b) cmd.push(p.flag);
    else if (p.invert_flag) cmd.push(p.invert_flag);
    return;
  }
  if (p.type === 'dropdown' || p.type === 'text' || p.type === 'file' || p.type === 'dir') {
    const s = String(v);
    if (s === '') return;
    // 向后兼容：旧预设中 "draft-model" 映射为 llama-server 实际支持的 "draft-simple"
    const emitted = p.key === 'spec_type' && s === 'draft-model' ? 'draft-simple' : s;
    cmd.push(p.flag, emitted);
    return;
  }
  // int_entry, int_slider, float_slider
  // float_slider 保留 2 位小数，避免 float32 精度问题导致命令预览显示 0.949999988079071
  if (p.type === 'float_slider') {
    const fv = Number(v);
    const rounded = Math.round(fv * 100) / 100;
    cmd.push(p.flag, String(rounded));
    return;
  }
  cmd.push(p.flag, String(v));
}

export function quoteArg(s: string): string {
  if (/[\s"]/.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

export function formatCommand(cmd: string[]): string {
  return cmd.map(quoteArg).join(' ');
}

export function previewCommand(opts: PreviewOptions): string {
  const cmd = buildCommand({
    exePath: opts.settings.server_exe,
    modelPath: String(opts.values.model ?? ''),
    values: opts.values,
  });
  return formatCommand(cmd);
}
