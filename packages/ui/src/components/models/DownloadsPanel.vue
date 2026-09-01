<script setup lang="ts">
// 下载任务列表面板：Models 页「下载任务」子标签 + 旧路由 /download 复用。
// 行为与原 DownloadPage.vue 完全一致；仅把数据/事件抽出为独立组件。
import { computed } from 'vue';
import PageFrame from '@/components/common/PageFrame.vue';
import DownloadCard from '@/components/common/DownloadCard.vue';
import Icon from '@/components/common/Icon.vue';
import { useDownloadStore } from '@/stores/download';
import { useI18nStore } from '@/stores/i18n';

const store = useDownloadStore();
const i18n = useI18nStore();

const activeCount = computed(() => store.tasks.filter((t) => t.status === 'downloading' || t.status === 'queued').length);
const completedCount = computed(() => store.tasks.filter((t) => t.status === 'completed').length);
const errorCount = computed(() => store.tasks.filter((t) => t.status === 'error').length);

function onClearFinished() {
  store.clearFinished();
}
</script>

<template>
  <PageFrame>
    <div class="status-bar">
      <div class="stat">
        <Icon name="download" :size="14" />
        <div class="stat-body">
          <span class="stat-value">{{ store.tasks.length }}</span>
          <span class="stat-label">{{ i18n.t('lbl_total_tasks') }}</span>
        </div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <Icon name="refresh" :size="14" />
        <div class="stat-body">
          <span class="stat-value">{{ activeCount }}</span>
          <span class="stat-label">{{ i18n.t('lbl_active_tasks') }}</span>
        </div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <Icon name="check_circle" :size="14" />
        <div class="stat-body">
          <span class="stat-value">{{ completedCount }}</span>
          <span class="stat-label">{{ i18n.t('lbl_completed_tasks') }}</span>
        </div>
      </div>
      <div v-if="errorCount" class="stat-divider"></div>
      <div v-if="errorCount" class="stat error">
        <Icon name="alert" :size="14" />
        <div class="stat-body">
          <span class="stat-value">{{ errorCount }}</span>
          <span class="stat-label">{{ i18n.t('lbl_failed_tasks') }}</span>
        </div>
      </div>
      <div class="status-right">
        <button class="action-btn" :disabled="!completedCount && !errorCount" @click="onClearFinished"
                :title="i18n.t('btn_clear_finished')">
          <Icon name="trash" :size="12" />
          <span>{{ i18n.t('btn_clear_finished') }}</span>
        </button>
      </div>
    </div>
    <DownloadCard mode="tasks" />
  </PageFrame>
</template>

<style scoped lang="scss">
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
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

  &.error .stat-value {
    color: var(--danger);
  }
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
}

.stat-label {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: var(--border);
}

.status-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
