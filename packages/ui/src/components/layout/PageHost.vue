<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

// 页面切换不使用 <transition>（leave/enter 交接窗口在 KeepAlive + 快速导航下
// 会短暂双页同框——旧页未卸载时新页已插入，用户可见"闪出其他页面内容"）。
// 改为结构化方案：keep-alive 直接替换组件（单激活实例，结构上无双页），
// 路由变化后给内容区一次轻微淡入作为切换反馈。
// 淡入是 CSS 动画而不是 WAAPI：reduced-motion 由 reset.scss 的全局规则统一关停，
// 不需要在 setup 期读一次 matchMedia 快照（快照在系统偏好中途变化时就失效了）。
// 两个同名关键帧来回切换是重启 CSS 动画的唯一无事件写法——同一 tick 里摘掉
// 再加回同一个类不会重播，而 animation-name 变化必定重跑一遍。
// 初值 null（不挂淡入类）：首帧不淡入，与原 WAAPI 实现一致（它只在路由 watch 回调里跑）
const fadeAlt = ref<boolean | null>(null);
watch(
  () => route.fullPath,
  () => {
    fadeAlt.value = !fadeAlt.value;
  },
);
</script>

<template>
  <div class="page-host" :class="{ 'is-fade-a': fadeAlt === true, 'is-fade-b': fadeAlt === false }">
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
  /* 传递确定高度：撑满 .app-content 给定的高度，并给页面根（PageFrame）提供弹性上下文。
     缺这一环时 PageFrame 的 flex:1 落在一个高度由内容决定的块上，等于没写（STYLE_TODO #82）。 */
  flex: 1 1 0%;
  display: flex;
  flex-direction: column;
}

/* 只动 opacity，不碰布局属性 */
.is-fade-a {
  animation: page-fade-a var(--dur-fast) var(--ease-smooth);
}
.is-fade-b {
  animation: page-fade-b var(--dur-fast) var(--ease-smooth);
}

@keyframes page-fade-a {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}
@keyframes page-fade-b {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}
</style>
