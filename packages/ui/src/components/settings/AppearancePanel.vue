<script setup lang="ts">
// 阶段三：设置页「外观」分组 —— 主题、语言（视觉效果固定为默认玻璃形态，开关已移除）。
import { computed } from 'vue';
import Card from '@/components/common/Card.vue';
import InfoStrip from '@/components/common/InfoStrip.vue';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import type { ThemeMode, Language } from '@llama-launcher/shared';

const settings = useSettingsStore();
const i18n = useI18nStore();

// 主题三选一段式按钮（深色 / 浅色 / 跟随系统）
const THEME_OPTIONS: Array<{ value: ThemeMode; labelKey: string }> = [
  { value: 'dark', labelKey: 'opt_theme_dark' },
  { value: 'light', labelKey: 'opt_theme_light' },
  { value: 'system', labelKey: 'opt_theme_system' },
];

const themeMode = computed<ThemeMode>({
  get: () => settings.themeMode,
  set: (v) => { settings.themeMode = v; settings.applyTheme(); void settings.save(); },
});
const language = computed<Language>({
  get: () => settings.language,
  set: (v) => { settings.language = v; void settings.save(); },
});
</script>

<template>
  <Card title-key="nav_settings_appearance">
    <InfoStrip :label="i18n.t('lbl_theme_mode')">
      <div class="theme-picker" role="radiogroup" :aria-label="i18n.t('lbl_theme_mode')">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.value"
          class="theme-opt"
          :class="{ active: themeMode === opt.value }"
          role="radio"
          :aria-checked="themeMode === opt.value"
          @click="themeMode = opt.value"
        >
          {{ i18n.t(opt.labelKey) }}
        </button>
      </div>
    </InfoStrip>
    <InfoStrip :label="i18n.t('lbl_language')">
      <select class="settings-select" v-model="language">
        <option value="zh">{{ i18n.t('opt_lang_zh') }}</option>
        <option value="en">{{ i18n.t('opt_lang_en') }}</option>
      </select>
    </InfoStrip>
  </Card>
</template>

<style scoped lang="scss">
.theme-picker {
  display: inline-flex;
  gap: 4px;
  padding: 4px; // 与全局 .tab-strip 胶囊条间距一致（§7.5 选项间距统一；原 3px 微间距已归一到 4px）
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  flex-wrap: nowrap;
}

.theme-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  border: none;
  background: transparent;
  color: var(--fg-secondary);
  font-size: var(--fs-md);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth),
    transform var(--dur-fast) var(--ease-jelly);

  &:hover:not(.active) {
    background: var(--bg-hover);
    color: var(--fg-primary);
  }


  &.active {
    background: var(--primary-bg);
    color: var(--primary-fg);
    font-weight: 600;
  }
}

.settings-select {
  min-width: 140px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--fg-primary);
  font-size: var(--fs-md);
  &:focus { border-color: var(--accent); outline: none; }
}
</style>
