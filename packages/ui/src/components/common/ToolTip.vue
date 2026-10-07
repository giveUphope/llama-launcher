<script setup lang="ts">
/**
 * 全站统一提示浮层。配色与定位全部交给 a-tooltip 的官方 props：
 * `content` 传文本、`content-class` 挂多行换行、`position` / `disabled` 由调用方选。
 * 不再包一层 `<span class="tooltip-text">`——那等于在库的内容节点里再自造一个排版层。
 */
withDefaults(
  defineProps<{
    text: string;
    position?: 'top' | 'tl' | 'tr' | 'lt' | 'lb' | 'left' | 'right' | 'rt' | 'rb' | 'bl' | 'br';
    disabled?: boolean;
  }>(),
  { position: 'top', disabled: false },
);
</script>

<template>
  <a-tooltip
    :content="text"
    :position="position"
    :disabled="disabled"
    :mini="true"
    content-class="fc-tooltip-multiline"
  >
    <span class="tooltip-host"><slot /></span>
  </a-tooltip>
</template>

<style>
/* 浮层文本带 \n（标签 / 值 / 操作提示三段），Arco 默认 white-space: normal 会把换行折成空格。
   弹层由 a-tooltip 传送到 body，scoped 选择器够不到它，故走官方 content-class 钩子 +
   非 scoped 块；类名是本组件私有（fc- 前缀），不会命中其他组件的浮层（§7.5.6）。 */
.fc-tooltip-multiline {
  white-space: pre-line;
}
</style>

<style scoped>
.tooltip-host {
  display: inline-flex;
  min-width: 0;
}
</style>
