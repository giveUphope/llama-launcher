/**
 * 人性化时间格式化工具
 * - 1 小时内：相对时间（如"3 分钟前"）
 * - 当天：HH:mm
 * - 当年：MM-DD HH:mm
 * - 跨年：YYYY-MM-DD
 *
 * 措辞一律取自 i18n 字典（trAt）：本模块曾自带平行 REL_ZH/REL_EN 双表，
 * 与 zh.ts/en.ts 抢同一职责且逃过键集一致性检查（门禁只比那两个文件）。
 */
import { trAt } from './i18n/index.js';
import type { Language } from './types/index.js';

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * 将 ISO 字符串或时间戳格式化为人性化时间。
 * lang 由调用方显式传入（如 PresetsPanel 传 settings.language），既决定措辞
 * 也注册响应式依赖，语言切换后模板会重渲染。
 */
export function formatRelativeTime(input: string | number, lang: Language = 'zh'): string {
  if (!input) return '—';
  const date = typeof input === 'string' ? new Date(input) : new Date(input);
  if (isNaN(date.getTime())) return '—';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const isSameYear = date.getFullYear() === now.getFullYear();
  const isSameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  // 1 小时内显示相对时间
  if (diffMin < 1) return trAt(lang, 'rel_just_now');
  if (diffMin < 60) return trAt(lang, 'rel_minutes_ago', [diffMin]);

  // 24 小时内显示 HH:mm
  if (diffHour < 24 && isSameDay) {
    return `${trAt(lang, 'rel_today')} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 昨天显示"昨天 HH:mm"
  if (isYesterday) {
    return `${trAt(lang, 'rel_yesterday')} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 同年显示 MM-DD HH:mm
  if (isSameYear) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 跨年显示 YYYY-MM-DD
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
