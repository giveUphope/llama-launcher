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
// 显存/内存耗尽（状态卡 OOM 警示行）——与着色正则一样在入队时一次性匹配
const OOM_RE = /\b(out of memory|VK_ERROR_OUT_OF_DEVICE_MEMORY|cudaErrorOutOfMemory|out_of_memory|failed to allocate|unable to allocate|not enough memory|std::bad_alloc)\b/i;
// 控制台着色关键词：kind 为 error/success/info 时直接定色，其余按关键词判定
const CONSOLE_ERROR_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault)\b/i;
const CONSOLE_WARN_RE = /\b(warn|warning|deprecat|slow|out of)\b/i;
const CONSOLE_SUCCESS_RE = /\b(listening|loaded|ready|initialized|running|success)\b/i;

/** 控制台一行的着色语义（渲染期只做 tone→class 映射，不再跑正则）。 */
export type ConsoleTone = 'error' | 'warn' | 'success' | 'info' | 'plain';

/**
 * 渲染层消费的输出行：IPC 原始条目 + 入队时一次算好的派生标记。
 * 关键词匹配（着色 / 失败判定 / OOM）原先都在渲染期按行重算——控制台最多渲染 1000 行、
 * 每条新日志触发一次整表重渲染，即每行 3 条正则；effectiveStatus 亦每行 join 80 行文本
 * 再跑一次正则。改为入队时 O(1) 判定后，这些热路径退化为布尔读。
 */
export interface OutputLine extends OutputEntry {
  /** 单调递增行号：v-for 的稳定 key（数组按 MAX_LINES 裁剪时索引会整体前移） */
  id: number;
  tone: ConsoleTone;
  fail: boolean;
  oom: boolean;
}

function toneOf(entry: OutputEntry): ConsoleTone {
  if (entry.kind === 'error') return 'error';
  if (entry.kind === 'success') return 'success';
  if (entry.kind === 'info') return 'info';
  const text = entry.data || '';
  if (CONSOLE_ERROR_RE.test(text)) return 'error';
  if (CONSOLE_WARN_RE.test(text)) return 'warn';
  if (CONSOLE_SUCCESS_RE.test(text)) return 'success';
  return 'plain';
}
// 端口绑定失败（llama-server 启动被端口占用时的原始输出，跨版本匹配：
// "bind() failed: Address already in use" / "address already in use" / "EADDRINUSE" / "OS Error: 10048" /
// "cannot assign requested address" / "errno 98" / "http: bind"）
export const PORT_BUSY_RE = /address already in use|bind\(\) failed|EADDRINUSE|errno\s+98|error:\s*10048|cannot assign requested address/i;

// 外部 llama-server 进程名识别（checkPort 返回的占用者进程名）：
// Windows tasklist 为 "llama-server.exe"，POSIX lsof/ss 可能截断到 9 字符（"llama-ser"），
// 故匹配到 "llama-ser" 前缀即可，不依赖扩展名
export const LLAMA_SERVER_NAME_RE = /llama[-_]?ser/i;
const TAIL_LINES = 80;

/** 外部 llama-server 实例（非本应用拉起，端口探测识别） */
export interface ExternalServerInstance {
  pid?: number;
  name?: string;
  port: number;
  host: string;
}

