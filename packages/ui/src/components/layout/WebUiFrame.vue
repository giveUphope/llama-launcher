<script setup lang="ts">
// Web UI 内嵌帧（布局层常驻组件）。
// 关键设计：iframe 元素始终挂载在文档中，仅通过 v-show（display:none）切换显隐——
// display:none 不会销毁 iframe 的浏览上下文，因此从 Web UI 切到其他菜单页再切回时，
// 页面不会重新加载（若由 keep-alive 将组件 DOM 移出文档，iframe 会因浏览上下文销毁而重载）。
// 服务停止时清空 src（后端已不存在，页面需随重启重新加载）；服务运行中跨页切换 src 不变，保持原页面。
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useServerStore } from '@/stores/server';
import { useI18nStore } from '@/stores/i18n';
import Icon from '@/components/common/Icon.vue';

const route = useRoute();
const server = useServerStore();
const i18n = useI18nStore();

// 是否位于 /webui 路由（决定帧显隐）
const active = computed(() => route.path === '/webui');
const running = computed(() => server.status === 'running');
// API 地址统一取 server.apiUrl（单一来源）：running 返回实际地址（url 残留时回退推导）、
// starting 推导、stopped 返回空——下方面板同时保留 running 门控，双保险
const webUrl = computed(() => server.apiUrl);
</script>

<template>
  <div v-show="active" class="webui-frame">
    <iframe
      v-show="running && webUrl"
      :src="running ? webUrl : ''"
      class="webui-iframe"
      title="llama Web UI"
    />
    <!-- 服务未运行等待占位：改用 Arco Result 承载图标与提示文案 → -->
    <a-result v-if="!running" class="webui-placeholder" :sub-title="i18n.t('webui_not_running')">
      <template #icon><Icon name="globe" :size="44" /></template>
    </a-result>
  </div>
</template>

<style scoped lang="scss">
.webui-frame {
  position: absolute;
  inset: 0;
  z-index: 20; /* 覆盖内容区上层的页面内容 */
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}

.webui-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--bg-app); // 加载瞬间避免白/黑闪烁，内容加载后由 Web UI 自身背景覆盖
}

.webui-placeholder {
  flex: 1;
  // a-result 自带居中布局与次级文案样式，仅保证占满区域即可
  width: 100%;
  padding-top: 6vh; // 轻微上移视觉重心，与原居中提示保持一致
}
</style>
