<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PARAMS, MODEL_KEY } from '@llama-launcher/shared';
import type { PerfTarget, TargetRecommendation, OccupancyConfig } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import PresetsPanel from '@/components/presets/PresetsPanel.vue';
import ParamRow from '@/components/params/ParamRow.vue';
import { confirm } from '@/composables/useConfirm';
import { useVramEstimate } from '@/composables/useVramEstimate';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

// 单页 + 页内 tab-strip 切换（与设置页同一体例）：query.tab 可深链，无 query 进入回退首个页签「参数预设」。
// 参数预设（PresetsPanel）由 KeepAlive 缓存，切页不丢状态。
type TabKey = 'custom' | 'presets';

const TABS: Array<{ key: TabKey; icon: string; labelKey: string }> = [
  { key: 'presets', icon: 'presets', labelKey: 'nav_params_presets' },
  { key: 'custom', icon: 'params', labelKey: 'nav_params_custom' },
];

const SUBCATEGORY_ORDER: string[] = [
  'network', 'context', 'compute', 'memory', 'sampling',
  'kv_cache', 'multimodal', 'template', 'speculative', 'thinking',
  'identity', 'endpoints', 'behavior',
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

const activeParamCount = computed(() =>
  PARAMS.filter((p) => !new Set(['mmproj', 'spec_draft_model']).has(p.key) && params.values[p.key] !== p.default).length,
);

const totalParamCount = computed(() => PARAMS.length);
const groupCount = computed(() => subcategoryGroups.value.length);

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
const vramStatValue = computed(() => {
  const o = vramOcc.value;
  if (!o || o.vram.totalMiB === null) return null;
  if (o.vram.capacityMiB) return `${Math.round((o.vram.totalMiB / o.vram.capacityMiB) * 100)}%`;
  return `${(o.vram.totalMiB / 1024).toFixed(1)}G`;
});

// 显存总占用超出设备空闲即警示
const vramWarn = computed(() => vramOcc.value?.vram.fits === false);

const giB = (mib: number | null | undefined) => (mib == null ? '—' : (mib / 1024).toFixed(1));

// tooltip：显存/内存双侧占用构成明细 + 上下文参考（与后端 estimateOccupancy 同一份数据）
const vramTooltip = computed(() => {
  const o = vramOcc.value;
  const e = vramEstimate.value;
  if (!o || !e || !e.devices.length) return i18n.t('msg_vram_unavailable');
  const v = o.vram;
  const lines: string[] = [];
  lines.push(
    i18n.t('msg_occ_vram_line')
      .replace('{0}', e.devices[0].name)
      .replace('{1}', giB(v.weightsMiB))
      .replace('{2}', giB(v.kvMiB))
      .replace('{3}', giB(v.reserveMiB))
      .replace('{4}', giB(v.totalMiB))
      .replace('{5}', giB(v.availableMiB))
      .replace('{6}', v.fits === false ? i18n.t('occ_over') : i18n.t('occ_ok')),
  );
  lines.push(
    i18n.t('msg_occ_ram_line')
      .replace('{0}', giB(o.ram.weightsMiB))
      .replace('{1}', giB(o.ram.kvMiB))
      .replace('{2}', giB(o.ram.reserveMiB))
      .replace('{3}', giB(o.ram.totalMiB))
      .replace('{4}', giB(o.ram.availableMiB)),
  );
  lines.push(
    i18n.t('msg_occ_ctx_line')
      .replace('{0}', (o.contextTokens ?? 0).toLocaleString())
      .replace('{1}', (o.maxContext ?? 0).toLocaleString())
      .replace('{2}', kvDtype.value),
  );
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
    message: i18n.t('msg_discard_dirty').replace('{0}', i18n.t('baseline_default')),
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
           显存总占用超出设备空闲时橙色警示 -->
      <a-divider class="stat-divider" direction="vertical" />
      <div class="stat" :class="{ warn: vramWarn }" :title="vramTooltip">
        <Icon :name="vramWarn ? 'alert' : 'info'" :size="14" />
        <!-- 字符串值（GB 估算/—）经 #suffix 插槽渲染，muted 态挂组件根 -->
        <a-statistic :title="i18n.t('lbl_vram_occupancy')" :class="{ muted: !vramStatValue }">
          <template #suffix>{{ vramStatValue ?? '—' }}</template>
        </a-statistic>
      </div>
      <!-- 性能目标选择器：四档目标联动关键杠杆建议（Arco Dropdown 承接；建议 chips 走 a-tag） -->
      <a-dropdown trigger="click" :popup-visible="targetOpen" @popup-visible-change="(v: any) => (targetOpen = v)">
        <a-button size="small" :title="i18n.t('target_picker_title')">
          <template #icon><Icon name="presets" :size="11" /></template>
          {{ i18n.t('lbl_perf_target') }}: {{ targetLabel }}
          <template #suffix><Icon name="chevron_down" :size="11" /></template>
        </a-button>
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
                  <a-tag v-for="r in targetRecs" :key="r.key" class="rec-chip" :title="r.reason">
                    {{ r.key }} = {{ r.value }}
                  </a-tag>
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
        <!-- 基线徽章已移除（与「已调整」统计重复，基线状态保留在概览服务状态卡）；
             保留恢复基线 / 清除会话参数两个操作入口 -->
        <a-button
          size="small"
          :disabled="!params.hasChanges || !params.baseline"
          :title="i18n.t('msg_restore_baseline')"
          @click="params.restoreBaseline()"
        >
          {{ i18n.t('msg_restore_baseline') }}
        </a-button>
        <a-button size="small" :title="i18n.t('msg_clear_session')" @click="onClearSession">
          {{ i18n.t('msg_clear_session') }}
        </a-button>
      </div>
    </div>

    <!-- 左侧 mini-nav 已重构入侧边栏子标签；内容区随 query.tab 切换 -->
    <div class="params-content">
      <template v-if="activeTab === 'custom'">
        <!-- 分组卡使用标准卡片标题（fs-lg 主色，与预设/服务等页对齐） -->
        <Card
          v-for="sub in subcategoryGroups"
          :key="sub.key"
          class="param-card"
          :title-key="`subcat_${sub.key}`"
        >
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

  :deep(.arco-statistic-title) {
    font-size: var(--fs-xs);
    color: var(--color-text-3);
    line-height: 1.3;
    margin-bottom: 2px;
  }

  :deep(.arco-statistic-value) {
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--color-text-1);
    font-family: var(--font-mono);
    line-height: 1.3;
  }

  // 已调整参数 > 0：数值警示橙（与行容器的 warn 描边同色系）
  &.warn :deep(.arco-statistic-value) {
    color: rgb(var(--orange-6));
  }
}

// 占位态（估算不可用）：次级灰降字重，与其他 stat 的主色区分
.stat .arco-statistic.muted :deep(.arco-statistic-value) {
  color: var(--color-text-3);
  font-weight: 400;
}

.stat-divider.arco-divider-vertical {
  height: 22px;
  margin: 0;
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
  // 自适应网格：小控件（开关/下拉/数字输入）自然多列并排，
  // 大控件（滑块/文件路径）占满整列宽度
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 4px 14px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
}
</style>

<style lang="scss">
/* 性能目标下拉菜单：Arco Dropdown popper 挂载于 body，需非 scoped 覆盖 */
.target-menu {
  min-width: 300px;
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
  color: rgb(var(--primary-6));
  font-weight: 600;
}

.target-menu .target-recs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 4px 4px;
  border-top: 1px solid var(--color-border-2);
}

.target-menu .target-rec-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.target-menu .rec-chip {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--color-text-1);
  cursor: help;
}

.target-recs-empty {
  margin-top: 4px;
  padding: 8px 4px 4px;
  border-top: 1px solid var(--color-border-2);
  color: var(--color-text-3);
  font-size: var(--fs-base);
}
</style>
