import { defineConfig, devices } from '@playwright/test';

// E2E 配置：根级独立于 turbo 的任务链（见 docs/zh/testing.md）。
// - project `web`：跑真实构建产物（vite preview 服务 packages/ui/dist）＋ demo-mock 数据，纯浏览器渲染层验证；
// - Electron 冒烟不在此配置中 —— 由 e2e/electron/run-smoke.mjs 独立脚本承担（Playwright worker
//   teardown 在代理环境下会挂起 30s，独立脚本可给到干净的退出码）。

/**
 * baseURL 的唯一所有者是 `e2e/run-web-e2e.mjs`（preview 进程的单点拥有者），经
 * `E2E_PREVIEW_URL` 传进来——本文件不再写第二份端口号。
 * 缺变量即快速失败：2026-09-20 实测过绕开驱动直接 `playwright test` 的后果，那时
 * 没人起 4173，浏览器会连到任意占用该端口的残留进程，11 条用例全红且原因难以定位。
 */
const previewUrl = process.env.E2E_PREVIEW_URL ?? '';
const isTestRun = process.argv.some((a) => a === 'test' || a.startsWith('test'));
if (isTestRun && !previewUrl) {
  console.error(
    '[playwright.config] 缺少 E2E_PREVIEW_URL：web 用例必须由驱动启动（pnpm e2e:web），' +
      '它才是 preview 进程的唯一拥有者。直接 `playwright test --project=web` 会连到' +
      '任意占用该端口的进程，结果不可信。',
  );
  process.exit(1);
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    {
      name: 'web',
      testMatch: /web\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: previewUrl,
      },
      // 不在此声明 webServer：preview 进程由 e2e/run-web-e2e.mjs 单点拥有（本地与 CI 同一条路径，
      // 因为 e2e:web 脚本就是「build + 该驱动」）。
      // 旧配置写了 webServer{command,port:4173,reuseExistingServer:!CI,timeout:60s}，实测是死配置：
      // Playwright 只在**给了 url** 时才建可用性回调（runner/index.js:839），我们只写 port →
      // ① 不检查端口占用（不会报 "already used"）；② 照样 spawn 一个 vite，因驱动已占 4173 而
      // EADDRINUSE 退出；③ _waitForProcess 因 isAvailableCallback/stdio 都为空，直接
      // `processExitedPromise.catch(() => {})` 吞掉退出（runner/index.js:935-939）。
      // 结果：每次跑都白起一个必死进程，且「谁在服务 4173」取决于两个进程的抢绑顺序；
      // reuseExistingServer / timeout 两个旋钮在此配置下完全无效。
    },
  ],
});