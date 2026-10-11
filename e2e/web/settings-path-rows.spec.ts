import { test, expect, type Page } from '@playwright/test';

/**
 * 设置页「常规」两行路径控件与状态摘要判据（2026-10-11 用户三条批注）：
 *   ① 两行操作对等——各有「更改」+「打开目录」，目录为空时后者禁用（没处可开）；
 *   ② 引擎状态**只在顶部摘要说一次**——行内那枚状态胶囊连同 156px 定宽槽整体撤除
 *      （同一屏两枚逐字相同的指示器是第二套出口）；
 *   ③ mock 的存在性检测与演示目录树**同源**：树里列得出的目录/文件就算存在，
 *      所以默认现场是「模型目录就绪 + 引擎就绪」这条正向链路，不必开任何钩子。
 * 摘要引擎格四态各有断言：未配置（`?fresh=1`）/ 就绪（默认）/ 未找到（把引擎目录填成
 * 演示树里没有 exe 的目录——`findLlamaExe` 的演示桩真的按目录查，与主进程同「本目录 +
 * 一层子目录」深度）/ 文件缺失（`__mockFsMissing`，此时模型目录那格同步转「不存在」）。
 * **每个状态各占一条用例**：钩子经 `addInitScript` 注入，对同一 page 的后续每次导航都
 * 持续生效——挤在一条用例里，第二条起读到的都是上一条的演示现场（第一版就这么假红过）。
 * 「打开目录」还须把**本行显示的目录原样**交给 `openPath`——按钮存在不等于接对了路径，
 * mock 侧为此把 openPath 桩升级成 `__mockOpenedPaths` 记录钩子。
 */
type Lang = 'zh' | 'en';

const UI: Record<Lang, {
  change: string; open: string;
  exeUnset: string; exeNotFound: string; exeMissing: string; exeReady: string;
  modelReady: string; modelMissing: string;
}> = {
  zh: {
    change: '更改', open: '打开目录',
    exeUnset: '引擎未配置', exeNotFound: '引擎未找到', exeMissing: '引擎文件缺失', exeReady: '引擎就绪',
    modelReady: '模型目录就绪', modelMissing: '模型目录不存在',
  },
  en: {
    change: 'Change', open: 'Open Folder',
    exeUnset: 'Engine not configured', exeNotFound: 'Engine not found',
    exeMissing: 'Engine file missing', exeReady: 'Engine ready',
    modelReady: 'Model dir ready', modelMissing: 'Model dir not found',
  },
};

interface Flags { fresh?: boolean; fsMissing?: boolean }

/** 打开设置页「常规」；演示钩子经 addInitScript 先于页面脚本置位（桩按调用时刻取值）。 */
async function openSettings(page: Page, lang: Lang, opts: Flags = {}) {
  const q: string[] = [];
  if (opts.fresh) q.push('fresh=1');
  if (lang === 'en') q.push('lang=en');
  if (opts.fsMissing) {
    await page.addInitScript(() => {
      (globalThis as unknown as Record<string, unknown>).__mockFsMissing = true;
    });
  }
  await page.goto(`/${q.length ? `?${q.join('&')}` : ''}#/settings`);
  await expect(page.locator('.status-summary')).toBeVisible();
  await expect(page.locator('.path-row')).toHaveCount(2);
  // 摘要三格是「模型目录第二格、引擎第三格」这一前提本身：将来加格或改条件渲染，
  // 下面的 nth() 会指到别处——先把前提钉住，宁可假红也不要指错格还判绿
  await expect(page.locator('.status-summary .summary-item')).toHaveCount(3);
}

/** 把引擎目录改成演示树里另一个目录（走输入框回车，与真实用户同一入口）。 */
async function setEngineDir(page: Page, dir: string) {
  const input = page.locator('.engine-path-row .path-input input').first();
  await input.fill(dir);
  await input.press('Enter');
  // GeneralPanel 的检测有 400ms 去抖，摘要那格还要再跑一次 fileExists
  await page.waitForTimeout(900);
}

const engineItem = (page: Page) => page.locator('.status-summary .summary-item').nth(2);
const modelItem = (page: Page) => page.locator('.status-summary .summary-item').nth(1);
const engineRow = (page: Page) => page.locator('.engine-path-row');

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
      await expect(engineItem(page)).toHaveText(UI[lang].exeUnset);
      await expect(engineRow(page).locator('.exe-tag'), '行内胶囊必须整体撤除').toHaveCount(0);
    });

    test('引擎目录指到没有 exe 的模型目录 → 摘要读「未找到」；指回有 exe 的目录 → 恢复「就绪」', async ({ page }) => {
      await openSettings(page, lang);
      // 演示树里 DeepSeek-R1-7B 只有 .gguf，没有 llama-server.exe，也没有含 exe 的子目录
      await setEngineDir(page, 'D:\\Models\\DeepSeek-R1-7B');
      await expect(engineItem(page), '填错目录与还没动手是两件事，指示必须分开').toHaveText(UI[lang].exeNotFound);
      await expect(engineRow(page).locator('.exe-tag')).toHaveCount(0);
      // 「本目录 + 一层子目录」的深度契约：指到 D:\Models 也应经 llama-bins 找到引擎
      await setEngineDir(page, 'D:\\Models');
      await expect(engineItem(page), '引擎在一级子目录里时必须仍报就绪（与主进程同一深度）').toHaveText(UI[lang].exeReady);
    });

    test('默认现场两行都就绪（检测与演示树同源，正向链路不必开钩子）', async ({ page }) => {
      await openSettings(page, lang);
      await expect(modelItem(page), '模型目录在演示树里列得出，就该判就绪').toHaveText(UI[lang].modelReady);
      await expect(engineItem(page), '引擎 exe 就在演示树里，就该判就绪').toHaveText(UI[lang].exeReady);
      await expect(engineRow(page).locator('.exe-tag')).toHaveCount(0);
    });

    test('路径全查不到时两格同时转阴（模型目录不存在 + 引擎文件缺失）', async ({ page }) => {
      await openSettings(page, lang, { fsMissing: true });
      await expect(modelItem(page)).toHaveText(UI[lang].modelMissing);
      await expect(engineItem(page)).toHaveText(UI[lang].exeMissing);
    });

    test('「打开目录」把本行显示的目录原样交给 openPath', async ({ page }) => {
      await openSettings(page, lang);
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
