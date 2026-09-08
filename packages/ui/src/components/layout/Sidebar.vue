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
  <a-layout-sider class="sidebar" :collapsed="collapsed" :width="224" :collapsed-width="64" :hide-trigger="true">
    <!-- collapsed-width 对齐 sider（64px）：Arco menu 默认折叠宽 48px，与 sider 不一致会在折叠态右侧留 16px 空白 -->
    <a-menu :selected-keys="[route.path]" :collapse="collapsed" :collapsed-width="64" @menu-item-click="navigate">
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
}

.version {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}
</style>
