<script setup lang="ts">
import { ref } from 'vue';
import { useI18nStore } from '@/stores/i18n';
import Icon from '@/components/common/Icon.vue';

const props = withDefaults(defineProps<{
  /** 子分组 i18n 标签 key（通过 subcat_<key> 查找） */
  subcategoryKey: string;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
}>(), {
  defaultExpanded: true,
});

const i18n = useI18nStore();
const expanded = ref(props.defaultExpanded);
</script>

<template>
  <div class="collapsible-section">
    <button class="section-header" @click="expanded = !expanded">
      <Icon :name="expanded ? 'chevron_down' : 'chevron_right'" :size="12" class="section-arrow" />
      <span class="section-title">{{ i18n.t(`subcat_${subcategoryKey}`) }}</span>
    </button>
    <transition name="collapse">
      <div v-if="expanded" class="section-body">
        <slot />
      </div>
    </transition>
  </div>
</template>

<style scoped lang="scss">
.collapsible-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 4px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--glass-border);
  cursor: pointer;
  color: var(--fg-secondary);
  font-size: var(--fs-base);
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: color var(--dur-fast) var(--ease-jelly);

  &:hover {
    color: var(--fg-primary);
  }
}

.section-arrow {
  /* 跟随分区 --hue（.hue-cycle 容器内循环彩虹取色） */
  color: hsl(var(--hue, 220deg) 90% 60%);
  flex-shrink: 0;
  transition: transform var(--dur-med) var(--ease-jelly);
}

.section-title {
  flex: 1;
}

.section-body {
  // 两列网格布局提升空间利用率，窄屏自动降为单列
  // 使用 minmax + clamp 动态计算列数：宽屏最多两列，窄屏自动单列
  // 920px = 两列最小宽度（460×2）+ gap（14px）
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 14px;
  padding-top: 4px;

  // 窄屏（内容区 < 920px）降为单列，避免参数行被挤压
  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
}

// 展开/收起：只动 opacity/transform（v-if 切换，状态存于 store 不受影响）
.collapse-enter-active,
.collapse-leave-active {
  transition: opacity var(--dur-med) var(--ease-jelly), transform var(--dur-med) var(--ease-jelly);
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
