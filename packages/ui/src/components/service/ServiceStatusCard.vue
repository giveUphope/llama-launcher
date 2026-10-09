<script setup lang="ts">
// 服务状态卡（概览页）：服务状态的唯一页面级展示区——状态、当前模型、API 地址、
// 运行时详情（主机/端口/PID/运行时长）、失败提示与基线徽章。
// 自「服务」页迁入概览：原概览 Q1–Q3 与服务页状态卡重复展示同一组信息，
// 迁移后该信息只在此一处显示（状态栏为全局常驻 chrome，不属于页面级展示）。
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Card from '@/components/common/Card.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useHardwareStore } from '@/stores/hardware';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, modelBaseName, formatDuration, DEFAULT_PORT, PARAMS } from '@llama-launcher/shared';

const server = useServerStore();
const params = useParamsStore();
const hw = useHardwareStore();
const i18n = useI18nStore();
const router = useRouter();

const isRunning = computed(() => server.status === 'running');

/**
 * 端点暴露提示：未设 API Key 且 CORS 允许所有来源时，引擎只在启动日志打一行
 * `security: no API key is set and CORS allows all origins`，滚过去就再也看不到——
 * 而它的含义是"本机任意网页都能调这个端点"，所以必须常驻在 API 地址旁边。
 */
const openEndpoint = computed(() => {
  if (!isRunning.value && !server.external) return false;
  const key = String(params.values.api_key ?? '').trim();
  const origins = String(params.values.cors_origins ?? '*').trim();
  return key === '' && (origins === '' || origins === '*');
});
const secHintText = computed(() => i18n.t('sec_open_endpoint_hint'));

// ---- 外部 llama-server 实例（非本应用拉起）----
// 探测只在「可能真的变了」的时候做，不做无脑定时轮询：
// ① 自家服务 starting/running 期间**完全不探**——store 的 refreshExternal 第一行就返回 null
//    （端口归自家进程所有，不存在"外部实例"语义），此前定时器仍每 15s 调一次空函数并写一遍响应式值；
// ② 自家服务停止的那一刻立即探一次（外部接管端口的时机就在这前后）；
// ③ host/port 参数改动时立即探一次；
// ④ 其余时间用退避兜底（15s → 30s → 60s 封顶）：外部进程启停我们收不到事件，
//    完全去掉轮询就会漏，但结论连续不变时没必要一直用快档。
const EXTERNAL_POLL_BASE_MS = 15_000;
const EXTERNAL_POLL_MAX_MS = 60_000;
// 页面是否可见（keep-alive 下 onUnmounted 不触发，必须靠激活/失活开关）
let pageActive = false;
let externalTimer: ReturnType<typeof setTimeout> | null = null;
let externalIdleSteps = 0;
// 上次观测到的外部实例标识（存在与否 + pid），用于判断"这轮有没有变"
let externalSeen = '';

function externalKey(): string {
  const e = server.external;
  return e ? `${e.host}:${e.port}:${e.pid ?? '?'}` : '';
}

function probeExternal() {
  void server.refreshExternal(
    Number(params.values.port ?? DEFAULT_PORT),
    String(params.values.host ?? '') || undefined,
  ).then(scheduleExternalProbe);
}

/** 只有"停在停服状态、需要盯外部实例"时才续探；结论变了就把退避档位收回快档 */
function scheduleExternalProbe() {
  if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
  if (!pageActive || server.status !== 'stopped') return;
  const now = externalKey();
  externalIdleSteps = now === externalSeen
    ? Math.min(externalIdleSteps + 1, 4)
    : 0;
  externalSeen = now;
  const delay = Math.min(EXTERNAL_POLL_BASE_MS * 2 ** externalIdleSteps, EXTERNAL_POLL_MAX_MS);
  externalTimer = setTimeout(probeExternal, delay);
}

const externalUrl = computed(() =>
  server.external ? `http://${server.external.host}:${server.external.port}` : '',
);

const externalTagLabel = computed(() => {
  if (!server.external) return '';
  return `${i18n.t('lbl_external_instance')} · PID ${server.external.pid ?? '?'}`;
});

const externalHint = computed(() => {
  if (!server.external) return '';
  return i18n.t('msg_external_detected', [server.external.name ?? '?', String(server.external.pid ?? '?'), externalUrl.value]);
});

/** 打开 Web UI：本应用实例跳内置 WebUI 页；外部实例直接在系统浏览器打开其地址 */
function onOpenWeb() {
  if (server.canOpenWeb) {
    void router.push('/webui');
    return;
  }
  if (externalUrl.value) void window.api.openExternal(externalUrl.value);
}

