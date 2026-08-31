<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Card from '@/components/common/Card.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import InfoStrip from '@/components/common/InfoStrip.vue';
import Icon from '@/components/common/Icon.vue';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, modelBaseName } from '@llama-launcher/shared';
import type { OutputEntry } from '@llama-launcher/shared';
import BaselineBadge from '@/components/common/BaselineBadge.vue';
import CommandPreviewCard from '@/components/service/CommandPreviewCard.vue';
import ParamSummaryCard from '@/components/service/ParamSummaryCard.vue';
import TrashCleanCard from '@/components/service/TrashCleanCard.vue';

const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();

// status 实际切到 stopped 时立即清 stopping 标记
watch(() => server.status, (s) => {
  if (s === 'stopped') stopping.value = false;
});

const isRunning = computed(() => server.status === 'running');

// ---- 阶段四：6 态前端兜底（设计稿 §10.1 / 补充指南 §4.2） ----
// 后端 ServerStatus 仅 3 态（stopped/starting/running）；UI 层根据「最近输出关键词」+「停止按钮调用中」
// 推断 stopping / failed / crashed。仅用于状态标签，不修改后端类型或 IPC。
type EffectiveStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'crashed';
const stopping = ref(false); // 用户点了 stop 但后端 status 尚未切到 stopped 的过渡

// 启动失败/异常退出关键词（与控制台 lineClass 共用）
const FAIL_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault|exit code|killed|killed by signal)\b/i;
// 启动成功关键词（status='running' 后用此判断是否「稳定运行」）
const READY_RE = /\b(listening|loaded model|ready|initialized|server listening)\b/i;

// 提取最近若干行输出的拼接文本（最多 80 行，避免正则性能问题）
const recentTail = computed(() => {
  const arr = server.outputs;
  const start = Math.max(0, arr.length - 80);
  return arr.slice(start).map((o) => o.data).join('');
});

const effectiveStatus = computed<EffectiveStatus>(() => {
  if (stopping.value && server.status === 'running') return 'stopping';
  if (server.status === 'running') {
    // 运行中但最近输出出现失败/崩溃关键词 → crashed
    if (FAIL_RE.test(recentTail.value)) return 'crashed';
    return 'running';
  }
  if (server.status === 'starting') {
    // 启动中但最近输出出现失败关键词 → failed
    if (FAIL_RE.test(recentTail.value)) return 'failed';
    return 'starting';
  }
  // status='stopped' 但上一次启动尝试后留下失败日志且最近 5 分钟内 → 仍标记 failed
  if (FAIL_RE.test(recentTail.value)) return 'failed';
  return 'stopped';
});

const isFailed = computed(() => effectiveStatus.value === 'failed');
const isCrashed = computed(() => effectiveStatus.value === 'crashed');

