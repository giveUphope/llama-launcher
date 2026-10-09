<script setup lang="ts">
// 日志页 = 推理框架（llama-server）输出的唯一出口。
// 归位前：这一页展示的是应用操作日志，而框架原始输出在「服务」页控制台——两类信息各在一页，
// 两页都带「复制输出 / 清空控制台」。按用户 2026-10-07 的决定（档 B）改成一处一类：
// 框架输出 → 本页（唯一复制/清空出口），应用操作日志 → 概览页的日志区。
import type { IconName } from '@/components/common/icon-map';
import { computed, ref, watch } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Card from '@/components/common/Card.vue';
import ConsolePanel from '@/components/common/ConsolePanel.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import { useServerStore, type ConsoleTone } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';

const server = useServerStore();
const i18n = useI18nStore();

// 关键词分类在 server store 的入队环节就算好了（OutputLine.tone），渲染期只做一次映射；
// 此前每条新日志都会对最多 1000 个渲染行各跑 3 条正则
const TONE_CLASS: Record<ConsoleTone, string> = {
  error: 'kind-error',
  warn: 'kind-warn',
  success: 'kind-success',
  info: 'kind-info',
  plain: 'kind-default',
};

type Level = ConsoleTone | 'all';

// 快速筛选五档：级别文案全部走 i18n（此前中英混杂——全部/普通中文、INFO 等四级硬编码
// 英文，同一栏两种语言）。「信息」档合并 tone info 与 plain：JSON INFO 行与无关键词的
// 原始行对用户是同一类「常规信息」，分列即重复档（#106）；「全部」图标换 console 与
// 信息档区分（原先两者同为 info-circle）。
const LEVELS: Array<{ key: Level; label: string; icon: IconName }> = [
  { key: 'all', label: i18n.t('lbl_all'), icon: 'console' },
  { key: 'info', label: i18n.t('lbl_level_info'), icon: 'info' },
  { key: 'success', label: i18n.t('lbl_level_success'), icon: 'check' },
  { key: 'warn', label: i18n.t('lbl_level_warn'), icon: 'alert' },
  { key: 'error', label: i18n.t('lbl_level_error'), icon: 'error' },
];

const levelFilter = ref<Level>('all');
const searchQuery = ref('');
const deferredQuery = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;
// 每次按键都重算筛选会得到新数组身份，进而整表重渲染：去抖 150ms 后才参与筛选
watch(searchQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { deferredQuery.value = q; }, 150);
});

const filteredOutputs = computed(() => {
  const q = deferredQuery.value.trim().toLowerCase();
  return server.outputs.filter((line) => {
    // 信息档合并 plain：无关键词的原始行对用户同为「常规信息」（#106 去重复档）；
    // plain tone 仍存在于内部分类（着色用），只是不再单列筛选档
    const toneHit = levelFilter.value === 'info'
      ? line.tone === 'info' || line.tone === 'plain'
      : levelFilter.value === 'all' || line.tone === levelFilter.value;
    if (!toneHit) return false;
    if (q && !line.data.toLowerCase().includes(q)) return false;
    return true;
  });
});

// 渲染上限：后端缓冲本身就是 1000 行，再给更高的数是永不触发的死余量
const RENDER_LIMIT = 1000;
const displayOutputs = computed(() => {
  const outs = filteredOutputs.value;
  return outs.length > RENDER_LIMIT ? outs.slice(-RENDER_LIMIT) : outs;
});

// 搜索命中切段：deferred 后按 indexOf 切（不用正则，免转义），命中段渲染为高亮底。
// 放 computed 而非 v-for 内联函数：只在（行集 | 关键词）变化时重算一次
interface RenderPart {
  text: string;
  hit: boolean;
}
const displayRows = computed(() => {
  const q = deferredQuery.value.trim().toLowerCase();
  return displayOutputs.value.map((line) => {
    if (!q) return { line, parts: [{ text: line.data, hit: false }] as RenderPart[] };
    const parts: RenderPart[] = [];
    const lower = line.data.toLowerCase();
    let from = 0;
    for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
      if (at > from) parts.push({ text: line.data.slice(from, at), hit: false });
      parts.push({ text: line.data.slice(at, at + q.length), hit: true });
      from = at + q.length;
    }
    if (from < line.data.length) parts.push({ text: line.data.slice(from), hit: false });
    return { line, parts };
  });
});

