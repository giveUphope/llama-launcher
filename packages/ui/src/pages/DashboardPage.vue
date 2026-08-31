<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import InfoStrip from '@/components/common/InfoStrip.vue';
import Icon from '@/components/common/Icon.vue';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useAppLogStore } from '@/stores/appLog';
import { useI18nStore } from '@/stores/i18n';
import { MODEL_KEY, modelBaseName } from '@llama-launcher/shared';
import type { AppLogEntry } from '@llama-launcher/shared';

const server = useServerStore();
const params = useParamsStore();
const appLog = useAppLogStore();
const i18n = useI18nStore();
const router = useRouter();

const isRunning = computed(() => server.status === 'running');
const isStarting = computed(() => server.status === 'starting');

// Q1: 服务是否运行？
const statusBadge = computed(() => {
  if (isRunning.value) return { status: 'ok', label: i18n.t('svc_status_running') };
  if (isStarting.value) return { status: 'loading', label: i18n.t('svc_status_starting') };
  return { status: 'idle', label: i18n.t('svc_status_stopped') };
});

// Q2: 当前加载或待启动的模型是什么？（别名优先，回退文件名去 .gguf 后缀）
const currentModel = computed(() => {
  const p = String(params.values[MODEL_KEY] ?? '');
  if (!p) return '';
  const alias = String(params.values['alias'] ?? '').trim();
  if (alias) return alias;
  return modelBaseName(p);
});

// Q3: API 地址是什么？——语义统一收敛到 server store 的 apiUrl（与真实服务状态绑定：
// 已停止时为空，不因 store.url 残留旧值而继续显示地址），本页直接使用 server.apiUrl

// Q4: 最近需要处理的问题——数据源用【应用日志】而非后端原始输出：
// 应用日志是结构化分级记录（WARN/ERROR 语义明确，服务启动失败/下载错误等），
// 后端 stdout 绝大多数为推理信息行，按"问题"语义过滤必然混杂（正则启发式不可靠）；
// 后端完整输出保留在「服务」页控制台。仅取问题级（warn/error）最近 3 条。
const recentIssues = computed<AppLogEntry[]>(() =>
  appLog.entries.filter((e) => e.kind === 'error' || e.kind === 'warn').slice(-3),
);
const hasError = computed(() => recentIssues.value.some((e) => e.kind === 'error'));

function lineClass(entry: AppLogEntry): string {
  return `kind-${entry.kind}`;
}

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

// ---- 控制台滚动（迷你问题列表） ----
const consoleEl = ref<HTMLElement | null>(null);
async function scrollToBottom() {
  await nextTick();
  consoleEl.value?.scrollTo?.(0, consoleEl.value.scrollHeight);
}
watch(() => recentIssues.value.length, () => { void scrollToBottom(); });
onActivated(() => { void scrollToBottom(); });
onMounted(() => { appLog.subscribe(); });
</script>

