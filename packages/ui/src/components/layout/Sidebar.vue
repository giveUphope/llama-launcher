<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import NavButton from '@/components/common/NavButton.vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';
import { useSettingsStore } from '@/stores/settings';
import { APP_VERSION } from '@llama-launcher/shared';
import type { NavItem } from '@/features';
import { navItems } from '@/features';

const i18n = useI18nStore();
const settings = useSettingsStore();
const route = useRoute();

// 折叠状态：本地 ref 兜底（settings 未加载/浏览器预览时也可点击切换），
// settings 就绪后双向同步并持久化（sidebar_collapsed）；展开/收起为单次布局过渡（§7.5.7 例外）
const collapsed = ref<boolean>(settings.settings?.sidebar_collapsed ?? false);
watch(
  () => settings.settings?.sidebar_collapsed,
  (v) => { if (v !== undefined && v !== collapsed.value) collapsed.value = v; },
);

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  if (settings.settings) {
    settings.settings.sidebar_collapsed = collapsed.value;
    void settings.save();
  }
}

// ---- 一级项子树展开/收起 ----
// 手动切换状态优先；未手动操作时按激活态自动展开（导航到该项即展开子树）
const expandedMap = reactive<Record<string, boolean>>({});

function isExpanded(item: NavItem): boolean {
  if (!item.children?.length) return false;
  if (expandedMap[item.to] !== undefined) return expandedMap[item.to];
  return route.path === item.to;
}

function toggleExpand(item: NavItem) {
  expandedMap[item.to] = !isExpanded(item);
}

// 路由落到带子标签的项时自动展开（含旧书签直达 /params 等场景）
watch(() => route.path, (p) => {
  const item = navItems.find((n) => n.to === p && n.children?.length);
  if (item) expandedMap[item.to] = true;
});
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <nav class="nav-list">
      <!-- 侧栏导航由功能注册表（features）驱动：各功能声明 nav 条目，按 order 排序渲染 -->
      <template v-for="item in navItems" :key="item.to">
        <NavButton
          :icon="item.icon"
          :label="i18n.t(item.labelKey)"
          :to="item.to"
          :collapsed="collapsed"
          :dot="item.dot ? item.dot() : false"
          :expandable="!!item.children?.length"
          :expanded="isExpanded(item)"
          @toggle="toggleExpand(item)"
        />
        <!-- 子树：展开时渲染子项（子项以 query.tab 控制页内内容）；
             收起态同样渲染（icon-only），保证下级标签入口与橙点不丢失 -->
        <div v-if="item.children?.length && isExpanded(item)" class="nav-sub" :class="{ compact: collapsed }">
          <NavButton
            v-for="c in item.children"
            :key="c.tab"
            child
            :icon="c.icon"
            :label="i18n.t(c.labelKey)"
            :to="item.to"
            :collapsed="collapsed"
            :tab="c.tab"
            :is-default="!!c.default"
            :dot="c.dot ? c.dot() : false"
          />
        </div>
      </template>
    </nav>
    <div class="sidebar-footer">
      <button
        class="collapse-btn"
        :title="i18n.t(collapsed ? 'sidebar_expand' : 'sidebar_collapse')"
        :aria-label="i18n.t(collapsed ? 'sidebar_expand' : 'sidebar_collapse')"
        @click="toggleCollapsed"
      >
        <Icon :name="collapsed ? 'chevron_right' : 'chevron_left'" :size="14" />
      </button>
      <span v-if="!collapsed" class="version">v{{ APP_VERSION }}</span>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  width: var(--sidebar-w);
  flex: 0 0 var(--sidebar-w);
  display: flex;
  flex-direction: column;
  // 侧边栏恒为深色玻璃（两种主题一致）
  background: var(--glass-sidebar);
  border-right: 1px solid var(--glass-sidebar-border);
  overflow: hidden;
  // 折叠宽度：用户主动触发的单次布局过渡（§7.5.7 例外）
  transition: width var(--dur-med) var(--ease-smooth);

  &.collapsed {
    width: var(--sidebar-w-collapsed);
    flex-basis: var(--sidebar-w-collapsed);
  }
}

.nav-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

// 一级项下的子树：子项间距与主项区一致（4px 刻度），缩进区分层级
.nav-sub {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 4px;
  padding-left: 8px;

  // 收起态：icon-only 子项与主项同宽居中（无缩进，56px 导轨内不裁切）
  &.compact {
    padding-left: 0;
  }
}

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--glass-sidebar-border);
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: none;
  border: none;
  // 灰底白字：深灰侧栏上使用亮灰文字，hover 提白
  color: var(--sidebar-fg-secondary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--sidebar-bg-hover);
    color: var(--sidebar-fg-primary);
  }

}

.version {
  font-size: var(--fs-sm);
  color: var(--sidebar-fg-secondary);
  font-family: var(--font-mono);
  white-space: nowrap;
}
</style>
