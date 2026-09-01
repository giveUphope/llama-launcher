<script setup lang="ts">
// 统一页面容器：内边距、纵向间距引用全局 layout 变量，
// 替代各页面里硬编码的 .page { padding / gap }。
</script>

<template>
  <div class="page-frame">
    <slot />
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

.page-frame {
  padding: $layout-page-padding;
  display: flex;
  flex-direction: column;
  // 分区风格：块间距由相邻区块的实线边框承担（Card 底边线），gap 归 0
  gap: 0;
  min-height: 0;
}
</style>
