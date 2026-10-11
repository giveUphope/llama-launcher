import { test, expect, type Page } from '@playwright/test';

/**
 * 设置页「常规」两行路径控件判据（2026-10-11 用户两条批注）：
 *   ① 两行操作对等——各有「更改」+「打开目录」，目录为空时后者禁用（没处可开）；
 *   ② 引擎状态**只在顶部摘要说一次**——行内那枚状态胶囊连同 156px 定宽槽整体撤除
 *      （此前同一屏会出现两枚逐字相同的指示器，那是第二套出口）。
 * 摘要引擎格四态各有断言：未配置（`?fresh=1`）/ 未找到（`__mockEngineNotFound`）/
 * 文件缺失（默认态）/ 就绪（`__mockEngineFileExists`）。
 * **每个状态各占一条用例**：钩子是经 `addInitScript` 注入的，它对同一 page 的后续每次
 * 导航都生效——四条断言挤在一条用例里，第二条起读到的都是上一条留下的演示现场
 * （第一版就这么假红过：默认态被前一条的 `__mockEngineNotFound` 粘住，读出「引擎未找到」）。
 * 「打开目录」还须把**本行显示的目录原样**交给 `openPath`——按钮存在不等于接对了路径，
 * mock 侧为此把 openPath 桩升级成 `__mockOpenedPaths` 记录钩子。
 */
type Lang = 'zh' | 'en';

const UI: Record<Lang, {
  change: string; open: string;
  unset: string; notFound: string; missing: string; ready: string;
}> = {
  zh: { change: '更改', open: '打开目录', unset: '引擎未配置', notFound: '引擎未找到', missing: '引擎文件缺失', ready: '引擎就绪' },
  en: {
    change: 'Change', open: 'Open Folder',
    unset: 'Engine not configured', notFound: 'Engine not found', missing: 'Engine file missing', ready: 'Engine ready',
  },
};

interface Flags { fresh?: boolean; engineNotFound?: boolean; engineExists?: boolean }

/** 打开设置页「常规」；演示钩子经 addInitScript 先于页面脚本置位（桩按调用时刻取值）。 */
async function openSettings(page: Page, lang: Lang, opts: Flags = {}) {
  const q: string[] = [];
  if (opts.fresh) q.push('fresh=1');
  if (lang === 'en') q.push('lang=en');
  if (opts.engineNotFound || opts.engineExists) {
    await page.addInitScript((f) => {
      const g = globalThis as unknown as Record<string, unknown>;
      if (f.notFound) g.__mockEngineNotFound = true;
      if (f.exists) g.__mockEngineFileExists = true;
    }, { notFound: !!opts.engineNotFound, exists: !!opts.engineExists });
  }
  await page.goto(`/${q.length ? `?${q.join('&')}` : ''}#/settings`);
  await expect(page.locator('.status-summary')).toBeVisible();
  await expect(page.locator('.path-row')).toHaveCount(2);
  // 摘要三格是「引擎那格排最后」这一前提本身：将来加格或改条件渲染，下面的 nth(2)
  // 会指到别处——先把前提钉住，宁可假红也不要指错格还判绿
  await expect(page.locator('.status-summary .summary-item')).toHaveCount(3);
}

const engineItem = (page: Page) => page.locator('.status-summary .summary-item').nth(2);
const engineRow = (page: Page) => page.locator('.engine-path-row');
const noChip = (page: Page, why: string) => expect(engineRow(page).locator('.exe-tag'), why).toHaveCount(0);

for (const lang of ['zh', 'en'] as Lang[]) {
  const name = lang === 'zh' ? '中文' : '英文';
  test.describe(`设置页路径行控件（${name}态）`, () => {
    test('两行控件对等，空目录时「打开目录」禁用', async ({ page }) => {
      await openSettings(page, lang, { fresh: true });
      for (const row of [page.locator('.path-row').first(), engineRow(page)]) {
        await expect(row.getByRole('button', { name: UI[lang].change }), '每行都要有「更改」').toBeVisible();
        await expect(row.getByRole('button', { name: UI[lang].open }), '每行都要有「打开目录」').toBeVisible();
        await expect(row.getByRole('button', { name: UI[lang].open }), '目录为空时不得可点').toBeDisabled();
      }
    });

    test('什么都没配 → 摘要读「未配置」，行内不出胶囊', async ({ page }) => {
      await openSettings(page, lang, { fresh: true });
      await expect(engineItem(page)).toHaveText(UI[lang].unset);
      await noChip(page, '空态行内不得有第二处指示');
    });

    test('目录填了但里面没有 llama-server → 摘要读「未找到」而不是「未配置」', async ({ page }) => {
      await openSettings(page, lang, { engineNotFound: true });
      await expect(engineItem(page), '填错目录与还没动手是两件事，指示必须分开').toHaveText(UI[lang].notFound);
      await noChip(page, '这一态同样不许在行内再说一遍');
    });

    test('找到路径但文件不存在 → 摘要读「文件缺失」，且「打开目录」把本行目录原样交给 openPath', async ({ page }) => {
      await openSettings(page, lang);
      await expect(engineItem(page)).toHaveText(UI[lang].missing);
      await noChip(page, '有结论时也不该在行内重复');
      const shown = await engineRow(page).locator('.path-input input').first().inputValue();
      expect(shown, '样本要求：引擎目录必须非空，否则这条判据打在禁用态上').not.toBe('');
      const before = await page.evaluate(() => ((globalThis as unknown as { __mockOpenedPaths?: string[] }).__mockOpenedPaths ?? []).length);
      await engineRow(page).getByRole('button', { name: UI[lang].open }).click();
      const rec = await page.evaluate(() => {
        const a = (globalThis as unknown as { __mockOpenedPaths?: string[] }).__mockOpenedPaths ?? [];
        return { n: a.length, last: a[a.length - 1] ?? null };
      });
      expect(rec.n, '点击必须真的打到 openPath 通道').toBe(before + 1);
      expect(rec.last, '传给 openPath 的必须就是引擎行里那个目录').toBe(shown);
    });

    test('引擎文件存在 → 摘要读「就绪」', async ({ page }) => {
      await openSettings(page, lang, { engineExists: true });
      await expect(engineItem(page)).toHaveText(UI[lang].ready);
      await noChip(page, '好消息也不许在行内再说一遍');
    });
  });
}

// 删除实验（本仓纪律：判据抓不住「把改动退回去」就等于没有价值）：往引擎行塞回一枚
// `.exe-tag`，「行内不出胶囊」那条腿必须转红——否则它只是「元素本来就不在」的恒真式。
test('删除实验：行内塞回一枚状态胶囊，判据必须看见', async ({ page }) => {
  await openSettings(page, 'zh');
  await expect(engineRow(page).locator('.exe-tag'), '基线：行内不得有胶囊').toHaveCount(0);
  const injected = await page.evaluate(() => {
    const row = document.querySelector('.engine-path-row');
    if (!row) return 0;
    const tag = document.createElement('span');
    tag.className = 'exe-tag';
    tag.textContent = '引擎文件缺失';
    row.appendChild(tag);
    return row.querySelectorAll('.exe-tag').length;
  });
  expect(injected, '样本要求：引擎行必须存在且塞得进节点').toBe(1);
  await expect(engineRow(page).locator('.exe-tag'), '塞回胶囊后判据必须转红').toHaveCount(1);
});
