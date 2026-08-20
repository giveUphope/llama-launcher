import { zh, type Dict } from './zh.js';
import { en } from './en.js';
import { PARAM_LABELS, PARAM_HELP } from './labels.js';
import type { Language } from '../types/index.js';

export type { Dict };
export { zh, en };

let _lang: Language = 'zh';
export function setLang(lang: Language): void {
  _lang = lang;
}
export function getLang(): Language {
  return _lang;
}

export function tr(key: keyof Dict | string, args?: (string | number)[]): string {
  const dict = _lang === 'en' ? en : zh;
  let text: string = (dict as Record<string, string>)[key] ?? (zh as Record<string, string>)[key] ?? String(key);
  if (args && args.length) {
    try {
      text = text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
    } catch {
      /* ignore */
    }
  }
  return text;
}

export function paramLabel(key: string): string {
  return PARAM_LABELS[key]?.[_lang] ?? key;
}

export function paramHelp(key: string): string {
  return PARAM_HELP[key]?.[_lang] ?? '';
}
