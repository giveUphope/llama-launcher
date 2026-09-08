<script setup lang="ts">
// 阶段三：设置页「关于」分组 —— 版本号、项目仓库、llama.cpp 发布页入口。
// 设计稿 §14.10：检查更新（仓库未提供能力时不实现）放入此分组。
import { computed } from 'vue';
import Card from '@/components/common/Card.vue';
import Icon from '@/components/common/Icon.vue';
import AppLogo from '@/components/common/AppLogo.vue';
import { APP_NAME, APP_VERSION } from '@llama-launcher/shared';
import { useI18nStore } from '@/stores/i18n';

const i18n = useI18nStore();

const repoUrl = 'https://github.com/giveUphope/llama-launcher';
const releasesUrl = 'https://github.com/ggml-org/llama.cpp/releases';

const versionLabel = computed(() => `${APP_VERSION}`);

async function onOpenUrl(url: string) {
  try { await window.api.openExternal(url); } catch { /* 静默 */ }
}
</script>

<template>
  <Card title-key="nav_settings_about">
    <!-- 品牌头：应用 Logo + 名称 + 版本（Logo 与 TopBar/favicon 同源统一样式） -->
    <div class="about-brand">
      <AppLogo :size="40" />
      <div class="about-brand-text">
        <span class="about-app-name">{{ APP_NAME }}</span>
        <span class="about-app-version">v{{ versionLabel }}</span>
      </div>
    </div>
    <a-descriptions class="about-desc" :column="1" size="small" :align="{ label: 'right' }">
      <a-descriptions-item :label="i18n.t('msg_about_repo')">
        <a-button type="text" size="small" @click="onOpenUrl(repoUrl)">
          <template #icon><Icon name="external" :size="12" /></template>
          <span>{{ repoUrl }}</span>
        </a-button>
      </a-descriptions-item>
      <a-descriptions-item :label="i18n.t('msg_about_releases')">
        <a-button type="text" size="small" @click="onOpenUrl(releasesUrl)">
          <template #icon><Icon name="external" :size="12" /></template>
          <span>{{ releasesUrl }}</span>
        </a-button>
      </a-descriptions-item>
    </a-descriptions>
  </Card>
</template>

<style scoped lang="scss">
// 品牌头：Logo（40px 胶囊圆角，与 TopBar 同源组件）+ 应用名 + 版本
.about-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--color-border-2);
}

.about-brand-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about-app-name {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--color-text-1);
}

.about-app-version {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  color: var(--color-text-3);
}
</style>
