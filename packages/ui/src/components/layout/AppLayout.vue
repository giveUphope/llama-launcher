<script setup lang="ts">
import TopBar from './TopBar.vue';
import Sidebar from './Sidebar.vue';
import StatusBar from './StatusBar.vue';
import PageHost from './PageHost.vue';
import WebUiFrame from './WebUiFrame.vue';
</script>

<template>
  <a-layout class="app-layout">
    <TopBar />
    <a-layout class="app-body">
      <Sidebar />
      <a-layout-content class="app-content">
        <PageHost />
        <WebUiFrame />
      </a-layout-content>
    </a-layout>
    <StatusBar />
  </a-layout>
</template>

<style scoped>
.app-layout {
  height: 100%;
  overflow: hidden;
}

.app-body {
  min-height: 0;
  overflow: hidden;
}

.app-content {
  position: relative;
  min-width: 0;
  min-height: 0;
  /* 页面骨架的确定高度从这里开始：Arco 已给 .arco-layout-content flex:1（父 .app-body 高有定值），
     再补 flex 列，子层 .page-host / .page-frame 的 flex:1 才能解析出真实高度（STYLE_TODO #82）。
     overflow 由 auto 改 hidden：纵向滚动下移到 .page-frame 内部，长页面不再把外层撑出滚动条。 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-fill-1);
}
</style>
