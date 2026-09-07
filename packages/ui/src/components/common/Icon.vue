<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  IconBook, IconCheck, IconCheckCircle, IconCheckSquare, IconClockCircle, IconClose, IconCloseCircle,
  IconCloud, IconCodeBlock, IconCopy, IconDashboard, IconDelete, IconDown, IconDownload, IconEmpty,
  IconExclamationCircle, IconExport, IconFile, IconFolder, IconFolderAdd, IconFullscreen, IconFullscreenExit,
  IconInfoCircle, IconLeft, IconLink, IconMinus, IconPlayArrow, IconPublic, IconQuestionCircle, IconRefresh,
  IconRight, IconRobot, IconSave, IconSearch, IconSettings, IconStar, IconStop, IconStorage, IconSunFill, IconTool,
} from '@arco-design/web-vue/es/icon';

const props = withDefaults(defineProps<{
  name: string;
  size?: number;
}>(), { size: 18 });

const icons: Record<string, Component> = {
  // 语义名 → Arco 官方图标（一对一同义映射，禁止多语义共用同一图形）
  dashboard: IconDashboard, models: IconRobot, params: IconTool, console: IconCodeBlock, settings: IconSettings, presets: IconBook,
  server: IconCloud, download: IconDownload, play: IconPlayArrow, stop: IconStop, refresh: IconRefresh,
  chevron_right: IconRight, chevron_left: IconLeft, chevron_down: IconDown, folder: IconFolder, folder_open: IconFolderAdd,
  file: IconFile, file_check: IconCheckSquare, save: IconSave, copy: IconCopy, trash: IconDelete, search: IconSearch,
  external: IconExport, close: IconClose, check: IconCheck, globe: IconPublic, theme: IconSunFill, link: IconLink,
  check_circle: IconCheckCircle, alert: IconExclamationCircle, info: IconInfoCircle, error: IconCloseCircle,
  clock: IconClockCircle, empty: IconEmpty, star: IconStar, disk: IconStorage,
  // 窗口控制（TopBar win-btn）：Arco 原生字形
  minimize: IconMinus, maximize: IconFullscreen, restore: IconFullscreenExit,
};
const component = computed<Component>(() => icons[props.name] ?? IconQuestionCircle);
</script>

<template>
  <component :is="component" class="icon" :style="{ fontSize: `${size}px` }" aria-hidden="true" />
</template>

<style scoped>
.icon { display: inline-flex; vertical-align: middle; flex-shrink: 0; }
</style>
