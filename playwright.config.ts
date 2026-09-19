import { defineConfig, devices } from '@playwright/test';

// E2E 配置：根级独立于 turbo 的任务链（见 docs/testing.md）。
// - project `web`：跑真实构建产物（vite preview 服务 packages/ui/dist）＋ demo-mock 数据，纯浏览器渲染层验证；
// - Electron 冒烟不在此配置中 —— 由 e2e/electron/run-smoke.mjs 独立脚本承担（Playwright worker
//   teardown 在代理环境下会挂起 30s，独立脚本可给到干净的退出码）。
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
        baseURL: 'http://127.0.0.1:4173',
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