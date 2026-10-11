import { test, expect, type Page } from '@playwright/test';

/**
 * 设置页「常规」两行路径控件判据（2026-10-11 用户批注三条）：
 *   ① 引擎目录行与模型目录行操作对等——两行都得有「更改」+「打开目录」，目录为空时
 *      后者禁用（没处可开）；
 *   ② 没配引擎目录时行内不再挂灰色「未配置」胶囊（它和空输入框说的是同一件事），
 *      但定宽槽必须留着——槽一撤，检测结论落地那刻整行宽度会跳（STYLE_TODO #81 那类）；
 *   ③ 顶部状态摘要那格要带主语：「引擎未配置」，不是光一句「未配置」。
 * 两态各测一遍：`?fresh=1` 空态与默认已配置态（后者 mock 里 exe 文件不存在，胶囊为
 * 「引擎文件缺失」）。宽度只判「非 0」不钉死数值——槽宽按双语最宽状态文案预留，会随文案变。
 */
type Lang = 'zh' | 'en';

const UI: Record<Lang, { change: string; open: string; exeIdle: string; exeTag: string }> = {
  zh: { change: '更改', open: '打开目录', exeIdle: '引擎未配置', exeTag: '引擎文件缺失' },
  en: { change: 'Change', open: 'Open Folder', exeIdle: 'Engine not configured', exeTag: 'Engine file missing' },
};

async function openSettings(page: Page, lang: Lang, fresh: boolean) {
  const query = fresh ? (lang === 'en' ? '/?fresh=1&lang=en' : '/?fresh=1') : (lang === 'en' ? '/?lang=en' : '/');
  await page.goto(query + '#/settings');
  await expect(page.locator('.status-summary')).toBeVisible();
  await expect(page.locator('.path-row')).toHaveCount(2);
  // 摘要三格是「引擎那格排最后」这一前提本身：将来加第四格或某格改条件渲染，
  // 下面的 nth(2) 会指到别处——先把前提钉住，宁可假红也不要指错格还判绿
  await expect(page.locator('.status-summary .summary-item')).toHaveCount(3);
}

for (const lang of ['zh', 'en'] as Lang[]) {
  test.describe(`设置页路径行控件（${lang === 'zh' ? '中文' : '英文'}态）`, () => {
    test('空态：两行控件对等且「打开目录」禁用，引擎行无胶囊但定宽槽仍在，摘要带主语', async ({ page }) => {
      await openSettings(page, lang, true);
      const engine = page.locator('.engine-path-row');
      for (const row of [page.locator('.path-row').first(), engine]) {
        await expect(row.getByRole('button', { name: UI[lang].change }), '每行都要有「更改」').toBeVisible();
        await expect(row.getByRole('button', { name: UI[lang].open }), '每行都要有「打开目录」').toBeVisible();
        await expect(row.getByRole('button', { name: UI[lang].open }), '目录为空时不得可点').toBeDisabled();
      }
      await expect(engine.locator('.exe-tag'), '空态不该再挂「未配置」胶囊').toHaveCount(0);
      const slotW = await engine.locator('.exe-status-slot').evaluate((el) => el.getBoundingClientRect().width);
      expect(slotW, '定宽槽被撤的话检测结论落地时整行会跳宽').toBeGreaterThan(0);
      await expect(page.locator('.status-summary .summary-item').nth(2)).toHaveText(UI[lang].exeIdle);
    });

    test('已配置态：检测胶囊照常出声，「打开目录」把本行显示的目录原样交给 openPath', async ({ page }) => {
      await openSettings(page, lang, false);
      const engine = page.locator('.engine-path-row');
      await expect(engine.locator('.exe-tag'), '检测结论必须回到行内').toHaveText(UI[lang].exeTag);
      const openBtn = engine.getByRole('button', { name: UI[lang].open });
      await expect(openBtn).toBeEnabled();
      // 按钮存在 ≠ 接对了目录：mock 的 openPath 是记录桩（demo-mock 的 __mockOpenedPaths）
      const shown = await engine.locator('.path-input input').first().inputValue();
      const before = await page.evaluate(() => ((globalThis as unknown as { __mockOpenedPaths?: string[] }).__mockOpenedPaths ?? []).length);
      await openBtn.click();
      const rec = await page.evaluate(() => {
        const a = (globalThis as unknown as { __mockOpenedPaths?: string[] }).__mockOpenedPaths ?? [];
        return { n: a.length, last: a[a.length - 1] ?? null };
      });
      expect(rec.n, '点击必须真的打到 openPath 通道').toBe(before + 1);
      expect(rec.last, '传给 openPath 的必须就是引擎行里那个目录').toBe(shown);
    });
  });
}

// 删除实验（本仓纪律：判据抓不住「把改动退回去」就等于没有价值）：把定宽槽藏起来，
// 空态那条「槽宽 > 0」必须转红——否则它只是「元素在不在」的恒真式。
test('删除实验：藏起定宽槽后，槽宽判据必须归零转红', async ({ page }) => {
  await openSettings(page, 'zh', true);
  const slot = page.locator('.engine-path-row .exe-status-slot');
  expect(await slot.evaluate((el) => el.getBoundingClientRect().width), '基线：槽必须占位').toBeGreaterThan(0);
  const injected = await page.addStyleTag({ content: '.exe-status-slot{display:none !important}' });
  const collapsed = await slot.evaluate((el) => el.getBoundingClientRect().width);
  // 撤注入用 el.remove() 而不是 handle.dispose()——后者只释放句柄、样式节点仍在页上
  await injected.evaluate((el) => el.remove());
  expect(collapsed, '撤槽后判据必须能看见宽度归零').toBe(0);
  expect(await slot.evaluate((el) => el.getBoundingClientRect().width), '撤掉注入后必须回到基线').toBeGreaterThan(0);
});