const statusInfo = computed(() => {
  if (effectiveStatus.value === 'running') return { status: 'ok', label: i18n.t('svc_status_running') };
  if (effectiveStatus.value === 'starting') return { status: 'loading', label: i18n.t('svc_status_starting') };
  if (effectiveStatus.value === 'stopping') return { status: 'loading', label: i18n.t('svc_status_stopping') };
  if (effectiveStatus.value === 'failed') return { status: 'error', label: i18n.t('svc_status_failed') };
  if (effectiveStatus.value === 'crashed') return { status: 'error', label: i18n.t('svc_status_crashed') };
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
const startTimeMs = ref<number | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

function updateDuration() {
  now.value = Date.now();
}

onActivated(() => {
  if (isRunning.value && startTimeMs.value == null) {
    void server.refreshStatus();
  }
  if (timer) clearInterval(timer);
  timer = setInterval(updateDuration, 1000);
});

onDeactivated(() => {
  if (timer) { clearInterval(timer); timer = null; }
});

const durationSec = computed(() => {
  if (!startTimeMs.value) return 0;
  return Math.floor((now.value - startTimeMs.value) / 1000);
});

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---- 服务状态变化时刷新 ----
watch(() => server.status, (s) => {
  if (s === 'running') {
    // 启动成功后记录开始时间（若之前未记录）
    if (startTimeMs.value == null) {
      startTimeMs.value = Date.now();
    }
  } else if (s === 'stopped') {
    startTimeMs.value = null;
  }
});

// ---- 复制地址 ----
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function copyUrl() {
  if (!server.apiUrl) return;
  await window.api.clipboard.write(server.apiUrl);
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 1500);
}

// ---- 控制台输出 ----
const ERROR_RE = /\b(error|failed|fatal|exception|cannot|unable|abort|crash|segfault)\b/i;
const WARN_RE = /\b(warn|warning|deprecat|slow|out of)\b/i;
const SUCCESS_RE = /\b(listening|loaded|ready|initialized|running|success)\b/i;

const consoleEl = ref<HTMLElement | null>(null);
const renderedLimit = 1000;
const renderedOutputs = computed(() => {
  const outs = server.outputs;
  return outs.length > renderedLimit ? outs.slice(-renderedLimit) : outs;
});

function lineClass(entry: OutputEntry): string {
  if (entry.kind === 'error') return 'kind-error';
  if (entry.kind === 'success') return 'kind-success';
  if (entry.kind === 'info') return 'kind-info';
  const text = entry.data || '';
  if (ERROR_RE.test(text)) return 'kind-error';
  if (WARN_RE.test(text)) return 'kind-warn';
  if (SUCCESS_RE.test(text)) return 'kind-success';
  return 'kind-default';
}

const autoScroll = ref(true);
const hasNewLogs = ref(false);

async function scrollConsoleToBottom() {
  await nextTick();
  if (consoleEl.value) {
    consoleEl.value.scrollTop = consoleEl.value.scrollHeight;
    autoScroll.value = true;
    hasNewLogs.value = false;
  }
}

watch(
  () => server.outputs.length,
  () => {
    if (autoScroll.value) {
      void scrollConsoleToBottom();
    } else {
      hasNewLogs.value = true;
    }
  },
);

onActivated(() => { void scrollConsoleToBottom(); });

function onScroll() {
  if (!consoleEl.value) return;
  const el = consoleEl.value;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  autoScroll.value = dist < 60;
  if (autoScroll.value) hasNewLogs.value = false;
}

function onClearConsole() { server.clearOutputs(); }

async function onCopyConsole() {
  const outs = server.outputs;
  if (outs.length === 0) return;
  await window.api.clipboard.write(outs.map((o) => o.data).join(''));
}

// ---- 控制台行数 ----
const logCount = computed(() => server.outputs.length);

// ---- 复制模型名 ----
const modelCopied = ref(false);
let modelCopyTimer: ReturnType<typeof setTimeout> | null = null;

async function copyModelName() {
  if (!currentModel.value) return;
  await window.api.clipboard.write(currentModel.value);
  modelCopied.value = true;
  if (modelCopyTimer) clearTimeout(modelCopyTimer);
  modelCopyTimer = setTimeout(() => { modelCopied.value = false; modelCopyTimer = null; }, 1500);
}
</script>

<template>
  <PageFrame>
    <!-- 运行状态区（阶段五重设计）：状态、模型、时长三胶囊一行；
         URL 升级为统一胶囊条（对齐仪表盘 api-strip）；运行时详情紧凑网格 -->
    <Card title-key="card_service_status">
      <template #actions>
        <!-- 双轨参数逻辑：基线徽章 + 恢复基线入口（与参数页一致） -->
        <BaselineBadge show-restore />
      </template>
      <!-- 单行单内容：运行状态 / 当前模型 / API 地址 / 运行时详情各自独立成行；
           内容值盒统一 boxed InfoStrip（宽/高/样式全库一致，§7.5.4 值盒标准） -->
      <div class="status-row">
        <StatusTag :status="statusInfo.status" :label="statusInfo.label" />
      </div>
      <!-- 当前模型：标签位常驻；无模型时值盒占位文案，复制按钮常驻（无值禁用），行结构不变 -->
      <div class="detail-row">
        <InfoStrip :label="i18n.t('lbl_dash_model')" mono boxed>
          <span v-if="currentModel" class="model-inline">
            <Icon name="models" :size="13" />
            <span class="model-text" :title="currentModel">{{ currentModel }}</span>
          </span>
          <span v-else class="empty-val">{{ i18n.t('status_model_none') }}</span>
        </InfoStrip>
        <button class="action-btn copy-btn" :disabled="!currentModel" @click="copyModelName" :title="i18n.t('copy_model')">
          <Icon name="copy" :size="12" />
          <span>{{ modelCopied ? i18n.t('msg_model_copied') : i18n.t('copy_model') }}</span>
        </button>
      </div>
      <!-- API 地址：标签位常驻；未运行时值盒占位，复制按钮常驻（无值禁用） -->
      <div class="detail-row">
        <InfoStrip :label="i18n.t('card_dash_api')" mono boxed>
          <span v-if="server.apiUrl" class="model-inline">
            <Icon name="link" :size="13" />
            <span class="url-text" :title="server.apiUrl">{{ server.apiUrl }}</span>
          </span>
          <span v-else class="empty-val">—</span>
        </InfoStrip>
        <button class="action-btn copy-btn" :disabled="!server.apiUrl" @click="copyUrl" :title="i18n.t('copy_url')">
          <Icon name="copy" :size="12" />
          <span>{{ copied ? i18n.t('msg_url_copied') : i18n.t('copy_url') }}</span>
        </button>
      </div>
      <!-- 运行时详情：网格常驻（各标签位预留）。主机/端口为配置类项——与运行状态无关、
           始终显示真实配置值（与仪表盘 Q1 一致）；PID/时长为运行时事实，未运行以 — 占位。
           运行前后行结构与标签位置完全不变，仅值文本变化 -->
      <div class="runtime-details">
        <InfoStrip :label="i18n.t('lbl_host')" mono boxed>
          <span>{{ server.host }}</span>
        </InfoStrip>
        <InfoStrip :label="i18n.t('lbl_port')" mono boxed>
          <span>{{ server.port }}</span>
        </InfoStrip>
        <InfoStrip label="PID" mono boxed>
          <span :class="{ 'empty-val': !server.pid }">{{ server.pid ?? '—' }}</span>
        </InfoStrip>
        <!-- 运行时长：并入运行时详情（单行单内容） -->
        <InfoStrip :label="i18n.t('lbl_run_duration')" mono boxed>
          <span :class="{ 'empty-val': !durationSec }">{{ durationSec ? formatDuration(durationSec) : '—' }}</span>
        </InfoStrip>
      </div>
      <!-- 失败/异常退出提示（设计稿 §8.4：错误摘要 + 解决方案）。
           ⚠️ 布局防跳动：外层 slot 常驻并预留与 banner 等高的固定高度，
           仅当失败时插入 banner——下方卡片列位置保持稳定，出现/消失不再下推。 -->
      <div class="failure-banner-slot" :class="{ 'has-banner': isFailed || isCrashed }">
        <div v-if="isFailed || isCrashed" class="failure-banner" role="alert">
          <Icon name="alert" :size="14" />
          <span>
            {{ isCrashed ? i18n.t('msg_service_crashed') : i18n.t('msg_service_failed') }}
            · {{ i18n.t('msg_check_console_below') }}
          </span>
        </div>
      </div>
    </Card>

    <!-- 阶段四：从 LaunchPage 迁入的命令预览与参数摘要 -->
    <CommandPreviewCard />
    <ParamSummaryCard />
    <TrashCleanCard />

    <!-- 控制台输出 -->
    <Card title-key="card_service_console">
      <template #actions>
        <button
          class="action-btn"
          @click="onCopyConsole"
          :disabled="server.outputs.length === 0"
          :title="i18n.t('copy_console')"
        >
          <Icon name="copy" :size="12" />
          <span>{{ i18n.t('copy_console') }}</span>
        </button>
        <button class="action-btn" @click="onClearConsole" :title="i18n.t('clear_console')">
          <Icon name="trash" :size="12" />
          <span>{{ i18n.t('clear_console') }}</span>
        </button>
        <span class="log-count">{{ logCount }} {{ i18n.t('col_lines') }}</span>
      </template>
      <div class="console-header">
        <!-- 左槽位常驻：预留 new-logs 胶囊的宽度，无新日志时隐藏但占位，
             保证右侧 scroll-hint 在 new-logs 出现/消失时水平位置稳定（不跳动）。 -->
        <span
          class="new-logs-slot"
          :class="{ 'has-new': hasNewLogs }"
          @click="hasNewLogs && void scrollConsoleToBottom()"
        >
          <span v-if="hasNewLogs" class="new-logs">
            <Icon name="chevron_down" :size="12" />
            <span>{{ i18n.t('msg_new_logs') }}</span>
          </span>
        </span>
        <span class="scroll-hint">{{ autoScroll ? i18n.t('msg_autoscroll_on') : i18n.t('msg_autoscroll_off') }}</span>
      </div>
      <div
        ref="consoleEl"
        class="console"
        @scroll="onScroll"
      >
        <span v-for="(line, idx) in renderedOutputs" :key="idx" :class="['output-line', lineClass(line)]">{{ line.data }}</span>
      </div>
    </Card>
    <!-- 性能测试（BenchPanel）已迁至「参数设置 → 性能测试」子标签（调参与测试强相关） -->
  </PageFrame>
</template>

<style scoped lang="scss">
/* 运行状态行 */
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

/* 内容行：boxed InfoStrip（值盒 flex 填满）+ 行尾操作按钮 */
.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  min-width: 0;

  .info-strip {
    flex: 1;
    min-width: 0;
  }
}

