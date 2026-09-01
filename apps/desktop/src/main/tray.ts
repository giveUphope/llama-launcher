/**
 * 系统托盘保活：窗口隐藏后应用驻留托盘；托盘菜单可 显示主窗口 / 退出（退出走 requestExit，
 * 模型服务运行中会二次确认）。
 * - 图标：优先加载 32px PNG（Windows 托盘各 DPI 渲染可靠），失败逐级兜底 16px PNG / icon.ico，
 *   并打印加载状态便于诊断"托盘图标不显示"。
 * - 右键菜单：不 setContextMenu（Windows 上原生 setContextMenu 弹出时从鼠标位置向下展开，
 *   不会自动向上），改为 right-click 时手动 popUpContextMenu，菜单底缘对齐图标上缘
 *   （预期"出现在图标上方"），图标上方放不下（如任务栏在顶部）时回退到图标下方。
 *   popUpContextMenu 的 position 为 DIP 屏幕坐标，锚点 kTopLeft——菜单自该点向下展开。
 */
import {
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  Tray,
  nativeImage,
  screen,
} from 'electron';

/**
 * 菜单几何估算（DIP，Windows / Chromium 130 原生 Views 菜单）：
 * 菜单项高约 33、分隔线约 7、容器上下边框合计约 4。
 * 按模板实际内容累加，而非固定高度——高度估小会导致菜单底缘压住托盘图标。
 */
const MENU_ITEM_H = 33;
const MENU_SEPARATOR_H = 7;
const MENU_BORDER_H = 4;
/** 菜单宽度估算（"显示主窗口"+ 内边距）；x 方向由工作区钳制兜底 */
const MENU_WIDTH_EST = 120;

function estimateMenuHeight(template: MenuItemConstructorOptions[]): number {
  let h = MENU_BORDER_H;
  for (const item of template) {
    h += item.type === 'separator' ? MENU_SEPARATOR_H : MENU_ITEM_H;
  }
  return h;
}
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestExit } from './app-exit.js';
import { loadSettings } from '@llama-launcher/core';
import { setLang, tr } from '@llama-launcher/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 加载托盘图标。
 * 路径注意：dev 编译产物在 dist/main/，resources 在 apps/desktop/resources → ../../resources；
 * 打包版 resources 经 extraResources 复制到 process.resourcesPath（asar 内路径 nativeImage 不支持）。
 */
function loadTrayIcon() {
  const candidates = [
    // dev：apps/desktop/resources
    join(__dirname, '../../resources/icon-32.png'),
    join(__dirname, '../../resources/icon-16.png'),
    join(__dirname, '../../resources/icon.ico'),
    // 打包：process.resourcesPath（extraResources 复制）
    join(process.resourcesPath, 'icon-32.png'),
    join(process.resourcesPath, 'icon-16.png'),
    join(process.resourcesPath, 'icon.ico'),
  ];
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      console.log('[tray] 图标已加载:', p);
      return img;
    }
  }
  console.error('[tray] 托盘图标加载失败（PNG/ICO 均不可用），请检查 apps/desktop/resources/');
  return nativeImage.createEmpty();
}

export function createTray(win: BrowserWindow): Tray {
  const icon = loadTrayIcon();
  const tray = new Tray(icon);
  tray.setToolTip('llama Launcher');

  // 菜单文案跟随设置语言（i18n 约定：用户可见字符串走 shared i18n）
  setLang(loadSettings().language);

  const menuTemplate: MenuItemConstructorOptions[] = [
    {
      label: tr('tray_show'),
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: tr('tray_quit'),
      click: () => {
        void requestExit(win);
      },
    },
  ];
  const menu = Menu.buildFromTemplate(menuTemplate);

  // 右键：菜单显示在托盘图标上方。Windows 原生弹出以 kTopLeft 锚点从给定点向下展开
  // （不会自动向上），故手动定位——菜单底缘对齐图标上缘、右缘对齐图标右缘；
  // 位置按该图标所在显示器的工作区钳制，上方放不下时回退到图标下方。
  tray.on('right-click', (_e, bounds) => {
    const menuH = estimateMenuHeight(menuTemplate);
    const wa = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;

    // 优先：菜单底缘贴图标上缘（菜单在图标上方）；上方放不下则贴图标下缘向下展开。
    const topY = bounds.y - menuH;
    const y = topY >= wa.y ? topY : bounds.y + bounds.height;

    // 右缘对齐图标右缘，并钳制在工作区左右边界内。
    const x = Math.min(
      Math.max(wa.x, bounds.x + bounds.width - MENU_WIDTH_EST),
      wa.x + wa.width - MENU_WIDTH_EST,
    );

    tray.popUpContextMenu(menu, { x, y });
  });

  // 单击托盘图标：显示并聚焦主窗口（隐藏时恢复）
  tray.on('click', () => {
    win.show();
    win.focus();
  });

  return tray;
}

