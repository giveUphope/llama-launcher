<script setup lang="ts">
import type { IconName } from '@/components/common/icon-map';
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PARAMS, MODEL_KEY } from '@llama-launcher/shared';
import type { PerfTarget, TargetRecommendation, OccupancyConfig } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import ToolTip from '@/components/common/ToolTip.vue';
import PresetsPanel from '@/components/presets/PresetsPanel.vue';
import ParamRow from '@/components/params/ParamRow.vue';
import { confirm } from '@/composables/useConfirm';
import { useVramEstimate } from '@/composables/useVramEstimate';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

// 单页 + 页内 tab-strip 切换（与设置页同一体例）：query.tab 可深链，无 query 进入回退首个页签「参数预设」。
// 参数预设（PresetsPanel）由 KeepAlive 缓存，切页不丢状态。
type TabKey = 'custom' | 'presets';

const TABS: Array<{ key: TabKey; icon: IconName; labelKey: string }> = [
  { key: 'presets', icon: 'presets', labelKey: 'nav_params_presets' },
  { key: 'custom', icon: 'params', labelKey: 'nav_params_custom' },
];

const SUBCATEGORY_ORDER: string[] = [
  'network', 'context', 'compute', 'memory', 'sampling',
  'kv_cache', 'multimodal', 'template', 'speculative', 'thinking',
  'identity', 'endpoints', 'security', 'behavior',
];

const route = useRoute();
const router = useRouter();
const params = useParamsStore();
const i18n = useI18nStore();

// 进入参数设置（无 query：侧栏点击、/basic 等旧重定向、旧书签）固定落在「参数预设」（首个页签）；
// 显式 ?tab=presets|custom|bench 仍深链有效。页签切换仅改写 query，不跨次进入记忆。
const activeTab = computed<TabKey>(() => {
  const t = String(route.query.tab ?? '');
  if (t === 'presets' || t === 'custom') return t;
  return 'presets';
});

function setTab(key: TabKey) {
  if (key === activeTab.value) return;
  void router.replace({ query: { ...route.query, tab: key } });
}

// 无 query 进入 /params 时归一化 URL 为默认页签，保证刷新/分享与视图一致
watch(
  () => [route.path, route.query.tab] as const,
  ([p, t]) => {
    if (p === '/params' && (t === undefined || t === '')) {
      void router.replace({ query: { ...route.query, tab: 'presets' } });
    }
  },
  { immediate: true },
);

const activeComponent = computed<Component | null>(() => {
  if (activeTab.value === 'presets') return PresetsPanel;
  return null; // custom 直接渲染 ParamRow 列表
});

// 按 subcategory 分组参数（保持定义顺序 + 自定义排序）
const subcategoryGroups = computed(() => {
  const ordered: { key: string; params: typeof PARAMS }[] = [];
  const seen = new Set<string>();
  for (const key of SUBCATEGORY_ORDER) {
    const items = PARAMS.filter((p) => (p.subcategory ?? 'default') === key);
    if (items.length > 0) {
      seen.add(key);
      ordered.push({ key, params: items });
    }
  }
  for (const p of PARAMS) {
    const sub = p.subcategory ?? 'default';
    if (!seen.has(sub)) {
      seen.add(sub);
      ordered.push({ key: sub, params: PARAMS.filter((x) => (x.subcategory ?? 'default') === sub) });
    }
  }
  return ordered;
});

// 目录类参数不计入「已生效参数」（其值随模型/目录选择联动，非用户显式开关）
const INACTIVE_COUNT_KEYS = new Set(['mmproj', 'spec_draft_model']);
const activeParamCount = computed(() =>
  PARAMS.filter((p) => !INACTIVE_COUNT_KEYS.has(p.key) && params.values[p.key] !== p.default).length,
);

const totalParamCount = computed(() => PARAMS.length);
const groupCount = computed(() => subcategoryGroups.value.length);

