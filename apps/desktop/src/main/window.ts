import { BrowserWindow, shell, app, screen } from 'electron';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { loadSettings, saveSettings } from '@llama-launcher/core';
import { IPC } from '@llama-launcher/shared';
import { processRegistry } from './process-registry.js';
import { isQuitting } from './app-exit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WindowOptions {
  onClose?: () => void | Promise<void>;
  /** 关闭请求拦截：由退出行为模块决定 托盘隐藏 / 直接退出 / 首次询问（见 app-exit.ts） */
  onCloseRequest?: (win: BrowserWindow) => void | Promise<void>;
}

// 开发服务器实际端口：Vite 监听后写入 packages/ui/.vite-dev-port。
// 从本文件 (apps/desktop/dist/main/window.js) 向上三级到仓库根，再进 packages/ui。
// 端口被占用时 Vite 会自动顺延，Electron 跟随该文件，避免连到错误端口白屏。
function resolveDevServerPort(): number {
  try {
    const portFile = resolve(__dirname, '../../../packages/ui/.vite-dev-port');
    if (existsSync(portFile)) {
      const p = Number(readFileSync(portFile, 'utf8').trim());
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    /* 忽略，回退默认端口 */
  }
  return 5173;
}

// 开发模式判据：
// - 显式 NODE_ENV=development 时强制进入开发模式；
// - 未显式设置时，使用 process.defaultApp / app.isPackaged 推断。
// 这样 `NODE_ENV=production electron .` 会正确加载本地构建产物。
//
// 热重载逃生口：即使 NODE_ENV=production，只要设置了 LLAMA_DEV_SERVER_URL
// 环境变量，就会加载该 URL（Vite dev server），实现"生产主进程 + UI HMR"。
// 用于在生产构建的主进程上调试 UI，避免每次改 UI 都要重新 build。
function resolveIsDev(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return process.env.LLAMA_DEV_SERVER_URL !== undefined;
  }
  if (process.env.NODE_ENV === 'development') return true;
  return !!process.defaultApp || !app.isPackaged;
}

// 解析 dev server URL：优先使用环境变量，未设置时按 Vite 实际端口拼接。
function resolveDevServerUrl(): string {
  const url = process.env.LLAMA_DEV_SERVER_URL;
  if (url && /^https?:\/\//.test(url)) return url;
  return `http://localhost:${resolveDevServerPort()}`;
}

// 默认窗口尺寸
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

// 解析持久化的窗口几何："x,y,width,height"
// 空/无效则返回 null（由调用方使用默认值并居中）
interface WindowGeometry { x: number; y: number; width: number; height: number; }

function parseGeometry(raw: string): WindowGeometry | null {
  if (!raw) return null;
  // 兼容旧格式 "WxH"
  const sizeOnly = /^(\d+)x(\d+)$/.exec(raw);
  if (sizeOnly) {
    return { x: -1, y: -1, width: parseInt(sizeOnly[1], 10), height: parseInt(sizeOnly[2], 10) };
  }
  // 新格式 "x,y,width,height"
  const parts = raw.split(',');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p.trim(), 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
}

// 校验窗口位置是否在某个显示器可见区域内，避免窗口跑到屏幕外
function isGeometryVisible(geo: WindowGeometry): boolean {
  if (geo.x < 0 || geo.y < 0) return false;
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    // 窗口至少有 100px 在某个显示器内
    return geo.x >= x - geo.width + 100 &&
      geo.x <= x + width - 100 &&
      geo.y >= y - geo.height + 100 &&
      geo.y <= y + height - 100;
  });
}

// 防抖保存窗口几何
let saveTimer: NodeJS.Timeout | null = null;
function scheduleSaveGeometry(win: BrowserWindow, maximized?: boolean) {
  const nextMax = maximized ?? win.isMaximized();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const [width, height] = win.getSize();
      const [x, y] = win.getPosition();
      const geo = `${x},${y},${width},${height}`;
      const cur = loadSettings();
      const changed = cur.window_geometry !== geo || cur.window_maximized !== nextMax;
      if (!changed) return;
      cur.window_geometry = geo;
      cur.window_maximized = nextMax;
      saveSettings(cur);
    } catch (e) {
      console.error('[window] save geometry failed:', e);
    }
  }, 500);
}

