<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/common/Icon.vue';

const props = withDefaults(defineProps<{
  icon: string;
  label: string;
  to: string;
  collapsed: boolean;
  child?: boolean;
  /** 显示小橙点：表示该页签存在未保存的调整 */
  dot?: boolean;
}>(), {
  child: false,
  dot: false,
});

const route = useRoute();
const active = computed(() => route.path === props.to);
</script>

<template>
  <router-link :to="to" class="nav-btn" :class="{ active, collapsed, child }">
    <span class="nav-icon">
      <Icon :name="icon" :size="18" />
    </span>
    <span class="nav-label" v-if="!collapsed">{{ label }}</span>
    <span v-if="dot" class="nav-dot"></span>
  </router-link>
</template>

<style scoped lang="scss">
// 侧边栏导航按钮：统一的字体、颜色、状态规划
// - 一级项：14px，fg-secondary → hover:fg-primary → active:accent
// - 二级子项：13px，fg-muted → hover:fg-primary → active:accent
.nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 16px;
  color: var(--sidebar-fg-secondary);
  text-decoration: none;
  border-radius: var(--radius-pill);
  transition: background var(--dur-fast) var(--ease-jelly), color var(--dur-fast) var(--ease-jelly);
  white-space: nowrap;
  font-family: var(--font-family);
  font-size: var(--fs-lg);

  &:hover {
    background: var(--sidebar-bg-hover);
    color: var(--sidebar-fg-primary);
  }

  &.active {
    background: var(--sidebar-bg-active);
    color: var(--accent);
  }

  &.collapsed {
    justify-content: center;
    padding: 0;
  }

  // 二级导航项：缩进 + 更小字号
  &.child {
    padding-left: 40px;
    height: 34px;
    font-size: var(--fs-md);
    color: var(--sidebar-fg-muted);

    .nav-icon {
      width: 16px;
      opacity: 0.85;
    }

    &:hover {
      color: var(--sidebar-fg-primary);
    }

    &.active {
      color: var(--accent);
      background: var(--sidebar-bg-active);
    }
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

  // 二级子项的小橙点位置调整
  .child & {
    margin-right: 16px;
  }

  // 激活状态下降低不透明度，避免与激活高亮冲突
  .active & {
    opacity: 0.6;
  }
}
</style>
