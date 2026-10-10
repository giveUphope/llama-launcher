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
 * 判据为什么带中文态：只断言「英文态是英文」可能是空转——如果选择器根本没命中节点，
 * 文本集合为空也会绿。中文态要求同一批节点必须读出中文，这才证明量的是库自带文案。
 *
 * 2026-10-08：预设面板删除后 popconfirm 在全站失去最后一个宿主，原「删除预设浮层按钮」
 * 一腿随之移除（不能为测试造一个生产没有的浮层）；Arco 内建文案仍由表格空态腿 +
 * 七页 CJK 残留扫描（中文态正对照）守护。
 */

const CJK = /[\u4e00-\u9fa5]/;

type Lang = 'zh' | 'en';
const url = (lang: Lang, hash = '') => `/?lang=${lang}${hash}`;

/** 把模型表筛到空集，返回 Arco 空态节点的文字 */
async function tableEmptyText(page: Page, lang: Lang) {
  // T21：不在启动期深链 `/?lang=xx#/models`——若 last_tab 恢复晚于路由解析，会把路由
  // replace 回 /dashboard，搜索框自然找不到（T17 成因②）。改为两步：先 goto 裸 URL 等
  // .sidebar（挂载完成标志），**再**改 hash 进模型页——同文档导航由路由直接响应，last_tab
  // 恢复只在启动期跑一次不会抢跑；也不耦合菜单文案（en 态是 "Models"，中文标签点击
  // 会干等 30s 超时，负实验 12/12 红在点击上）。全程不用 waitForTimeout 猜时长。
  await page.goto(url(lang));
  await expect(page.locator('.sidebar'), `${lang} 态侧栏应可见（挂载完成标志）`).toBeVisible();
  await page.goto(url(lang, '#/models'));
  await expect(page).toHaveURL(/#\/models(\?|$)/);
  // 用 .search-row input 而不是 main input：进页路由切换是异步的，泛选择器可能命中
  // 尚未卸载的旧页面输入框，fill 落空后判据就成了「空态没出现」的假失败
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
    // T21：一次性 getAttribute + toBe 不重试，而应用启动是异步的——page.goto 在 load 事件
    // 即返回，早于 i18n store 写 document.documentElement.lang 时读到静态 zh-CN
    // （T17 成因①；负实验实证：退回一次性读取时 en 腿 --repeat-each=12 12/12 全红）。
    // 改 web-first 自动重试断言，由 Playwright 轮询到值正确或超时。
    await expect(page.locator('html'), `${lang} 态 html[lang] 应跟随界面语言`).toHaveAttribute(
      'lang',
      lang === 'en' ? 'en' : 'zh-CN',
    );

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
