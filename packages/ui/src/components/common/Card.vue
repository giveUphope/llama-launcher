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
           可点击区域，不做「整行 div 挂 click」那种自定义交互控件。
           钮外套真 <h2>（WAI-ARIA APG 手风琴的写法：标题包按钮，不是把 heading 角色塞进按钮——
           那会吃掉按钮语义），读屏按 H 键能在各卡片小节之间跳转（STYLE_TODO #92） -->
      <h2 v-if="props.collapsible" class="section-card__title">
        <a-button class="section-card__toggle" type="text" size="medium" :aria-expanded="isOpen" @click="toggle">
          <template #icon>
            <Icon class="section-card__chevron" :class="{ 'is-open': isOpen }" name="chevron_right" :size="12" />
          </template>
          {{ title }}
        </a-button>
      </h2>
      <a-space v-else>
        <h2 v-if="titleKey" class="section-card__title">{{ title }}</h2>
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

/* 卡片小节标题就是这一区的 <h2>（每页唯一的 <h1> 由 PageHost 给，STYLE_TODO #92）。
   字号/字重/行高一律继承 Arco 卡片头自己那一条声明（`.arco-card-header-title` 实测 16px / 500 /
   1.5715），不另造一档标题字号；UA 给 h2 的上下外边距（0.83em）与 bold 必须归零与继承，
   否则卡片头会比改前高出一档（卡片高度是 #81/#82 的硬判据）。 */
.section-card__title {
  margin: 0;
  font: inherit;
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
  transition: transform var(--dur-fast) var(--ease-smooth);
}
.section-card__chevron.is-open {
  transform: rotate(90deg);
}
</style>
