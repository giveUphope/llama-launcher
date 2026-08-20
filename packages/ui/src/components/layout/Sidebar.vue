<script setup lang="ts">
import { computed } from 'vue';
import NavButton from '@/components/common/NavButton.vue';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';
import { useSettingsStore } from '@/stores/settings';
import { APP_VERSION } from '@llama-launcher/shared';
import { navItems } from '@/features';

const i18n = useI18nStore();
const settings = useSettingsStore();

// 侧边栏折叠（持久化到 settings.sidebar_collapsed；宽度过渡为用户主动触发的单次布局动画）
const collapsed = computed<boolean>({
  get: () => settings.settings?.sidebar_collapsed ?? false,
  set: (v) => {
    if (!settings.settings) return;
    settings.settings.sidebar_collapsed = v;
    void settings.save();
  },
});
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <nav class="nav-list">
      <!-- 侧栏导航由功能注册表（features）驱动：各功能声明 nav 条目，按 order 排序渲染 -->
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
        @click="collapsed = !collapsed"
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
  transition: width var(--dur-med) var(--ease-jelly);

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
  gap: 2px;
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
  color: var(--sidebar-fg-muted);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-jelly), color var(--dur-fast) var(--ease-jelly),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover {
    background: var(--sidebar-bg-hover);
    color: var(--sidebar-fg-primary);
  }

  &:active {
    transform: scale(0.9);
  }
}

.version {
  font-size: var(--fs-sm);
  color: var(--sidebar-fg-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}
</style>
