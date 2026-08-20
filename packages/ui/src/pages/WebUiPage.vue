<script setup lang="ts">
// Web UI 的实际渲染由布局层 WebUiFrame 承担（iframe 常驻文档，切页不重载）。
// 本页仅作为 /webui 路由的导航目标；内容区由 WebUiFrame（absolute 覆盖）呈现。
</script>

<template>
  <div class="webui-route" />
</template>

<style scoped lang="scss">
.webui-route {
  height: 100%;
}
</style>
