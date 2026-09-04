<script setup lang="ts">
// 水平 label-value 信息行：替代 SettingsPage 的 .form-row + .field-label 重复模式。
// 用法：
//   <InfoStrip label="引擎目录" :value="llamaDir" mono />
//   <InfoStrip :label="t('lbl_theme_mode')"> <select ...> </InfoStrip>
//
// variant：default（fg-primary 正文）/ mono（等宽，路径/数值）/ warn / success / muted
// boxed：值盒变体——内容装入统一文本框（高 26px、胶囊、bg-input + 边框、内容省略截断），
// 用于状态卡等需要"值盒化"展示的内容项；宽度在行内 flex:1 填满（等列）。
interface Props {
  label: string;
  value?: string;
  variant?: 'default' | 'mono' | 'warn' | 'success' | 'muted';
  boxed?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  boxed: false,
});
</script>

<template>
  <div class="info-strip">
    <label class="info-label">
      <slot name="label">{{ props.label }}</slot>
    </label>
    <div class="info-value" :class="[props.variant, { boxed: props.boxed }]">
      <template v-if="props.value">{{ props.value }}</template>
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.info-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 24px;
  line-height: 1.4; // 紧凑表单行（§7.5.1 行高语义化），不依赖字体默认 normal
}

.info-label {
  flex: 0 1 110px;
  min-width: 64px;
  text-align: right;
  color: var(--fg-secondary);
  font-size: var(--fs-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-base);
  color: var(--fg-primary);

  // 值盒变体：统一内容文本框（宽高/样式全库一致，见 §7.5.4 值盒标准）
  &.boxed {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    overflow: hidden;
    white-space: nowrap;
  }

  &.mono {
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.warn { color: var(--warn-text); }
  &.success { color: var(--success-text); }
  &.muted { color: var(--fg-muted); }
}
</style>

<style>
/* 表单信息行垂直堆叠间距（设置页面板多行 InfoStrip 直接堆叠在 .card-body 内）：
   4px 与参数设置页 .param-grid 行距（gap: 4px 14px）一致（§7.5.4 间距刻度），
   InfoStrip 与 ParamRow 同为 24px 紧凑表单行高。
   grid/行内布局（DashboardPage .q-grid、ServicePage .api-row/.runtime-details）
   中 InfoStrip 非 .card-body 直接子节点，不受此规则影响。 */
.card-body > .info-strip + .info-strip {
  margin-top: 4px;
}
</style>
