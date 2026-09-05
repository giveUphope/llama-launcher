<script setup lang="ts">
import { ref, watch } from 'vue';
import NavButton from '@/components/common/NavButton.vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';
import { useSettingsStore } from '@/stores/settings';
import { APP_VERSION } from '@llama-launcher/shared';
import { navItems } from '@/features';

const i18n = useI18nStore();
const settings = useSettingsStore();

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
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <nav class="nav-list">
      <!-- 侧栏导航由功能注册表（features）驱动：各功能声明 nav 条目，按 order 排序渲染。
           一级项不再有子树展开——次级页面统一回归页内 tab-strip 切换（如参数设置） -->
      <NavButton
        v-for="item in navItems"
        :key="item.to"
        :icon="item.icon"
        :label="i18n.t(item.labelKey)"
        :to="item.to"
        :collapsed="collapsed"
        :dot="item.dot ? item.dot() : false"
      />
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
  /* 层级压到内容区之下：右侧内容区（.app-content, z-index 1）的浮层/气泡不被侧栏遮罩 */
  z-index: 0;
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
