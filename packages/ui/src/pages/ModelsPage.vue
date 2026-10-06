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
    <a-tabs class="page-tabs" :active-key="activeTab" @change="(k) => setTab(k as TabKey)">
      <a-tab-pane v-for="t in TABS" :key="t.key" :key-value="t.key">
        <template #title>
          <Icon :name="t.icon" :size="13" />
          <span>{{ i18n.t(t.labelKey) }}</span>
        </template>
      </a-tab-pane>
    </a-tabs>

    <div class="tab-content">
      <!-- 两个子面板都包进 KeepAlive：v-if 会在每次切子标签时销毁重建面板，组件局部 ref
           随之清空——「本地模型」丢的是体检徽章（刚花 1–3 分钟测出的 pp/tg），
           「模型库」丢的是 URL 解析结果、搜索结果、文件列表与勾选（得重新解析重新勾）。
           缓存 LibraryPanel 是安全的：DownloadCard 的订阅走 download store 的
           `ensureSubscribed()`（幂等防重入），不是「挂载即订阅、卸载才退订」的写法。
           include 按文件名匹配，同参数页 PresetsPanel 的既有范式。 -->
      <KeepAlive include="LocalModelsPanel,LibraryPanel">
        <component :is="activeTab === 'local' ? LocalModelsPanel : LibraryPanel" :key="activeTab" />
      </KeepAlive>
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
  // flex: 1 在 PageFrame 还不是弹性列时是死规则（STYLE_TODO #82）。骨架改成 flex 列后它会
  // 突然生效：模型表比可视区高时，本盒被压到可视高、里面的面板再被压一档 = 内容裁切。
  // 故写 1 0 auto：短内容时撑满剩余高度（与原意一致），长内容时保持自然高、交给 PageFrame 滚动。
  flex: 1 0 auto;
}
</style>
