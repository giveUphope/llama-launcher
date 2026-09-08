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

// ---- 复制（a-typography copyable 图标触发；Arco 自带复制，这里再走 Electron 剪贴板兜底）----
async function copyViaApi(text: string | undefined) {
  if (!text) return;
  try { await window.api.clipboard.write(text); } catch { /* Arco 已复制或环境不支持 */ }
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
    <!-- 运行状态：a-tag 独立行 -->
    <a-space :size="8" class="status-row">
      <StatusTag :status="statusInfo.status" :label="statusInfo.label" />
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
      <a-descriptions-item :label="i18n.t('card_dash_api')" :span="2">
        <a-typography-text v-if="server.apiUrl" copyable :copy-text="server.apiUrl" @copy="copyViaApi(server.apiUrl)">
          <Icon name="link" :size="13" />
          <span class="mono-val ellipsis" :title="server.apiUrl">{{ server.apiUrl }}</span>
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

    <!-- 快捷操作（自原概览 Q2/Q3 保留）：按钮不属于信息展示，不构成重复 -->
    <a-space :size="8" class="quick-actions">
      <a-button type="primary" size="small" :disabled="!isRunning" @click="router.push('/webui')" :title="i18n.t('open_web')">
        <template #icon><Icon name="external" :size="13" /></template>
        {{ i18n.t('open_web') }}
      </a-button>
      <a-button size="small" @click="router.push('/models')" :title="i18n.t('lbl_manage_models')">
        <template #icon><Icon name="models" :size="13" /></template>
        {{ i18n.t('lbl_manage_models') }}
      </a-button>
    </a-space>
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
        <a-button size="mini" @click="onOomHalveCtx">{{ i18n.t('act_oom_halve_ctx') }}</a-button>
        <a-button size="mini" @click="onOomKvQuant">{{ i18n.t('act_oom_kv_quant') }}</a-button>
      </div>
    </div>
  </Card>
</template>

<style scoped lang="scss">
/* 运行状态行 */
.status-row {
  margin-bottom: 8px;
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

// 值缺省占位（未运行/无值）：次级灰
.empty-val {
  color: var(--color-text-3);
}

// 快捷操作行：a-space（gap 8px，§7.5.5）
.quick-actions {
  margin-bottom: 8px;
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

/* 失败提示 div（icon + 文案）：flex 居中 + 图标间距 6px + 内边距保持
   banner 高 ≈ slot 预留 30px（防跳动）；文字深红达 AA（见 style-audit #53），兼容浅/深主题 */
.failure-banner {
  display: inline-flex;
  align-items: center;
  gap: 6px; // 图标与文本间距归一到提示行统一 6px（默认 0 贴文本）
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-base);
  font-weight: 600;
  color: rgb(var(--danger-6));
}

// OOM 归因建议行：紧随失败 banner 的次级提示 + 行内缓解按钮
.oom-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;

  .oom-text {
    color: var(--color-text-2);
    font-size: var(--fs-base);
  }
}
</style>
