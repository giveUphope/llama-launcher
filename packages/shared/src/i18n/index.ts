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

export function trAt(lang: Language, key: keyof Dict | string, args?: (string | number)[]): string {
  const dict = lang === 'en' ? en : zh;
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

/** 按当前语言取文案（语言由 setLang 维护；需要显式语言的纯函数用 trAt） */
export function tr(key: keyof Dict | string, args?: (string | number)[]): string {
  return trAt(_lang, key, args);
}

export function paramLabel(key: string): string {
  return PARAM_LABELS[key]?.[_lang] ?? key;
}

export function paramHelp(key: string): string {
  return PARAM_HELP[key]?.[_lang] ?? '';
}
