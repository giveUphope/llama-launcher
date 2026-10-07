import { test, expect, type Page } from '@playwright/test';

/**
 * 引擎获取指引浮层判据（STYLE_TODO #96）
 *
 * 出了什么事：这个浮层原先是自己写的——`Teleport` 到 body + `getBoundingClientRect` 算位置 +
 * 300/150ms 定时器 + resize/scroll 监听 + 自己的 z-index / 阴影 / 入场动画。本轮改挂到
 * Arco 的官方浮层组件 `a-popover` 上，所以这里要证明两件事：
 *   ① 换成库的实现之后，四条通道仍然都在：鼠标悬停开、悬停离开关、Enter 开、Esc 关；
 *   ② 键盘用户仍然进得去浮层内部（浮层里唯一的动作是那个「打开发布页」按钮），
 *      关闭后焦点回到触发器，不会掉到 body 上让键盘用户失去位置。
 * 判据用真事件（Playwright 的 hover / keyboard），不用合成事件——合成 mouseleave 在
 * hover-stay 逻辑上不可靠，实测就得出过「离开不关」的假结论。
 */

const STEP_COUNT = 4;

async function openGeneral(page: Page) {
  await page.goto('/?lang=zh#/settings?tab=general');
  await expect(page.locator('.card-help-icon')).toBeVisible();
}

function popup(page: Page) {
  return page.locator('.arco-popover-popup-content').filter({ has: page.locator('.exe-help-panel') }).first();
}

test('悬停开、离开关：官方 hover 通道两条都通', async ({ page }) => {
  await openGeneral(page);
  const tip = popup(page);
  await expect(tip, '未悬停时浮层不该在屏幕上').toBeHidden();

  await page.hover('.card-help-icon');
  await expect(tip, '悬停触发器后浮层必须出现').toBeVisible();
  expect(await tip.locator('.exe-help-step').count(), '四步指引都要渲染').toBe(STEP_COUNT);

  // 把真指针移到远离触发器与浮层的地方（页面左下空白），Arco 的 leave 计时器才会走
  await page.mouse.move(4, 660);
  await expect(tip, '指针离开后浮层必须关闭——关不掉就是 hover-stay 逻辑失效').toBeHidden({ timeout: 3000 });
});

test('键盘开合：Enter 打开并把焦点送进浮层，Esc 关闭并把焦点还给触发器', async ({ page }) => {
  await openGeneral(page);
  const trigger = page.locator('.card-help-icon');
  await trigger.focus();
  await page.keyboard.press('Enter');

  const tip = popup(page);
  await expect(tip, 'Enter 必须打开浮层').toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('.exe-help-panel')),
    '焦点必须移进浮层，否则键盘到不了里面唯一的按钮').toBe(true);

  await page.keyboard.press('Escape');
  await expect(tip, 'Esc 必须关闭浮层').toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.className || ''),
    '关闭后焦点应回到触发器').toContain('card-help-icon');
});

test('ARIA 与库自带能力对齐：aria-expanded 随开关翻转，表面样式由库提供', async ({ page }) => {
  await openGeneral(page);
  const trigger = page.locator('.card-help-icon');
  expect(await trigger.getAttribute('aria-expanded'), '初始应为 false').toBe('false');
  await page.hover('.card-help-icon');
  const tip = popup(page);
  await expect(tip).toBeVisible();
  expect(await trigger.getAttribute('aria-expanded'), '打开后应为 true').toBe('true');

  // 表面（底 / 边 / 阴影 / 圆角）来自 a-popover 自己的节点，我方不再写第二条声明：
  // 判据取「库的容器有背景与圆角」这一事实，值不钉死（Arco 改档我们跟着走）
  const surface = await tip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow !== 'none' };
  });
  expect(surface.bg, '浮层底由库提供').not.toBe('rgba(0, 0, 0, 0)');
  expect(parseFloat(surface.radius) > 0, '圆角由库提供').toBe(true);
  expect(surface.shadow, '阴影由库提供').toBe(true);

  await page.mouse.move(4, 660);
  await expect(tip).toBeHidden({ timeout: 3000 });
  expect(await trigger.getAttribute('aria-expanded'), '关闭后应回到 false').toBe('false');
});
