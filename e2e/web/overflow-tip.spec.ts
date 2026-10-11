import { test, expect, type Page } from '@playwright/test';

/**
 * 「未截断就不该出回声气泡」的真页面判据（2026-10-11 用户第二次批注：概览页 API 地址
 * `http://127.0.0.1:9931` 全量看得见，悬停却还是弹同一句话）。
 * 两条用例互为对照——只测「不出」那一条，可能只是「浮层机制整个坏了」的假绿：
 *   ① 概览页服务状态卡的 API 地址（未截断）⇒ 悬停不得出气泡；
 *   ② 服务页参数摘要的模型路径值（被省略号截断）⇒ 悬停必须出气泡，内容就是完整路径。
 * 悬停用 Playwright 的真实鼠标事件（Arco 浮层由 trigger 的 mouseenter 驱动，合成事件测不准，
 * 同 `file-browser.spec.ts` 用真滚轮、`help-popover.spec.ts` 用真 hover 的纪律）。
 * 「截断与否」在断言前先量给测试看（`scrollWidth` vs `clientWidth`）：日后布局变了会显式
 * 判红，而不是悄悄换了语义。
 */
async function openPage(page: Page, nav: string) {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: nav }).click();
  await expect(page.locator('.page-frame')).toBeVisible();
}

/** 元素是否被省略号截断（与 ToolTip 内部同一判据：+1 容差防亚像素） */
const isTruncated = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

/**
 * 浮层节点。用 `.arco-tooltip`（Arco 的弹层类，实测挂在 `.arco-trigger-popup` 同一个节点上），
 * **不要用 `[role="tooltip"]`**——那个 role 属性只在 dev 构建里出现，e2e 跑的是 vite build
 * 产物，用 role 选会得到恒 0，把「该弹的」也判成不弹（本轮就在 dev 里探到过 role、
 * 到 preview 上归零，绕了一大圈）。
 */
const visibleTips = (page: Page) => page.locator('.arco-tooltip:visible');

/**
 * 悬停手法：先等 DOM 落定、把指针移开、再进入。
 * 实测从侧栏点进服务页后，摘要 chip 会随模型参数集异步载回**重渲染一次**——指针刚好停在
 * 旧节点上时 mouseenter 丢一次就不会再补（第一次 hover 弹不出、第二次就正常，probe 复现过）。
 * 不这么处理，「该弹的没弹」会被当成缺陷，而「不该弹的没弹」又可能是同一种假绿。
 */
async function hoverSettled(page: Page, target: ReturnType<Page['locator']>) {
  await target.waitFor();
  await page.waitForTimeout(400);
  await page.mouse.move(12, 12);
  await page.waitForTimeout(150);
  await target.hover();
}

test('未截断的值：悬停不出回声气泡（概览页 API 地址）', async ({ page }) => {
  await openPage(page, '概览');
  const apiVal = page.locator('.status-desc .mono-val.ellipsis').nth(1);
  await expect(apiVal).toBeVisible();
  const text = (await apiVal.textContent() ?? '').trim();
  expect(text, '样本要求：API 地址格必须有值').not.toBe('');
  expect(await isTruncated(apiVal), '样本要求：这一格在当前视口下必须完整可见').toBe(false);

  // 与下一条用例悬停同一类目标（ToolTip 宿主），否则「不出气泡」可能只是「悬停没生效」
  await hoverSettled(page, page.locator('.status-desc .tooltip-host').nth(1));
  await page.waitForTimeout(700);
  await expect(visibleTips(page), `文本没被截断，悬停不该再说一遍「${text}」`).toHaveCount(0);
});

test('被截断的值：悬停必须出完整值气泡（服务页摘要的模型路径）', async ({ page }) => {
  await openPage(page, '服务');
  const chipVal = page.locator('.summary-chip .chip-val').first();
  await expect(chipVal).toBeVisible();
  const shown = (await chipVal.textContent() ?? '').trim();
  expect(await isTruncated(chipVal), `样本要求：模型路径值必须真的被截断（当前 ${shown}）`).toBe(true);

  // 悬停目标取 ToolTip 的宿主（Arco 把 mouseenter 绑在它身上），不是里面那层 span
  await hoverSettled(page, page.locator('.summary-chip .tooltip-host', { has: page.locator('.chip-val') }).first());
  await expect
    .poll(async () => visibleTips(page).count(), { message: '截断值必须能悬停出完整值', timeout: 4000 })
    .toBe(1);
  await expect(visibleTips(page).first(), '气泡内容必须是完整值').toHaveText(shown);
});
