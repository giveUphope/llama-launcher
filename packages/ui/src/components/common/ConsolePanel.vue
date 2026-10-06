<script setup lang="ts">
// 控制台面板：日志页与服务页共用的「外壳 + 滚动行为 + 有新日志提示」。
// 行渲染留给各页（日志页是时间戳/级别/正文三段，服务页是后端原始输出单段），
// 这里只统一底/字/边框/圆角、级别色与滚动，不把两套行模板并成一个大杂烩。
import { ref } from 'vue';
import Icon from '@/components/common/Icon.vue';
import { useAutoScroll } from '@/composables/useAutoScroll';
import { useI18nStore } from '@/stores/i18n';

const props = defineProps<{
  /** 行数来源：变化即触发「跟随滚动 / 有新日志」判定 */
  count: number;
}>();

const i18n = useI18nStore();
const consoleEl = ref<HTMLElement | null>(null);
const { hasNewLogs, scrollToBottom, onScroll } = useAutoScroll(consoleEl, {
  count: () => props.count,
});
</script>

<template>
  <div class="console-frame">
    <!-- 胶囊绝对定位浮在框内右下角：留在正常流里时，它一出现就把日志框往下顶一档（框高跳变） -->
    <a-button
      v-if="hasNewLogs"
      class="new-logs-bar"
      type="text"
      size="mini"
      @click="scrollToBottom()"
    >
      <Icon name="chevron_down" :size="12" />
      <span>{{ i18n.t('msg_new_logs') }}</span>
    </a-button>
    <div ref="consoleEl" class="console" @scroll="onScroll">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
/* 面板本体不写高度：服务页定高、日志页弹性，都由外层给的 class 决定 */
.console-frame {
  position: relative; // 给胶囊当定位参照（胶囊不参与布局）
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.console {
  flex: 1 1 0%;
  min-height: 0;
  background: var(--console-bg);
  color: var(--console-fg);
  border: 1px solid var(--color-border-2);
  border-radius: var(--radius-row);
  overflow: auto;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  line-height: 1.55;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

/* 级别色打在行元素上，行内子节点不写 color 即继承（token 依据见 theme.scss
   「控制台级别色」——原先的 arcoblue-6/danger-6 压在恒深底上只有 3.11/4.35） */
.console :deep(.kind-info) {
  color: var(--log-kind-info);
}
.console :deep(.kind-success) {
  color: var(--log-kind-success);
}
.console :deep(.kind-warn) {
  color: var(--log-kind-warn);
}
.console :deep(.kind-error) {
  color: var(--log-kind-error);
}

/* 有新日志胶囊：a-button 基座，底色以 --console-bg 打底（全站禁 backdrop-filter，
   用不透明混色而不是模糊，保证压住文字仍可读） */
.new-logs-bar {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: var(--z-chrome);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in srgb, rgb(var(--console-accent)) 22%, var(--console-bg));
  color: rgb(var(--console-accent));
  border: 1px solid rgb(var(--console-accent));
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  height: auto;
  font-weight: 600;
  animation: pulse-glow var(--dur-ambient) var(--ease-smooth) infinite;

  &:hover {
    background: color-mix(in srgb, rgb(var(--console-accent)) 32%, var(--console-bg));
    color: rgb(var(--console-accent));
  }
}

/* 只动 opacity：环境/注意力提示档动效不得触碰布局属性 */
@keyframes pulse-glow {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
