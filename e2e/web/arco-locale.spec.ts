import { test, expect, type Page } from '@playwright/test';

/**
 * Arco 组件自带文案必须跟随界面语言（STYLE_TODO #94）
 *
 * 出了什么事：界面切到英文后，删除预设的浮层按钮仍写着「取消 / 确定」，模型表空态写着
 * 「暂无数据」。原因不是我们的字典缺键，而是 Arco 有自己的一套 i18n（`useI18n().t()`），
 * 不显式配置就永远停在随包注册的 zh-CN。修法在 `packages/ui/src/stores/i18n.ts`：
 * 注册英文包 + 随 settings.language 调 `useLocale()`，顺带把 `html[lang]` 一起跟着切
 * （读屏按它选发音规则）。
 *
 * 判据为什么带中文态：只断言「英文态是英文」可能是空转——如果选择器根本没命中按钮，
 * 文本集合为空也会绿。中文态要求同一批节点必须读出中文，这才证明量的是库自带文案。
 */

const CJK = /[\u4e00-\u9fa5]/;

type Lang = 'zh' | 'en';
const url = (lang: Lang, hash = '') => `/?lang=${lang}${hash}`;

/** 打开预设页并弹出「删除预设」的 a-popconfirm，返回浮层里两个按钮的文字 */
async function popconfirmButtons(page: Page, lang: Lang) {
  await page.goto(url(lang, '#/params?tab=presets'));
  const del = page.locator('.col-actions .arco-btn', { hasText: lang === 'en' ? 'Delete' : '删除' }).first();
  await expect(del, `${lang} 态应能命中删除按钮`).toBeVisible();
  await del.click();
  const pop = page.locator('.arco-popconfirm').first();
  await expect(pop).toBeVisible();
  return (await pop.locator('.arco-btn').allTextContents()).map((s) => s.trim());
}

/** 把模型表筛到空集，返回 Arco 空态节点的文字 */
async function tableEmptyText(page: Page, lang: Lang) {
  await page.goto(url(lang, '#/models'));
  // 用 .search-row input 而不是 main input：上一步停在参数页，路由切换是异步的，
  // 泛选择器可能命中旧页面的输入框，fill 落空后判据就成了「空态没出现」的假失败
  const input = page.locator('.search-row input');
  await expect(input, `${lang} 态模型页搜索框应存在`).toBeVisible();
  await input.fill('zzzz-no-such-model');
  const empty = page.locator('.arco-empty-description').first();
  await expect(empty, `${lang} 态筛空后应出现 Arco 空态节点`).toBeVisible();
  const text = (await empty.textContent())?.trim() ?? '';
  await input.fill('');
  return text;
}

/** Arco 自带节点里直接写着的中文（只量节点自己的文本子节点，不量我们 i18n 渲染的内容） */
async function cjkInArcoNodes(page: Page) {
  return page.evaluate(() => {
    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[class*="arco-"]'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join(' ')
        .trim();
      if (!/[\u4e00-\u9fa5]/.test(own)) continue;
      const cls = Array.from(el.classList).find((c) => c.startsWith('arco-')) ?? '';
      hits.push(`.${cls} ${own.slice(0, 24)}`);
    }
    return Array.from(new Set(hits));
  });
}

for (const lang of ['zh', 'en'] as const) {
  test(`Arco 自带文案语言一致性（${lang} 态）`, async ({ page }) => {
    await page.goto(url(lang));
    expect(await page.locator('html').getAttribute('lang'), `${lang} 态 html[lang] 应跟随界面语言`)
      .toBe(lang === 'en' ? 'en' : 'zh-CN');

    const buttons = await popconfirmButtons(page, lang);
      console.log(`[arco-i18n][${lang}] popconfirm 按钮：${JSON.stringify(buttons)}`);
    expect(buttons.length, '浮层应有两个按钮').toBeGreaterThanOrEqual(2);
    if (lang === 'en') {
      for (const b of buttons) expect(CJK.test(b), `英文态浮层按钮出现中文：${b}`).toBe(false);
      expect(buttons.some((b) => /cancel/i.test(b)), '英文态取消按钮应为 Cancel').toBe(true);
    } else {
      // 中文态是正对照：同一批节点必须读出中文，否则上面的英文断言是空转
      expect(buttons.filter((b) => CJK.test(b)).length, '中文态浮层按钮应为中文').toBe(buttons.length);
    }

    const emptyText = await tableEmptyText(page, lang);
    console.log(`[arco-i18n][${lang}] 表格空态：${emptyText}`);
    expect(CJK.test(emptyText), `${lang} 态空态文案：${emptyText}`).toBe(lang === 'zh');

    const leaks: string[] = [];
    let zhHits = 0;
    for (const hash of ['#/dashboard', '#/models', '#/service', '#/params', '#/logs', '#/webui', '#/settings']) {
      await page.goto(url(lang, hash));
      await page.waitForTimeout(400);
      const found = await cjkInArcoNodes(page);
      if (lang === 'en') leaks.push(...found.map((f) => `${hash} ${f}`));
      else zhHits += found.length;
    }
    console.log(lang === 'en'
      ? `[arco-i18n][en] 七页 Arco 节点自带文案中文残留：${leaks.length} 处${leaks.length ? ` ${JSON.stringify(leaks)}` : ''}`
      : `[arco-i18n][zh] 七页中文文本节点命中 ${zhHits} 处（正对照：证明英文态那条检测器不是恒空）`);
    if (lang === 'en') {
      expect(leaks, `英文态中文残留：${JSON.stringify(leaks)}`).toEqual([]);
    } else {
      // 中文态必须量到中文，否则「英文态 0 处」可能只是检测器根本没命中任何东西
      expect(zhHits, '中文态正对照：一处中文都没量到，说明检测器空转').toBeGreaterThan(0);
    }
  });
}
