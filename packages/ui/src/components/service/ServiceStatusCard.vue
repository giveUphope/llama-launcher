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
    <!-- 运行状态：a-tag 独立行（检测到外部 llama-server 时并排展示外部实例徽章） -->
    <a-space :size="8" class="status-row">
      <StatusTag :status="statusInfo.status" :label="statusInfo.label" />
      <ToolTip v-if="server.external" :text="externalHint">
        <a-tag color="arcoblue">{{ externalTagLabel }}</a-tag>
      </ToolTip>
    </a-space>

    <!-- 字段区：单个 a-descriptions 原生多列承载（模型/地址整行，主机/端口/PID/时长两列）；
         可复制值用 a-typography-text copyable（原生复制图标，@copy 走 Electron 剪贴板兜底） -->
    <a-descriptions class="status-desc" :column="2" size="small">
      <a-descriptions-item :label="i18n.t('lbl_dash_model')" :span="2">
        <a-typography-text v-if="currentModel" copyable :copy-text="currentModel" @copy="copyViaApi(currentModel)">
          <Icon name="models" :size="13" />
          <span class="mono-val ellipsis" :title="currentModel">{{ currentModel }}</span>
        </a-typography-text>
        <span v-else class="empty-val">{{ i18n.t('status_model_none') }}</span>
      </a-descriptions-item>
      <!-- API 地址：本应用运行中显示自身地址；停止但探测到外部实例时显示外部地址（title 注明来源） -->
      <a-descriptions-item :label="i18n.t('card_dash_api')" :span="2">
        <a-typography-text
          v-if="server.apiUrl || externalUrl"
          copyable
          :copy-text="server.apiUrl || externalUrl"
          :title="!server.apiUrl && externalUrl ? externalHint : undefined"
          @copy="copyViaApi(server.apiUrl || externalUrl)"
        >
          <Icon name="link" :size="13" />
          <span class="mono-val ellipsis" :title="server.apiUrl || externalUrl">{{ server.apiUrl || externalUrl }}</span>
        </a-typography-text>
        <span v-else class="empty-val">—</span>
      </a-descriptions-item>
      <a-descriptions-item :label="i18n.t('lbl_host')">
        <span class="mono-val">{{ server.host }}</span>
      </a-descriptions-item>
      <a-descriptions-item :label="i18n.t('lbl_port')">
        <span class="mono-val">{{ server.port }}</span>
      </a-descriptions-item>
      <a-descriptions-item label="PID">
        <span class="mono-val" :class="{ 'empty-val': !server.pid }">{{ server.pid ?? '—' }}</span>
      </a-descriptions-item>
      <a-descriptions-item :label="i18n.t('lbl_run_duration')">
        <span class="mono-val" :class="{ 'empty-val': !durationSec }">{{ durationSec ? formatDuration(durationSec) : '—' }}</span>
      </a-descriptions-item>
    </a-descriptions>

    <!-- 端点暴露常驻提示（成因见 openEndpoint 注释）：槽恒在、未触发时 visibility:hidden。
         此前 v-if 插在字段表与快捷按钮之间，进页面/改这两项再回来会把按钮行以下整块下推
         （STYLE_TODO #81 档 2）。预留按较长那态算：中文一行、英文两行，故两档封顶 + 省略，
         完整文案走 title（同 #81 既有范式 .failure-banner-slot，静态 CSS，不做测量回填）。 -->
    <div class="sec-hint-slot" :class="{ 'is-active': openEndpoint }">
      <Icon class="sec-hint-icon" name="alert" :size="12" />
      <span class="sec-hint-text" :title="secHintText">{{ secHintText }}</span>
    </div>

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
    <div class="failure-banner-slot">
      <div class="failure-row" :class="{ 'has-banner': statusInfo.status === 'error' }">
        <div v-if="statusInfo.status === 'error'" class="failure-banner" role="alert">
          <Icon name="alert" :size="14" />
          <span>
            {{ server.effectiveStatus === 'crashed' ? i18n.t('msg_service_crashed') : i18n.t('msg_service_failed') }}
            · {{ i18n.t('msg_check_console_below') }}
          </span>
        </div>
      </div>
      <!-- 常驻一档（28px）内两种出声，互斥不并列，所以行高不随内容变：
           ① OOM 归因（进程已报错，扫输出尾部判出）——上下文减半 / KV 量化；
           ② 减负建议（还没跑就看出装不下，判据在 core recommendOffloadAdvice）——
              条目来自下发数据，本行只按 offloadRelief 分流，最多两个按钮 + 单行省略，
              理由走原生 title（同 §7.5「截断值保留原生 title」，不再叠 ToolTip 包一层壳）。 -->
      <div class="oom-row" :class="{ 'is-active': oomDetected || reliefActive }">
        <div v-if="oomDetected" class="oom-hint">
          <span class="oom-text">{{ i18n.t('msg_oom_detected') }}</span>
          <a-button size="mini" @click="onOomHalveCtx">{{ i18n.t('act_oom_halve_ctx') }}</a-button>
          <a-button size="mini" @click="onOomKvQuant">{{ i18n.t('act_oom_kv_quant') }}</a-button>
        </div>
        <div v-else-if="reliefActive" class="oom-hint oom-hint--relief">
          <span class="oom-text" :title="i18n.t('msg_offload_advice')">{{ i18n.t('msg_offload_advice') }}</span>
          <a-button
            v-for="line in reliefShown"
            :key="line.id"
            size="mini"
            :title="line.reason"
            @click="onApplyRelief(line.key, line.value)"
          >
            {{ line.action }}
          </a-button>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
