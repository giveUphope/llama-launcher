<script setup lang="ts">
// 组件 name：供 ParamsPage 的 <KeepAlive include="BenchPanel"> 精确匹配缓存，
// 切换 tab 时保留测试历史（combos）等内存状态
defineOptions({ name: 'BenchPanel' });

import { computed, onUnmounted, ref } from 'vue';
import type { BenchResult, ParamDef } from '@llama-launcher/shared';
import { PARAMS } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import SliderParam from '@/components/params/SliderParam.vue';
import IntEntryParam from '@/components/params/IntEntryParam.vue';
import DropdownParam from '@/components/params/DropdownParam.vue';
import CheckboxParam from '@/components/params/CheckboxParam.vue';
import TextParam from '@/components/params/TextParam.vue';
import { useParamsStore } from '@/stores/params';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';

const params = useParamsStore();
const settings = useSettingsStore();
const server = useServerStore();
const i18n = useI18nStore();

// 特殊 key：不参与性能参数展示（model 由命令构建器单独处理；mmproj/spec_draft_model 为文件路径，
// 在参数配置页已可调整，性能测试页聚焦可对比的参数组合）
const TUNE_EXCLUDE = new Set(['model', 'mmproj', 'spec_draft_model']);

// 动态参数项：跟随参数配置页中「已启用」的参数（与参数配置页勾选状态实时同步）。
// 用户勾选/取消某个参数后，性能测试页自动增减对应控件，交互方式与参数配置页完全一致
// （滑块/下拉/开关/文本等控件组件直接复用）。
const activeTuneParams = computed<ParamDef[]>(() => {
  return PARAMS.filter((p) => !TUNE_EXCLUDE.has(p.key) && params.isEnabled(p.key));
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
const metricsEnabled = computed(() => params.isEnabled('metrics') && String(params.values.metrics) !== 'false');

function onDeleteCombo(id: string) {
  combos.value = combos.value.filter((c) => c.id !== id);
}

// 清空全部测试历史（应用运行期间可手动清理；关闭应用后内存态数据自然清空）
function onClearHistory() {
  combos.value = [];
}

// 应用测试记录对应的参数到当前设置。
// 复用预设的完全覆盖应用逻辑：组合快照（含 _enabled）与 PresetValues 结构一致，
// 附带智能归一化（类型/范围/选项适配）与依赖联动清理，返回启用参数数量。
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

// 组合参数摘要：展示该测试记录中「已启用」的参数（依赖快照内的 _enabled），
// 未勾选启用的参数不会展示（与 command-builder 用 _enabled 过滤发射参数的行为一致）
function snapshotSummary(snapshot: Record<string, string | number | boolean>): string {
  let enabledKeys: string[] = [];
  const enRaw = snapshot._enabled;
  if (typeof enRaw === 'string') {
    try {
      const en = JSON.parse(enRaw) as Record<string, boolean>;
      enabledKeys = Object.keys(en).filter((k) => en[k]);
    } catch { /* 忽略损坏的 enabled 数据 */ }
  }
  return enabledKeys
    .filter((k) => k !== '_enabled' && !TUNE_EXCLUDE.has(k))
    .filter((k) => snapshot[k] !== undefined && String(snapshot[k]) !== '')
    .map((k) => `${k}=${String(snapshot[k])}`)
    .join('  ');
}

// 等待服务进入 running 状态（带超时）。
// restart 场景：launcher.restart() 是异步的（等旧进程 exit 后再启动新进程），
// 且旧进程退出前 server.status 仍是旧 running——若立即按 running 返回，会在新进程
// 模型尚未加载完成时就发测试请求，导致端点无法访问。因此：
// - restarting=true 时，先等待状态离开 running（旧进程退出），再等待重新进入 running（新进程就绪）
// - restarting=false 时（首次启动），直接等待 running
// 启动失败检测：模型配置错误等导致 llama-server 启动失败时，进程 exit → 状态停在 stopped 且
// pid 为 null，不会重新 running。此时连续多次轮询确认后立即判定失败（而非等到超时），
// 避免界面一直停留在"等待服务就绪"。返回 'ok' | 'timeout' | 'failed'。
function waitRunning(timeoutMs: number, restarting = false): Promise<'ok' | 'timeout' | 'failed'> {
  return new Promise((resolve) => {
    const started = Date.now();
    // 阶段标记：restart 时先等旧进程退出（状态 != running），再等新进程 running
    let phase: 'wait-exit' | 'wait-running' = restarting ? 'wait-exit' : 'wait-running';
    // 启动失败判定：连续 N 次轮询看到 stopped + pid null（进程已退出且未重启）→ 判定失败
    let stoppedStreak = 0;
    const FAIL_STREAK = 4; // ~1.2s（300ms × 4），区分 restart 的短暂 stopped 中间态
    const timer = setInterval(async () => {
      // 每次轮询刷新 pid/status（restart 后主进程状态变化）
      try { await server.refreshStatus(); } catch { /* 忽略轮询失败 */ }
      const s = server.status;
      if (phase === 'wait-exit') {
        // 旧进程退出：状态离开 running（stopped/starting 都算退出完成）
        if (s !== 'running') phase = 'wait-running';
        stoppedStreak = 0;
      } else if (s === 'running') {
        clearInterval(timer);
        resolve('ok');
        return;
      } else if (s === 'stopped' && server.pid === null) {
        // 进程已退出（启动失败或意外退出）：连续确认后判定失败
        stoppedStreak++;
        if (stoppedStreak >= FAIL_STREAK) {
          clearInterval(timer);
          resolve('failed');
          return;
        }
      } else {
        // starting 等中间态：重置连续计数
        stoppedStreak = 0;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve('timeout');
      }
    }, 300);
  });
}

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

// 多并发场景并发数：跟随参数页 -np（parallel）值（>1 时），否则默认 4；上限 8。
// 不新增任何 UI 控件——与单并发一起在一次「运行测试」中自动完成
function benchConcurrency(): number {
  const v = Number(params.values.parallel);
  if (Number.isFinite(v) && v > 1) return Math.min(v, 8);
  return 4;
}

async function onRunTest() {
  if (running.value) return;
  running.value = true;
  try {
    // 1. 确保 --metrics 已启用：未启用时临时开启（测试需要 /metrics 与推测解码接受率）
    let metricsWasEnabled = metricsEnabled.value;
    if (!metricsEnabled.value) {
      params.set('metrics', true);
      params.setEnabled('metrics', true);
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
    const waitResult = await waitRunning(180000, restarted);
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
    const req = {
      prompt: prompt.value,
      maxTokens: maxTokens.value,
      concurrency: benchConcurrency(),
      apiKey: String(params.values.api_key ?? ''),
    };
    const res = await window.api.server.bench(req);
    if (!res || !res.ok) {
      statusText.value = `Error: ${res?.error ?? 'bench failed'}`;
      return;
    }
    const { single, concurrent } = res.data;
    // 5. 追加两条测试历史记录（单并发 + 多并发，同一次测试、同一参数快照）。
    //    单并发行沿用原名，多并发行带 ×N 后缀；部分并发请求失败时标注失败数。
    //    数据仅内存保存，关闭应用即清空。
    const comboName = `${i18n.t('bench_combo')} ${seq}`;
    const concName = `${comboName} · ${i18n.t('bench_concurrent_suffix').replace('{0}', String(concurrent.concurrency))}`;
    const comboSnapshot = { ...params.snapshot() };
    combos.value.push({
      id: `${Date.now()}-${++seq}`,
      name: comboName,
      result: single,
      snapshot: comboSnapshot,
    });
    combos.value.push({
      id: `${Date.now()}-${++seq}`,
      name: concurrent.failed
        ? `${concName}${i18n.t('bench_concurrent_failed').replace('{0}', String(concurrent.failed))}`
        : concName,
      result: concurrent,
      snapshot: comboSnapshot,
    });
    statusText.value = '';
  } catch (e: any) {
    statusText.value = `Error: ${e?.message ?? String(e)}`;
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
    <!-- 参数快速调整：动态跟随参数配置页已启用项，控件与参数配置页完全一致 -->
    <Card title-key="bench_tune_title">
      <div class="tune-grid">
        <div v-for="p in activeTuneParams" :key="p.key" class="tune-row">
          <SliderParam v-if="p.type === 'int_slider' || p.type === 'float_slider'" :p="p" />
          <IntEntryParam v-else-if="p.type === 'int_entry'" :p="p" />
          <DropdownParam v-else-if="p.type === 'dropdown'" :p="p" />
          <CheckboxParam v-else-if="p.type === 'checkbox'" :p="p" />
          <TextParam v-else :p="p" />
        </div>
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
      <div v-if="appliedMsg" class="applied-msg">{{ appliedMsg }}</div>
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

.tune-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
}

// 参数控件行：视觉隔离边框（与参数配置页 ParamRow 卡片化分隔一致）
.tune-row {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  padding: 4px 8px;
  transition: border-color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    border-color: var(--accent);
  }
}

// 测试执行的标签与输入（保留原 tune-label/tune-input 用于 run-row）
.tune-label {
  font-size: var(--fs-md);
  color: var(--fg-secondary);
  flex-shrink: 0;
  width: 110px;
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

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--btn-h);
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;

    &:hover:not(:disabled) {
      background: var(--accent-hover);
      border-color: var(--accent-hover);
    }
  }

  &.danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.mini-btn {
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  // 在 flex 按钮组内不被压缩（表格列宽变化时保持按钮完整可点击）
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease-jelly), border-color var(--dur-fast) var(--ease-jelly),
    color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  // 应用按钮：accent 描边强调（与应用内 accent 强调色按钮一致，如 TopBar 的 web 按钮）
  &.accent {
    color: var(--accent);
    border-color: var(--accent);

    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent) 10%, var(--bg-input));
    }
  }

  &.danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  &:hover {
    background: var(--bg-hover);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.combo-table-wrap {
  margin-top: 10px;
  overflow-x: auto;
}

.applied-msg {
  margin-top: 10px;
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
    padding: 16px;
  }
}
</style>
