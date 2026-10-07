import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { DEFAULT_HOST, DEFAULT_PORT } from '@llama-launcher/shared';
import type { ServerStatus, ServerStatusEvent, ServerStopInfo, OutputEntry, PropsCheck } from '@llama-launcher/shared';
import { useIPC, invokeOk, toPlain } from '@/composables/useIPC';
import { useI18nStore } from '@/stores/i18n';
import { formatLogTime } from './appLog';
import type { AppSettings, PresetValues } from '@llama-launcher/shared';

/** 有效状态：在 ServerStatus（stopped/starting/running/stopping）基础上叠加
 *  failed（启动失败）与 crashed（运行中崩溃）两个增强态。
 *  两者一律由主进程随状态事件下发的停止事实（`ServerStopInfo`）推导，**不看日志文字**——
 *  llama-server 在正常运行期也会为拒绝一个越界请求打
 *  `E srv  send_error: task id = N, error: request ... exceeds the available context size`
 *  这样的行，旧的「最近 80 行里有没有 error 字样」判定会把活着的进程显示成「异常退出」，
 *  再滚过 80 行又自己变回「运行中」（2026-09-25 移除该判定）。 */
export type EffectiveStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'crashed';

// 显存/内存耗尽（状态卡 OOM 警示行）——在入队时一次性匹配
const OOM_RE = /\b(out of memory|VK_ERROR_OUT_OF_DEVICE_MEMORY|cudaErrorOutOfMemory|out_of_memory|failed to allocate|unable to allocate|not enough memory|std::bad_alloc)\b/i;
// 控制台着色关键词：kind 为 error/success/info 时直接定色，其余按关键词判定
const CONSOLE_ERROR_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault)\b/i;
const CONSOLE_WARN_RE = /\b(warn|warning|deprecat|slow|out of)\b/i;
const CONSOLE_SUCCESS_RE = /\b(listening|loaded|ready|initialized|running|success)\b/i;

/** 控制台一行的着色语义（渲染期只做 tone→class 映射，不再跑正则）。 */
export type ConsoleTone = 'error' | 'warn' | 'success' | 'info' | 'plain';

/**
 * 渲染层消费的输出行：IPC 原始条目 + 入队时一次算好的派生标记。
 * 关键词匹配（着色 / OOM）原先都在渲染期按行重算——控制台最多渲染 1000 行、
 * 每条新日志触发一次整表重渲染，即每行 2~3 条正则。改为入队时 O(1) 判定后，
 * 这些热路径退化为布尔读。
 */