// ---- 分区折叠（自定义参数页签）----
// 默认全展开（与折叠前的信息密度一致），折叠状态只活在本页签话期内：
// 本页 keep-alive 不卸载，ref 天然跨页签保留，应用重启后回到全展开。
const openSections = ref<string[]>(subcategoryGroups.value.map((g) => g.key));
const allSectionKeys = computed(() => subcategoryGroups.value.map((g) => g.key));
const allOpen = computed(() => openSections.value.length === allSectionKeys.value.length);
function expandAll() {
  openSections.value = [...allSectionKeys.value];
}
function collapseAll() {
  openSections.value = [];
}
function onToggleSection(key: string, expanded: boolean) {
  const at = openSections.value.indexOf(key);
  if (expanded && at < 0) openSections.value = [...openSections.value, key];
  else if (!expanded && at >= 0) {
    openSections.value = [...openSections.value.slice(0, at), ...openSections.value.slice(at + 1)];
  }
}
// 每分区「相对出厂默认已改几项」一次算好随数据携带（§7.1 热路径铁律 ②：
// 不在 v-for 里逐行调函数求派生值）
const sectionChangedCount = computed(() => {
  const out: Record<string, number> = {};
  for (const g of subcategoryGroups.value) {
    out[g.key] = g.params.filter((p) => params.values[p.key] !== p.default).length;
  }
  return out;
});

// 硬件资源占用估算（自定义参数标签状态条 stat 项）：主进程 `--list-devices` 探测 +
// GGUF KV 内存模型，按当前会话配置（卸载层数/上下文/KV 档位）估算显存与内存双侧占用。
// stat 槽位常驻占位（不可用显示 —），避免异步加载/显隐导致跳动；构成明细放 title tooltip。
const PERF_TARGET_ITEMS: { key: PerfTarget; labelKey: string }[] = [
  { key: 'max-context', labelKey: 'target_max_context' },
  { key: 'balanced', labelKey: 'target_balanced' },
  { key: 'latency', labelKey: 'target_latency' },
  { key: 'memory', labelKey: 'target_memory' },
];
const perfTarget = ref<PerfTarget>('balanced');
const vramModelPath = computed(() => String(params.values[MODEL_KEY] ?? ''));
const kvDtype = computed(() => String(params.values['cache_type_k'] ?? 'q8_0'));
// 会话占用配置：与参数页当前值同源（卸载层数/上下文/KV 档位），保证前后端估算链路一致
const occConfig = computed<OccupancyConfig>(() => ({
  ngl: String(params.values['gpu_layers'] ?? 'auto'),
  ctxSize: Number(params.values['ctx_size'] ?? 0) || 0,
  kvDtype: kvDtype.value,
}));
const { estimate: vramEstimate } = useVramEstimate(vramModelPath, kvDtype, perfTarget, occConfig);

const vramOcc = computed(() => vramEstimate.value?.occupancy ?? null);

// stat 值：显存占用占设备容量百分比（容量未知时显示 GiB），不可估算为 null → 显示 —
// a-statistic :value 仅支持 number|Date（字符串走其内部 dayjs 分支会渲染 Invalid Date），
// 故拆数值 + 单位后缀；无估算值时 :value 为 undefined → 走原生 placeholder 渲染 —
const vramStatValue = computed<{ num: number; unit: string } | null>(() => {
  const o = vramOcc.value;
  if (!o || o.vram.totalMiB === null) return null;
  if (o.vram.capacityMiB) return { num: Math.round((o.vram.totalMiB / o.vram.capacityMiB) * 100), unit: '%' };
  return { num: Number((o.vram.totalMiB / 1024).toFixed(1)), unit: 'G' };
});

// 显存总占用超出设备空闲即警示
const vramWarn = computed(() => vramOcc.value?.vram.fits === false);

const giB = (mib: number | null | undefined) => (mib == null ? '—' : (mib / 1024).toFixed(1));

