<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';

const props = defineProps<{
  titleKey?: string;
  /** 可折叠卡片：卡片头整体成为切换钮，内容由调用方用 v-model:expanded 控制 */
  collapsible?: boolean;
  expanded?: boolean;
}>();
const emit = defineEmits<{ (e: 'update:expanded', value: boolean): void }>();

const i18n = useI18nStore();
const title = computed(() => (props.titleKey ? i18n.t(props.titleKey) : ''));
const isOpen = computed(() => (props.collapsible ? props.expanded !== false : true));

function toggle() {
  if (props.collapsible) emit('update:expanded', !isOpen.value);
}
</script>

<template>
  <a-card class="section-card" :bordered="true" :class="{ 'section-card--collapsed': props.collapsible && !isOpen }">
    <template v-if="titleKey || $slots.actions" #title>
      <!-- 折叠态的卡片头即切换钮：用 a-button 承载（全站按钮基座），标题文字与箭头同处一个
           可点击区域，不做「整行 div 挂 click」那种自定义交互控件 -->
      <a-button
        v-if="props.collapsible"
        class="section-card__toggle"
        type="text"
        size="medium"
        :aria-expanded="isOpen"
        @click="toggle"
      >
        <template #icon>
          <Icon class="section-card__chevron" :class="{ 'is-open': isOpen }" name="chevron_right" :size="12" />
        </template>
        {{ title }}
      </a-button>
      <a-space v-else>
        <span v-if="titleKey">{{ title }}</span>
        <slot name="title-extra" />
      </a-space>
    </template>
    <!-- 操作区统一 a-space（卡片头操作 gap 6px，§7.5.4）：按钮/计数等子元素间距由组件承载，
         避免各页面 actions 内容紧贴 -->
    <template v-if="$slots.actions" #extra>
      <a-space :size="6">
        <slot name="actions" />
      </a-space>
    </template>
    <slot v-if="isOpen" />
  </a-card>
</template>

<style scoped>
.section-card {
  margin-bottom: 16px;
}

/* 折叠时收起卡片体（Arco 仍会渲染带内距的 body，留白会露出一条空档） */
.section-card--collapsed :deep(.arco-card-body) {
  display: none;
}

.section-card__toggle {
  padding-left: 0;
  font-weight: inherit;
}

/* 箭头旋转而非换字形：与侧栏分组、参数分区的展开指示同一套动效语义 */
.section-card__chevron {
  transition: transform 0.15s ease;
}
.section-card__chevron.is-open {
  transform: rotate(90deg);
}
</style>
