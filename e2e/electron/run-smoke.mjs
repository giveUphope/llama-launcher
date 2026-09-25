// Electron 冒烟测试（独立脚本，不经 Playwright worker —— 该环境 worker teardown 会挂）。
// 运行：node e2e/electron/run-smoke.mjs（前置：pnpm --filter @llama-launcher/desktop build 产出 dist/）
// 验证主进程窗口链路：生产模式（loadFile dist/ui/index.html）启动 → 主进程版本 → 窗口 → 侧栏渲染。
// Windows 本地 headless；Linux CI 用 xvfb-run 包裹（无需 --no-sandbox 冲突，见 docs/zh/testing.md）。
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

  // 真机往返一条推送通道（回归用例：体检状态由主进程推送，不靠渲染层轮询）。
  // 探针拿一个「确实存在但不是 GGUF」的文件当 modelPath：handler 的 existsSync 放行，
  // llama-bench 随即报错进 catch → 状态迁移 → publish() 推一次；不加载模型、不占 GPU。
  // 这里刻意不 monkeypatch benchLlamaStatus 去数「有没有轮询」——contextBridge 暴露的属性
  // 在主世界不可写，那种断言会假通过；轮询是否消失由源码事实（无 setInterval）+ 浏览器计数实测保证。
  const benchProbe = await win.evaluate(async (probeModel) => {
    const api = window.api && window.api.system;
    if (!api || typeof api.onBenchStatus !== 'function') {
      throw new Error('preload 未暴露 system.onBenchStatus（推送桥接缺失）');
    }
    /** @type {string[]} */
    const pushed = [];
    const off = api.onBenchStatus((job) => pushed.push(String(job && job.state)));
    if (typeof off !== 'function') throw new Error('onBenchStatus 未返回退订函数');
    await api.benchLlamaRun(probeModel);
    const deadline = Date.now() + 25_000;
    while (!pushed.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    off();
    return pushed;
  }, join(here, '..', '..', 'apps', 'desktop', 'package.json'));

  const benchState = benchProbe[0];
  if (!benchState) {
    throw new Error('25s 内未收到 system:benchOnStatus 推送（主进程 → 渲染层链路断）');
  }
  if (benchState !== 'error' && benchState !== 'done') {
    throw new Error(`推送到的不是终态：${benchState}`);
  }

  console.log(`[electron-smoke] PASS 主进程版本=${version} 标题="${title}" 体检推送=${benchState}`);
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