// 有效状态：增强判定（running+失败→crashed、starting+失败→failed、stopped+残留失败→failed）
// 已下沉至 server store（概览状态卡/StatusBar 共用单一事实源）
const statusInfo = computed(() => {
  if (server.effectiveStatus === 'running') return { status: 'ok', label: i18n.t('svc_status_running') };
  if (server.effectiveStatus === 'starting') return { status: 'loading', label: i18n.t('svc_status_starting') };
  if (server.effectiveStatus === 'stopping') return { status: 'loading', label: i18n.t('svc_status_stopping') };
  if (server.effectiveStatus === 'failed') return { status: 'error', label: i18n.t('svc_status_failed') };
  if (server.effectiveStatus === 'crashed') return { status: 'error', label: i18n.t('svc_status_crashed') };
  return { status: 'idle', label: i18n.t('svc_status_stopped') };
});

// ---- 当前模型 ----（别名优先，回退文件名去 .gguf 后缀）
const currentModel = computed(() => {
  const p = String(params.values[MODEL_KEY] ?? '');
  if (!p) return '';
  const alias = String(params.values['alias'] ?? '').trim();
  if (alias) return alias;
  return modelBaseName(p);
});

// 注：API 地址不在此处派生，统一使用 server store 的 apiUrl（与真实服务状态绑定：
// 运行中/启动中返回地址，已停止返回空——避免 store.url 残留旧值继续显示）。
// 显示层对空值以占位符呈现，保证运行前后显示项行结构稳定。

// ---- 运行时长（秒 → 文本）----
// 起点取核心下发的「本轮就绪时刻」，不是「本页第一次看见 running 的时刻」——
// 后者在服务已运行、用户第一次进概览页时永远为空（下面的 watch 不触发），
// 运行时长就一直显示「—」，要停止再启动才正常（STYLE_TODO 记录过这条）。
const startTimeMs = computed<number | null>(() => server.readyAt);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

function updateDuration() {
  now.value = Date.now();
}

// 1s 心跳只在真的运行时开：原实现在概览页激活时无条件开表，服务停止后仍每秒写 now.value
// （durationSec 虽短路为 0，但每秒的唤醒 + 响应式写入照旧发生）
function startDurationTimer() {
  if (timer || !pageActive) return;
  updateDuration();
  timer = setInterval(updateDuration, 1000);
}
function stopDurationTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

// 概览页也派一份 /props 自动刷新的可见计数：这里显示状态与基线徽章，用户停在此页时
// 同样在「真的看」（服务页那份见 CommandPreviewCard）。节拍与退避全在 store 里，
// 本页只负责进/出计数——失活必须退掉，否则后台页会继续敲端口（§7.1 铁律①）。
let releasePropsWatch: (() => void) | null = null;
// 落位/减负建议的取数订阅：与回读同一套「本页真的可见才取数」，失活必须退掉（§7.1 铁律①），
// 否则概览页停在后台时仍会跟着参数改动去敲主进程的估算。
let releaseHwWatch: (() => void) | null = null;

function enterHwWatch() {
  releaseHwWatch?.();
  releaseHwWatch = hw.enter();
}
function leaveHwWatch() {
  releaseHwWatch?.();
  releaseHwWatch = null;
}

onActivated(() => {
  pageActive = true;
  // 页签重新可见 = 有人真的在看 → 进入自动刷新计数（running 时立刻复检一次，
  // 之后按「结论连续不变就 ×2^n 退避」续探；核心侧自己不排定时器）
  releasePropsWatch?.();
  releasePropsWatch = server.enterPropsWatch();
  enterHwWatch();
  if (isRunning.value) startDurationTimer();
  // 外部实例探测：激活立即探一次，之后按退避续探（失活/卸载即停）
  externalIdleSteps = 0;
  probeExternal();
});

onDeactivated(() => {
  pageActive = false;
  releasePropsWatch?.();
  releasePropsWatch = null;
  leaveHwWatch();
  stopDurationTimer();
  if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
});

onUnmounted(() => {
  pageActive = false;
  releasePropsWatch?.();
  releasePropsWatch = null;
  leaveHwWatch();
  stopDurationTimer();
  if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
});

const durationSec = computed(() => {
  if (!startTimeMs.value) return 0;
  return Math.floor((now.value - startTimeMs.value) / 1000);
});

// ---- 服务状态变化时刷新 ----
watch(() => server.status, (s) => {
  if (s === 'running') {
    // 起点由 server.readyAt 提供（核心下发），这里只负责起计时器
    startDurationTimer();
    // 端口归自家进程所有，外部探测在此期间无意义：清掉已排定的续探
    if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
  } else if (s === 'stopped') {
    stopDurationTimer();
    // 自家进程刚停 = 端口可能马上被外部实例接手的时刻，立刻探一次并把退避收回快档
    if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
    externalIdleSteps = 0;
    probeExternal();
  }
});

