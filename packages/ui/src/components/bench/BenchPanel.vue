<script setup lang="ts">
// 组件 name：供 ParamsPage 的 <KeepAlive include="BenchPanel"> 精确匹配缓存，
// 切换 tab 时保留测试历史（combos）等内存状态
defineOptions({ name: 'BenchPanel' });

import { computed, onUnmounted, ref } from 'vue';
import type { BenchResult, ParamDef } from '@llama-launcher/shared';
import { PARAMS } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import ParamRow from '@/components/params/ParamRow.vue';
import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import { waitForRunning } from '@/composables/useWaitRunning';

const params = useParamsStore();
const settings = useSettingsStore();
const server = useServerStore();
const i18n = useI18nStore();

// 特殊 key：不参与性能参数展示（model 由命令构建器单独处理；mmproj/spec_draft_model 为文件路径，
// 在参数配置页已可调整，性能测试页聚焦可对比的参数组合）
const TUNE_EXCLUDE = new Set(['model', 'mmproj', 'spec_draft_model']);

// 动态参数项：跟随参数配置页中值 ≠ 默认值的参数（与参数配置页实时同步）。
// 参数调整后，性能测试页自动增减对应行——行组件直接复用 ParamRow，
// 控件类型（滑块/下拉/开关/文本/文件等）与行效果由 ParamRow 内部分支承载
const activeTuneParams = computed<ParamDef[]>(() => {
  return PARAMS.filter((p) => !TUNE_EXCLUDE.has(p.key) && params.values[p.key] !== p.default);
});

// 测试历史记录（内存态，关闭应用即清空；每次运行测试追加一条，便于调整前后对比）
interface BenchCombo {
  id: string;
  name: string;
  result: BenchResult | null;
  snapshot: Record<string, string | number | boolean>;
}

const combos = ref<BenchCombo[]>([]);
const running = ref(false);
const statusText = ref('');
const prompt = ref(i18n.t('bench_default_prompt'));
const maxTokens = ref(512);
let seq = 0;

const isRunning = computed(() => server.status === 'running' || server.status === 'starting');
const metricsEnabled = computed(() => params.values['metrics'] === true);

function onDeleteCombo(id: string) {
  combos.value = combos.value.filter((c) => c.id !== id);
}

// 清空全部测试历史（应用运行期间可手动清理；关闭应用后内存态数据自然清空）
function onClearHistory() {
  combos.value = [];
}

// 应用测试记录对应的参数到当前设置。
// 复用预设的完全覆盖应用逻辑：组合快照与被测实例启动参数一致（值即真相，无勾选状态），
// 附带智能归一化（类型/范围/选项适配）与依赖联动清理，返回非默认参数数量。
// 应用后面板内短暂提示 + 写入控制台，确认参数确实生效。
const appliedMsg = ref('');
let appliedTimer: number | null = null;
function onApplyCombo(c: BenchCombo) {
  const count = params.applyPreset(c.snapshot);
  const msg = i18n.t('bench_applied').replace('{0}', c.name).replace('{1}', String(count));
  server.pushOutput({
    kind: 'success',
    data: `[bench] ${msg}\n`,
    ts: Date.now(),
  });
  appliedMsg.value = msg;
  if (appliedTimer != null) window.clearTimeout(appliedTimer);
  appliedTimer = window.setTimeout(() => { appliedMsg.value = ''; }, 3000);
}

// 组合参数摘要：展示该测试记录中非默认的参数（值即真相，勾选框已移除）
function snapshotSummary(snapshot: Record<string, string | number | boolean>): string {
  const keys = Object.keys(snapshot).filter((k) => k !== '_enabled' && !TUNE_EXCLUDE.has(k));
  return keys
    .filter((k) => {
      const p = PARAMS.find((x) => x.key === k);
      if (!p) return false;
      return snapshot[k] !== p.default;
    })
    .filter((k) => String(snapshot[k]) !== '')
    .map((k) => `${k}=${String(snapshot[k])}`)
    .join('  ');
}

// 启动/重启后的就绪等待（两阶段 + 启动失败检测）已抽取为公共 composable useWaitRunning（waitForRunning）

// 判断运行中服务是否与当前参数快照完全一致（含启用状态）。
// 一致时无需重启（避免重复加载模型，30B 模型加载耗时数十秒），直接对现有实例发测试请求。
function sameParamsAsRunning(snapshot: Record<string, string | number | boolean>): boolean {
  const running = server.runningValues;
  if (!running) return false;
  const snapKeys = Object.keys(snapshot);
  const runKeys = Object.keys(running);
  if (snapKeys.length !== runKeys.length) return false;
  for (const k of snapKeys) {
    if (!(k in running)) return false;
    if (String(snapshot[k]) !== String(running[k])) return false;
  }
  return true;
}