// tooltip：显存/内存双侧占用构成明细 + 上下文参考（与后端 estimateOccupancy 同一份数据）
const vramTooltip = computed(() => {
  const o = vramOcc.value;
  const e = vramEstimate.value;
  if (!o || !e || !e.devices.length) {
    // 过去这里只有一句「不可用」，真机上引擎目录改名/搬走时永远只有「—」可看，无从排查。
    // 主进程现在把探测失败原因（含尝试过的路径）随结果带回，直接并进 tooltip。
    return e?.probeError
      ? `${i18n.t('msg_vram_unavailable')}\n${e.probeError}`
      : i18n.t('msg_vram_unavailable');
  }
  const v = o.vram;
  const lines: string[] = [];
  lines.push(i18n.t('msg_occ_vram_line', [e.devices[0].name, giB(v.weightsMiB), giB(v.kvMiB), giB(v.reserveMiB), giB(v.totalMiB), giB(v.availableMiB), v.fits === false ? i18n.t('occ_over') : i18n.t('occ_ok')]));
  lines.push(i18n.t('msg_occ_ram_line', [giB(o.ram.weightsMiB), giB(o.ram.kvMiB), giB(o.ram.reserveMiB), giB(o.ram.totalMiB), giB(o.ram.availableMiB)]));
  lines.push(i18n.t('msg_occ_ctx_line', [(o.contextTokens ?? 0).toLocaleString(), (o.maxContext ?? 0).toLocaleString(), kvDtype.value]));
  // 「为什么慢」只在这里说一次（服务页原先还有一行同义提示，与这里重复，2026-10-06 用户标注后删除）：
  // 有权重落在内存侧时，内存→显卡的搬运才是决定出字速度的那条链路。
  if ((o.ram.weightsMiB ?? 0) > 0) lines.push(i18n.t('msg_occ_spill_line'));
  return lines.join('\n');
});

// ---- 性能目标选择器：四档目标联动关键杠杆建议（估算引擎驱动，见 core target-recommend） ----
const targetOpen = ref(false);
const targetLabel = computed(() => {
  const item = PERF_TARGET_ITEMS.find((t) => t.key === perfTarget.value);
  return item ? i18n.t(item.labelKey) : '';
});

// 与当前会话值的差集：只展示真正会改变的项（与默认一致的 建议 不重复打扰）
const targetRecs = computed<TargetRecommendation[]>(() => {
  const recs = vramEstimate.value?.recommendations ?? [];
  return recs.filter((r) => String(params.values[r.key] ?? '') !== String(r.value));
});

function selectTarget(t: PerfTarget) {
  perfTarget.value = t; // 面板保持展开，随估算刷新显示该目标下的建议
}

// 面板展开/收起由 Arco Dropdown 受控（popup-visible-change 同步），无需手动监听外部点击
async function applyTargetRecs() {
  const recs = targetRecs.value;
  if (!recs.length) return;
  const lines = recs.map((r) => `  ${r.key} = ${r.value}`).join('\n');
  const ok = await confirm({
    title: i18n.t('target_apply_title'),
    message: `${i18n.t('target_apply_msg')}\n\n${lines}`,
    variant: 'info',
  });
  if (!ok) return;
  for (const r of recs) params.set(r.key, r.value);
  targetOpen.value = false;
}

// 清除会话参数：回出厂默认 + 清空基线（双确认防误触）
async function onClearSession() {
  const ok = await confirm({
    title: i18n.t('msg_clear_session'),
    message: i18n.t('msg_discard_dirty', [i18n.t('baseline_default')]),
    variant: 'warning',
  });
  if (!ok) return;
  params.clearSession();
}
</script>

