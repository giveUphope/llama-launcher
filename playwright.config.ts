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
      webServer: {
        // 直接走 node + vite CLI，避免 Windows 上 pnpm/cmd shim 启动不稳
        command:
          'node node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1 --strictPort --config packages/ui/vite.config.ts',
        port: 4173,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
    },
  ],
});