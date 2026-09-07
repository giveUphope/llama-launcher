<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  IconApps, IconBook, IconCheck, IconCheckCircle, IconClockCircle, IconClose, IconCloseCircle,
  IconCloud, IconCodeBlock, IconCopy, IconDelete, IconDown, IconDownload, IconExclamationCircle,
  IconExport, IconFile, IconFolder, IconFolderAdd, IconFullscreen, IconFullscreenExit, IconInfoCircle, IconLeft,
  IconLink, IconMinus, IconPlayArrow, IconPublic, IconQuestionCircle, IconRefresh, IconRight, IconSave,
  IconSearch, IconSettings, IconStar, IconStop, IconStorage, IconSunFill,
} from '@arco-design/web-vue/es/icon';

const props = withDefaults(defineProps<{
  name: string;
  size?: number;
}>(), { size: 18 });

const icons: Record<string, Component> = {
  dashboard: IconApps, models: IconStorage, params: IconSettings, console: IconCodeBlock, settings: IconSettings, presets: IconBook,
  server: IconCloud, download: IconDownload, play: IconPlayArrow, stop: IconStop, refresh: IconRefresh,
  chevron_right: IconRight, chevron_left: IconLeft, chevron_down: IconDown, folder: IconFolder, folder_open: IconFolderAdd,
  file: IconFile, file_check: IconFile, save: IconSave, copy: IconCopy, trash: IconDelete, search: IconSearch,
  external: IconExport, close: IconClose, check: IconCheck, globe: IconPublic, theme: IconSunFill, link: IconLink,
  check_circle: IconCheckCircle, alert: IconExclamationCircle, info: IconInfoCircle, error: IconCloseCircle,
  clock: IconClockCircle, empty: IconFile, star: IconStar, disk: IconStorage,
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