const filteredCount = computed(() => filteredOutputs.value.length);

// 空态两分：缓冲区真的空（服务还没说过话）vs 筛选/搜索无命中——同一张空态图，文案区分
const emptyText = computed(() =>
  server.outputs.length === 0 ? i18n.t('msg_empty_no_logs') : i18n.t('msg_no_matching_logs'),
);

// 复制的是「当前看到的」：带筛选/搜索时把看不见的行一起复制走会误导排查
async function onCopyAll() {
  const text = filteredOutputs.value.map((o) => o.data).join('');
  if (!text) return;
  await window.api.clipboard.write(text);
}

function onClear() {
  server.clearOutputs();
}

// 滚动（停用门控 / rAF 合帧 / 「有新日志」判定）一律由 ConsolePanel 内的 useAutoScroll 承担
</script>

<template>
  <PageFrame>
    <!-- 2026-10-08 卡片化：全站最后一个内容裸在页面上的页面，换官方 Card 基座
         （无标题卡——页级 h1「日志」已存在，避免重复；筛选行 / 控制台 / 计数条
         依次排在卡体内，边框 / 底 / 内距交回库） -->
    <Card class="logs-card">
    <!-- 级别筛选 + 搜索 + 操作按钮：单行编排（2026-10-08，用户裁定）——按钮收纯图标
         （ToolTip 承担说明 + aria-label 补无障碍名），省出的宽度交给搜索框；
         不许折行：窗口最小宽 1024 下三段合计约 440px（图标钮后），单行恒放得下 -->
    <div class="filter-row">
      <!-- 级别筛选：切换按钮组（2026-10-08 用户裁定「按钮分隔还在使用被淘汰的样式」——
           分段单选组的内建钮间分隔线与统计条分隔线同族一并退役；独立 a-button +
           aria-pressed 承担单选语义，键盘可达（tag 方案无 tabindex 故不取），组件间纯 gap 无线 -->
      <div class="level-filter" role="group" :aria-label="i18n.t('lbl_level_filter')">
        <a-button
          v-for="l in LEVELS"
          :key="l.key"
          size="small"
          :type="levelFilter === l.key ? 'primary' : 'secondary'"
          :aria-pressed="levelFilter === l.key"
          @click="levelFilter = l.key"
        >
          <template #icon><Icon :name="l.icon" :size="11" /></template>
          {{ l.label }}
        </a-button>
      </div>
      <div class="search-box">
        <a-input
          v-model="searchQuery"
          :placeholder="i18n.t('lbl_search_logs')"
          allow-clear
        >
          <template #prefix><Icon name="search" :size="13" /></template>
        </a-input>
      </div>
      <div class="toolbar-right">
        <!-- 行数计数（2026-10-09 用户裁定自底部状态条并回工具条）：命中数 / 缓冲区总行数，
             分母取缓冲区总量，筛选无命中时读得出一共有多少行；信息在左、动作在右 -->
        <span class="show-limit">{{ filteredCount }} / {{ server.outputs.length }} {{ i18n.t('col_lines') }}</span>
        <ToolTip :text="i18n.t('copy_console')">
          <a-button
            size="small"
            :disabled="filteredOutputs.length === 0"
            :aria-label="i18n.t('copy_console')"
            @click="onCopyAll"
          >
            <template #icon><Icon name="copy" :size="12" /></template>
          </a-button>
        </ToolTip>
        <ToolTip :text="i18n.t('clear_console')">
          <a-button
            size="small"
            class="clear-console"
            status="danger"
            :aria-label="i18n.t('clear_console')"
            @click="onClear"
          >
            <template #icon><Icon name="trash" :size="12" /></template>
          </a-button>
        </ToolTip>
      </div>
    </div>

    <!-- 框架输出内容区 -->
    <div class="console-wrap">
      <div class="scope-hint">
        <Icon name="info" :size="11" />
        <span>{{ i18n.t('msg_framework_logs_hint') }}</span>
      </div>
      <!-- count 取 outputs 而非 filteredOutputs 的长度：两个都监听过，同一行会触发两次滚动 -->
      <ConsolePanel class="console-fill" :count="server.outputs.length">
        <a-empty v-if="displayOutputs.length === 0" class="logs-empty" :description="emptyText" />
        <span
          v-for="row in displayRows"
          :key="row.line.id"
          :class="['output-line', TONE_CLASS[row.line.tone]]"
        ><span class="line-ts">{{ row.line.time }}</span><span class="line-text"><span
          v-for="(p, i) in row.parts"
          :key="i"
          :class="{ 'search-hit': p.hit }"
        >{{ p.text }}</span></span></span>
      </ConsolePanel>
    </div>
    </Card>
  </PageFrame>
