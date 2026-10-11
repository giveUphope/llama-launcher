<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 全站统一提示浮层。配色与定位全部交给 a-tooltip 的官方 props：
 * `content` 传文本、`content-class` 挂多行换行、`position` / `disabled` 由调用方选。
 * 不再包一层 `<span class="tooltip-text">`——那等于在库的内容节点里再自造一个排版层。
 *
 * `overflowOnly`（2026-10-11 用户两次批注）：给「回声型」提示用——浮层内容就是插槽里那段
 * 文本时，只有**真的被省略号截断**才该弹（短值 `0.7`、`http://127.0.0.1:9931` 弹一遍同样
 * 的话是噪声）。判定量的是插槽首元素，因为省略号挂在它上面而不是宿主上。
 * 反过来，凡是浮层**携带界面上看不到的信息**（显示模型名、提示完整路径；显示短句、提示长句）
 * 的调用点都不得开这个开关——按截断关闭等于删功能。
 */
const props = withDefaults(
  defineProps<{
    text: string;
    position?: 'top' | 'tl' | 'tr' | 'lt' | 'lb' | 'left' | 'right' | 'rt' | 'rb' | 'bl' | 'br';
    disabled?: boolean;
    /** 仅在插槽文本被省略号截断时才出浮层（回声型提示专用，默认关＝常开） */
    overflowOnly?: boolean;
  }>(),
  { position: 'top', disabled: false, overflowOnly: false },
);

const hostEl = ref<HTMLElement | null>(null);
const overflowing = ref(false);
let observer: ResizeObserver | null = null;

/** 省略号挂在插槽首元素上（宿主只是 inline-flex 容器），所以量它。 */
function measuredEl(): HTMLElement | null {
  const host = hostEl.value;
  if (!host) return null;
  return (host.firstElementChild as HTMLElement | null) ?? host;
}

function measure() {
  const el = measuredEl();
  // +1 容差：亚像素取整会把未截断的边界值误判成截断
  overflowing.value = !!el && el.scrollWidth > el.clientWidth + 1;
}

onMounted(() => {
  if (!props.overflowOnly) return;
  void nextTick(measure);
  // ResizeObserver 只在被观察元素尺寸变化时触发：页面被 keep-alive 隐藏时元素尺寸不变，
  // 它就不跑，因此不需要 activate/deactivate 配对（与定时器、事件监听不同）；卸载必断。
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    const el = measuredEl();
    if (el) observer.observe(el);
  }
});

// 文本换了（同一实例承载不同值，如列表复用）要重测——RO 只在尺寸变化时触发，内容变化不保证
watch(() => [props.text, props.overflowOnly], () => { void nextTick(measure); });
onBeforeUnmount(() => { observer?.disconnect(); observer = null; });
</script>

<template>
  <a-tooltip
    :content="text"
    :position="position"
    :disabled="disabled || (overflowOnly && !overflowing)"
    :mini="true"
    content-class="fc-tooltip-multiline"
  >
    <span ref="hostEl" class="tooltip-host"><slot /></span>
  </a-tooltip>
</template>

<style>
/* 浮层文本带 \n（标签 / 值 / 操作提示三段），Arco 默认 white-space: normal 会把换行折成空格。
   弹层由 a-tooltip 传送到 body，scoped 选择器够不到它，故走官方 content-class 钩子 +
   非 scoped 块；类名是本组件私有（fc- 前缀），不会命中其他组件的浮层（§7.5.6）。 */
.fc-tooltip-multiline {
  white-space: pre-line;
}
</style>

<style scoped>
.tooltip-host {
  display: inline-flex;
  min-width: 0;
}
</style>
