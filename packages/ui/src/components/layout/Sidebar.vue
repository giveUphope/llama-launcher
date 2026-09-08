<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Icon from '@/components/common/Icon.vue';
import { useI18nStore } from '@/stores/i18n';
import { useSettingsStore } from '@/stores/settings';
import { APP_VERSION } from '@llama-launcher/shared';
import { navItems } from '@/features';

const i18n = useI18nStore();
const settings = useSettingsStore();
const router = useRouter();
const route = useRoute();
const collapsed = ref(settings.settings?.sidebar_collapsed ?? false);
watch(() => settings.settings?.sidebar_collapsed, (value) => {
  if (value !== undefined) collapsed.value = value;
});
function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  if (settings.settings) {
    settings.settings.sidebar_collapsed = collapsed.value;
    void settings.save();
  }
}

function navigate(key: string | number) {
  void router.push(String(key));
}
</script>

<template>
  <a-layout-sider class="sidebar" :collapsed="collapsed" :width="224" :collapsed-width="48" :hide-trigger="true">
    <!-- Arco 原生折叠体系即 48px：sider 与 a-menu 折叠宽保持默认一致（menu 折叠态样式按 48px 布局，
         强改 collapsed-width 会破坏 icon margin 布局导致收起/展开图标漂移，勿改） -->
    <a-menu :selected-keys="[route.path]" :collapse="collapsed" @menu-item-click="navigate">
      <a-menu-item v-for="item in navItems" :key="item.to">
        <template #icon><Icon :name="item.icon" /></template>
        {{ i18n.t(item.labelKey) }}
        <a-badge v-if="item.dot?.()" dot class="nav-dot" />
      </a-menu-item>
    </a-menu>
    <div class="sidebar-footer">
      <a-button type="text" size="small" @click="toggleCollapsed">
        <template #icon><Icon :name="collapsed ? 'chevron_right' : 'chevron_left'" /></template>
      </a-button>
      <a-typography-text v-if="!collapsed" type="secondary" class="version">v{{ APP_VERSION }}</a-typography-text>
    </div>
  </a-layout-sider>
</template>

<style scoped>
.sidebar {
  height: 100%;
  border-right: 1px solid var(--color-border);
}

.nav-dot {
  margin-left: auto;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  border-top: 1px solid var(--color-border);
  /* 展开动画窄宽阶段裁剪溢出，防按钮+版本号被 flex 压缩换行（历史：宽度过渡中版本号折行撑高 footer） */
  overflow: hidden;
}

.version {
  flex-shrink: 0; /* 不被 flex 压缩 */
  white-space: nowrap; /* 版本号保持单行 */
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}
</style>
