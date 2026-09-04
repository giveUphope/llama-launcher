<script setup lang="ts">
// 服务状态卡（概览页）：服务状态的唯一页面级展示区——状态、当前模型、API 地址、
// 运行时详情（主机/端口/PID/运行时长）、失败提示与基线徽章。
// 自「服务」页迁入概览：原概览 Q1–Q3 与服务页状态卡重复展示同一组信息，
// 迁移后该信息只在此一处显示（状态栏为全局常驻 chrome，不属于页面级展示）。
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Card from '@/components/common/Card.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import InfoStrip from '@/components/common/InfoStrip.vue';
import Icon from '@/components/common/Icon.vue';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, modelBaseName, formatDuration } from '@llama-launcher/shared';

const server = useServerStore();
const params = useParamsStore();
const i18n = useI18nStore();
const router = useRouter();

const isRunning = computed(() => server.status === 'running');

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

onUnmounted(() => {
  if (timer) { clearInterval(timer); timer = null; }
});

const durationSec = computed(() => {
  if (!startTimeMs.value) return 0;
  return Math.floor((now.value - startTimeMs.value) / 1000);
});

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

// ---- 复制地址 / 模型名 ----
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function copyUrl() {
  if (!server.apiUrl) return;
  await window.api.clipboard.write(server.apiUrl);
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; copyTimer = null; }, 1500);
}

const modelCopied = ref(false);
let modelCopyTimer: ReturnType<typeof setTimeout> | null = null;

async function copyModelName() {
  if (!currentModel.value) return;
  await window.api.clipboard.write(currentModel.value);
  modelCopied.value = true;
  if (modelCopyTimer) clearTimeout(modelCopyTimer);
  modelCopyTimer = setTimeout(() => { modelCopied.value = false; modelCopyTimer = null; }, 1500);
}

// ---- OOM 归因：启动失败/崩溃时扫描输出尾部的显存不足特征，给出可执行的缓解建议 ----
// 估算模型（参数页提示条）回答「能开多大」，此处回答「失败了怎么救」——两条路径互补。
const OOM_RE = /\b(out of memory|VK_ERROR_OUT_OF_DEVICE_MEMORY|cudaErrorOutOfMemory|out_of_memory|failed to allocate|unable to allocate|not enough memory|std::bad_alloc)\b/i;
const oomDetected = computed(() =>
  statusInfo.value.status === 'error' &&
  server.outputs.slice(-300).some((o) => OOM_RE.test(o.data)),
);

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
</script>

<template>
  <Card title-key="card_service_status">
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
         始终显示真实配置值；PID/时长为运行时事实，未运行以 — 占位。
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
    <!-- 快捷操作（自原概览 Q2/Q3 保留）：按钮不属于信息展示，不构成重复 -->
    <div class="quick-actions">
      <button class="action-btn accent" :disabled="!isRunning" @click="router.push('/webui')" :title="i18n.t('open_web')">
        <Icon name="external" :size="13" />
        <span>{{ i18n.t('open_web') }}</span>
      </button>
      <button class="action-btn" @click="router.push('/models')" :title="i18n.t('lbl_manage_models')">
        <Icon name="models" :size="13" />
        <span>{{ i18n.t('lbl_manage_models') }}</span>
      </button>
    </div>
    <!-- 失败/异常退出提示（设计稿 §8.4：错误摘要 + 解决方案）。
         ⚠️ 布局防跳动：外层 slot 常驻并预留与 banner 等高的固定高度，
         仅当失败时插入 banner——下方内容位置保持稳定，出现/消失不再下推。 -->
    <div class="failure-banner-slot" :class="{ 'has-banner': statusInfo.status === 'error' }">
      <div v-if="statusInfo.status === 'error'" class="failure-banner" role="alert">
        <Icon name="alert" :size="14" />
        <span>
          {{ server.effectiveStatus === 'crashed' ? i18n.t('msg_service_crashed') : i18n.t('msg_service_failed') }}
          · {{ i18n.t('msg_check_console_below') }}
        </span>
      </div>
      <!-- OOM 归因建议（输出尾部命中显存不足特征时追加，给出可执行缓解动作） -->
      <div v-if="statusInfo.status === 'error' && oomDetected" class="oom-hint">
        <span class="oom-text">{{ i18n.t('msg_oom_detected') }}</span>
        <button class="mini-btn accent" @click="onOomHalveCtx">{{ i18n.t('act_oom_halve_ctx') }}</button>
        <button class="mini-btn accent" @click="onOomKvQuant">{{ i18n.t('act_oom_kv_quant') }}</button>
      </div>
    </div>
  </Card>
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

// 快捷操作行：按钮组 flex; gap: 8px（§7.5）
.quick-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

// 复制按钮等宽：值盒右缘跨行对齐（文案长度差异不影响盒子宽度）
.copy-btn {
  font-size: var(--fs-md);
  min-width: 112px;
  justify-content: center;
}

/* 失败提示槽位：常驻预留 banner 等高的固定高度（防出现/消失时下推下方内容）。
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
  color: var(--danger-text); // 文字用深红达 AA；底/边保留亮 --danger 语义
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  font-weight: 600;
}

// OOM 归因建议行：紧随失败 banner 的次级提示 + 行内缓解按钮
.oom-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;

  .oom-text {
    color: var(--fg-secondary);
    font-size: var(--fs-base);
  }
}
</style>