export function createMainWindow(opts?: WindowOptions): BrowserWindow {
  const isDev = resolveIsDev();

  // 读取持久化的窗口几何
  let initWidth = DEFAULT_WIDTH;
  let initHeight = DEFAULT_HEIGHT;
  let initX: number | undefined;
  let initY: number | undefined;
  let center = true;
  // 应用默认打开时自动最大化（固定行为：不再读取 window_maximized，
  // 避免"上次还原过"导致后续启动不再最大化；该字段仍保存以兼容旧数据）
  const startMaximized = true;
  try {
    const s = loadSettings();
    const geo = parseGeometry(s.window_geometry);
    if (geo) {
      initWidth = Math.max(geo.width, 800);
      initHeight = Math.max(geo.height, 600);
      if (isGeometryVisible(geo)) {
        initX = geo.x;
        initY = geo.y;
        center = false;
      }
    }
  } catch (e) {
    console.error('[window] load geometry failed:', e);
  }

  // 应用图标（羊驼启动器）：运行时用于任务栏/标题栏；打包后由 electron-builder 的
  // icon 字段统一使用同一份 resources/icon.ico。
  const iconPath = join(__dirname, '..', '..', 'resources', 'icon.ico');
  const winIcon = existsSync(iconPath) ? iconPath : undefined;

  const win = new BrowserWindow({
    width: initWidth,
    height: initHeight,
    ...(initX !== undefined && initY !== undefined ? { x: initX, y: initY } : {}),
    minWidth: 1024,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false, // 无边框：原生标题栏由应用内 TopBar 自定义按钮替代
    backgroundColor: '#1E1E1E',
    icon: winIcon, // 任务栏/Alt-Tab 显示的图标
    title: 'llama Launcher',
    webPreferences: {
      // 关闭后台节流：默认 true 时窗口被遮挡/非激活会暂停 rAF 与定时器，
      // 导致悬浮提示（ToolTip 500ms 延迟 setTimeout）与进入动画卡住不显示
      backgroundThrottling: false,
      // preload 用 CommonJS（.cjs），避免 ESM preload 在 Electron 沙箱中的兼容性问题
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  if (center) win.center();
  // 默认打开时自动最大化
  if (startMaximized) win.maximize();

  // 窗口几何变化时防抖保存（resize/move 事件可能高频触发）
  const onGeometryChange = () => scheduleSaveGeometry(win);
  const onMaximize = () => {
    scheduleSaveGeometry(win, true);
    if (!win.isDestroyed()) win.webContents.send(IPC.WINDOW_MAXIMIZED);
  };
  const onUnmaximize = () => {
    scheduleSaveGeometry(win, false);
    if (!win.isDestroyed()) win.webContents.send(IPC.WINDOW_UNMAXIMIZED);
  };
  win.on('resize', onGeometryChange);
  win.on('move', onGeometryChange);
  // 最大化/还原后立即保存一次（包含最大化状态，供下次启动恢复）
  win.on('maximize', onMaximize);
  win.on('unmaximize', onUnmaximize);
  win.on('leave-full-screen', onGeometryChange);

  if (isDev) {
    // 开发模式 / 热重载模式：加载 Vite dev server
    const devUrl = resolveDevServerUrl();
    win.loadURL(devUrl)
      .then(() => {
        win.show();
        // 开发模式默认不打开 DevTools 控制台；仅当 LLAMA_DEV_CONSOLE=1
        // （`pnpm dev:console`）或生产热重载逃生口（LLAMA_DEV_SERVER_URL）时打开
        if (process.env.LLAMA_DEV_CONSOLE === '1' || process.env.LLAMA_DEV_SERVER_URL) {
          win.webContents.openDevTools({ mode: 'detach' });
        }
      })
      .catch(err => {
        console.error('[window] Failed to load dev server:', err);
      });
  } else {
    // 生产模式：加载构建产物
    // 打包后 __dirname 位于 app.asar/dist/main/，
    // UI 产物由 copy-ui.cjs 复制到 dist/ui/，即 app.asar/dist/ui/index.html
    const uiPath = join(__dirname, '..', 'ui', 'index.html');
    win.loadFile(uiPath)
      .then(() => win.show())
      .catch(err => {
        console.error('[window] Failed to load UI:', err);
      });
  }

  // 外部链接在系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 窗口关闭时同步触发清理回调，确保子进程被停止。
  // 非退出路径（托盘隐藏 / 首次询问）由 onCloseRequest 拦截并 preventDefault；
  // 仅当 isQuitting()（requestExit 已置位）时才放行走真正关闭（保存几何 + onClose 清理）。
  win.on('close', (e) => {
    if (!isQuitting()) {
      e.preventDefault();
      if (opts?.onCloseRequest) {
        try {
          void opts.onCloseRequest(win);
        } catch (err) {
          console.error('[window] onCloseRequest error:', err);
        }
      }
      return;
    }
    // 关闭前保存最终几何与最大化状态，确保下次恢复准确
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    // 移除几何/状态事件监听，避免闭包长期持有窗口引用
    win.removeListener('resize', onGeometryChange);
    win.removeListener('move', onGeometryChange);
    win.removeListener('maximize', onMaximize);
    win.removeListener('unmaximize', onUnmaximize);
    win.removeListener('leave-full-screen', onGeometryChange);
    try {
      const [width, height] = win.getSize();
      const [x, y] = win.getPosition();
      const cur = loadSettings();
      cur.window_geometry = `${x},${y},${width},${height}`;
      cur.window_maximized = win.isMaximized();
      saveSettings(cur);
    } catch { /* 忽略关闭时的保存错误 */ }
    if (opts?.onClose) {
      try {
        opts.onClose();
      } catch (e) {
        console.error('[window] onClose error:', e);
      }
    }
  });

  // 窗口已彻底销毁后，清理其关联的所有子进程（llama-server 等）。
  // 使用 'closed' 而非 'close'：'closed' 在窗口资源释放后触发、绝不会因
  // 渲染进程阻塞而延迟，确保进程清理一定发生；即便 onClose 回调异常也不影响。
  win.on('closed', () => {
    try {
      processRegistry.cleanupWindow(win);
    } catch (e) {
      console.error('[window] cleanupWindow error:', e);
    }
  });

  return win;
}
