/**
 * 人性化时间格式化工具
 * - 1 小时内：相对时间（如"3 分钟前"）
 * - 当天：HH:mm
 * - 当年：MM-DD HH:mm
 * - 跨年：YYYY-MM-DD
 */

type Lang = 'zh' | 'en';

const REL_ZH: Record<string, string> = {
  just_now: '刚刚',
  minutes_ago: '{0} 分钟前',
  hours_ago: '{0} 小时前',
  today: '今天',
  yesterday: '昨天',
};

const REL_EN: Record<string, string> = {
  just_now: 'just now',
  minutes_ago: '{0} min ago',
  hours_ago: '{0} h ago',
  today: 'Today',
  yesterday: 'Yesterday',
};

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * 将 ISO 字符串或时间戳格式化为人性化时间
 */
export function formatRelativeTime(input: string | number, lang: Lang = 'zh'): string {
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

  const rel = lang === 'zh' ? REL_ZH : REL_EN;

  // 1 小时内显示相对时间
  if (diffMin < 1) return rel.just_now;
  if (diffMin < 60) return rel.minutes_ago.replace('{0}', String(diffMin));

  // 24 小时内显示 HH:mm
  if (diffHour < 24 && isSameDay) {
    return `${rel.today} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 昨天显示"昨天 HH:mm"
  if (isYesterday) {
    return `${rel.yesterday} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 同年显示 MM-DD HH:mm
  if (isSameYear) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 跨年显示 YYYY-MM-DD
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
