import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppLogEntry, AppLogKind } from '@llama-launcher/shared';

/**
 * 渲染层消费的应用日志行：IPC 条目 + 入队时一次算好的派生字段。
 * 时间戳格式化（Intl）、级别→样式映射、搜索用小写副本原先都在渲染期逐行重算——
 * 日志页最多渲染 2000 行且每条新日志都触发整表重渲染，即每行一次
 * `new Date().toLocaleTimeString()` + `toLowerCase()`。
 */
export interface AppLogLine extends AppLogEntry {
  id: number;
  time: string;
  cls: string;
  lower: string;
}

// 级别着色：应用日志不含 stdout/stderr，按 kind 直接映射即可
function clsOf(kind: AppLogKind): string {
  switch (kind) {
    case 'error': return 'kind-error';
    case 'warn': return 'kind-warn';
    case 'success': return 'kind-success';
    default: return 'kind-info';
  }
}

function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// 应用日志 store：读取/订阅主进程的应用生命周期/操作日志（区别于 server store 的后端 llama 输出）。
// 订阅防重入：与 server store 同模式，避免 dev HMR 下 listener 累积导致重复推送。
export const useAppLogStore = defineStore('appLog', () => {
  const entries = ref<AppLogLine[]>([]);
  const MAX_LINES = 2000;

  let subscribed = false;
  let locale = 'zh-CN';
  let seq = 0;

  function decorate(entry: AppLogEntry): AppLogLine {
    const data = entry.data || '';
    return {
      ...entry,
      id: ++seq,
      time: formatTime(entry.ts, locale),
      cls: clsOf(entry.kind),
      lower: data.toLowerCase(),
    };
  }

  function push(entry: AppLogEntry) {
    entries.value.push(decorate(entry));
    if (entries.value.length > MAX_LINES) {
      entries.value.splice(0, entries.value.length - MAX_LINES);
    }
  }

  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    try {
      // 初始拉取当前缓冲（浏览器预览/mock 环境下 list 可能返回 null）
      void window.api.logs.list().then((list) => {
        if (Array.isArray(list) && list.length > 0) entries.value = list.slice(-MAX_LINES).map(decorate);
      });
      window.api.logs.onLog((e) => push(e));
    } catch {
      // 浏览器预览环境（无 Electron preload）忽略订阅
    }
  }

  /** 切换界面语言：重算已缓存行的时间串（Intl 结果与 locale 绑定，仅切语言时发生一次） */
  function setLocale(next: string) {
    if (!next || next === locale) return;
    locale = next;
    for (const line of entries.value) line.time = formatTime(line.ts, locale);
  }

  function clear() {
    entries.value = [];
    try { void window.api.logs.clear(); } catch { /* 浏览器预览容错 */ }
  }

  return { entries, subscribe, clear, setLocale };
});
