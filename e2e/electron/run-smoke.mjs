// Electron 冒烟测试（独立脚本，不经 Playwright worker —— 该环境 worker teardown 会挂）。
// 运行：node e2e/electron/run-smoke.mjs（前置：pnpm --filter @llama-launcher/desktop build 产出 dist/）
// 验证主进程窗口链路：生产模式（loadFile dist/ui/index.html）启动 → 主进程版本 → 窗口 → 侧栏渲染。
// Windows 本地 headless；Linux CI 用 xvfb-run 包裹（无需 --no-sandbox 冲突，见 docs/testing.md）。
import { _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRequire = createRequire(join(here, '..', '..', 'apps', 'desktop', 'package.json'));
const electronPath = desktopRequire('electron');

let app = null;
try {
  app = await _electron.launch({
    executablePath: electronPath,
    args: ['.', '--headless', '--disable-gpu'],
    cwd: join(here, '..', '..', 'apps', 'desktop'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Playwright 在 Windows 上 spawn 子进程依赖 cmd.exe；agent 环境可能缺这些系统变量，
      // 显式注入避免 spawn C:\WINDOWS\system32\cmd.exe ENOENT
      ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe',
      SystemRoot: 'C:\\Windows',
    },
    timeout: 90_000,
  });

  const version = await app.evaluate(async ({ app: electronApp }) => electronApp.getVersion());
  if (!version) throw new Error('无法读取 Electron 主进程版本');

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const title = await win.title();
  if (!title.includes('llama Launcher')) {
    throw new Error(`窗口标题不符合预期: "${title}"`);
  }

  // 侧栏导航任一可见即证明 Vue 应用已挂载（7 项导航都会渲染）
  await win.locator('.sidebar .arco-menu-item').first().waitFor({ state: 'visible', timeout: 15_000 });

  console.log(`[electron-smoke] PASS 主进程版本=${version} 标题="${title}"`);
  const code = 0;
  cleanup(code);
} catch (e) {
  console.error('[electron-smoke] FAIL:', e && e.message);
  cleanup(1);
}

function cleanup(code) {
  // 不要走 app.close() 优雅退出：应用拦截 close 弹「退出二次确认」导致挂起。
  // 直接按进程树强杀（renderer/gpu 子进程不会随父进程死亡自动退出，Windows 需 taskkill /T）。
  if (app) {
    try {
      const proc = app.process();
      if (process.platform === 'win32') {
        // 同步等待 taskkill 完成后再退出，避免残留进程占用单实例锁
        spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true });
        try { proc.kill(); } catch { /* 根进程可能已退出 */ }
      } else {
        proc.kill('SIGKILL');
      }
    } catch {
      /* 进程已退出 */
    }
  }
  process.exit(code);
}