// 探测目标（会话参数里的 host/port）被改动时立刻重探一次——比等下一个退避周期准
watch(() => [params.values.host, params.values.port], () => {
  if (!pageActive || server.status !== 'stopped') return;
  if (externalTimer) { clearTimeout(externalTimer); externalTimer = null; }
  externalIdleSteps = 0;
  probeExternal();
});

// ---- 复制（a-typography copyable 图标触发；Arco 自带复制，这里再走 Electron 剪贴板兜底）----
async function copyViaApi(text: string | undefined) {
  if (!text) return;
  try { await window.api.clipboard.write(text); } catch { /* Arco 已复制或环境不支持 */ }
}

// ---- OOM 归因：启动失败/崩溃时扫描输出尾部的显存不足特征，给出可执行的缓解建议 ----
// 估算模型（参数页提示条）回答「能开多大」，此处回答「失败了怎么救」——两条路径互补。
// 逐行 OOM 标记由 server store 在入队时算好（server.oomDetected 扫最近 300 行布尔），
// 此处不再 slice + 正则——原实现每条新日志都要重扫 300 行文本
const oomDetected = computed(() => statusInfo.value.status === 'error' && server.oomDetected);

// 上下文减半：当前 -c（0 = 从模型加载时按训练上限折算）的一半，按 1024 粒度、下限 4096
function onOomHalveCtx() {
  const cur = Number(params.values['ctx_size'] ?? 0);
  const trained = Number(params.ggufInfo?.context_length ?? 0);
  const base = cur > 0 ? cur : (trained > 0 ? trained : 32768);
  params.set('ctx_size', Math.max(4096, Math.floor(base / 2 / 1024) * 1024));
}

// KV 量化 q8_0：KV 每 token 字节减半（量化 KV 需 Flash Attention，一并开启）
function onOomKvQuant() {
  params.set('flash_attn', 'on');
  params.set('cache_type_k', 'q8_0');
  params.set('cache_type_v', 'q8_0');
}

// ---- 「装不下」减负建议（docs/zh/params-system.md §5.6 第 3 项）----
// 与上面 OOM 归因的区别：那条要等进程真的报错才出声（扫日志判出的，用户已经白等一次启动），
// 这条在选完模型的当下就出声。判据一条都不在这里重复——「超出空闲显存吗」只写在 core 的
// recommendOffloadAdvice 里，条目随 system:estimateVram 下发并带 offloadRelief 标记，
// 本卡只按标记分流（第二套判据就是第二套实现，core 改了界面不会跟着改）。
interface ReliefLine {
  /** v-for 稳定键：同一参数同一取值即同一条建议 */
  id: string;
  /** 按钮上的参数名用 flag 原文（-cmoe / -ngl / -dev / -ts）：业务标识不翻译，
   *  且与命令预览框里的写法一致，用户点完能在预览里对上号 */
  flag: string;
  action: string;
  reason: string;
  key: string;
  value: string | number | boolean;
}

/**
 * 建议取值在按钮上的写法：勾选类参数（`-cmoe`）没有「值」可看，画一个勾；
 * 其余（-ngl 的层数、-dev 的设备名、-ts 的比例串）按原样显示，与命令预览框一致。
 * 纯符号/原文，不产文案（数据层不产文案这条纪律同样适用于渲染端的派生）。
 */
function formatReliefValue(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}
// §7.1 铁律②：文案与 flag 在数据到位时算一次并随条目携带，不放在 v-for 的函数调用里
const reliefLines = computed<ReliefLine[]>(() =>
  hw.relief.map((r) => {
    const flag = PARAMS.find((p) => p.key === r.key)?.flag ?? r.key;
    return {
      id: `${r.key}=${String(r.value)}`,
      flag,
      key: r.key,
      value: r.value,
      action: i18n.t('act_apply_relief', [flag, formatReliefValue(r.value)]),
      reason: i18n.t(r.reasonKey, r.reasonArgs ?? []),
    };
  }),
);
/**
 * 常驻槽只有一档 28px，行内按钮再多就得换行（一换行卡片就长高，STYLE_TODO #81 正在防这个），
 * 所以**最多上两个**：core 的出单顺序就是杠杆的强弱顺序（-cmoe → -ngl → -dev → -ts），
 * 排在后面的那条并没有丢——同一批条目也在 `recommendations` 里，参数页的性能目标建议区全量可见。
 */