<template>
  <PageFrame>
    <!-- 页内页签（与设置页同一体例）：参数预设 / 自定义参数（Arco Tabs） -->
    <a-tabs class="page-tabs" :active-key="activeTab" @change="(k) => setTab(k as TabKey)">
      <a-tab-pane v-for="t in TABS" :key="t.key" :key-value="t.key">
        <template #title>
          <Icon :name="t.icon" :size="13" />
          <span>{{ i18n.t(t.labelKey) }}</span>
        </template>
      </a-tab-pane>
    </a-tabs>

    <!-- 参数预览条仅在「自定义参数」标签展示（预设界面聚焦预设编辑，不显示参数统计）：
         a-statistic 承载统计（warn/muted 态走语义类），a-divider 分隔 -->
    <div v-if="activeTab === 'custom'" class="params-status-bar">
      <div class="stat">
        <Icon name="params" :size="14" />
        <a-statistic :value="totalParamCount" :title="i18n.t('lbl_total_params')" />
      </div>
      <a-divider class="stat-divider" direction="vertical" />
      <div class="stat" :class="{ warn: activeParamCount > 0 }">
        <Icon :name="activeParamCount > 0 ? 'alert' : 'info'" :size="14" />
        <a-statistic :value="activeParamCount" :title="i18n.t('lbl_active_params')" />
      </div>
      <a-divider class="stat-divider" direction="vertical" />
      <div class="stat">
        <Icon name="presets" :size="14" />
        <a-statistic :value="groupCount" :title="i18n.t('lbl_param_groups')" />
      </div>
      <!-- 硬件占用估算 stat：槽位常驻占位（不可用显示 —），构成明细放 tooltip；
           显存总占用超出设备空闲时由官方预设 tag 警示（范式纯化：值色覆写删除，
           统计值回归官方配色——「跟随库官方观感」豁免延伸至预设配对） -->
      <a-divider class="stat-divider" direction="vertical" />
      <ToolTip :text="vramTooltip">
        <div class="stat" :class="{ warn: vramWarn }">
          <Icon :name="vramWarn ? 'alert' : 'info'" :size="14" />
          <a-statistic
            :title="i18n.t('lbl_vram_occupancy')"
            :value="vramStatValue?.num"
            placeholder="—"
            :class="{ muted: !vramStatValue }"
          >
            <template #suffix>{{ vramStatValue?.unit }}</template>
          </a-statistic>
          <a-tag v-if="vramWarn" color="orange" size="small" nowrap>{{ i18n.t('lbl_vram_over') }}</a-tag>
        </div>
      </ToolTip>
      <!-- 性能目标选择器：四档目标联动关键杠杆建议（Arco Dropdown 承接；建议 chips 走 a-tag）。
           hide-on-select=false：点击目标仅切换选中并刷新建议区，面板保持展开，
           由用户主动点「应用到参数」（应用后收起）或点击外部关闭。
           position=bl：按钮文字随所选目标变化导致触发器宽度变化，默认 bottom（水平居中）
           会让弹层随按钮宽度左右跳变（实测 609~630px 摆动）；bl 左对齐触发器后弹层 x 恒定 -->
      <a-dropdown trigger="click" position="bl" :popup-visible="targetOpen" :hide-on-select="false" @popup-visible-change="(v: any) => (targetOpen = v)">
        <ToolTip :text="i18n.t('target_picker_title')">
          <a-button size="small">
            <template #icon><Icon name="presets" :size="11" /></template>
            {{ i18n.t('lbl_perf_target') }}: {{ targetLabel }}
            <!-- 同 TopBar：a-button 无 #suffix 槽（死槽内容被静默丢弃），尾箭头必须进默认槽 -->
            <Icon name="chevron_down" :size="11" class="target-caret" />
          </a-button>
        </ToolTip>
        <template #content>
          <div class="target-menu">
            <a-doption
              v-for="t in PERF_TARGET_ITEMS"
              :key="t.key"
              class="target-item"
              :class="{ active: t.key === perfTarget }"
              @click="selectTarget(t.key)"
            >
              <span class="target-item-label">{{ i18n.t(t.labelKey) }}</span>
              <Icon v-if="t.key === perfTarget" name="check" :size="12" class="target-item-check" />
            </a-doption>
            <template v-if="targetRecs.length">
              <div class="target-recs">
                <div class="target-rec-chips">
                  <!-- size="small"：与其余建议值芯片同档（.gguf-hint / .suggestion-chip 实测 h20；
                       原缺 size 走 a-tag 默认 h24，同一语义两种高度，见 STYLE_TODO #77） -->
                  <ToolTip v-for="r in targetRecs" :key="r.key" :text="i18n.t(r.reasonKey, r.reasonArgs)">
                    <a-tag size="small" class="rec-chip">
                      <span class="chip-key">{{ r.key }}</span>
                      <span class="chip-eq">=</span>
                      <span class="chip-val">{{ r.value }}</span>
                    </a-tag>
                  </ToolTip>
                </div>
                <a-button size="small" type="primary" @click="applyTargetRecs">
                  {{ i18n.t('target_apply') }} ({{ targetRecs.length }})
                </a-button>
              </div>
            </template>
            <div v-else class="target-recs-empty">{{ i18n.t('target_no_recs') }}</div>
          </div>
        </template>
      </a-dropdown>
      <div class="status-right">
        <!-- 分区折叠总控（仅自定义参数页签有分区概念）-->
        <template v-if="activeTab === 'custom'">
          <ToolTip :text="i18n.t('act_expand_all')">
            <a-button size="small" :disabled="allOpen" :aria-label="i18n.t('act_expand_all')" @click="expandAll">
              <template #icon><Icon name="chevron_down" :size="12" /></template>
            </a-button>
          </ToolTip>
          <ToolTip :text="i18n.t('act_collapse_all')">
            <a-button size="small" :disabled="openSections.length === 0" :aria-label="i18n.t('act_collapse_all')" @click="collapseAll">
              <template #icon><Icon name="chevron_right" :size="12" /></template>
            </a-button>
          </ToolTip>
        </template>
        <!-- 基线徽章已移除（与「已调整」统计重复，基线状态保留在概览服务状态卡）；
             保留恢复基线 / 清除会话参数两个操作入口 -->
        <ToolTip :text="i18n.t('msg_restore_baseline')">
          <a-button
            size="small"
            :disabled="!params.hasChanges || !params.baseline"
            @click="params.restoreBaseline()"
          >
            {{ i18n.t('msg_restore_baseline') }}
          </a-button>
        </ToolTip>
        <ToolTip :text="i18n.t('msg_clear_session')">
          <a-button size="small" @click="onClearSession">
            {{ i18n.t('msg_clear_session') }}
          </a-button>
        </ToolTip>
      </div>
    </div>

    <!-- 左侧 mini-nav 已重构入侧边栏子标签；内容区随 query.tab 切换 -->
    <div class="params-content">
      <template v-if="activeTab === 'custom'">
        <!-- 分组卡使用标准卡片标题（fs-lg 主色，与预设/服务等页对齐）；
             可折叠：卡片头即切换钮，标题右侧 a-tag 标出该组相对出厂默认已改几项 -->
        <Card
          v-for="sub in subcategoryGroups"
          :key="sub.key"
          class="param-card"
          :title-key="`subcat_${sub.key}`"
          collapsible
          :expanded="openSections.includes(sub.key)"
          @update:expanded="onToggleSection(sub.key, $event)"
        >
          <template v-if="sectionChangedCount[sub.key]" #actions>
            <a-tag size="small" color="orange">{{ i18n.t('subcat_changed_n', [String(sectionChangedCount[sub.key])]) }}</a-tag>
          </template>
          <div class="param-grid">
            <ParamRow v-for="p in sub.params" :key="p.key" :p="p" />
          </div>
        </Card>
      </template>

      <KeepAlive v-else include="PresetsPanel">
        <component
          :is="activeComponent"
          v-if="activeComponent"
          :key="activeTab"
        />
      </KeepAlive>
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
// 页签条与下方区块统一 8px 间距（§7.5 顶栏条与相邻区块间距规范）
.page-tabs {
  margin-bottom: 8px;
}

