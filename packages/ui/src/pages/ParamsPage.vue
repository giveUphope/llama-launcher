<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PARAMS, MODEL_KEY } from '@llama-launcher/shared';
import type { PerfTarget, TargetRecommendation, OccupancyConfig } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import PresetsPanel from '@/components/presets/PresetsPanel.vue';
import BenchPanel from '@/components/bench/BenchPanel.vue';
import ParamRow from '@/components/params/ParamRow.vue';
import { confirm } from '@/composables/useConfirm';
import { useVramEstimate } from '@/composables/useVramEstimate';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

// 左侧迷你导航已重构入侧边栏（子标签：参数预设 / 自定义参数 / 性能测试），
// 本页只保留内容区，tab 由侧边栏经路由 query.tab 驱动。
// 性能测试（BenchPanel）自服务页迁入作为第三子标签（调参与测试强相关）；
// 页面级 keep-alive（PageHost）保证切换页面后测试历史不丢失。
type TabKey = 'custom' | 'presets' | 'bench';

const SUBCATEGORY_ORDER: string[] = [
  'network', 'context', 'compute', 'memory', 'sampling',
  'kv_cache', 'multimodal', 'template', 'speculative', 'thinking',
  'identity', 'endpoints', 'behavior',
];

const route = useRoute();
const router = useRouter();
const params = useParamsStore();
const i18n = useI18nStore();

// 向后兼容：旧 ?tab=params 映射到 custom（bench 现已是真实子标签，直接命中）
const LEGACY_TAB_MAP: Record<string, TabKey> = { params: 'custom' };

const activeTab = ref<TabKey>('custom');
watch(() => route.query.tab, (tab) => {
  const t = String(tab ?? 'custom');
  if (t === 'presets' || t === 'custom' || t === 'bench') {
    activeTab.value = t;
  } else if (LEGACY_TAB_MAP[t]) {
    // 旧书签/快捷键（?tab=params）：归一化 URL，保证侧边栏子项高亮与内容一致
    void router.replace({ query: { tab: LEGACY_TAB_MAP[t] } });
  }
}, { immediate: true });

