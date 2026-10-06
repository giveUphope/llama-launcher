<template>
  <!-- 页面根必须是普通 DIV：Arco 的 a-layout-content 渲染成 <main>，而外壳 `.app-content`
       已经是那唯一的一个 main（读屏「跳到主内容」的落点）。这里再用一次就是 main > main
       （模型页把 PageFrame 套了两层，改前实测那里是三个 main），地标重复等于把落点讲糊。 -->
  <div class="page-frame">
    <slot />
  </div>
</template>

<style scoped>
/*
 * 页面骨架：本盒是「页面内容的滚动容器 + 弹性上下文」，两件事必须同时成立，缺一条就回到
 * STYLE_TODO #82 的老毛病（页面里写的 flex: 1 全部失效、日志控制台随内容无限长高）。
 *   ① 确定高度：上层 .app-content（flex 列，高 100% 有定值）→ .page-host: flex:1 → 本盒: flex:1，
 *      高度逐级可解析，于是子项写 flex: 1 时真有自由空间可分（内部滚动才可能生效）。
 *   ② 溢出滚动：长页面（参数页 69 行）在本盒内滚，不再把整页撑到外层——外层 .app-content 已改
 *      overflow: hidden，滚动条位置因此从窗口边缘移到本盒边缘，可视宽度不变（实测子项宽 549/559 两档一致）。
 *   ③ 非弹性子项显式 flex-shrink: 0：块流改 flex 列后，默认的 flex-shrink: 1 会把超长内容「压缩」
 *      而不是「溢出」——压缩的表现是裁切（内容看不见也滚不到）。需要长高的子项（如日志页
 *      .console-wrap 自带 flex: 1）用自己的规则覆盖本行即可（属性级联按具体性取胜）。
 * 代价提示：flex 容器不合并相邻外边距，页内子项的 margin 由「取最大值」变成「相加」，改这里必须
 * 逐页复量间距（STYLE_TODO #82 验收判据 3）。
 *   ④ 本盒由 a-layout-content 改为普通 div（STYLE_TODO #92 的唯一 main）：Arco 给这一层的声明
 *      只有 `flex: 1`，本盒自己写的 `flex: 1 1 0%` 本来就覆盖它，摘掉那层壳不缺任何东西，
 *      ① 的高度解析链一字未动。
 */
.page-frame {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  /* 两个轴都留 auto：窄窗口下参数页状态行右侧按钮簇实测会横向溢出（scrollWidth 714 > clientWidth 597），
     写成 overflow-x: hidden 会把那 106px 裁成够不着的内容——外层 .app-content 原本是 auto，能横滚。 */
  overflow: auto;
  padding: 20px 24px 24px;
}

.page-frame > :deep(*) {
  flex-shrink: 0;
}
</style>
