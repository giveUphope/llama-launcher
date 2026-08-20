<script setup lang="ts">
import TopBar from './TopBar.vue';
import Sidebar from './Sidebar.vue';
import StatusBar from './StatusBar.vue';
import PageHost from './PageHost.vue';
import WebUiFrame from './WebUiFrame.vue';
</script>

<template>
  <div class="app-layout">
    <TopBar />
    <div class="app-body">
      <Sidebar />
      <main class="app-content">
        <PageHost />
        <!-- Web UI 内嵌帧常驻文档（v-show 切换显隐，iframe 不随路由切页销毁/重载） -->
        <WebUiFrame />
      </main>
    </div>
    <StatusBar />
  </div>
</template>

<style scoped lang="scss">
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.app-content {
  position: relative; /* WebUiFrame 绝对定位铺满内容区 */
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  /* 透明底：让单玻璃层（surface.scss .glass-layer）的模糊斑块透出 */
  background: transparent;
}
</style>
