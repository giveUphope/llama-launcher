<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PARAMS } from '@llama-launcher/shared';
import Card from '@/components/common/Card.vue';
import PageFrame from '@/components/common/PageFrame.vue';
import Icon from '@/components/common/Icon.vue';
import PresetsPanel from '@/components/presets/PresetsPanel.vue';
import BenchPanel from '@/components/bench/BenchPanel.vue';
import ParamRow from '@/components/params/ParamRow.vue';
import BaselineBadge from '@/components/common/BaselineBadge.vue';
import { confirm } from '@/composables/useConfirm';
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
      <div class="status-right">
        <!-- 双轨参数逻辑：基线徽章 + 恢复基线 + 清除会话（替代原「未保存」脏标签） -->
        <BaselineBadge show-restore />
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
        <Card
          v-for="sub in subcategoryGroups"
          :key="sub.key"
          class="param-card"
          :title-key="`subcat_${sub.key}`"
          compact
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