/* 运行状态行 */
.status-row {
  margin-bottom: 8px;
}

/* 端点暴露提示常驻槽：与命令预览卡的警示行同色同字号（橙色业务语义色）。
   min-height = 两档 fs-sm 行高（12px × 1.5 = 18px/档），中英两态都不撑高。 */
.sec-hint-slot {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: -6px 0 10px;
  min-height: 36px;
  font-size: var(--fs-sm);
  color: var(--fg-warning-text);
  visibility: hidden; // 未触发：保留占位但不显示，位置不动

  &.is-active {
    visibility: visible;
  }
}

.sec-hint-icon {
  flex: 0 0 auto;
  margin-top: 3px; // 与 18px 行框首行文字对齐：(18 - 12) / 2
}

// 两档封顶：超出省略，完整文案由 title 承载
.sec-hint-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  line-height: 1.5;
}

/* a-descriptions 字段表：标签列定宽右对齐（原生组件，仅调间距节奏） */
.status-desc {
  margin-bottom: 12px;

  :deep(.arco-descriptions-item-label) {
    min-width: 88px;
    color: var(--color-text-2);
  }

  :deep(.arco-descriptions-item-value-block) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  // 可复制值行（模型名/API 地址）：icon + 文本 + 复制图标并排，
  // 图标与文本间距归一到 6px（对齐 Arco size-small 按钮 icon 间距；默认 0 贴文本）
  :deep(.arco-typography) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
  }
}

// 数值/路径用 mono（§7.5.1）
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
  margin-bottom: 8px;
}

/* 失败提示槽位：常驻两档（banner 行 + OOM 建议行），margin-top 归一到 slot 上。
   两档各自 min-height + visibility，出现/消失都不再下推下方内容（#81 既有范式）。 */
.failure-banner-slot {
  margin-top: 8px;
}

.failure-row {
  min-height: 30px; // = banner 高度（padding 6px×2 + fs-base 13px 行高 1.4 ≈ 30px），两种状态高度恒等
  visibility: hidden;

  &.has-banner {
    visibility: visible;
  }
}

.oom-row {
  margin-top: 8px;
  min-height: 28px; // = 建议行一档（文案 18px / mini 按钮 24px 取高者 + 余量），到位前后高度恒等
  visibility: hidden;

  &.is-active {
    visibility: visible;
  }
}

/* 失败提示 div（icon + 文案）：flex 居中 + 图标间距 6px + 内边距保持
   banner 高 ≈ slot 预留 30px（防跳动）；文字取 danger 角色色（style-audit #53），兼容浅/深主题 */
.failure-banner {
  display: inline-flex;
  align-items: center;
  gap: 6px; // 图标与文本间距归一到提示行统一 6px（默认 0 贴文本）
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--fg-danger-text);
}

// OOM 归因建议行 / 减负建议行：紧随失败 banner 的次级提示 + 行内动作按钮
// （行高由 .oom-row 的常驻槽负责，这里只管内容呈现）
// ⚠ 单行硬约束：槽只预留一档 28px，所以这一行**不许换行**——换行就是卡片长高，
// #81 登记的正是这个。文案变长（尤其中转英）时省略号收住、完整内容走原生 title，
// 按钮 flex: 0 0 auto 保证按钮永远完整可见（动作比描述文字更重要）。
.oom-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 0;

  .oom-text {
    color: var(--color-text-2);
    font-size: var(--fs-base);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :deep(.arco-btn) {
    flex: 0 0 auto;
  }
}
</style>