.params-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: var(--color-fill-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  margin-bottom: 8px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-2);

  // 单行统计条：title 与 value 同行横排（对齐模型管理统计条范式）
  :deep(.arco-statistic-title),
  :deep(.arco-statistic-content) {
    display: inline-block;
  }

  :deep(.arco-statistic-title) {
    font-size: var(--fs-xs);
    line-height: 1.3;
    margin: 0 6px 0 0; // title 与 value 间距 6px
  }

  :deep(.arco-statistic-value) {
    font-size: var(--fs-lg);
    font-weight: 700;
    font-family: var(--font-mono);
    line-height: 1.3;
    // 「已调整」0 → 12 → 64 的位数变化会撑宽统计块、把后面的分隔线与相邻 stat 顶开：
    // mono 字体下 2ch 恰为两位数字宽（参数总数与已调整数都不超过两位），预留后位数变化不改几何
    display: inline-block;
    min-width: 2ch;
  }

  // 已调整参数 > 0：数值保持官方配色；警示信号由分区头「N 项已改」官方 orange 预设
  // tag 承载（#105 范式纯化：统计值色覆写删除）
}

// （占位态的次级灰覆写已随 #105 范式纯化删除：占位「—」回归官方配色）

.stat-divider.arco-divider-vertical {
  height: 22px;
  margin: 0;
}

// 性能目标按钮尾箭头：间距镜像官方前导图标 margin（size-small 为 6px）
.target-caret {
  margin-left: 6px;
}

.status-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.params-content {
  display: flex;
  flex-direction: column;
  // 分区风格：参数分组卡片由底边实线分隔
  gap: 0;
  min-width: 0;
  min-height: 0;
}

.param-card {
  margin-bottom: 0;
}


