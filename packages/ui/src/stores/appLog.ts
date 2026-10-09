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

/** 行时间串（Intl 按 locale 输出 时:分:秒）：应用日志与框架控制台（server store）共用，
 *  两处日志面的时间列因此同格式；调用方在入队时调用并随行携带 */
export function formatLogTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// 应用日志 store：读取/订阅主进程的应用生命周期/操作日志（区别于 server store 的后端 llama 输出）。
// 应用日志缓冲上限：导出给日志页作为渲染上限，避免两处各写一个数（曾出现页面 RENDER_LIMIT 3000
// 高于缓冲 2000 而永远触发不到的死余量）。
export const APP_LOG_MAX_LINES = 2000;

// 订阅防重入：与 server store 同模式，避免 dev HMR 下 listener 累积导致重复推送。
export const useAppLogStore = defineStore('appLog', () => {
  const entries = ref<AppLogLine[]>([]);

  let subscribed = false;
  let locale = 'zh-CN';
  let seq = 0;

  function decorate(entry: AppLogEntry): AppLogLine {
    const data = entry.data || '';
    return {
      ...entry,
      id: ++seq,
      time: formatLogTime(entry.ts, locale),
      cls: clsOf(entry.kind),
      lower: data.toLowerCase(),
    };
  }

  function push(entry: AppLogEntry) {
    entries.value.push(decorate(entry));
    if (entries.value.length > APP_LOG_MAX_LINES) {
      entries.value.splice(0, entries.value.length - APP_LOG_MAX_LINES);
    }
  }

  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    try {
      // 初始拉取当前缓冲（浏览器预览/mock 环境下 list 可能返回 null）。
      // 异步拒绝也要兜：list() 返回 rejected promise 时若无 catch，会以 Unhandled
      // Rejection 污染进程（T04）；初始拉取失败不阻断订阅，后续 onLog 事件照常入队。
      void window.api.logs
        .list()
        .then((list) => {
          if (!Array.isArray(list) || list.length === 0) return;
          // 快照必须**合并**而不是整体替换：渲染层本地也会推应用级事件（params/launcher 等
          // 经 appLog.push，早于本快照落地），整体替换会把它们冲掉（实测 [params]/[mmproj]
          // 行在概览卡闪失）。按 ts+data 判重只补本地没有的行，本地行保持原序在前。
          const seen = new Set(entries.value.map((e) => `${e.ts}:${e.data}`));
          const merged = [...entries.value];
          for (const e of list) {
            if (seen.has(`${e.ts}:${e.data}`)) continue;
            seen.add(`${e.ts}:${e.data}`);
            merged.push(decorate(e));
          }
          merged.sort((a, b) => a.ts - b.ts); // 合并后按事件时间排序（本地行与快照行互相穿插）
          entries.value = merged.slice(-APP_LOG_MAX_LINES);
        })
        .catch(() => {
          // 初始缓冲拉取失败（读取异常/预载缺失）静默放弃，live 推送不受影响
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
    for (const line of entries.value) line.time = formatLogTime(line.ts, locale);
  }

  function clear() {
    entries.value = [];
    try { void window.api.logs.clear(); } catch { /* 浏览器预览容错 */ }
  }

  // push 一并暴露：渲染层本地产生的应用级事件（参数载入/启动器错误等）从这里进同一缓冲，
  // 与主进程经 LOGS_ONLOG 推来的行在概览卡合流——控制台只留 llama-server 原始输出
  return { entries, push, subscribe, clear, setLocale };
});
