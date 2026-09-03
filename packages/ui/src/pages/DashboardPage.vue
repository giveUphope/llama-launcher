<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import ServiceStatusCard from '@/components/service/ServiceStatusCard.vue';
import { useAppLogStore } from '@/stores/appLog';
import { useI18nStore } from '@/stores/i18n';
import type { AppLogEntry } from '@llama-launcher/shared';

const appLog = useAppLogStore();
const i18n = useI18nStore();
const router = useRouter();

// 服务状态（状态/模型/API 地址/运行时详情）由 ServiceStatusCard 承担——
// 服务状态信息的唯一页面级展示区（原 Q1–Q3 与服务页状态卡重复，已合并迁入）。

// 最近需要处理的问题——数据源用【应用日志】而非后端原始输出：
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
    <!-- 服务状态：状态 / 当前模型 / API 地址 / 主机 / 端口 / PID / 运行时长 / 基线徽章，
         页面级唯一展示区（Card 分区风格，底边线与下方问题区分隔） -->
    <ServiceStatusCard />

    <!-- 最近问题（单行单内容：仅问题本身，无状态指示器——运行状态见上方服务状态卡） -->
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
      <div class="issues-actions-slot" :class="{ 'has-actions': hasError }">
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
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
/* 问题区域 */
.q-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  // 分隔线上方距离：与 Card 分区体一致（内容 → 线 14px），避免内容贴线
  padding-bottom: 14px;
}

// 服务状态卡（Card 分区）自带底边线；下方问题区补齐与 q-section 相同的 14px 顶距，
// 保持与「线到内容 14px」一致的分隔节奏（§7.5.4）
.card + .q-section {
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

/* 迷你日志/问题区域 */
.issues-console {
  max-height: 160px;
  /* 防跳动：问题条目固定上限 3 行（recentIssues.slice(-3)）——预留 3 行最小高度
     （padding 6×2 + 3×fs-base 行高 1.5 ≈ 72px），空态/少行时高度恒定，不再出现
     空态 ↔ 多行时的 Q4 区块高度变化（#46 预留位置模式）。 */
  min-height: 72px;
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
    /* 空态占位组件：flex 居中 + min-height 60px（父级 72px border-box − 上下 padding 12），
       垂直居中占满预留区，空态 ↔ 1–3 行条目高度恒定（#46/#47 预留位置模式；
       原定高行高方案超出预留区 12px 且违反行高语义化清单 #9，2026-09-04 改为 flex） */
    color: var(--fg-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60px;
    padding: 0;
    font-family: var(--font-family);
  }
}

.issues-actions {
  display: flex;
  gap: 8px;
}

/* 问题操作行防跳动：外层槽位常驻并与按钮行等高（--btn-h），无问题时隐藏但占满
   高度——操作行出现/消失时问题区高度恒定，下方内容不再被下推（#42 预留位置模式）。 */
.issues-actions-slot {
  margin-top: 8px;
  min-height: var(--btn-h);

  &:not(.has-actions) {
    visibility: hidden;
  }
}
</style>