<template>
  <PageFrame>
    <!-- Q1: 服务是否运行？ -->
    <div class="q-section q-status">
      <div class="q-header">
        <h2 class="q-title">{{ i18n.t('card_dash_status') }}</h2>
        <StatusTag :status="statusBadge.status" :label="statusBadge.label" />
      </div>
      <!-- 监听地址指示器：主机/端口 分列展示；完整 API 地址统一在下方「API 地址」卡片（Q3） -->
      <div class="q-grid">
        <InfoStrip :label="i18n.t('lbl_host')" mono>
          <span class="val-box">{{ server.host }}</span>
        </InfoStrip>
        <InfoStrip :label="i18n.t('lbl_dash_port')" mono>
          <span class="val-box">{{ server.port }}</span>
        </InfoStrip>
      </div>
    </div>

    <!-- Q2: 当前加载什么模型？ -->
    <div class="q-section q-model">
      <div class="q-header">
        <h2 class="q-title">{{ i18n.t('card_dash_model') }}</h2>
        <StatusTag v-if="currentModel" status="ok" :label="i18n.t('model_status_available')" />
        <StatusTag v-else status="idle" :label="i18n.t('status_model_none')" />
      </div>
      <InfoStrip :label="i18n.t('lbl_dash_model')" mono>
        <span class="val-box">
          {{ currentModel || i18n.t('msg_no_model_selected') }}
        </span>
      </InfoStrip>
      <div class="q-actions">
        <button class="action-btn accent" @click="void router.push('/models')">
          <Icon name="models" :size="14" />
          <span>{{ i18n.t('lbl_manage_models') }}</span>
        </button>
      </div>
    </div>

    <!-- Q3: API 地址是什么？ -->
    <div class="q-section q-api">
      <div class="q-header">
        <h2 class="q-title">{{ i18n.t('card_dash_api') }}</h2>
      </div>
      <div class="api-strip">
        <span class="api-url" :title="server.apiUrl || '—'">
          <Icon name="link" :size="14" />
          <span>{{ server.apiUrl || i18n.t('status_stopped') }}</span>
        </span>
        <button
          class="action-btn copy-btn"
          :disabled="!server.apiUrl"
          @click="copyUrl"
          :title="i18n.t('copy_url')"
        >
          <Icon name="copy" :size="12" />
          <span>{{ copied ? i18n.t('msg_url_copied') : i18n.t('copy_url') }}</span>
        </button>
        <button
          class="action-btn accent"
          :disabled="!isRunning"
          @click="void router.push('/webui')"
          :title="i18n.t('open_web')"
        >
          <Icon name="external" :size="13" />
          <span>{{ i18n.t('open_web') }}</span>
        </button>
      </div>
    </div>

    <!-- Q4: 是否有需要处理的问题？ -->
      <!-- Q4: 是否有需要处理的问题？（单行单内容：仅问题本身，无状态指示器——运行状态见 Q1） -->
      <div class="q-section q-issues">
        <div class="q-header">
          <h2 class="q-title">{{ i18n.t('card_dash_issues') }}</h2>
        </div>
        <div ref="consoleEl" class="issues-console">
          <div v-if="recentIssues.length === 0" class="empty-text">
            {{ i18n.t('msg_no_issues') }}
          </div>
          <div
            v-for="(line, idx) in recentIssues"
            :key="idx"
            :class="['log-line', lineClass(line)]"
          >{{ line.data }}</div>
        </div>
      <div v-if="hasError" class="issues-actions">
        <button class="action-btn" @click="void router.push('/logs')">
          <Icon name="console" :size="13" />
          <span>{{ i18n.t('nav_logs') }}</span>
        </button>
        <button class="action-btn" @click="void router.push('/service')">
          <Icon name="server" :size="13" />
          <span>{{ i18n.t('nav_service') }}</span>
        </button>
      </div>
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
/* 四大问题区域 */
.q-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  // 分隔线上方距离：与 Card 分区体一致（内容 → 线 14px），避免内容贴线
  padding-bottom: 14px;
}

// 分区风格：区块之间以实线分隔（线到内容 14px，与 Card 分区体一致，见 frontend.md §7.5.4）
.q-section + .q-section {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.q-header {
  display: flex;
  align-items: center;
  justify-content: flex-start; // 指示器贴近标题文本，不拉开到右侧
  gap: 12px;
  padding-bottom: 4px;
}

.q-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--fg-primary);
}

/* 字段值文本框：与输入框同视觉（输入底 + 边框 + 胶囊），与左侧 label 形成清晰对照 */
.val-box {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  max-width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.q-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.q-actions {
  display: flex;
  gap: 8px;
}

/* API 地址条 */
.api-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.api-url {
  flex: 1;
  min-width: 200px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-base);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  font-size: var(--fs-md);
}

/* 迷你日志/问题区域 */
.issues-console {
  max-height: 160px;
  overflow: auto;
  padding: 6px 10px;
  background: var(--console-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;

  .log-line {
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--console-fg);
    &.kind-error { color: var(--danger); }
    &.kind-warn { color: var(--warn); }
    &.kind-success { color: var(--success); }
    &.kind-info { color: var(--info); }
  }

  .empty-text {
    color: var(--fg-muted);
    text-align: center;
    padding: 12px 0;
    font-family: var(--font-family);
  }
}

.issues-actions {
  display: flex;
  gap: 8px;
}
</style>
