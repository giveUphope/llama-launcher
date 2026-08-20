import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ServerStatus, OutputEntry } from '@llama-launcher/shared';
import { useIPC, invokeOk, toPlain } from '@/composables/useIPC';
import type { AppSettings, PresetValues } from '@llama-launcher/shared';

export const useServerStore = defineStore('server', () => {
  const api = useIPC();

  const status = ref<ServerStatus>('stopped');
  const pid = ref<number | null>(null);
  const host = ref('127.0.0.1');
  const port = ref(8080);
  const url = ref('');
  // 最近一次启动/重启使用的参数快照（含 _enabled），用于判断服务是否与当前参数一致
  const runningValues = ref<Record<string, string | number | boolean> | null>(null);
  const outputs = ref<OutputEntry[]>([]);
  const MAX_LINES = 5000;

  function pushOutput(entry: OutputEntry) {
    outputs.value.push(entry);
    if (outputs.value.length > MAX_LINES) {
      outputs.value.splice(0, outputs.value.length - MAX_LINES);
    }
  }

  // 防重入：subscribe 可能被多次调用（如 dev HMR 下 App 重新挂载），
  // 若每次都注册新监听器，preload 的 outputListeners 会累积，
  // 导致同一输出条目被 push 多次（控制台重复输出）。对齐 download store 的防重入模式。
  let subscribed = false;
  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    try {
      api.server.onOutput((e) => {
        pushOutput(e);
      });
      api.server.onStatus((s) => {
        status.value = s;
      });
    } catch {
      // 浏览器预览环境(无 Electron preload)下 api.server 未定义,忽略事件订阅
    }
  }

  async function refreshStatus() {
    const info = await api.server.getStatus();
    // 防御性检查：浏览器预览/mock 环境下 getStatus 可能返回 null
    if (!info) return;
    status.value = info.status;
    pid.value = info.pid;
    host.value = info.host;
    port.value = info.port;
    url.value = info.url;
    runningValues.value = info.values ?? null;
  }

  async function start(values: PresetValues, settings: AppSettings) {
    try {
      await invokeOk(api.server.start(toPlain(values), toPlain(settings)));
    } catch (err: any) {
      pushOutput({ kind: 'error', data: `[Launcher] Start failed: ${err.message}\n`, ts: Date.now() });
      throw err;
    }
  }

  async function stop() {
    try {
      await invokeOk(api.server.stop());
    } catch (err: any) {
      pushOutput({ kind: 'error', data: `[Launcher] Stop failed: ${err.message}\n`, ts: Date.now() });
      throw err;
    }
  }

  async function restart(values: PresetValues, settings: AppSettings) {
    try {
      await invokeOk(api.server.restart(toPlain(values), toPlain(settings)));
    } catch (err: any) {
      pushOutput({ kind: 'error', data: `[Launcher] Restart failed: ${err.message}\n`, ts: Date.now() });
      throw err;
    }
  }

  async function previewCommand(values: PresetValues, settings: AppSettings): Promise<string> {
    return invokeOk(api.server.previewCommand(toPlain(values), toPlain(settings)));
  }

  function clearOutputs() {
    outputs.value = [];
  }

  return {
    status, pid, host, port, url, outputs, runningValues,
    subscribe, refreshStatus, clearOutputs, pushOutput,
    start, stop, restart, previewCommand,
  };
});
