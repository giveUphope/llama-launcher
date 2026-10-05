<template>
  <a-layout-content class="page-frame">
    <slot />
  </a-layout-content>
</template>

<style scoped>
.page-frame {
  /* 注意：这里刻意没有用 flex。各页子元素写的 `flex: 1; min-height: 0` 目前是失效的
     （Arco 的 .arco-layout-content 只给 flex:1 不给 display:flex，而本盒自身高度由内容
     决定），日志页控制台因此随内容无限长高、内部滚动永不生效。改成 flex 列实测不足以
     修好——还缺「确定高度」这一环，且会牵动 7 个页面间距，见 STYLE_TODO #82。 */
  min-height: 100%;
  padding: 20px 24px 24px;
}
</style>