// 多并发场景并发数：依据被测服务实例的并行槽位数 -np（parallel）决定
// （读测试开始时刻的快照，而非当前编辑值——测试等待/运行期间用户可能改动参数，
// 被测实例的实际槽位由启动时刻参数决定）。
// - np ≥ 2：并发数 = min(np, 8)，真正行使全部并行槽位的聚合吞吐（可按实际槽位对比单并发）
// - np ≤ 1（含默认 -1 自动）：服务器无多并行槽位，多并发不适用，返回 1 表示本次不执行多并发
// 不新增任何 UI 控件——由主进程根据该值决定多并发是否执行；与单并发一起在一次「运行测试」中自动完成
function benchConcurrency(s: Record<string, string | number | boolean>): number {
  const v = Number(s.parallel);
  if (Number.isFinite(v) && v >= 2) return Math.min(v, 8);
  return 1;
}

async function onRunTest() {
  if (running.value) return;
  running.value = true;
  try {
    // 1. 确保 --metrics 已开启：测试需要 /metrics 与推测解码接受率
    let metricsWasEnabled = metricsEnabled.value;
    if (!metricsWasEnabled) {
      params.set('metrics', true);
    }
    // 2. 刷新服务状态，拿到最近一次启动的参数快照
    await server.refreshStatus();
    const snapshot = params.snapshot();
    const runningStatus = server.status;

    // 3. 智能检测：
    //    a) 服务运行中且参数与当前完全一致（含 metrics 已开启）→ 复用现有服务，不重启
    //    b) 其余情况（未运行 / 运行中参数不一致 / starting）→ 统一走 server.restart：
    //       core 的 Launcher.restart() 在运行中会 `proc.once('exit', () => start)` 等旧进程退出后再启动新进程，
    //       未运行时直接 start——避免了手动 stop() 后立即 start() 的竞态
    //       （taskkill 异步杀进程，exit 事件触发前 launcher.proc 仍指向旧进程，start() 会误判 "already running"）
    let restarted = false;
    if (runningStatus === 'running' && metricsWasEnabled && sameParamsAsRunning(snapshot)) {
      statusText.value = i18n.t('bench_status_reuse');
    } else {
      statusText.value = runningStatus === 'stopped'
        ? i18n.t('bench_status_starting')
        : i18n.t('bench_status_restart');
      await server.restart(snapshot, settings.settings!);
      restarted = true;
    }
    statusText.value = i18n.t('bench_status_wait');
    // 重启场景：先等旧进程退出（状态离开 running），再等新进程加载完成重新 running，
    // 避免旧 running 状态残留导致新进程模型未加载完就发请求（端点无法访问）
    const waitResult = await waitForRunning(180000, restarted);
    if (waitResult !== 'ok') {
      if (waitResult === 'failed') {
        // 启动失败（模型配置错误等）：提示用户查看控制台日志（含具体报错）
        statusText.value = i18n.t('bench_status_failed');
      } else {
        statusText.value = i18n.t('bench_status_timeout');
      }
      return;
    }
    statusText.value = i18n.t('bench_status_running');
    // 4. 发测试请求：一次运行依次执行单并发（1 个请求）与多并发（benchConcurrency 个并行请求）两个场景
    //    并发数与 api_key 取被测实例快照（snapshot），不受测试期间用户编辑影响
    const req = {
      prompt: prompt.value,
      maxTokens: maxTokens.value,
      concurrency: benchConcurrency(snapshot),
      apiKey: String(snapshot.api_key ?? ''),
    };
    const res = await window.api.server.bench(req);
    if (!res || !res.ok) {
      statusText.value = i18n.t('bench_error').replace('{0}', res?.error ?? 'bench failed');
      return;
    }
    const { single, concurrent } = res.data;
    // 5. 追加测试历史记录：单并发行始终追加；多并发仅在服务器有并行槽位（np≥2，concurrent 非空）时追加。
    //    单并发行沿用原名，多并发行带 ×N 后缀；部分并发请求失败时标注失败数。数据仅内存保存。
    //    快照必须取测试开始时刻的 snapshot（= 被测实例的启动参数 / 复用实例的核对参数），
    //    不能用测试结束时刻的 params.snapshot()——等待与运行期间用户可能编辑参数，
    //    届时当前值已不等于被测服务实际运行的命令参数（历史记录与服务页命令不一致的根因）。
    const comboName = `${i18n.t('bench_combo')} ${seq}`;
    const comboSnapshot = { ...snapshot };
    combos.value.push({
      id: `${Date.now()}-${++seq}`,
      name: comboName,
      result: single,
      snapshot: comboSnapshot,
    });
    if (concurrent) {
      const concName = `${comboName} · ${i18n.t('bench_concurrent_suffix').replace('{0}', String(concurrent.concurrency))}`;
      combos.value.push({
        id: `${Date.now()}-${++seq}`,
        name: concurrent.failed
          ? `${concName}${i18n.t('bench_concurrent_failed').replace('{0}', String(concurrent.failed))}`
          : concName,
        result: concurrent,
        snapshot: comboSnapshot,
      });
      statusText.value = '';
    } else {
      const np = snapshot.parallel ?? -1;
      statusText.value = i18n.t('bench_multi_skipped').replace('{0}', String(np));
    }
  } catch (e: any) {
    statusText.value = i18n.t('bench_error').replace('{0}', e?.message ?? String(e));
  } finally {
    running.value = false;
  }
}

