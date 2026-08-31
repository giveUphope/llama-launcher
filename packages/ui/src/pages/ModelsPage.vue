<script setup lang="ts">
// 模型页（3 子标签壳）：本地模型 / 模型库 / 下载任务。
// 阶段三重构：原 DownloadPage 拆为 LibraryPanel（URL 解析+搜索+文件选择）
// 与 DownloadsPanel（任务列表），原 ModelsPage 主体抽到 LocalModelsPanel。
// 旧路由 /download 重定向到 ?tab=downloads（保留旧书签）。
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageFrame from '@/components/common/PageFrame.vue';
import LocalModelsPanel from '@/components/models/LocalModelsPanel.vue';
import LibraryPanel from '@/components/models/LibraryPanel.vue';
import DownloadsPanel from '@/components/models/DownloadsPanel.vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';

const route = useRoute();
const router = useRouter();
const i18n = useI18nStore();

type TabKey = 'local' | 'library' | 'downloads';

const TABS: Array<{ key: TabKey; icon: string; labelKey: string }> = [
  { key: 'local', icon: 'folder_open', labelKey: 'nav_models_local' },
  { key: 'library', icon: 'search', labelKey: 'nav_models_library' },
  { key: 'downloads', icon: 'download', labelKey: 'nav_models_downloads' },
];

const activeTab = computed<TabKey>(() => {
  const t = String(route.query.tab ?? 'local');
  if (t === 'library' || t === 'downloads') return t;
  return 'local';
});

function setTab(key: TabKey) {
  if (key === activeTab.value) return;
  void router.replace({ query: { ...route.query, tab: key } });
}

// /download 旧路由入口：若直接通过路径进入（无 tab），保持在 downloads tab；
// features/download.ts 仍把 /download 路由保留为合法入口，渲染此页 downloads tab。
watch(
  () => route.path,
  (p) => {
    if (p === '/download' && route.query.tab !== 'downloads') {
      void router.replace({ query: { ...route.query, tab: 'downloads' } });
    }
  },
  { immediate: true },
);
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
      <DownloadsPanel v-else-if="activeTab === 'downloads'" />
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
