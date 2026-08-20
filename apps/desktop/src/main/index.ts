import { app, BrowserWindow, shell } from 'electron';
import { createMainWindow } from './window.js';
import { createTray } from './tray.js';
import { handleWindowClose } from './app-exit.js';
import { registerIpcHandlers } from './ipc/index.js';
import { launcherBridge } from './launcher-bridge.js';
import { processRegistry } from './process-registry.js';
import { installHfTransport } from './hf-transport.js';
import { installDownloadTransport } from './download-transport.js';
import { setCleanupLogLevel, cleanupLogger, killProcessTree, findDevSessionRoot, getDownloadManager } from '@llama-launcher/core';

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行：本实例直接退出（不重复拉起窗口）。
  // 注意：若此处触发，说明上一次 electron 没真正退出、仍占着单例锁，
  // 需先在任务管理器结束残留的 electron 进程。
  cleanupLogger.warn('app', 'another instance already holds the single-instance lock, quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      const w = wins[0];
      // 托盘隐藏时恢复显示（单实例二次启动即唤起窗口）
      if (!w.isVisible()) w.show();
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  let mainWin: BrowserWindow | null = null;

  // 开发环境开启清理 debug 日志，便于观察窗口-进程映射与终止步骤
  if (process.env.NODE_ENV === 'development') {
    setCleanupLogLevel('debug');
  }

  // 诊断：捕获未处理异常，避免静默退出且便于定位启动期崩溃
  process.on('uncaughtException', (e) => {
    cleanupLogger.error('app', 'uncaughtException', e);
  });
  process.on('unhandledRejection', (e) => {
    cleanupLogger.error('app', 'unhandledRejection', e);
  });
  app.on('quit', (_e, exitCode) => {
    cleanupLogger.info('app', `quit with exitCode=${exitCode}`);
  });

  app.whenReady().then(() => {
    try {
      // 注入基于 Electron net 模块的 HF 传输:绕开 BoringSSL 指纹被 hf-mirror.com
      // reset 的问题(net 模块用 Chromium 网络栈,TLS 指纹同 Chrome)。须在 IPC 调用前完成。
      // - installHfTransport:文件列表 API(JSON 短请求)
      // - installDownloadTransport:probe + 段下载(流式,文件可达 20GB+)
      installHfTransport();
      installDownloadTransport();
      registerIpcHandlers();
      mainWin = createMainWindow({
        // 窗口关闭时同步清理子进程（llama-server），避免残留进程。
        // 这里做兜底：主清理逻辑在 window.ts 的 'closed' 事件里通过
        // processRegistry.cleanupWindow 完成；onClose 再确保一次 launcher 级清理。
        onClose: () => launcherBridge.disposeSync(),
        // 关闭请求拦截：按 close_behavior 决定 托盘隐藏 / 直接退出 / 首次询问（含服务运行二次确认）
        onCloseRequest: (win) => void handleWindowClose(win),
      });
      launcherBridge.setWindow(mainWin);
      // 托盘保活：窗口隐藏后应用驻留托盘
      createTray(mainWin);

      // Open external links in default browser
      mainWin.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          shell.openExternal(url);
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });
    } catch (e) {
      // 启动期异常：记录但不静默崩溃，便于定位
      cleanupLogger.error('app', 'whenReady callback failed', e);
    }
  });

  // 退出前同步清理所有窗口关联的子进程（进程树 + 按名兜底扫杀）。
  // 不使用 preventDefault + async 等待，避免退出延迟和进程残留。
  app.on('before-quit', () => {
    cleanupLogger.info('app', 'before-quit: cleaning up all associated processes');
    // dispose = pauseAll(暂停下载并保存续传元数据) + 销毁 https 连接池 + 移除事件监听
    getDownloadManager().dispose();
    processRegistry.cleanupAll();
    launcherBridge.disposeSync();

    // 开发模式：关窗退出时顺带结束整个 dev 会话（turbo/vite/concurrently 等兄弟进程）。
    // 用 !app.isPackaged 判定开发模式（比依赖 NODE_ENV 更可靠：cross-env 的 env
    // 只作用于 && 链的第一个命令，electron 主进程里拿不到 NODE_ENV）。
    // 生产打包版(isPackaged=true)绝不误杀用户终端。此时 llama-server 已清理完毕，
    // 这里从进程列表里找到 `turbo run dev` 根，杀掉整棵进程树，释放 5173 等端口。
    // 热重载（dev-watch）通过 LLAMA_DEV_SKIP_QUIT_KILL=1 跳过——否则重启 Electron 会
    // 连带杀掉 tsc --watch 与监视器本身。
    if (!app.isPackaged && process.env.LLAMA_DEV_SKIP_QUIT_KILL !== '1') {
      try {
        const root = findDevSessionRoot();
        if (root && root !== process.pid) {
          cleanupLogger.info('app', `dev session: killing process tree rooted at turbo pid=${root}`);
          killProcessTree(root);
        } else {
          cleanupLogger.debug('app', 'dev session: no turbo dev root found, skip tree kill');
        }
      } catch (e) {
        cleanupLogger.error('app', 'dev session tree kill failed', e);
      }
    }
  });

  // 双保险：will-quit 阶段再次清理，确保任何路径下子进程都已终止。
  app.on('will-quit', () => {
    getDownloadManager().pauseAll();
    processRegistry.cleanupAll();
    launcherBridge.disposeSync();
  });

  // 无后台模式/托盘模式：关闭所有窗口后立即退出，避免进程残留。
  // 开发模式下退出时会顺带杀掉整棵 dev 树（见 before-quit）。
  app.on('window-all-closed', () => {
    mainWin = null;
    launcherBridge.setWindow(null);
    processRegistry.cleanupAll();
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // 开发模式下，用户 Ctrl-C / concurrently -k 会以 SIGTERM/SIGINT 直接结束 Electron，
  // 此时 before-quit/will-quit 可能来不及触发。注册信号处理器：先清理 llama-server，
  // 再杀掉整棵 dev 会话树（turbo/vite 等），最后退出，避免残留进程占用端口/资源。
  let signalHandled = false;
  const onSignal = () => {
    if (signalHandled) return;
    signalHandled = true;
    cleanupLogger.info('app', 'signal received: force cleaning up processes before exit');
    getDownloadManager().pauseAll();
    processRegistry.cleanupAll();
    launcherBridge.disposeSync();
    if (!app.isPackaged) {
      try {
        const root = findDevSessionRoot();
        if (root && root !== process.pid) {
          cleanupLogger.info('app', `dev session: killing process tree rooted at turbo pid=${root}`);
          killProcessTree(root);
        }
      } catch (e) {
        cleanupLogger.error('app', 'dev session tree kill failed', e);
      }
    }
    app.exit(0);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
