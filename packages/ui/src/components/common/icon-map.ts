// 逐个深路径引入，不走 @arco-design/web-vue/es/icon 桶：桶文件除具名再导出外还带一行
// `export { default } from './arco-vue-icon.js'`（全局注册用的 250 项插件对象），
// 深路径引入后该对象与其引用链整体不进包。实测产物 Icon chunk 139.65 → 130.29 kB
// （gzip 38.70 → 36.79）；余下体积是 Arco 每个图标编译后的 render 函数本身
// （本文件 39 个字形 ≈ 118 kB），不是桶引入造成的。
import IconBook from '@arco-design/web-vue/es/icon/icon-book/index.js';
import IconCheck from '@arco-design/web-vue/es/icon/icon-check/index.js';
import IconCheckCircle from '@arco-design/web-vue/es/icon/icon-check-circle/index.js';
import IconCheckSquare from '@arco-design/web-vue/es/icon/icon-check-square/index.js';
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
import IconSearch from '@arco-design/web-vue/es/icon/icon-search/index.js';
import IconSettings from '@arco-design/web-vue/es/icon/icon-settings/index.js';
import IconStar from '@arco-design/web-vue/es/icon/icon-star/index.js';
import IconStop from '@arco-design/web-vue/es/icon/icon-stop/index.js';
import IconStorage from '@arco-design/web-vue/es/icon/icon-storage/index.js';
import IconSunFill from '@arco-design/web-vue/es/icon/icon-sun-fill/index.js';
import IconTool from '@arco-design/web-vue/es/icon/icon-tool/index.js';
import IconUp from '@arco-design/web-vue/es/icon/icon-up/index.js';


export const icons = {
  // 语义名 → Arco 官方图标。**两条硬规则，由 style-audit 第 21 条守着**：
  // ① 一个字形只准挂一个语义名（历史上 folder / folder_open 共用纯文件夹，
  //    结果「打开目录」和「上一级」长得一样，用户批注即此）；
  // ② 语义名必须有读者——零读者的名字连同 import 一起删（原 clock 已被 bench 取代仍留着）。
  dashboard: IconDashboard, models: IconRobot, params: IconTool, console: IconCodeBlock, settings: IconSettings, presets: IconBook,
  server: IconCloud, download: IconDownload, play: IconPlayArrow, stop: IconStop, refresh: IconRefresh,
  chevron_right: IconRight, chevron_left: IconLeft, chevron_up: IconUp, chevron_down: IconDown, folder: IconFolder,
  file: IconFile, file_check: IconCheckSquare, copy: IconCopy, trash: IconDelete, search: IconSearch,
  external: IconExport, close: IconClose, check: IconCheck, globe: IconPublic, theme: IconSunFill, link: IconLink,
  check_circle: IconCheckCircle, alert: IconExclamationCircle, info: IconInfoCircle, error: IconCloseCircle,
  empty: IconEmpty, star: IconStar, disk: IconStorage, bench: IconExperiment,
  // 窗口控制（TopBar win-btn）：Arco 原生字形
  minimize: IconMinus, maximize: IconFullscreen, restore: IconFullscreenExit,
  // 加载中：Arco IconLoading 自带旋转动画（替代自定义 spin @keyframes，全站统一）
  loading: IconLoading,
} as const;

/** 语义名即类型：写错或删掉一个名字，vue-tsc 当场报红 */
export type IconName = keyof typeof icons;

/** 兜底字形（编译期已挡住错名，这里只防运行期动态拼出的名字） */
export const FALLBACK_ICON = IconQuestionCircle;
