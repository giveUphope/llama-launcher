<script setup lang="ts">
// 阶段三：设置页「外观」分组 —— 主题、语言（视觉效果固定为默认玻璃形态，开关已移除）。
import { computed } from 'vue';
import Card from '@/components/common/Card.vue';
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
    <a-form :model="{}" layout="horizontal" label-align="right"
            :label-col-style="{ flex: '0 1 110px', minWidth: '64px', marginRight: '8px' }"
            :wrapper-col-style="{ flex: '1 1 0', minWidth: '0' }">
      <a-form-item :label="i18n.t('lbl_theme_mode')">
        <a-radio-group type="button" size="small" :model-value="themeMode" @change="(v: any) => (themeMode = v)">
          <a-radio v-for="opt in THEME_OPTIONS" :key="opt.value" :value="opt.value">
            {{ i18n.t(opt.labelKey) }}
          </a-radio>
        </a-radio-group>
      </a-form-item>
      <a-form-item :label="i18n.t('lbl_language')">
        <a-select class="fc-select" v-model="language" :style="{ width: '140px' }">
          <a-option value="zh">{{ i18n.t('opt_lang_zh') }}</a-option>
          <a-option value="en">{{ i18n.t('opt_lang_en') }}</a-option>
        </a-select>
      </a-form-item>
    </a-form>
  </Card>
</template>