</template>

<style scoped lang="scss">
/* 操作按钮行：独立按钮（无提示条容器） */
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  // 与筛选 chips/搜索框同行，按钮组右对齐
  margin-left: auto;
}

/* 筛选行：单行编排（2026-10-08 用户裁定）——不开 wrap（折行 = 高度跳动 +
   按钮掉到第二行），宽度压力由右侧图标钮（已收窄）与搜索框弹性收缩承担；
   窗口最小宽 1024 下三段合计 ~440px，恒放得下 */
.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

// 级别筛选：独立切换按钮组（选中 = primary 实底，其余 secondary），
// 组件间距交容器 gap——分段单选组的钮间分隔线是被淘汰的样式（#113/#115 同族）
.level-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 卡片化（2026-10-08）：无标题卡撑满页面剩余高，卡体转弹性列让控制台填充。
   弹性链：page-frame → 卡 → 卡体 → console-wrap → ConsolePanel(console-fill)，
   每环 min-height: 0 缺一环即溢出（#82 骨架链纪律） */
.logs-card {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;

  :deep(.arco-card-body) {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
}

.search-box {
  flex: 1;
  // 下限 140：1024 最小窗宽下理论分得 ~280px，此值只是极端情况的兜底
  min-width: 140px;
  max-width: 380px;
}

/* 内容区 */
.console-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.scope-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--fg-hint);
}

/* 面板高度：日志页要撑满剩余可视高（骨架链给的是确定高度 + 弹性列，缺这一环等于没写，
   STYLE_TODO #82）。同一个面板在概览页是定高小窗，两种给法都由外层决定，面板本体不写 */
.console-fill {
  flex: 1 1 0%;
  min-height: 0;
}

/* 后端原始输出一行一段：行首时间戳 + 正文两段，flex 折行时长行悬挂缩进在正文列下。
   级别色由 ConsolePanel 打在行上（.kind-* → --log-kind-*），时间列固定 info 色不随级别 */
.output-line {
  display: flex;
  align-items: baseline;
  gap: 10px;

  // 横向扫读辅助：整行提亮一档
  &:hover {
    background: color-mix(in srgb, var(--console-fg) 6%, var(--console-bg));
  }
}

.line-ts {
  flex: none;
  color: var(--log-kind-info);
  font-variant-numeric: tabular-nums;
}

.line-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 搜索命中段：accent 不透明混色打底（压住深底保证级别色文字仍可读），文字色继承行 */
.search-hit {
  background: color-mix(in srgb, rgb(var(--console-accent)) 26%, var(--console-bg));
  color: inherit;
  border-radius: 2px;
}

/* 空态：a-empty 官方组件（2026-10-08 统一）。描述色用 Arco 官方 gray-5 配对（中灰压
   恒深控制台底实测可读），不另写 Arco 节点配色（规则 20 零登记面） */
.logs-empty {
  padding: 24px 20px;
}

/* 行数计数：随工具条右簇展示（2026-10-09 自底部状态条并入；底条本身只有它一个
   内容，随迁拆除，控制台由此多得一行高度）。次级档 + mono，与按钮簇隔 8px（容器 gap） */
.show-limit {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--fg-hint);
}
</style>