.param-grid {
  // 自适应多列网格：auto-fill 不折叠空轨道——各组共享同一轨道宽度，参数少的组
  // 控件不会被拉伸（auto-fit 会折叠空轨道：2 参数组控件被撑到 ~795px，4 参数组仅 ~391px）。
  // 最小轨 434px = 一行参数的实测最小舒适宽：边框 2 + 行内距 16 + 标签列 124 + 8 +
  // 控件 ≥164（滑块轨道 80 + 间隙 8 + 数字框 76）+ 4 + 提示槽 72 + 4 + 还原 ✕ 槽 24
  // + 4 + 依赖警示槽 12（STYLE_TODO #81 档 1：#77「槽位常驻」范式漏掉的第四处）。
  // （#77 曾按「标签 140 + 数字框 88」推到 450；#78 查明其中 16px 是 Arco label-col
  //  的默认右内距、88 对 6 位值有 12px 富余，两处回收后行宽省 32px。）
  // 曾取 340px 并配 max-width:1160px 封顶 3 列，实测两头都坏：
  // ① ≥1600 视口卡片可用宽 1326→2286 而网格恒 1160（1920 右侧空 486px、2560 空 1126px）；
  // ② 1440（未触及封顶）排成 3 列 ×369px，滑块轨道被压到 31px。现不设上限。
  // 列数随宽度单调增长，判据是算术而非记忆：轨道 434 + 列间距 14 ⇒
  // 两列需卡内可用宽 ≥ 882，三列 ≥ 1330，四列 ≥ 1778，五列 ≥ 2226。
  // （旧注释里「1156/1280/1440 → 2 列、1600/1728/1920 → 3 列」是 418 轨时代按视口记的
  //  经验值，轨道一变就整体失准，故改为写公式；要按视口用就自己按上面的式子换算。）
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(434px, 1fr));
  gap: 4px 14px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}
</style>

<style lang="scss">
/* 性能目标下拉菜单：Arco Dropdown popper 挂载于 body，需非 scoped 覆盖 */
.target-menu {
  // 定宽弹层：各目标的建议 chips 内容不同，弹层若随内容自适应会在 300~591px 间
  // 跳动拉宽（chips 单行铺开）。定宽后 chips 走 flex-wrap 换行，单行最多 2 个，
  // 切换目标时弹层宽度稳定不变
  width: 340px;
  padding: 4px;
}

.target-menu .target-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.target-menu .target-item .arco-dropdown-option-content {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}

.target-menu .target-item.active .arco-dropdown-option-content {
  color: var(--fg-accent);
  font-weight: 600;
}

.target-menu .target-recs {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 4px 4px;
  border-top: 1px solid var(--color-border-2);
  // 定高一档（chips 一行 20 + gap 8 + 应用按钮 24 + 上下内距）：切换性能目标时建议条数增减
  // 不再让弹层高度跳动，与 .target-recs-empty 同档保证两态等高
  min-height: 64px;
}

.target-menu .target-rec-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 建议值芯片：与参数行 .gguf-hint、模型页 .suggestion-chip 同档（a-tag size=small
   + mono + --fs-sm + 内段 gap 5px + key/=/value 三段配色，§7.5.4 ① / STYLE_TODO #77）。
   原 `color: --color-text-1` 是死声明（a-tag 原生文字色即 rgb(29,33,41)），已删 */
.target-menu .rec-chip {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  align-items: center;
  gap: 5px;
  cursor: help;
}

.target-menu .chip-key { color: var(--fg-accent); font-weight: 600; }
/* 装饰符号：信息由 key/val 两段承载，等号本身不携带内容，保留 text-3 不并入 --fg-hint */
.target-menu .chip-eq { color: var(--color-text-3); }
.target-menu .chip-val { color: var(--color-text-1); }

.target-recs-empty {
  margin-top: 4px;
  padding: 8px 4px 4px;
  border-top: 1px solid var(--color-border-2);
  color: var(--fg-hint);
  font-size: var(--fs-base);
  // 与 .target-recs 同档定高：有无建议两种内容形状下弹层高度一致
  min-height: 64px;
}
</style>

<!-- 性能目标下拉弹层样式：popup 由 a-dropdown 传送到 body，需非 scoped 样式。
     菜单含「目标项 + 建议区 + 应用按钮」，高度可变且必须完整展示——禁用 Arco 默认
     206px 滚动裁剪（.arco-dropdown-list-wrapper max-height），弹层随内容完整展开；
     :has(.target-menu) 精确圈定本弹层，不影响模型选择/URL 历史等长列表下拉的正常滚动。 -->
<style lang="scss">
.arco-dropdown-list-wrapper:has(.target-menu) {
  max-height: none;
  overflow: visible;
}
</style>
