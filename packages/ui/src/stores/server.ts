import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ServerStatus, OutputEntry } from '@llama-launcher/shared';
import { useIPC, invokeOk, toPlain } from '@/composables/useIPC';
import { useI18nStore } from '@/stores/i18n';
import type { AppSettings, PresetValues } from '@llama-launcher/shared';

/** 有效状态：在 ServerStatus（stopped/starting/running/stopping）基础上叠加
 *  failed（启动失败/残留失败）与 crashed（运行中崩溃）两个增强态。 */
export type EffectiveStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'crashed';

// 失败/崩溃关键词（服务页状态卡原实现下沉至此，三处状态显示共用单一判定）
const FAIL_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault|exit code|killed|killed by signal)\b/i;
// 端口绑定失败（llama-server 启动被端口占用时的原始输出，跨版本匹配：
// "bind() failed: Address already in use" / "address already in use" / "EADDRINUSE" / "OS Error: 10048" /
// "cannot assign requested address" / "errno 98" / "http: bind"）
export const PORT_BUSY_RE = /address already in use|bind\(\) failed|EADDRINUSE|errno\s+98|error:\s*10048|cannot assign requested address/i;
const TAIL_LINES = 80;

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

  // 端口占用友好提示：同一端口 5s 内只提示一次，避免重复输出刷屏
  let lastPortHintKey = '';
  let lastPortHintTs = 0;
  function portBusyHint(entry: OutputEntry) {
    if (status.value !== 'starting' && status.value !== 'running') return;
    if (!PORT_BUSY_RE.test(entry.data)) return;
    const now = Date.now();
    const key = `${port.value}`;
    if (key === lastPortHintKey && now - lastPortHintTs < 5000) return;
    lastPortHintKey = key;
    lastPortHintTs = now;
    pushOutput({
      kind: 'error',
      data: `[Launcher] ${useI18nStore().t('svc_port_busy_hint').replace('{0}', key)}\n`,
      ts: now,
    });
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
        portBusyHint(e);
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

  /**
   * 统一 API 地址语义（单一来源，Dashboard/ServicePage 共用）：
   * 与真实服务状态绑定——运行中显示实际地址（store.url 残留时回退推导），启动中推导；
   * 已停止时返回空（onStatus 事件只更新 status 不刷新 url，直接读 url 会残留旧值）。
   * 显示层对空值以占位符呈现，保证运行前后显示项行结构稳定。
   */
  const apiUrl = computed(() => {
    if (status.value === 'running') return url.value || `http://${host.value}:${port.value}`;
    if (status.value === 'starting') return `http://${host.value}:${port.value}`;
    return '';
  });

  // ---- 增强状态机（单一事实源，ServicePage / Dashboard Q1 / StatusBar 共用）----
  // 最近 80 行输出拼接（限长，避免正则性能问题）
  const outputTail = computed(() => outputs.value.slice(-TAIL_LINES).map((o) => o.data).join(''));

  /**
   * 有效状态：在原始 ServerStatus 之上按最近输出增强判定——
   * running + 失败关键词 → crashed；starting + 失败关键词 → failed；
   * stopped 但残留失败输出 → failed。UI 层临时态（stopping）由调用方按需覆盖。
   */
  const effectiveStatus = computed<EffectiveStatus>(() => {
    if (status.value === 'running') return FAIL_RE.test(outputTail.value) ? 'crashed' : 'running';
    if (status.value === 'starting') return FAIL_RE.test(outputTail.value) ? 'failed' : 'starting';
    if (status.value === 'stopped' && FAIL_RE.test(outputTail.value)) return 'failed';
    return status.value;
  });

  return {
    status, pid, host, port, url, apiUrl, outputs, runningValues,
    effectiveStatus,
    subscribe, refreshStatus, clearOutputs, pushOutput,
    start, stop, restart, previewCommand,
  };
});
