import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppLogEntry } from '@llama-launcher/shared';

// 应用日志 store：读取/订阅主进程的应用生命周期/操作日志（区别于 server store 的后端 llama 输出）。
// 订阅防重入：与 server store 同模式，避免 dev HMR 下 listener 累积导致重复推送。
export const useAppLogStore = defineStore('appLog', () => {
  const entries = ref<AppLogEntry[]>([]);
  const MAX_LINES = 2000;

  let subscribed = false;
  let unsub: (() => void) | null = null;

  function push(entry: AppLogEntry) {
    entries.value.push(entry);
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
        if (Array.isArray(list) && list.length > 0) entries.value = list.slice(-MAX_LINES);
      });
      unsub = window.api.logs.onLog((e) => push(e));
    } catch {
      // 浏览器预览环境（无 Electron preload）忽略订阅
    }
  }

  function clear() {
    entries.value = [];
    try { void window.api.logs.clear(); } catch { /* 浏览器预览容错 */ }
  }

  return { entries, subscribe, clear };
});