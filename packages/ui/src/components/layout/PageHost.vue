<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { navItems } from '@/features';
import { useI18nStore } from '@/stores/i18n';

const route = useRoute();
const i18n = useI18nStore();

// 页标题只在此处取一次：名字与侧栏同源于 features 注册表，页面里再各写一遍标题就是第二套事实源
// （七页各自硬写会漏、会漂，新增页忘写就没有标题——这里结构上漏不掉）。
// 旧路由 /download 与 /launch 是 redirect、不渲染组件，因此每张真实页面都能查到导航项。
const pageTitle = computed(() => {
  const nav = navItems.find((item) => item.to === route.path);
  return nav ? i18n.t(nav.labelKey) : '';
});

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
  <!-- 每页唯一的 <h1>：页名只在侧栏显示，页面里没有任何可见的大标题，硬塞一个就是改版。
       所以这是一个「视觉隐藏但读得到」的标题——读屏按 H 键能在 7 个页名之间跳转，
       视力正常的人看到的还是原来那一屏。元素由 Arco a-typography-title 原生渲染成 <h1>
       （heading 属性控级别），不另造一套字号。
       它排在 .page-host **外面**而不是里面：`.page-host > *` 是四份 e2e 用的「激活页面根已渲染」
       就绪门禁（见 app.spec.ts / layout-stability.spec.ts），标题插进去会让那条门禁第一次就命中
       h1（同步渲染、必然先于异步页面组件）而变成空转。多根之后标题仍是 main 里文档序第一个标题。 -->
  <a-typography-title v-if="pageTitle" :heading="1" class="page-title">{{ pageTitle }}</a-typography-title>
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

/* 视觉隐藏但可读（sr-only，STYLE_TODO #92）：离出常规流 + 1px 裁切，既不占位也不改几何，
   #82 的三层骨架链一字未动；不用 display:none / visibility:hidden——那样读屏也一并读不到。
   clip-path 与裁剪盒同给：前者是现代浏览器的裁法，后者是旧浏览器的等价物。 */
.page-title {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
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
