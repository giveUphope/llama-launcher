import { test, expect, type Page } from '@playwright/test';

// 参数页交互 E2E：验证 Arco 控件（a-switch / a-slider+input-number）可通过 UI 修改值。
// 参数页由侧栏导航进入（demo 设置 last_tab 会在启动时回跳「概览」）。

async function openParams(page: Page) {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: '参数设置' }).click();
  await expect(page).toHaveURL(new RegExp(`#/params(\\?|$)`));
  // 默认落在「参数预设」页签，切到「自定义参数」才渲染参数控件
  await page.locator('.page-tabs .arco-tabs-tab', { hasText: '自定义参数' }).click();
}

test.describe('参数页交互', () => {
  test('切换 checkbox 开关翻转选中态', async ({ page }) => {
    await openParams(page);
    const sw = page.locator('.param-control .arco-switch').first();
    await expect(sw).toBeVisible();

    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'true' : 'false');
  });

  test('滑杆数值输入框修改后值更新', async ({ page }) => {
    await openParams(page);
    const num = page.locator('.slider-control .arco-input-number input').first();
    await expect(num).toBeVisible();

    const max = Number((await num.getAttribute('max')) ?? '1000000');
    const before = Number(await num.inputValue());
    // 未到上限则 +1，已在上限则 -1：保证填值落在 [min,max] 内必然产生变化
    const target = before >= max ? before - 1 : before + 1;
    await num.fill(String(target));
    await num.press('Enter');
    const after = Number(await num.inputValue());
    expect(after).not.toBe(before);
  });
});