async function onStopServer() {
  try { await server.stop(); } catch { /* ignore */ }
}

function fmt(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

// 格式化测试耗时：<1s 显示毫秒，其余显示秒（保留 1 位小数）。
// 对应 BenchResult.elapsedMs（单并发：单次请求时长；多并发：整阶段墙钟时长），
// 用于对比不同参数组合的耗时差异
function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// 计算推测解码接受率（优先单次请求的 draft_n，其次 metrics 累计值）。
// 该指标对所有推测解码类型（DFlash/草稿模型/MTP/ngram 等）均适用
function acceptanceRate(r: BenchResult): number | null {
  if (r.draftN > 0) return r.draftNAccepted / r.draftN;
  if (r.metricsDraftTotal > 0) return r.metricsDraftAccepted / r.metricsDraftTotal;
  return null;
}

onUnmounted(() => {
  if (appliedTimer != null) {
    window.clearTimeout(appliedTimer);
    appliedTimer = null;
  }
});
</script>

<template>
  <div class="bench-panel">
    <!-- 参数快速调整：动态跟随参数配置页非默认值项，逐行复用 ParamRow——
         与自定义参数页同布局同效果（param-grid 同款 auto-fit 网格；行悬停背景/描边、
         非默认橙描边、依赖警示、GGUF 提示、还原按钮均由 ParamRow 统一承载） -->
    <Card title-key="bench_tune_title">
      <div class="tune-grid">
        <ParamRow v-for="p in activeTuneParams" :key="p.key" :p="p" />
      </div>
      <div class="tune-hint">{{ i18n.t('bench_tune_hint') }}</div>
    </Card>

    <!-- 测试执行 -->
    <Card title-key="bench_run_title">
      <div class="run-row">
        <label class="tune-label">{{ i18n.t('bench_prompt') }}</label>
        <input class="tune-input flex" type="text" v-model="prompt" />
      </div>
      <div class="run-row">
        <label class="tune-label">{{ i18n.t('bench_max_tokens') }}</label>
        <input class="tune-input num" type="number" v-model.number="maxTokens" min="16" max="4096" step="16" />
      </div>
      <div class="run-actions">
        <button class="action-btn primary" :disabled="running" @click="onRunTest">
          {{ running ? i18n.t('bench_running') : i18n.t('bench_run') }}
        </button>
        <button class="action-btn" :disabled="!isRunning" @click="onStopServer">
          {{ i18n.t('bench_stop') }}
        </button>
        <span v-if="statusText" class="status-text">{{ statusText }}</span>
      </div>
      <div class="tune-hint">{{ i18n.t('bench_metrics_hint') }}</div>
    </Card>

    <!-- 测试历史：表格对比每次运行调整前后的性能指标（内存态，关闭应用即清空） -->
    <Card title-key="bench_history_title">
      <template #actions>
        <button
          class="mini-btn danger"
          :disabled="combos.length === 0"
          @click="onClearHistory"
        >
          {{ i18n.t('bench_clear_history') }}
        </button>
      </template>
      <!-- 应用提示防跳动：外层槽位常驻并与提示行等高（padding 6×2 + fs-base 行高 ≈ 32px），
            无提示时隐藏但占满高度——提示条出现/消失时下方历史表不再下移（#42 预留位置模式）。 -->
      <div class="applied-msg-slot" :class="{ 'has-msg': !!appliedMsg }">
        <div v-if="appliedMsg" class="applied-msg">{{ appliedMsg }}</div>
      </div>
      <div class="combo-table-wrap">
        <table class="combo-table">
          <thead>
            <tr>
              <th class="col-name">{{ i18n.t('bench_combo_name') }}</th>
              <th class="col-time">{{ i18n.t('bench_test_time') }}</th>
              <th class="col-metric">{{ i18n.t('bench_tok_s') }}</th>
              <th class="col-metric">{{ i18n.t('bench_prompt_tok_s') }}</th>
              <th class="col-metric">{{ i18n.t('bench_acceptance') }}</th>
              <th class="col-metric">{{ i18n.t('bench_gen_tokens') }}</th>
              <th class="col-params">{{ i18n.t('bench_params') }}</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!combos.length">
              <td colspan="8" class="empty">{{ i18n.t('bench_no_history') }}</td>
            </tr>
            <tr v-for="c in combos" :key="c.id" class="combo-row">
              <td class="combo-name-cell">{{ c.name }}</td>
              <td class="time-cell">{{ c.result ? formatDuration(c.result.elapsedMs) : '—' }}</td>
              <td class="metric-cell">{{ c.result ? fmt(c.result.predictedPerSecond) : '—' }}</td>
              <td class="metric-cell">{{ c.result ? fmt(c.result.promptPerSecond) : '—' }}</td>
              <td class="metric-cell">
                {{ c.result && acceptanceRate(c.result) !== null ? fmt((acceptanceRate(c.result) ?? 0) * 100, 1) + '%' : '—' }}
              </td>
              <td class="metric-cell">{{ c.result ? c.result.predictedN : '—' }}</td>
              <td class="params-cell" :title="snapshotSummary(c.snapshot)">{{ snapshotSummary(c.snapshot) }}</td>
              <td class="action-cell">
                <button class="mini-btn accent" :title="i18n.t('bench_apply_tip')" @click="onApplyCombo(c)">{{ i18n.t('bench_apply') }}</button>
                <button class="mini-btn danger" @click="onDeleteCombo(c.id)">{{ i18n.t('bench_delete') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </div>
</template>

<style scoped lang="scss">
.bench-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

// 参数网格：与参数设置页 .param-grid 同配方（auto-fit、gap 4×14、窄屏单列），
// 行由 ParamRow 承载——与自定义参数页一致呈现行效果（非默认橙描边/hover/还原按钮，2026-08-31）
.tune-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 4px 14px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}

// 测试执行的标签与输入（保留原 tune-label/tune-input 用于 run-row）
// 标签等列：固定 110px 右对齐（参考参数行 label-col 逻辑），输入框起点对齐
.tune-label {
  font-size: var(--fs-md);
  color: var(--fg-secondary);
  flex: 0 1 110px;
  min-width: 64px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.run-row {
  display: flex;
  align-items: center;
  gap: 8px;
  // 行间留出间距，避免提示词行与生成 token 数行组件重叠
  margin-bottom: 8px;

  &:last-of-type {
    margin-bottom: 0;
  }
}

.tune-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);

  &.num {
    max-width: 110px;
    flex: none;
  }

  &.flex {
    flex: 1;
  }

  &:focus {
    border-color: var(--accent);
    outline: none;
  }
}

.tune-hint {
  margin-top: 8px;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

.run-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.status-text {
  font-size: var(--fs-sm);
  color: var(--accent);

  &.warn {
    color: var(--warn);
  }
}

.combo-table-wrap {
  margin-top: 10px;
  overflow-x: auto;
}

.applied-msg-slot {
  margin-top: 10px;
  min-height: 32px; // = 提示行实际高度（padding 6px×2 + fs-base 13 × 行高 1.5 ≈ 31.5px）

  &:not(.has-msg) {
    visibility: hidden;
  }
}

.applied-msg {
  padding: 6px 10px;
  border-radius: var(--radius-row);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid var(--success);
  color: var(--success);
  font-size: var(--fs-base);
}

.combo-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-base);

  thead th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--glass-border);
    color: var(--fg-secondary);
    font-weight: 600;
    white-space: nowrap;
    position: sticky;
    top: 0;
    /* 粘性表头必须不透明：行滚动穿过表头时半透明玻璃会透底（且滚动容器禁 blur） */
    background: var(--bg-card);
  }

  tbody td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-primary);
    vertical-align: middle;
  }

  tbody tr {
    &:hover {
      background: var(--bg-hover);
    }
  }

  .col-name {
    width: 110px;
  }

  .col-time {
    width: 90px;
  }

  .col-metric {
    width: 90px;
  }

  .col-params {
    min-width: 160px;
  }

  .col-action {
    width: 118px;
    text-align: right;
  }

  .combo-name-cell {
    font-weight: 600;
    white-space: nowrap;
  }

  .metric-cell {
    font-family: var(--font-mono);
    white-space: nowrap;
    color: var(--accent);
  }

  .time-cell {
    font-family: var(--font-mono);
    white-space: nowrap;
    color: var(--fg-muted);
  }

  .params-cell {
    font-size: var(--fs-sm);
    font-family: var(--font-mono);
    color: var(--fg-muted);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-cell {
    // 按钮组：flex 布局 + 8px 间隔（与应用内 toolbar/run-actions 等按钮组间距一致），
    // 取代行内按钮间不可控的空白字符间距
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    white-space: nowrap;
  }

  .empty {
    text-align: center;
    color: var(--fg-muted);
    padding: 20px; // 空态标准内距 20px（与 PresetsPanel/LocalModelsPanel .empty 统一；原 16px 离群）
  }
}
</style>