const reliefShown = computed(() => reliefLines.value.slice(0, 2));
/**
 * 没取到估算 / core 判定放得下 ⇒ 一条都不显示（不猜、不把「没量过」写成「没问题」）。
 * 服务正在跑时也闭嘴：引擎已经把这份模型装载起来了，此刻喊「装不下」是自相矛盾——
 * 真炸了有上面那条 OOM 归因接管（判据来自 core 下发的停止事实，不在这里猜）。
 */
const reliefActive = computed(
  () => reliefShown.value.length > 0 && server.status !== 'running' && !oomDetected.value,
);

function onApplyRelief(key: string, value: string | number | boolean) {
  params.set(key, value);
}
</script>

<template>
  <Card title-key="card_service_status">
    <!-- 运行状态：a-tag 独立行（检测到外部 llama-server 时并排展示外部实例徽章）。
         aria-live 走 a-space 的属性透传（Arco Space 未声明 inheritAttrs:false，落到它渲染的那个
         div 上），不新包元素——包一层就改几何，卡片高度与槽位常驻是 #81/#82 的硬判据。
         播报只由「状态文字变了」触发：starting→running、以及核心随 status 事件下发的停止事实
         翻成「启动失败 / 异常退出」时，界面过去只换颜色，读屏用户看不出发生了什么（#92）。 -->
    <a-space :size="8" class="status-row" aria-live="polite">
      <StatusTag :status="statusInfo.status" :label="statusInfo.label" />
      <ToolTip v-if="server.external" :text="externalHint">
        <a-tag color="arcoblue">{{ externalTagLabel }}</a-tag>
      </ToolTip>
    </a-space>

    <!-- 字段区：四列网格，标签在值上方；模型名/地址各跨 2 列（长值省略 + 悬浮）。
         可复制值用 a-typography-text copyable（原生复制图标，@copy 走 Electron 剪贴板兜底） -->
    <div class="status-grid">
      <div class="field span-2">
        <div class="field-label">{{ i18n.t('lbl_dash_model') }}</div>
        <div class="field-value">
          <a-typography-text v-if="currentModel" copyable :copy-text="currentModel" @copy="copyViaApi(currentModel)">
            <Icon name="models" :size="13" />
            <ToolTip :text="currentModel"><span class="mono-val ellipsis">{{ currentModel }}</span></ToolTip>
          </a-typography-text>
          <span v-else class="empty-val">{{ i18n.t('status_model_none') }}</span>
        </div>
      </div>
      <!-- API 地址：本应用运行中显示自身地址；停止但探测到外部实例时显示外部地址（悬浮注明来源，
           两条信息合并进一个 ToolTip：externalHint 本身含 URL，不丢信息） -->
      <div class="field span-2">
        <div class="field-label">{{ i18n.t('card_dash_api') }}</div>
        <div class="field-value">
          <a-typography-text
            v-if="server.apiUrl || externalUrl"
            copyable
            :copy-text="server.apiUrl || externalUrl"
            @copy="copyViaApi(server.apiUrl || externalUrl)"
          >
            <Icon name="link" :size="13" />
            <ToolTip :text="!server.apiUrl && externalUrl ? externalHint : (server.apiUrl || externalUrl)">
              <span class="mono-val ellipsis">{{ server.apiUrl || externalUrl }}</span>
            </ToolTip>
          </a-typography-text>
          <span v-else class="empty-val">—</span>
        </div>
      </div>
      <div class="field">
        <div class="field-label">{{ i18n.t('lbl_host') }}</div>
        <div class="field-value"><span class="mono-val">{{ server.host }}</span></div>
      </div>
      <div class="field">
        <div class="field-label">{{ i18n.t('lbl_port') }}</div>
        <div class="field-value"><span class="mono-val">{{ server.port }}</span></div>
      </div>
      <div class="field">
        <div class="field-label">PID</div>
        <div class="field-value"><span class="mono-val" :class="{ 'empty-val': !server.pid }">{{ server.pid ?? '—' }}</span></div>
      </div>
      <div class="field">
        <div class="field-label">{{ i18n.t('lbl_run_duration') }}</div>
        <div class="field-value"><span class="mono-val" :class="{ 'empty-val': !durationSec }">{{ durationSec ? formatDuration(durationSec) : '—' }}</span></div>
      </div>
    </div>

    <!-- 端点暴露提示：Arco 官方 a-alert 按需展示（v-if，不占位）。
         2026-10-09 用户裁定废除 #81 隐藏预留槽模式：出现即占位、不出现不占位，
         布局随内容流动；完整文案本来就在行内（不再需要单行省略 + ToolTip）。 -->
    <a-alert v-if="openEndpoint" class="sec-hint" type="warning" show-icon>{{ secHintText }}</a-alert>

    <!-- 快捷操作（自原概览 Q2/Q3 保留）：按钮不属于信息展示，不构成重复。
         打开 Web UI：本应用运行中跳内置页；停止但接管了外部实例时在系统浏览器打开其地址 -->
    <a-space :size="8" class="quick-actions">
      <ToolTip :text="isRunning ? i18n.t('open_web') : externalHint">
        <a-button
          type="primary"
          size="small"
          :disabled="!isRunning && !externalUrl"
          @click="onOpenWeb"
        >
          <template #icon><Icon name="external" :size="13" /></template>
          {{ i18n.t('open_web') }}
        </a-button>
      </ToolTip>
      <ToolTip :text="i18n.t('lbl_manage_models')">
        <a-button size="small" @click="router.push('/models')">
          <template #icon><Icon name="models" :size="13" /></template>
          {{ i18n.t('lbl_manage_models') }}
        </a-button>
      </ToolTip>
    </a-space>
    <!-- 失败/异常退出提示（设计稿 §8.4：错误摘要 + 解决方案）。
         ⚠️ 布局防跳动（STYLE_TODO #81 档 2 第 2 处）：外层 slot 常驻，内部拆成**两档**行——
         banner 行与建议行各自预留固定高度、未触发时 visibility:hidden。
         此前只预留了 banner 的 30px，OOM 建议（含 2 个按钮）是扫日志异步判出的，到位后再把
         下方内容顶高约 28px；现在两种状态高度恒等，建议到不到都不动。 -->
    <!-- 失败归因：Arco 官方 a-alert error 按需展示（v-if，不占位；role=alert 保留读屏播报） -->
    <a-alert
      v-if="statusInfo.status === 'error'"
      class="failure-alert"
      type="error"
      show-icon
      role="alert"
    >
      {{ server.effectiveStatus === 'crashed' ? i18n.t('msg_service_crashed') : i18n.t('msg_service_failed') }}
      · {{ i18n.t('msg_check_console_below') }}
    </a-alert>
    <!-- OOM 归因 / 减负建议（互斥不并列，判据在 core）：Arco 官方 a-alert warning 按需展示。
         建议按钮走官方组件流程，条目来自下发数据、按 offloadRelief 分流，最多两个。 -->
    <a-alert v-if="oomDetected" class="oom-alert" type="warning" show-icon>
      <span class="oom-alert-msg">{{ i18n.t('msg_oom_detected') }}</span>
      <a-button size="mini" class="oom-act" @click="onOomHalveCtx">{{ i18n.t('act_oom_halve_ctx') }}</a-button>
      <a-button size="mini" class="oom-act" @click="onOomKvQuant">{{ i18n.t('act_oom_kv_quant') }}</a-button>
    </a-alert>
    <a-alert v-else-if="reliefActive" class="oom-alert oom-alert--relief" type="warning" show-icon>
      <span class="oom-alert-msg">{{ i18n.t('msg_offload_advice') }}</span>
      <ToolTip v-for="line in reliefShown" :key="line.id" :text="line.reason">
        <a-button size="mini" class="oom-act" @click="onApplyRelief(line.key, line.value)">
          {{ line.action }}
        </a-button>
      </ToolTip>
    </a-alert>
  </Card>
</template>

<style scoped lang="scss">
/* 运行状态行 */
.status-row {
  margin-bottom: 12px;
}

/* 端点暴露 / 失败归因 / OOM·减负：Arco 官方 a-alert 按需展示（v-if，不占位）。
   2026-10-09 用户裁定废除 #81/#82 隐藏预留槽模式——出现即占位、不出现不占位，
   布局随内容流动；仅保留卡内 12px 纵向节奏。 */
.sec-hint {
  margin-bottom: 12px;
}

.failure-alert {
  margin-bottom: 12px;
}

.oom-alert {
  margin-bottom: 12px;

  // 建议按钮随文案内联在官方 alert 内容流里（mini 档不撑高一行告警）
  .oom-act {
    margin-left: 8px;
    flex-shrink: 0;
  }
}

.mono-val {
  font-family: var(--font-mono);
}

// 超长值省略（模型名/地址），防撑破 descriptions 列
.ellipsis {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

// 值缺省占位（未运行/无值）：次级档角色色——「未选择模型」是读得到的信息，不是纯装饰
.empty-val {
  color: var(--fg-hint);
}

// 快捷操作行：a-space（gap 8px，§7.5.5）
.quick-actions {
  margin-bottom: 12px;
}

</style>
