<script setup lang="ts">
// 阶段三：设置页「外观」分组 —— 主题、语言（视觉效果固定为默认玻璃形态，开关已移除）。
import { computed } from 'vue';
import Card from '@/components/common/Card.vue';
import { useSettingsStore } from '@/stores/settings';
import { useI18nStore } from '@/stores/i18n';
import { vInnerAriaLabel } from '@/directives/innerAriaLabel';
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
            :label-col-style="{ flex: '0 0 110px', minWidth: '0', marginRight: '8px', paddingRight: '0' }"
            :wrapper-col-style="{ flex: '1 1 0', minWidth: '0' }">
      <a-form-item :label="i18n.t('lbl_theme_mode')">
        <!-- 主题三选一：切换按钮组（选中 = primary 实底）——分段单选组的钮间分隔线是
             被淘汰的样式（STYLE_TODO 115 号，与日志页级别筛选同轮退役），组件间纯 gap 无线；
             Arco 的 primary 实底白字自身达标，无需再挂对比度修正（原 .theme-radio-on 随组删除） -->
        <div class="theme-filter" role="group" :aria-label="i18n.t('lbl_theme_mode')">
          <a-button
            v-for="opt in THEME_OPTIONS"
            :key="opt.value"
            size="small"
            :type="themeMode === opt.value ? 'primary' : 'secondary'"
            :aria-pressed="themeMode === opt.value"
            @click="themeMode = opt.value"
          >
            {{ i18n.t(opt.labelKey) }}
          </a-button>
        </div>
      </a-form-item>
      <a-form-item :label="i18n.t('lbl_language')" v-inner-aria-label="i18n.t('lbl_language')">
        <a-select class="fc-select" v-model="language" :aria-label="i18n.t('lbl_language')" :style="{ width: '140px' }">
          <a-option value="zh">{{ i18n.t('opt_lang_zh') }}</a-option>
          <a-option value="en">{{ i18n.t('opt_lang_en') }}</a-option>
        </a-select>
      </a-form-item>
    </a-form>
  </Card>
</template>

<style scoped lang="scss">
/* 主题切换按钮组：间距交 gap（分段组的钮间分隔线已随 #115 退役）。
   选中态 = primary 实底白字，Arco 官方预设自身达标（原 .theme-radio-on
   对比度修正已无宿主），零覆写 */
.theme-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
