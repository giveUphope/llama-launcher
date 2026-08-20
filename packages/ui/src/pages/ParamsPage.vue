<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ParamsPanel from '@/components/params/ParamsPanel.vue';
import PresetsPanel from '@/components/presets/PresetsPanel.vue';
import BenchPanel from '@/components/bench/BenchPanel.vue';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

type TabKey = 'basic' | 'advanced' | 'server' | 'presets' | 'bench';

const VALID_TABS: TabKey[] = ['basic', 'advanced', 'server', 'presets', 'bench'];

// 标签定义：参数组标签带 group 用于渲染参数，预设/性能测试标签渲染独立面板
const TABS: { key: TabKey; labelKey: string; group?: string }[] = [
  { key: 'basic', labelKey: 'nav_basic', group: 'basic' },
  { key: 'advanced', labelKey: 'nav_advanced', group: 'advanced' },
  { key: 'server', labelKey: 'nav_server', group: 'server' },
  { key: 'presets', labelKey: 'nav_presets' },
  { key: 'bench', labelKey: 'nav_bench' },
];

const route = useRoute();
const router = useRouter();
const params = useParamsStore();
const i18n = useI18nStore();

// active 标签由 route.query.tab 驱动（旧路由 /basic、/advanced、/server、/presets 均重定向到这里）
const activeTab = ref<TabKey>('basic');
watch(() => route.query.tab, (tab) => {
  if (VALID_TABS.includes(tab as TabKey)) activeTab.value = tab as TabKey;
}, { immediate: true });

function setTab(key: TabKey) {
  activeTab.value = key;
  void router.replace({ query: { tab: key } });
}

// 当前激活的 tab 定义（含 group）
const activeTabDef = computed(() => TABS.find((t) => t.key === activeTab.value));

// 各标签渲染的组件：参数组标签共用 ParamsPanel（按 group 传参），预设/性能测试各自独立。
// 所有面板都包在 <KeepAlive> 内，切换 tab 时组件实例被缓存（保留内存状态），
// 尤其性能测试历史的 combos 在切走再切回后不丢失。
const activeComponent = computed<Component | null>(() => {
  const def = activeTabDef.value;
  if (!def) return null;
  if (def.group) return ParamsPanel;
  if (def.key === 'presets') return PresetsPanel;
  if (def.key === 'bench') return BenchPanel;
  return null;
});
</script>

<template>
  <div class="page">
    <!-- 页内标签：基础 / 高级 / 服务端 / 预设 / 性能测试 -->
    <div class="tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        @click="setTab(t.key)"
      >
        {{ i18n.t(t.labelKey) }}
        <span v-if="t.group && params.changedGroups[t.group]" class="tab-dot"></span>
      </button>
    </div>

    <!-- 面板容器：KeepAlive 作为稳定父容器缓存各组件实例，
         切换 tab 时保留内存状态（如性能测试历史 combos、预设列表等） -->
    <KeepAlive include="ParamsPanel,PresetsPanel,BenchPanel">
      <component
        :is="activeComponent"
        v-if="activeComponent"
        :key="activeTabDef?.group ?? activeTab"
        :group="activeTabDef?.group ?? 'basic'"
      />
    </KeepAlive>
  </div>
</template>

<style scoped lang="scss">
.page {
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 8px;
}

.tab-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  background: none;
  border: 1px solid transparent;
  color: var(--fg-secondary);
  font-size: var(--fs-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), color var(--dur-fast) var(--ease-jelly),
    border-color var(--dur-fast) var(--ease-jelly), transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--bg-hover);
    color: var(--fg-primary);
  }

  &:active {
    transform: scale(0.96);
  }

  &.active {
    background: var(--glass-bg);
    border-color: var(--glass-border);
    color: var(--accent);
    font-weight: 600;
  }
}

.tab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warn);
  flex-shrink: 0;
}
</style>
