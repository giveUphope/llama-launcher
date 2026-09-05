<script setup lang="ts">
// 模型页（2 子标签壳）：本地模型 / 模型库。
// 下载任务不再单列页签——模型库（DownloadCard library 模式）已内置任务区，
// 含进度/暂停/恢复/清除等完整能力。旧路由 /download 保留并指向模型库 tab。
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import LocalModelsPanel from '@/components/models/LocalModelsPanel.vue';
import LibraryPanel from '@/components/models/LibraryPanel.vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';

const route = useRoute();
const router = useRouter();
const i18n = useI18nStore();

type TabKey = 'local' | 'library';

const TABS: Array<{ key: TabKey; icon: string; labelKey: string }> = [
  { key: 'local', icon: 'folder_open', labelKey: 'nav_models_local' },
  { key: 'library', icon: 'search', labelKey: 'nav_models_library' },
];

const activeTab = computed<TabKey>(() => {
  const t = String(route.query.tab ?? 'local');
  if (t === 'library') return t;
  return 'local';
});

function setTab(key: TabKey) {
  if (key === activeTab.value) return;
  void router.replace({ query: { ...route.query, tab: key } });
}
</script>

<template>
  <PageFrame>
    <div class="tab-strip" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        :aria-selected="activeTab === t.key"
        role="tab"
        @click="setTab(t.key)"
      >
        <Icon :name="t.icon" :size="13" />
        <span>{{ i18n.t(t.labelKey) }}</span>
      </button>
    </div>

    <div class="tab-content">
      <LocalModelsPanel v-if="activeTab === 'local'" />
      <LibraryPanel v-else-if="activeTab === 'library'" />
    </div>
  </PageFrame>
</template>

<style scoped lang="scss">
.tab-content {
  display: flex;
  flex-direction: column;
  // 分区风格：面板内卡片由底边实线分隔，gap 归 0；与上方 tab 条保持 8px 间距
  gap: 0;
  margin-top: 8px;
  min-height: 0;
  flex: 1;
}
</style>