export const useServerStore = defineStore('server', () => {
  const api = useIPC();

  const status = ref<ServerStatus>('stopped');
  const pid = ref<number | null>(null);
  const host = ref('127.0.0.1');
  const port = ref(8080);
  const url = ref('');
  // 最近一次启动/重启使用的参数快照（仅参数值，无逐参数启用位），用于判断服务是否与当前参数一致
  const runningValues = ref<Record<string, string | number | boolean> | null>(null);
  const outputs = ref<OutputLine[]>([]);
  // 输出行号源（单调递增，跨 clearOutputs 不复用，供 v-for 稳定 key）
  let outputSeq = 0;
  const MAX_LINES = 5000;
  // 当前这一轮运行的失败判定只看本轮输出：每次进入 starting（start/restart 拉起新进程）时
  // 重置为本次运行的起始下标。若不加区分，上一轮端口冲突等失败残留行会留在输出缓冲尾部，
  // 把本轮 starting/running 误判为 failed/crashed——正是“端口冲突处理后重新启动、状态无变化
  // 但服务其实已启动”的根因。
  const runStart = ref(0);

  // ---- 外部 llama-server 实例检测（非本应用拉起）----
  // 来源有二：① 概览页定时探测配置端口（refreshExternal）；② 启动端口冲突时用户选择
  // 「接管监控」（adoptExternal）。仅做展示与监控，不受本应用进程管理（stop/restart 不作用其上）；
  // 本应用自身进入 starting/running 时外部标记立即失效（端口已被自家进程占用）。
  const external = ref<ExternalServerInstance | null>(null);

  /** 探测配置端口上是否有外部 llama-server 在监听。返回是否存在。 */
  async function refreshExternal(portVal?: number, hostVal?: string): Promise<boolean> {
    // 本应用自己的服务已在启动/运行：端口被自家进程占用，不存在「外部实例」语义
    if (status.value === 'running' || status.value === 'starting') {
      external.value = null;
      return false;
    }
    const p = portVal ?? port.value;
    const h = (hostVal ?? host.value) || '127.0.0.1';
    try {
      const res = await api.system.checkPort(p, h);
      // 防御性检查：浏览器预览/mock 环境下 checkPort 可能返回 null
      if (res && res.inUse && LLAMA_SERVER_NAME_RE.test(res.name ?? '')) {
        const appeared = external.value === null;
        external.value = { pid: res.pid, name: res.name, port: p, host: h };
        if (appeared) {
          pushOutput({
            kind: 'info',
            data: `[Launcher] ${useI18nStore().t('msg_external_detected')
              .replace('{0}', res.name ?? '?')
              .replace('{1}', String(res.pid ?? '?'))
              .replace('{2}', `http://${h}:${p}`)}\n`,
            ts: Date.now(),
          });
        }
        return true;
      }
      if (external.value) {
        pushOutput({
          kind: 'info',
          data: `[Launcher] ${useI18nStore().t('msg_external_gone').replace('{0}', String(p))}\n`,
          ts: Date.now(),
        });
      }
      external.value = null;
      return false;
    } catch {
      return false;
    }
  }

  /** 接管外部实例（启动端口冲突弹窗选择「接管监控」）：记录展示，不拉起进程。 */
  function adoptExternal(instance: ExternalServerInstance) {
    external.value = instance;
    pushOutput({
      kind: 'info',
      data: `[Launcher] ${useI18nStore().t('msg_external_adopted')
        .replace('{0}', instance.name ?? '?')
        .replace('{1}', String(instance.pid ?? '?'))}\n`,
      ts: Date.now(),
    });
  }

  function clearExternal() {
    external.value = null;
  }

  function decorate(entry: OutputEntry): OutputLine {
    const text = entry.data || '';
    return {
      ...entry,
      id: ++outputSeq,
      tone: toneOf(entry),
      fail: FAIL_RE.test(text),
      oom: OOM_RE.test(text),
    };
  }

  /** 一批入队 + 一次裁剪：主进程按 16ms 窗口成批推送，逐条 push 会让数组每次变更都触发依赖刷新 */
  function pushOutputBatch(batch: OutputEntry[]) {
    if (!batch || batch.length === 0) return;
    for (const entry of batch) outputs.value.push(decorate(entry));
    if (outputs.value.length > MAX_LINES) {
      const removed = outputs.value.length - MAX_LINES;
      outputs.value.splice(0, removed);
      if (runStart.value > removed) runStart.value -= removed;
      else runStart.value = 0;
    }
  }

  function pushOutput(entry: OutputEntry) {
    pushOutputBatch([entry]);
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
      api.server.onOutputBatch((entries) => {
        pushOutputBatch(entries);
        for (const e of entries) portBusyHint(e);
      });
      api.server.onStatus((s) => {
        // 进入 starting 即意味着拉起了一个新进程：失败/崩溃判定边界重置到本轮输出起点。
        if (s === 'starting') runStart.value = outputs.value.length;
        // 本应用拉起自身进程后，外部实例标记立即失效（端口将归自家进程所有）
        if (s === 'starting' || s === 'running') external.value = null;
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
    // 与 onStatus 订阅同一语义：自家进程 running 后外部实例标记失效
    if (info.status === 'running' || info.status === 'starting') external.value = null;
  }

  async function start(values: PresetValues, settings: AppSettings) {
    try {
      await invokeOk(api.server.start(toPlain(values), toPlain(settings)));
      // 立即以主进程权威状态同步一次：状态事件若丢失/迟到，界面不至于停留在旧状态
      // （防“实际已在启动而界面无变化”）。
      await refreshStatus();
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
      await refreshStatus();
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
    runStart.value = 0;
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
  // 本轮运行输出窗口（最多 80 行）内是否出现失败关键词：
  // 逐行读入队时算好的 fail 标记。上一轮（如端口冲突失败）残留的失败关键词不得把本轮
  // starting/running 误判为 failed/crashed，故窗口起点仍是 runStart 下标。
  // （此前这里是 slice(80).map(data).join('') 再对整串跑正则，每条新日志一次。）
  const tailHasFail = computed(() => {
    const arr = outputs.value;
    const from = Math.max(runStart.value, arr.length - TAIL_LINES, 0);
    for (let i = from; i < arr.length; i++) if (arr[i].fail) return true;
    return false;
  });

  /** 最近 OOM_LOOKBACK 行内是否出现显存/内存耗尽（状态卡 OOM 警示） */
  const OOM_LOOKBACK = 300;
  const oomDetected = computed(() => {
    const arr = outputs.value;
    for (let i = Math.max(0, arr.length - OOM_LOOKBACK); i < arr.length; i++) if (arr[i].oom) return true;
    return false;
  });

  /**
   * 有效状态：在原始 ServerStatus 之上按本轮输出增强判定——
   * running + 失败关键词 → crashed；starting + 失败关键词 → failed；
   * stopped 但本轮残留失败输出 → failed。UI 层临时态（stopping）由调用方按需覆盖。
   */
  const effectiveStatus = computed<EffectiveStatus>(() => {
    if (status.value === 'running') return tailHasFail.value ? 'crashed' : 'running';
    if (status.value === 'starting') return tailHasFail.value ? 'failed' : 'starting';
    if (status.value === 'stopped' && tailHasFail.value) return 'failed';
    return status.value;
  });

  return {
    status, pid, host, port, url, apiUrl, outputs, runningValues,
    effectiveStatus, oomDetected,
    external,
    refreshExternal, adoptExternal, clearExternal,
    subscribe, refreshStatus, clearOutputs, pushOutput, pushOutputBatch,
    start, stop, restart, previewCommand,
  };
});
