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
  overflow: auto;
  background: var(--color-fill-1);
}
</style>
