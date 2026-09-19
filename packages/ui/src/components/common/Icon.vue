<script setup lang="ts">
import { computed, type Component } from 'vue';
// 逐个深路径引入，不走 @arco-design/web-vue/es/icon 桶：桶文件除具名再导出外还带一行
// `export { default } from './arco-vue-icon.js'`（全局注册用的 250 项插件对象），
// 深路径引入后该对象与其引用链整体不进包。实测产物 Icon chunk 139.65 → 130.29 kB
// （gzip 38.70 → 36.79）；余下体积是 Arco 每个图标编译后的 render 函数本身
// （本文件 43 个字形 ≈ 118 kB），不是桶引入造成的。
import IconBook from '@arco-design/web-vue/es/icon/icon-book/index.js';
import IconCheck from '@arco-design/web-vue/es/icon/icon-check/index.js';
import IconCheckCircle from '@arco-design/web-vue/es/icon/icon-check-circle/index.js';
import IconCheckSquare from '@arco-design/web-vue/es/icon/icon-check-square/index.js';
import IconClockCircle from '@arco-design/web-vue/es/icon/icon-clock-circle/index.js';
import IconClose from '@arco-design/web-vue/es/icon/icon-close/index.js';
import IconCloseCircle from '@arco-design/web-vue/es/icon/icon-close-circle/index.js';
import IconCloud from '@arco-design/web-vue/es/icon/icon-cloud/index.js';
import IconCodeBlock from '@arco-design/web-vue/es/icon/icon-code-block/index.js';
import IconCopy from '@arco-design/web-vue/es/icon/icon-copy/index.js';
import IconDashboard from '@arco-design/web-vue/es/icon/icon-dashboard/index.js';
import IconDelete from '@arco-design/web-vue/es/icon/icon-delete/index.js';
import IconDown from '@arco-design/web-vue/es/icon/icon-down/index.js';
import IconDownload from '@arco-design/web-vue/es/icon/icon-download/index.js';
import IconEmpty from '@arco-design/web-vue/es/icon/icon-empty/index.js';
import IconExclamationCircle from '@arco-design/web-vue/es/icon/icon-exclamation-circle/index.js';
import IconExport from '@arco-design/web-vue/es/icon/icon-export/index.js';
import IconExperiment from '@arco-design/web-vue/es/icon/icon-experiment/index.js';
import IconFile from '@arco-design/web-vue/es/icon/icon-file/index.js';
import IconFolder from '@arco-design/web-vue/es/icon/icon-folder/index.js';
import IconFullscreen from '@arco-design/web-vue/es/icon/icon-fullscreen/index.js';
import IconFullscreenExit from '@arco-design/web-vue/es/icon/icon-fullscreen-exit/index.js';
import IconInfoCircle from '@arco-design/web-vue/es/icon/icon-info-circle/index.js';
import IconLeft from '@arco-design/web-vue/es/icon/icon-left/index.js';
import IconLink from '@arco-design/web-vue/es/icon/icon-link/index.js';
import IconLoading from '@arco-design/web-vue/es/icon/icon-loading/index.js';
import IconMinus from '@arco-design/web-vue/es/icon/icon-minus/index.js';
import IconPlayArrow from '@arco-design/web-vue/es/icon/icon-play-arrow/index.js';
import IconPublic from '@arco-design/web-vue/es/icon/icon-public/index.js';
import IconQuestionCircle from '@arco-design/web-vue/es/icon/icon-question-circle/index.js';
import IconRefresh from '@arco-design/web-vue/es/icon/icon-refresh/index.js';
import IconRight from '@arco-design/web-vue/es/icon/icon-right/index.js';
import IconRobot from '@arco-design/web-vue/es/icon/icon-robot/index.js';
import IconSave from '@arco-design/web-vue/es/icon/icon-save/index.js';
import IconSearch from '@arco-design/web-vue/es/icon/icon-search/index.js';
import IconSettings from '@arco-design/web-vue/es/icon/icon-settings/index.js';
import IconStar from '@arco-design/web-vue/es/icon/icon-star/index.js';
import IconStop from '@arco-design/web-vue/es/icon/icon-stop/index.js';
import IconStorage from '@arco-design/web-vue/es/icon/icon-storage/index.js';
import IconSunFill from '@arco-design/web-vue/es/icon/icon-sun-fill/index.js';
import IconTool from '@arco-design/web-vue/es/icon/icon-tool/index.js';

const props = withDefaults(defineProps<{
  name: string;
  size?: number;
}>(), { size: 18 });

const icons: Record<string, Component> = {
  // 语义名 → Arco 官方图标（一对一同义映射，禁止多语义共用同一图形；
  // 字形必须与动作语义一致——folder_open 用纯文件夹而非 + 新建形，bench 用烧杯而非时钟）
  dashboard: IconDashboard, models: IconRobot, params: IconTool, console: IconCodeBlock, settings: IconSettings, presets: IconBook,
  server: IconCloud, download: IconDownload, play: IconPlayArrow, stop: IconStop, refresh: IconRefresh,
  chevron_right: IconRight, chevron_left: IconLeft, chevron_down: IconDown, folder: IconFolder, folder_open: IconFolder,
  file: IconFile, file_check: IconCheckSquare, save: IconSave, copy: IconCopy, trash: IconDelete, search: IconSearch,
  external: IconExport, close: IconClose, check: IconCheck, globe: IconPublic, theme: IconSunFill, link: IconLink,
  check_circle: IconCheckCircle, alert: IconExclamationCircle, info: IconInfoCircle, error: IconCloseCircle,
  clock: IconClockCircle, empty: IconEmpty, star: IconStar, disk: IconStorage, bench: IconExperiment,
  // 窗口控制（TopBar win-btn）：Arco 原生字形
  minimize: IconMinus, maximize: IconFullscreen, restore: IconFullscreenExit,
  // 加载中：Arco IconLoading 自带旋转动画（替代自定义 spin @keyframes，全站统一）
  loading: IconLoading,
};
const component = computed<Component>(() => icons[props.name] ?? IconQuestionCircle);
</script>

<template>
  <component :is="component" class="icon" :style="{ fontSize: `${size}px` }" aria-hidden="true" />
</template>

<style scoped>
/* 图标居中交给各容器（Arco button/menu 有自带 vertical-align 校准如 -2px），
   此处不得设 vertical-align: middle——会以更高特异性覆盖 Arco 校准，
   导致按钮内图标相对文本偏下 ~1.5px（历史：tb-model 等按钮图标与文本不齐） */
.icon { display: inline-flex; flex-shrink: 0; }
</style>
