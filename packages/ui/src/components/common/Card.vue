<script setup lang="ts">
import { computed } from 'vue';
import { useI18nStore } from '@/stores/i18n';

const props = defineProps<{
  titleKey?: string;
}>();

const i18n = useI18nStore();
const title = computed(() => (props.titleKey ? i18n.t(props.titleKey) : ''));
</script>

<template>
  <section class="card">
    <header v-if="titleKey || $slots.actions" class="card-header">
      <div class="accent-bar"></div>
      <h2 v-if="titleKey" class="card-title">
        <span>{{ title }}</span>
        <!-- 标题文字右侧的附加内容（如帮助图标）；flex 布局内联紧跟标题，不换行 -->
        <slot name="title-extra" />
      </h2>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card-body">
      <slot />
    </div>
  </section>
</template>

<style scoped lang="scss">
.card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
  /* hover 用边框高亮而非 transform 上浮：transform 会提升合成层，鼠标扫过成排卡片时
     文字重栅格化出现明显闪烁（"整体浮动"感） */
  transition: border-color var(--dur-med) var(--ease-jelly);
  /* 不设 overflow: hidden —— 否则卡片内的下拉面板(如并发选择器)超出卡片时会被裁切。
     圆角裁切改由 .card-header 自身负责。 */

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--glass-border));
  }
}

.card-header {
  height: 38px;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--glass-border);
  background: transparent;
  /* 仅 header 裁切:让 accent-bar / 标题背景贴合卡片顶部圆角 */
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  overflow: hidden;
}

.accent-bar {
  width: 3px;
  flex: 0 0 3px;
  /* 装饰条跟随 --hue（.hue-cycle 容器内循环彩虹；默认 --hue=220deg 即强调蓝） */
  background: hsl(var(--hue, 220deg) 90% 60%);
}

.card-title {
  margin: 0;
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--fg-primary);
}

.card-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 8px;
}

.card-body {
  padding: 14px 16px;
}
</style>
