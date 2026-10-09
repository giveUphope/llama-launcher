import { test, expect, type Page } from '@playwright/test';
// 参数行数从事实源取（同 layout-stability.spec.ts）：等齐再滚——mock 的 69 行是异步挂载的，
// 行没齐就「滚到底」只会滚到 51px（首屏残段），样本判据恒空转
import { PARAMS } from '../../packages/shared/dist/index.js';

// 切页滚动位置恢复判据（TODO T09，2026-10-09）：参数页（69 行，唯一可滚长页）滚到底 →
// 侧栏切日志页 → 切回参数页，.page-frame 的 scrollTop 必须保留（容差 2px）。
// 背景：keep-alive 缓存的是整页组件（含各自的 .page-frame 滚动容器），切回时内容高度
// 立即就绪（mock 实测 2654 == 离开前），恢复由 PageHost 的 useScrollRestore 在激活后
// 写入——0.0.52 两次失败的根因（外层 .app-content 不在缓存内、高度长不回来）已被
// #82 骨架链改版消除。本判据守住「恢复时序改动后仍有效」。

async function gotoParams(page: Page) {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: '参数设置' }).click();
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

test.describe('切页滚动位置恢复（T09）', () => {
  test('参数页滚到底 → 日志页 → 切回：scrollTop 保留', async ({ page }) => {
    await gotoParams(page);
    // 等全部参数行挂载完成，再「滚到底」——否则 before 是首屏残段的 51px，样本失效
    await expect(page.locator('.param-row-wrapper')).toHaveCount(PARAMS.length);
    await page.evaluate(() => {
      const el = document.querySelector('.page-frame')!;
      el.scrollTop = el.scrollHeight;
    });
    const before = await page.evaluate(() => document.querySelector('.page-frame')!.scrollTop);
    // 样本要求：参数页必须真的可滚（mock 视口下 69 行 > 一屏），否则判据空转
    expect(before).toBeGreaterThan(100);

    await page.locator('.sidebar .arco-menu-item', { hasText: '日志' }).click();
    await expect(page).toHaveURL(/#\/logs/);
    await expect(page.locator('.page-host > *').first()).toBeVisible();

    await page.locator('.sidebar .arco-menu-item', { hasText: '参数设置' }).click();
    await expect(page).toHaveURL(/#\/params/);
    await expect(page.locator('.page-host > *').first()).toBeVisible();
    // 恢复 = nextTick + 高度就绪写入（上限 30 帧），600ms 富余足够
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => document.querySelector('.page-frame')!.scrollTop);
    expect(Math.abs(after - before), `切回后 scrollTop ${after} 应等于离开前 ${before}`).toBeLessThanOrEqual(2);
  });
});