const activeComponent = computed<Component | null>(() => {
  if (activeTab.value === 'presets') return PresetsPanel;
  if (activeTab.value === 'bench') return BenchPanel;
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

// 点击面板外关闭（与 TopBar 模型下拉同模式）
function onDocClick() {
  targetOpen.value = false;
}
onMounted(() => { document.addEventListener('click', onDocClick); });
onUnmounted(() => { document.removeEventListener('click', onDocClick); });

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
    <!-- 参数预览条仅在「自定义参数」标签展示（预设界面聚焦预设编辑，不显示参数统计） -->
    <div v-if="activeTab === 'custom'" class="params-status-bar">
      <div class="stat">
        <Icon name="params" :size="14" />
        <div class="stat-body">
          <span class="stat-value">{{ totalParamCount }}</span>
          <span class="stat-label">{{ i18n.t('lbl_total_params') }}</span>
        </div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat" :class="{ warn: activeParamCount > 0 }">
        <Icon :name="activeParamCount > 0 ? 'alert' : 'info'" :size="14" />
        <div class="stat-body">
          <span class="stat-value" :class="{ warn: activeParamCount > 0 }">{{ activeParamCount }}</span>
          <span class="stat-label">{{ i18n.t('lbl_active_params') }}</span>
        </div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <Icon name="presets" :size="14" />
        <div class="stat-body">
          <span class="stat-value">{{ groupCount }}</span>
          <span class="stat-label">{{ i18n.t('lbl_param_groups') }}</span>
        </div>
      </div>
      <!-- 硬件占用估算 stat：槽位常驻占位（不可用显示 —），构成明细放 tooltip；
           显存总占用超出设备空闲时橙色警示 -->
      <div class="stat-divider"></div>
      <div class="stat" :class="{ warn: vramWarn }" :title="vramTooltip">
        <Icon :name="vramWarn ? 'alert' : 'info'" :size="14" />
        <div class="stat-body">
          <span class="stat-value" :class="{ warn: vramWarn, muted: !vramStatValue }">{{ vramStatValue ?? '—' }}</span>
          <span class="stat-label">{{ i18n.t('lbl_vram_occupancy') }}</span>
        </div>
      </div>
      <!-- 性能目标选择器：四档目标联动关键杠杆建议（点击外部关闭，与 TopBar 模型下拉同模式） -->
      <div class="target-wrap" @click.stop>
        <button class="mini-btn" :title="i18n.t('target_picker_title')" @click="targetOpen = !targetOpen">
          <Icon name="presets" :size="11" />
          <span>{{ i18n.t('lbl_perf_target') }}: {{ targetLabel }}</span>
          <Icon name="chevron_down" :size="11" />
        </button>
        <div v-if="targetOpen" class="target-panel">
          <button
            v-for="t in PERF_TARGET_ITEMS"
            :key="t.key"
            class="target-item"
            :class="{ active: t.key === perfTarget }"
            @click="selectTarget(t.key)"
          >
            <span>{{ i18n.t(t.labelKey) }}</span>
            <Icon v-if="t.key === perfTarget" name="check" :size="12" />
          </button>
          <div v-if="targetRecs.length" class="target-recs">
            <div class="target-rec-chips">
              <span v-for="r in targetRecs" :key="r.key" class="rec-chip" :title="r.reason">
                {{ r.key }} = {{ r.value }}
              </span>
            </div>
            <button class="action-btn primary" @click="applyTargetRecs">
              {{ i18n.t('target_apply') }} ({{ targetRecs.length }})
            </button>
          </div>
          <div v-else class="target-recs-empty">{{ i18n.t('target_no_recs') }}</div>
        </div>
      </div>
      <div class="status-right">
        <!-- 基线徽章已移除（与「已调整」统计重复，基线状态保留在概览服务状态卡）；
             保留恢复基线 / 清除会话参数两个操作入口 -->
        <button
          class="action-btn"
          :disabled="!params.hasChanges || !params.baseline"
          :title="i18n.t('msg_restore_baseline')"
          @click="params.restoreBaseline()"
        >
          <span>{{ i18n.t('msg_restore_baseline') }}</span>
        </button>
        <button
          class="action-btn"
          :title="i18n.t('msg_clear_session')"
          @click="onClearSession"
        >
          <span>{{ i18n.t('msg_clear_session') }}</span>
        </button>
      </div>
    </div>

    <!-- 左侧 mini-nav 已重构入侧边栏子标签；内容区随 query.tab 切换 -->
    <div class="params-content">
      <template v-if="activeTab === 'custom'">
        <!-- 分组卡使用标准卡片标题（fs-lg 主色，与预设/服务等页对齐；紧凑体例仅保留给 BenchPanel） -->
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

      <KeepAlive v-else include="PresetsPanel,BenchPanel">
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
.params-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-row);
  margin-bottom: 8px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--fg-secondary);
}

.stat-body {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.3;
}

.stat-value {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--fg-primary);
  font-family: var(--font-mono);

  &.warn { color: var(--warn); }

  // 占位态（估算不可用）：次级灰，与其他 stat 的主色区分
  &.muted { color: var(--fg-muted); font-weight: 400; }
}

.stat-label {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.stat-divider {
  width: 1px;
  height: 22px;
  background: var(--border);
}

.status-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

// 性能目标选择器：mini-btn 触发 + 绝对定位下拉面板（浮层阴影走 --shadow-dropdown）
.target-wrap {
  position: relative;
}

.target-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 300px;
  padding: 6px;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-dropdown);
  box-shadow: var(--shadow-dropdown);
}

.target-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  background: none;
  border: none;
  border-radius: var(--radius-mini);
  color: var(--fg-secondary);
  font-size: var(--fs-base);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--bg-hover);
    color: var(--fg-primary);
  }

  &.active {
    color: var(--accent);
  }
}

.target-recs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
  padding: 8px;
  border-top: 1px solid var(--border);
}

.target-rec-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rec-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--fg-primary);
  cursor: help;
}

.target-recs-empty {
  margin-top: 6px;
  padding: 8px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: var(--fs-base);
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
