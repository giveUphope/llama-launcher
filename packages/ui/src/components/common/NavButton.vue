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
  /** 子项专属：路由 query.tab 值（path 命中后再按 query 子匹配高亮） */
  tab?: string;
  /** 子项专属：页面未带 tab query 时的默认高亮子项 */
  isDefault?: boolean;
  /** 一级项专属：含子标签，右侧显示展开箭头 */
  expandable?: boolean;
  /** 一级项专属：子树当前是否展开（箭头方向） */
  expanded?: boolean;
}>(), {
  child: false,
  dot: false,
  tab: undefined,
  isDefault: false,
  expandable: false,
  expanded: false,
});

const emit = defineEmits<{ toggle: [] }>();

const route = useRoute();

// 一级项激活：path 命中；子项激活：path 命中 + (query.tab 精确匹配 | 无 query 时为默认项)
const active = computed(() => {
  if (!props.child) return route.path === props.to;
  if (route.path !== props.to) return false;
  const t = route.query.tab;
  if (t === undefined || t === '') return props.isDefault;
  return String(t) === props.tab;
});

// 子项点击目标：写入 query.tab；一级项保持纯 path
const target = computed(() =>
  props.child && props.tab ? { path: props.to, query: { tab: props.tab } } : props.to,
);

// 一级项点击：未激活 → 路由跳转（Sidebar 监听后自动展开子树）；
// 已激活 → 切换展开/收起（避免重复跳转无意义）
function handleClick() {
  if (props.expandable && route.path === props.to) {
    emit('toggle');
  }
}
</script>

<template>
  <router-link
    :to="target"
    class="nav-btn"
    :class="{ active, collapsed, child }"
    :title="label"
    :aria-label="label"
    @click="handleClick"
  >
    <span class="nav-icon">
      <Icon :name="icon" :size="18" />
    </span>
    <span class="nav-label" v-if="!collapsed">{{ label }}</span>
    <span v-if="dot" class="nav-dot"></span>
    <span
      v-if="expandable && !collapsed"
      class="nav-chevron"
      @click.stop="emit('toggle')"
      :title="expanded ? label : label"
    >
      <Icon :name="expanded ? 'chevron_down' : 'chevron_right'" :size="14" />
    </span>
  </router-link>
</template>

<style scoped lang="scss">
// 侧边栏导航按钮：统一的字体、颜色、状态规划
// - 一级项：14px，fg-secondary → hover:fg-primary → active:bg-active + fg-active
// - 二级子项：13px，fg-muted → hover:fg-primary → active:bg-active + fg-active
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

    // 收起态子项：与主项一致居中（覆盖缩进，避免 40px padding 把图标推出 56px 导轨被裁切）
    &.collapsed {
      padding-left: 0;
    }

    &:hover {
      color: var(--sidebar-fg-primary);
    }

    &.active {
      color: var(--sidebar-fg-active);
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

  // 收起态：改为图标右上角标（脱离流式布局），不被侧栏 overflow 裁切、
  // 也不把图标挤离中心——橙点始终高于导轨遮罩可见
  .collapsed & {
    position: absolute;
    top: 5px;
    right: 6px;
    margin: 0;
  }

  // 二级子项的小橙点位置调整
  .child & {
    margin-right: 16px;

    // 子项角标随 34px 行高微调（margin 重置，避免 .child 的 margin-right 偏移角标）
    .collapsed & {
      top: 4px;
      right: 8px;
      margin: 0;
    }
  }

  // 激活状态下降低不透明度，避免与激活高亮冲突
  .active & {
    opacity: 0.6;
  }
}

// 一级项的子树展开箭头：hover 高亮，激活态随主项文字取色
.nav-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-mini);
  color: var(--sidebar-fg-muted);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth);

  &:hover {
    background: var(--sidebar-bg-hover);
    color: var(--sidebar-fg-primary);
  }

  .active & {
    color: var(--sidebar-fg-active);
  }
}
</style>