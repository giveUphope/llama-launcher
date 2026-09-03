<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/common/Icon.vue';

const props = withDefaults(defineProps<{
  icon: string;
  label: string;
  to: string;
  collapsed: boolean;
  /** 显示小橙点提示（如参数有未保存调整） */
  dot?: boolean;
}>(), {
  dot: false,
});

const route = useRoute();

// 激活：path 命中（页内子标签经 query.tab 切换，不影响侧栏高亮）
const active = computed(() => route.path === props.to);
</script>

<template>
  <router-link
    :to="to"
    class="nav-btn"
    :class="{ active, collapsed }"
    :title="label"
    :aria-label="label"
  >
    <span class="nav-icon">
      <Icon :name="icon" :size="18" />
    </span>
    <span class="nav-label" v-if="!collapsed">{{ label }}</span>
    <span v-if="dot" class="nav-dot"></span>
  </router-link>
</template>

<style scoped lang="scss">
// 侧栏导航按钮：统一的字体、颜色、状态规划
// - 一级项：14px，fg-secondary → hover:fg-primary → active:bg-active + fg-active
.nav-btn {
  position: relative; // 收起态橙点角标的定位基准
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 16px;
  color: var(--sidebar-fg-secondary);
  text-decoration: none;
  border-radius: var(--radius-pill);
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth);
  white-space: nowrap;
  font-family: var(--font-family);
  font-size: var(--fs-lg);

  &:hover {
    background: var(--sidebar-bg-hover);
    color: var(--sidebar-fg-primary);
  }

  &.active {
    background: var(--sidebar-bg-active);
    color: var(--sidebar-fg-active);
  }

  &.collapsed {
    justify-content: center;
    padding: 0;
  }
}

.nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
}

.nav-label {
  font-size: var(--fs-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

// 小橙点：表示该页签存在调整（参数值改动或启用项变化）
// 始终显示，包括激活状态，便于用户在当前页也知道仍有未保存的调整
// 使用 --warn 橙色以区别于蓝色主题色，提高辨识度
.nav-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 12px;

  // 收起态：改为图标右上角标（脱离流式布局），不被侧栏 overflow 裁切、
  // 也不把图标挤离中心——橙点始终高于导轨遮罩可见
  .collapsed & {
    position: absolute;
    top: 5px;
    right: 6px;
    margin: 0;
  }

  // 激活状态下降低不透明度，避免与激活高亮冲突
  .active & {
    opacity: 0.6;
  }
}
</style>