export interface OutputLine extends OutputEntry {
  /** 单调递增行号：v-for 的稳定 key（数组按 MAX_LINES 裁剪时索引会整体前移） */
  id: number;
  /** 行时间串（formatLogTime(ts, lang)，与概览应用日志同源）：入队时算好随行携带，语言切换整表重算 */
  time: string;
  tone: ConsoleTone;
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

/** 外部 llama-server 实例（非本应用拉起，端口探测识别） */
export interface ExternalServerInstance {
  pid?: number;
  name?: string;
  port: number;
  host: string;
}

/**
 * /props 自动刷新的退避档位（与概览页外部实例探测 ServiceStatusCard 同一套形状）。
 * 为什么这里允许定时、而核心侧那个 60s 盲轮询被删：被删的是「不管有没有人看、不管有没有变」
 * 的固定周期敲端口；引擎参数只可能被外部 `POST /props` 改写，而那次改写**在本机没有可订阅的事件源**
 * ——这与「别人家的 llama-server 何时起来」完全同构，所以沿用外部实例探测那条已被审查保留下来的
 * 「该探才探 + 空闲退避」规则：可见才探、只在 running 探、结论连续不变就把间隔按 ×2^n 拉长到封顶。
 */
export const PROPS_POLL_BASE_MS = 15_000;
export const PROPS_POLL_MAX_MS = 60_000;
/** 退避步数上限（15s→30s→60s 后保持封顶，继续翻倍只会白等） */
export const PROPS_POLL_MAX_STEPS = 4;

/** 第 step 档的等待时长：派生而非抄死，测试与被测代码共用这一个算式。 */
export function propsPollDelayMs(step: number): number {
  const s = Math.max(0, Math.min(step, PROPS_POLL_MAX_STEPS));
  return Math.min(PROPS_POLL_BASE_MS * 2 ** s, PROPS_POLL_MAX_MS);
}

export const useServerStore = defineStore('server', () => {
  const api = useIPC();
  const i18n = useI18nStore();

  const status = ref<ServerStatus>('stopped');
  const pid = ref<number | null>(null);
  const host = ref(DEFAULT_HOST);
  const port = ref(DEFAULT_PORT);
  const url = ref('');
  /**
   * 本轮服务「就绪」的时刻（epoch ms），由核心随状态事件与 getStatus 一并下发。
   * 界面据此派生运行时长——不能像以前那样在「本页第一次看见 running」时自记：
   * 服务已运行而用户第一次进概览页时那个 watch 根本不触发，时长就一直显示「—」。
   */
  const readyAt = ref<number | null>(null);
  // 最近一次启动/重启使用的参数快照（仅参数值，无逐参数启用位），用于判断服务是否与当前参数一致
  const runningValues = ref<Record<string, string | number | boolean> | null>(null);
  const outputs = ref<OutputLine[]>([]);
  // 输出行号源（单调递增，跨 clearOutputs 不复用，供 v-for 稳定 key）
  let outputSeq = 0;
  const MAX_LINES = 5000;
  // 主进程随状态事件下发的「最近一次结束事实」（见 shared/types/server.ts 的 ServerStopInfo）。
  // failed / crashed 两个增强态只由它推导：核心状态机知道进程是否起过、是否曾就绪、怎么退的，
  // 日志文本一概不参与——用关键词猜曾把运行中的服务误判成异常退出（详见 effectiveStatus 注释）。
  // 新一轮 starting 时主进程会把它清成 null，故跨轮残留天然不成立。
  const stopInfo = ref<ServerStopInfo | null>(null);

  // 引擎侧环境变量覆写项（LLAMA_ARG_*）：由主进程在启动那一刻检出并随 ServerInfo 下发。
  // 界面「未发射＝引擎按缺省值」这一前提只有在没有这些变量时才成立，故必须可见（见命令预览卡提示）。
  const envOverrides = ref<string[]>([]);

  // /props 回读对账结果（核心在服务就绪后跑一次）：null = 尚未回读或该环境没有真实服务。
  // 这是界面上唯一「已证实」的信号，其余参数值都只是「我们发出去了」。
  const propsCheck = ref<PropsCheck | null>(null);

  // ---- 外部 llama-server 实例检测（非本应用拉起）----
  // 来源有二：① 概览页定时探测配置端口（refreshExternal）；② 启动端口冲突时用户选择
  // 「接管监控」（adoptExternal）。仅做展示与监控，不受本应用进程管理（stop/restart 不作用其上）；
  // 本应用自身进入 starting/running 时外部标记立即失效（端口已被自家进程占用）。
  const external = ref<ExternalServerInstance | null>(null);

  /** 探测配置端口上是否有外部 llama-server 在监听。返回是否存在。 */
  async function refreshExternal(portVal?: number, hostVal?: string): Promise<boolean> {
    // 本应用自己的服务已在启动/运行/正在停：端口被自家进程占用，不存在「外部实例」语义
    if (status.value !== 'stopped') {
      external.value = null;
      return false;
    }
    const p = portVal ?? port.value;
    const h = (hostVal ?? host.value) || DEFAULT_HOST;
    try {
      const res = await api.system.checkPort(p, h);
      // 防御性检查：浏览器预览/mock 环境下 checkPort 可能返回 null
      if (res && res.inUse && LLAMA_SERVER_NAME_RE.test(res.name ?? '')) {
        const appeared = external.value === null;
        external.value = { pid: res.pid, name: res.name, port: p, host: h };
        if (appeared) {
          pushOutput({
            kind: 'info',
            data: `[Launcher] ${useI18nStore().t('msg_external_detected', [res.name ?? '?', String(res.pid ?? '?'), `http://${h}:${p}`])}\n`,
            ts: Date.now(),
          });
        }
        return true;
      }
      if (external.value) {
        pushOutput({
          kind: 'info',
          data: `[Launcher] ${useI18nStore().t('msg_external_gone', [String(p)])}\n`,
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
      data: `[Launcher] ${useI18nStore().t('msg_external_adopted', [instance.name ?? '?', String(instance.pid ?? '?')])}\n`,
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
      time: formatLogTime(entry.ts, i18n.lang),
      tone: toneOf(entry),
      oom: OOM_RE.test(text),
    };
  }

  /** 一批入队 + 一次裁剪：主进程按 16ms 窗口成批推送，逐条 push 会让数组每次变更都触发依赖刷新 */
  function pushOutputBatch(batch: OutputEntry[]) {
    if (!batch || batch.length === 0) return;
    for (const entry of batch) outputs.value.push(decorate(entry));
    if (outputs.value.length > MAX_LINES) {
      outputs.value.splice(0, outputs.value.length - MAX_LINES);
    }
  }

  function pushOutput(entry: OutputEntry) {
    pushOutputBatch([entry]);
  }

  // 行时间串与界面语言绑定（Intl 输出随 locale 变）：切换语言时对已缓存行整表重算一次，
  // 与 appLog.setLocale 同规则——不重算的话同一个控制台里会同时出现两种时间格式
  watch(
    () => i18n.lang,
    (lang) => {
      if (!lang) return;
      for (const line of outputs.value) line.time = formatLogTime(line.ts, lang);
    },
  );

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
      data: `[Launcher] ${useI18nStore().t('svc_port_busy_hint', [key])}\n`,
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
      api.server.onStatus((e: ServerStatusEvent) => {
        stopInfo.value = e.stop ?? null;
        // 回读结果随同状态事件补发（核心跑完 /props 后再发一次 running），null 表示尚未回读到
        if (e.propsCheck !== undefined) propsCheck.value = e.propsCheck;
        // 就绪时刻由核心下发（stopping 期间保留，进程真死才归零）——界面不许自己猜
        if (e.readyAt !== undefined) readyAt.value = e.readyAt ?? null;
        // starting / running / stopping 期间端口归自家进程所有，外部实例标记立即失效
        if (e.status !== 'stopped') external.value = null;
        // PID 与访问 URL 属于「这一轮运行」的事实：留着就是给一个已经不在的进程继续挂账号
        // （此前这里只写 status，两者要等主动拉取才更新，于是停服后概览与状态栏仍显示旧进程号）。
        // host/port 是用户配置的监听地址，不是运行事实，保留。
        if (e.status === 'stopped') {
          pid.value = null;
          url.value = '';
        }
        status.value = e.status;
      });
    } catch {
      // 浏览器预览环境(无 Electron preload)下 api.server 未定义,忽略事件订阅
    }
  }

  /**
   * 拉取主进程状态。`refresh: true` 顺带触发一次 /props 回读——触发点有两类：
   * ① 自动刷新（下面的 `enterPropsWatch` 那一套「可见 + 只在 running + 空闲退避」的节拍）；
   * ② 用户点「重新校验」按钮想立刻要答案。
   * 「窗口重新聚焦」那一侧的信号不经这里，由主进程 `launcher-bridge` 挂 `win.on('focus')`
   * 直接调 `Launcher.recheckProps()`（窗口没聚焦时渲染层自己也收不到 focus，放在主进程才可靠）。
   * 核心侧始终不含定时器：敲端口与否由这里的可见性决定。
   */
  async function refreshStatus(refresh = false) {
    const info = await api.server.getStatus(refresh);
    // 防御性检查：浏览器预览/mock 环境下 getStatus 可能返回 null
    if (!info) return;
    status.value = info.status;
    stopInfo.value = info.stop ?? null;
    pid.value = info.pid;
    host.value = info.host;
    port.value = info.port;
    url.value = info.url;
    readyAt.value = info.readyAt ?? null;
    runningValues.value = info.values ?? null;
    envOverrides.value = info.envOverrides ?? [];
    if (info.propsCheck !== undefined) propsCheck.value = info.propsCheck;
    // 与 onStatus 订阅同一语义：自家进程 running 后外部实例标记失效
    if (info.status === 'running' || info.status === 'starting') external.value = null;
  }

  // ---- /props 自动刷新（渲染层节拍：可见 + 只在 running + 空闲退避）----
  // 为什么放在渲染层而不是核心：「有没有人在看」只有渲染层知道（keep-alive 的激活/失活），
  // 而核心只有端口。节拍器写在这里，核心仍是纯事件驱动——它收到 `server:status(refresh:true)`
  // 才敲一次端口，自己从不排表。
  // 生命周期铁律 §7.1①：定时器必须与 onActivated/onDeactivated 配对，失活清表；
  // 计数式挂接（多个卡片各持一个 release）是为了「概览 ↔ 服务」来回切页时不出现 0 空窗，
  // 也让同一组件在 keep-alive 下 unmount + deactivate 双触发时不会把计数减成负数。
  let propsWatchers = 0;
  let propsTimer: ReturnType<typeof setTimeout> | null = null;
  /** 连续「结论没变」的步数：决定下一档等多久 */
  let propsIdleSteps = 0;
  /** 上一次节拍见到的结论指纹，用于判断这一轮有没有新东西可报 */
  let propsLastKey = '';
  /** 在途节拍标记：同一时刻只允许一次回读排队（回读是异步的，节拍可能撞上） */
  let propsPollInFlight = false;

  /**
   * 结论指纹：与核心 `runPropsCheck` 的 changed 判定取同一组字段
   * （mismatched / error / baselineDrift）。字段不一致会导致两侧对「变没变」各有看法，
   * 退避档位就失去意义（该回快档时没回）。checkedAt 刻意不参与——它每次都变，
   * 把它算进指纹等于退避永不生效。
   */
  function propsConclusionKey(): string {
    const c = propsCheck.value;
    if (!c) return '';
    return JSON.stringify([c.mismatched, c.error ?? '', c.baselineDrift ?? null]);
  }

  function clearPropsTimer() {
    if (propsTimer) { clearTimeout(propsTimer); propsTimer = null; }
  }

  /** 只有「真的有人在看」且「有端口可敲（running）」时才允许排下一次 */
  function propsShouldPoll(): boolean {
    return propsWatchers > 0 && status.value === 'running';
  }

  function schedulePropsPoll() {
    clearPropsTimer();
    if (!propsShouldPoll()) return;
    propsTimer = setTimeout(() => {
      propsTimer = null;
      void propsPollTick();
    }, propsPollDelayMs(propsIdleSteps));
  }

  async function propsPollTick(): Promise<void> {
    if (propsPollInFlight) return;
    propsPollInFlight = true;
    try {
      await refreshStatus(true);
    } finally {
      propsPollInFlight = false;
    }
    const key = propsConclusionKey();
    if (key !== propsLastKey) {
      // 结论变了 = 这次敲端口是有产出的 → 回到快档，趁热接着看
      propsIdleSteps = 0;
      propsLastKey = key;
    } else {
      // 无事可报 → 拉长间隔，直到封顶
      propsIdleSteps = Math.min(propsIdleSteps + 1, PROPS_POLL_MAX_STEPS);
    }
    schedulePropsPoll();
  }

  /** 归零退避并立刻敲一次端口（页面重新可见 / 服务变 running / host·port 改动） */
  function propsProbeNow() {
    propsIdleSteps = 0;
    propsLastKey = '';
    clearPropsTimer();
    if (propsShouldPoll()) void propsPollTick();
  }

  /**
   * 声明「本页正在有人看 /props 结论」，返回幂等的 release。
   * 调用方：展示回读结论的卡片，onActivated 挂、onDeactivated/onUnmounted 放。
   */
  function enterPropsWatch(): () => void {
    propsWatchers++;
    propsProbeNow();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      propsWatchers = Math.max(0, propsWatchers - 1);
      if (propsWatchers === 0) {
        // 没人看了：立刻停表，后台页不许敲端口
        clearPropsTimer();
        propsIdleSteps = 0;
        propsLastKey = '';
      }
    };
  }

  // 服务变 running（含重启后的新一轮）：退避归零并立刻探一次；离开 running 一律停表
  watch(status, (s) => {
    if (s === 'running') propsProbeNow();
    else clearPropsTimer();
  });
  // 监听地址变了（多地址 host / 改端口后重启）：上一轮结论与新端点无关，归零重探
  watch([host, port], () => {
    if (propsShouldPoll()) propsProbeNow();
  });

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

  /**
   * 「现在能不能打开内置 Web UI」的唯一口径。此前这个判断在顶栏（无门控）、
   * 概览服务状态卡（严格 running）、内嵌帧（严格 running）各写一份，同一时刻
   * 一处可点一处是灰的。内嵌帧只在 running 时真正加载 iframe，所以口径按它定：
   * starting 期端口还没监听，跳过去只能看到「服务未运行」。
   */
  const canOpenWeb = computed(() => status.value === 'running');

  // ---- 增强状态机（单一事实源，ServicePage / Dashboard / StatusBar 共用）----

  /** 最近 OOM_LOOKBACK 行内是否出现显存/内存耗尽（状态卡 OOM 警示） */
  const OOM_LOOKBACK = 300;
  const oomDetected = computed(() => {
    const arr = outputs.value;
    for (let i = Math.max(0, arr.length - OOM_LOOKBACK); i < arr.length; i++) if (arr[i].oom) return true;
    return false;
  });

  /**
   * 有效状态：在原始 ServerStatus 之上，用主进程下发的停止事实细分「怎么停的」——
   * 跑过之后非正常退出 → crashed；启动阶段就退出 / 压根没起来 → failed；
   * 用户主动停或干净退出 → stopped。UI 层临时态（stopping）由调用方按需覆盖。
   *
   * 这里刻意不参考 outputs：日志里出现 error 字样与进程死活无关（llama-server 会用它
   * 拒绝单个越界请求），旧实现正是据此把运行中的服务判成「异常退出」。
   */
  const effectiveStatus = computed<EffectiveStatus>(() => {
    if (status.value !== 'stopped') return status.value;
    const stop = stopInfo.value;
    if (!stop || stop.reason === 'stopped_by_user') return 'stopped';
    if (stop.reason === 'spawn_failed') return 'failed';
    if (!stop.hadBeenReady) return 'failed';
    // 曾就绪后自己退出：干净退出（code 0、无信号）不算崩，其余算异常退出
    return stop.code === 0 && !stop.signal ? 'stopped' : 'crashed';
  });

  return {
    status, pid, host, port, url, readyAt, apiUrl, canOpenWeb, outputs, runningValues, stopInfo, envOverrides, propsCheck,
    effectiveStatus, oomDetected,
    external,
    refreshExternal, adoptExternal, clearExternal,
    subscribe, refreshStatus, clearOutputs, pushOutput, pushOutputBatch,
    enterPropsWatch,
    start, stop, restart, previewCommand,
  };
});