// 值缺省占位（未运行/无值）：次级灰，与有值时的主色形成对比但保持行结构不变
.empty-val {
  color: var(--fg-muted);
}

// 值盒内联元素：flex 收缩 + 超长省略，防止溢出值盒
.model-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-inline .model-text,
.model-inline .url-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-details {
  display: grid;
  // 列宽 ≥ 280：等列 110 标签 + 值盒有舒展空间（值盒全库统一 26px 高）
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

/* 失败提示槽位：常驻预留 banner 等高的固定高度（防出现/消失时下推下方卡片）。
   margin-top 归一到 slot 上；banner 本身仅负责内容呈现。 */
.failure-banner-slot {
  margin-top: 8px;
  min-height: 30px; // = banner 高度（padding 6px×2 + fs-base 13px 行高 1.4 ≈ 30px），两种状态高度恒等

  &:not(.has-banner) {
    visibility: hidden; // 无失败时保留占位但隐藏，仍占满 slot 高度
  }
}

.failure-banner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  font-weight: 600;
}

// 复制按钮等宽：值盒右缘跨行对齐（文案长度差异不影响盒子宽度）
.copy-btn {
  font-size: var(--fs-md);
  min-width: 112px;
  justify-content: center;
}

/* 控制台 */
.console-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

/* new-logs 左槽位常驻：预留胶囊宽度，无新日志时隐藏但占位（scroll-hint 右缘稳定） */
.new-logs-slot {
  display: inline-flex;
  align-items: center;
  min-height: 22px; // 与胶囊行高一致，避免出现时撑高 header

  &:not(.has-new) {
    visibility: hidden; // 保留宽度占位，隐藏胶囊
  }
}

.new-logs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }
}

.scroll-hint {
  opacity: 0.7;
}

.log-count {
  font-family: var(--font-mono);
  color: var(--fg-muted);
  font-size: var(--fs-sm);
}

.console {
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  height: 320px;
  overflow: auto;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;

  .output-line {
    white-space: pre-wrap;
    word-break: break-all;
    display: block;
    &.kind-error { color: var(--danger); }
    &.kind-warn { color: var(--warn); }
    &.kind-success { color: var(--success); }
    &.kind-info { color: var(--info); }
  }
}
</style>
