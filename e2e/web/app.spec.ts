import { test, expect, type Page } from '@playwright/test';

// Web 渲染层 E2E：跑真实构建产物（vite preview + demo-mock 数据）。
// demo-mock 在无 window.api 时由 main.ts 注入，静态 UI 自足可离线验证。
// 注意：demo 设置的 last_tab 会在启动时强制回跳「概览」，故导航统一走侧栏点击。

const NAV = [
  { to: '#/dashboard', label: '概览' },
  { to: '#/models', label: '模型管理' },
  { to: '#/service', label: '服务' },
  { to: '#/params', label: '参数设置' },
  { to: '#/logs', label: '日志' },
  { to: '#/webui', label: '内置 Web UI' },
  { to: '#/settings', label: '应用设置' },
];

/** 打开首页等启动完成，再通过侧栏导航到目标页面，返回已就绪的页面。 */
async function openPage(page: Page, label: string, to: string) {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: label }).click();
  await expect(page).toHaveURL(new RegExp(`${to}(\\?|$)`));
  // 页面主体渲染（非白屏）：page-host 下存在激活页面根元素
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

test.describe('侧边栏导航', () => {
  for (const item of NAV) {
    test(`「${item.label}」可点击并切换到对应页面`, async ({ page }) => {
      await openPage(page, item.label, item.to);
    });
  }
});

test.describe('demo-mock 数据注入', () => {
  test('模型页展示演示模型列表', async ({ page }) => {
    await openPage(page, '模型管理', '#/models');
    await expect(
      page.locator('.models-table .model-name-row', { hasText: 'Qwen3-32B-A3B-Instruct-Q4_K_M.gguf' }),
    ).toBeVisible();
  });

  test('服务页展示 running 状态卡', async ({ page }) => {
    await openPage(page, '服务', '#/service');
    await expect(page.getByText('运行中', { exact: true }).first()).toBeVisible();
  });
});