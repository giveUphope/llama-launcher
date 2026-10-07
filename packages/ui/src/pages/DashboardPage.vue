<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import ServiceStatusCard from '@/components/service/ServiceStatusCard.vue';
import { useAppLogStore, type AppLogLine } from '@/stores/appLog';
import { useSettingsStore } from '@/stores/settings';
import { useAutoScroll } from '@/composables/useAutoScroll';
import { useI18nStore } from '@/stores/i18n';

const appLog = useAppLogStore();
const settings = useSettingsStore();
const i18n = useI18nStore();
const router = useRouter();

// 服务状态（状态/模型/API 地址/运行时详情）由 ServiceStatusCard 承担——
// 服务状态信息的唯一页面级展示区（原 Q1–Q3 与服务页状态卡重复，已合并迁入）。

// 应用操作日志（服务启停、下载、错误等）的唯一展示区。
// 2026-10-07 档 B 归位：这一路数据原先有一份完整视图在「日志」页（带级别筛选、搜索、复制、
// 清空），而那一页现在只展示推理框架输出——一类信息一个出口，本页不再另设复制/清空按钮。
// 只取最近若干条：日志缓冲 2000 条，概览要的是「最近发生了什么」，滚动窗口自带过期能力。
const APP_LOG_WINDOW = 24;
const appLogLines = computed<AppLogLine[]>(() => appLog.entries.slice(-APP_LOG_WINDOW));
// 是否值得给出入口：只看当前窗口里的 error（窗口自带滚动，旧错误会被新行推走，
// 不会像「全量历史里有过一次 error」那样把动作行永久钉住）
const hasError = computed(() => appLogLines.value.some((e) => e.kind === 'error'));

// 行级别类由 store 在入队时算好（AppLogLine.cls），渲染期不再逐行求值

// ---- 控制台滚动（应用日志窗口） ----
// 这一份列表只需要「停用不滚动 + 回页时补滚到底」：没有「有新日志」胶囊，也没有手动跟随开关，
// 所以接 useAutoScroll 而不套 ConsolePanel（行渲染与日志页不同：这里是定高小窗）
const consoleEl = ref<HTMLElement | null>(null);
useAutoScroll(consoleEl, { count: () => appLogLines.value.length, pill: false });

onMounted(() => { appLog.subscribe(); });

// 语言切换只需重算已缓存行的时间串（store 内一次遍历）；时间戳渲染在本页，所以这个 watch
// 随应用日志视图一起从「日志」页搬了过来
watch(() => settings.language, (lang) => { if (lang) appLog.setLocale(lang); }, { immediate: true });
</script>

<template>
  <PageFrame>
    <!-- 服务状态：状态 / 当前模型 / API 地址 / 主机 / 端口 / PID / 运行时长 / 基线徽章，
         页面级唯一展示区（Card 分区风格，底边线与下方问题区分隔） -->
    <ServiceStatusCard />

    <!-- 应用操作日志（时间 / 级别 / 正文三列，级别色整行着色；无复制/清空出口——
         减少多处出口是本轮的决定，需要动手的入口只有下面这一条「日志」跳转）。
         2026-10-08 范式统一：自绘 .q-section 裸标题换官方 Card 基座（与同页
         ServiceStatusCard 及全站卡片同族——标题 h2 / 卡片头 / 体边距全交回库） -->
    <Card title-key="card_dash_applog">
      <div ref="consoleEl" class="issues-console">
        <a-empty v-if="appLogLines.length === 0" class="dash-empty" :description="i18n.t('msg_empty_no_logs')" />
        <div
          v-for="entry in appLogLines"
          :key="entry.id"
          :class="['log-line', entry.cls]"
        >
          <span class="log-ts">{{ entry.time }}</span>
          <span class="log-kind">{{ entry.kind.toUpperCase() }}</span>
          <span class="log-text">{{ entry.data }}</span>
        </div>
      </div>
      <div class="issues-actions-slot" :class="{ 'has-actions': hasError }">
        <div v-if="hasError" class="issues-actions">
          <a-button size="small" @click="void router.push('/logs')">
            <template #icon><Icon name="console" :size="13" /></template>
            {{ i18n.t('nav_logs') }}
          </a-button>
          <a-button size="small" @click="void router.push('/service')">
            <template #icon><Icon name="server" :size="13" /></template>
            {{ i18n.t('nav_service') }}
          </a-button>
        </div>
      </div>
    </Card>
  </PageFrame>
</template>

<style scoped lang="scss">
/* （自绘 .q-section / .q-header / .q-title 已随 2026-10-08 范式统一删除：
   应用操作日志换官方 Card 基座，标题 h2 / 卡片头 / 体边距 / 卡间 16px 全交回库） */

/* 应用日志窗口（恒深底 + 三列行） */
.issues-console {
  max-height: 160px;
  /* 防跳动：窗口条数上限 24 条但可视区固定，空态时仍预留 3 行最小高度
     （padding 6×2 + 3×fs-base 行高 1.5 ≈ 72px），空态 ↔ 少行时高度恒定，
     不再出现空态 ↔ 多行时的 Q4 区块高度变化（#46 预留位置模式）。 */
  min-height: 72px;
  overflow: auto;
  padding: 6px 10px;
  background: var(--console-bg);
  /* 恒深底必须同时给前景色：四条 kind 之外的行（如下载事件转写）此前继承 body 文字，
     浅色主题下 #1d2129 压在 #1d2129 上=看不见（实测该节点 fg 与 bg 完全相同）。
     与 ConsolePanel 同一套：底色与前景色成对声明，不靠调用方记得补级别色。 */
  color: var(--console-fg);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;

  .log-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--console-fg);
    // 级别色走 --log-kind-*（同一底上的达标档，见 theme.scss），与控制台面板同一套取值
    &.kind-error { color: var(--log-kind-error); }
    &.kind-warn { color: var(--log-kind-warn); }
    &.kind-success { color: var(--log-kind-success); }
    &.kind-info { color: var(--log-kind-info); }
  }

  // 时间戳与级别标签是次要列：不随行着色（info 行只给级别标签着色，正文保持前景色）
  .log-ts {
    flex-shrink: 0;
    color: var(--log-kind-info);
    font-size: var(--fs-sm);
    min-width: 64px;
  }

  .log-kind {
    flex-shrink: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    min-width: 52px;
  }

  .log-text {
    flex: 1;
    min-width: 0;
  }

  .log-line.kind-info .log-text {
    color: var(--console-fg);
  }

  .dash-empty {
    /* 空态占位：a-empty 官方组件（2026-10-08 统一，替换自绘文案行）。
       flex 居中 + min-height 60px（父级 72px border-box − 上下 padding 12），垂直居中
       占满预留区，空态 ↔ 1–3 行条目高度恒定（#46/#47 预留位置模式）；默认插图在
       60px 档放不下，压到 40px。描述色用 Arco 官方 gray-5 配对，不另写节点配色 */
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60px;
    padding: 0;

    :deep(.arco-empty-image) {
      height: 40px;
    }
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
