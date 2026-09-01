<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const hostEl = ref<HTMLElement | null>(null);
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 页面切换不使用 <transition>（leave/enter 交接窗口在 KeepAlive + 快速导航下
// 会短暂双页同框——旧页未卸载时新页已插入，用户可见"闪出其他页面内容"）。
// 改为结构化方案：keep-alive 直接替换组件（单激活实例，结构上无双页），
// 路由变化后对内容区整体做一次轻微淡入作为切换反馈。
// 动画用 WAAPI 由代码控制（reduced-motion 下跳过），无事件依赖。
watch(
  () => route.fullPath,
  async () => {
    await nextTick();
    const el = hostEl.value;
    if (!el || reducedMotion) return;
    el.animate(
      [{ opacity: 0.55 }, { opacity: 1 }],
      { duration: 90, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
    );
  },
);
</script>

<template>
  <div ref="hostEl" class="page-host">
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
</template>

<style scoped lang="scss">
.page-host {
  min-width: 0;
  min-height: 0;
}
</style>
