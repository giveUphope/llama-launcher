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
    <a-menu
      :selected-keys="[route.path]"
      :collapse="collapsed"
      role="navigation"
      :aria-label="i18n.t('a11y_main_nav')"
      @menu-item-click="navigate"
    >
      <!-- Arco a-menu-item 渲染为无 tabindex / 无 role / 无键盘处理的 DIV（es/menu/item.js），
           鼠标可用但 Tab 与读屏完全到不了：语义与按键由 attrs 透传补（item.js 把 $attrs 并到
           .arco-menu-item 根节点上），导航仍走既有 navigate，不另起一套路由 -->
      <a-menu-item
        v-for="item in navItems"
        :key="item.to"
        role="link"
        tabindex="0"
        :aria-current="item.to === route.path ? 'page' : undefined"
        @keydown.enter.prevent="navigate(item.to)"
        @keydown.space.prevent="navigate(item.to)"
      >
        <template #icon><Icon :name="item.icon" /></template>
        {{ i18n.t(item.labelKey) }}
        <!-- 红点提示（有未保存改动）：Arco a-badge 的 dot 渲染要求 count>0，
             纯 dot 无 count 时 countValue=NaN 会落到 number 分支显示「NaN」（源码 getDot 判定） -->
        <a-badge v-if="item.dot?.()" :count="1" dot class="nav-dot" />
      </a-menu-item>
    </a-menu>
    <div class="sidebar-footer">
      <a-button
        type="text"
        size="small"
        :aria-label="collapsed ? i18n.t('sidebar_expand') : i18n.t('sidebar_collapse')"
        @click="toggleCollapsed"
      >
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

/* Arco 2.58 的焦点样式只覆盖 .arco-menu 根节点与菜单里的 a 标签（es/menu/style/index.css 的 3 处
   focus 规则即 .arco-menu:focus-visible / .arco-menu a:focus / .arco-menu-item-tooltip a:focus），
   菜单项本身是 DIV，聚焦后实测 box-shadow: none、outline-style: none —— 补了 tabindex 就必须自带
   焦点环，否则键盘用户只知道能停却不知道停在哪；环宽与取色沿用 Arco 按钮的 focus-visible 约定 */
:deep(.arco-menu-item:focus-visible) {
  box-shadow: 0 0 0 0.25em rgb(var(--primary-3));
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

  /* 折叠切换动画中禁止子项收缩：宽度过渡不足时整体居中溢出裁剪（渐进露出），
     而非压缩按钮/图标变形重叠 */
  > * {
    flex-shrink: 0;
  }
}

.version {
  flex-shrink: 0; /* 不被 flex 压缩 */
  white-space: nowrap; /* 版本号保持单行 */
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}
</style>
