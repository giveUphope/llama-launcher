import { existsSync } from 'node:fs';
import { PARAMS, type ParamDef, type ParamDependsOn } from '@llama-launcher/shared';
import type { AppSettings } from '@llama-launcher/shared';

export interface BuildOptions {
  exePath: string;
  modelPath: string;
  values: Record<string, string | number | boolean>;
  /** 用户扩展参数原文（settings.custom_args）：按 shell 词法切分后追加到命令末尾 */
  customArgs?: string;
}

export interface PreviewOptions {
  values: Record<string, string | number | boolean>;
  settings: AppSettings;
  /** 是否把 settings.custom_args 并入预览（默认 true；内置参数命令预览传 false） */
  includeCustomArgs?: boolean;
}

/**
 * 扩展参数词法切分：按空白分割，支持双引号（含 \ 转义）包裹含空格的值。
 * 与命令预览输入框的手写命令行语法保持一致。
 */
export function tokenizeArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') { inQuote = !inQuote; has = true; continue; }
    if (ch === '\\' && inQuote && i + 1 < input.length) { cur += input[i + 1]; i++; continue; }
    if (/\s/.test(ch) && !inQuote) {
      if (has) { out.push(cur); cur = ''; has = false; }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
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

  const values = opts.values;
  for (const p of PARAMS) {
    const v = values[p.key];
    if (v === undefined || shouldSkip(p, v, values)) continue;
    appendArg(cmd, p, v);
  }
  // 扩展参数：原样追加在末尾（同名 flag 后者生效，用户可借此覆盖内置值）
  if (opts.customArgs && opts.customArgs.trim()) {
    cmd.push(...tokenizeArgs(opts.customArgs.trim()));
  }
  return cmd;
}

function shouldSkip(p: ParamDef, v: string | number | boolean, values: Record<string, string | number | boolean>): boolean {
  if (p.type === 'checkbox') return false; // checkbox 始终发射 flag / invert_flag
  if (v === '') return true; // 空字符串不发射
  // 依赖不满足时跳过发射（如 draft-mtp 下的 --spec-draft-model、mirostat=0 下的 --mirostat-lr）
  if (p.dependsOn && !isDependencyMet(p.dependsOn, values)) return true;
  return v === p.default;
}

function isDependencyMet(dep: ParamDependsOn, values: Record<string, string | number | boolean>): boolean {
  const depDef = PARAMS.find((p) => p.key === dep.key);
  if (!depDef) return false;
  let depValue = values[dep.key];
  // 旧版预设兼容：spec_type 'draft-model' 等同于 'draft-simple'
  if (depDef.key === 'spec_type' && depValue === 'draft-model') depValue = 'draft-simple';
  const depDefault = depDef.default;
  // checkbox 依赖源按布尔语义判定：依赖源值为 false 视为"未生效"
  if (depDef.type === 'checkbox') {
    const b = depValue === true || depValue === 'true' || depValue === 1 || depValue === '1';
    if (!b) return false;
  } else {
    if (depValue === depDefault) return false;
  }
  const depValueStr = String(depValue);
  if (dep.notValues && dep.notValues.includes(depValueStr)) return false;
  if (dep.values && dep.values.length > 0 && !dep.values.includes(depValueStr)) return false;
  return true;
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
    customArgs: opts.includeCustomArgs === false ? '' : opts.settings.custom_args,
  });
  return formatCommand(cmd);
}
