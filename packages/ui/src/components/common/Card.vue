<script setup lang="ts">
import { computed } from 'vue';
import { useI18nStore } from '@/stores/i18n';

const props = defineProps<{
  titleKey?: string;
}>();

const i18n = useI18nStore();
const title = computed(() => (props.titleKey ? i18n.t(props.titleKey) : ''));
</script>

<template>
  <section class="card">
    <header v-if="titleKey || $slots.actions" class="card-header">
      <h2 v-if="titleKey" class="card-title">
        <!-- 文本描述优先：标题文字在前，附加元素（帮助图标等）跟后 -->
        <span>{{ title }}</span>
        <slot name="title-extra" />
      </h2>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card-body">
      <slot />
    </div>
  </section>
</template>

<style scoped lang="scss">
// 分区风格：内容区块由实线分隔（而非玻璃卡片）。块间依赖相邻区块底边框，
// 页面容器 gap 为 0（见 page-frame / 各页 .tab-content），最后一块去掉底边线。
.card {
  background: transparent;
  border-radius: 0;
  border-bottom: 1px solid var(--border);
  transition: none;

  &:hover {
    border-color: var(--border); // 分区风格下无 hover 边框变化
  }

  &:last-child {
    border-bottom: none;
  }
}

.card-header {
  height: 38px;
  display: flex;
  align-items: center;
  background: transparent;
  border-radius: 0;
  overflow: visible;
}

.card-title {
  margin: 0;
  padding: 0 0 0 2px;
  display: flex;
  align-items: center;
  flex: 1;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--fg-primary);
  min-width: 0;
  letter-spacing: 0.2px;
}

.card-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-body {
  padding: 10px 0 14px;
}
</style>