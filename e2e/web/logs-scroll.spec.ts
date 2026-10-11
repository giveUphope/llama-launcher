import { test, expect, type Page, type ElementHandle } from '@playwright/test';

// STYLE_TODO #82 的判据：页面骨架（.app-content → .page-host → .page-frame）必须是
// 「有确定高度的弹性列」。这一环失效时的表现是：日志控制台随内容无限长高、内部滚动永远空转
// （scrollTop 赋值后仍是 0）、长页面把外层撑出滚动条。改法要同时满足两件事，缺一条就回到老毛病，
// 所以这里的判据也按两件事分别钉：① 高度可解析（子项 flex:1 拿到真实高）② 溢出滚动而非裁切。
//
// 三条纪律沿用 layout-stability.spec.ts：
//  ① 阈值派生，不写死像素（行数用「远多于一屏」的批量，高度判据写成「不随行数增长」的等式）；
//  ② 判据自带样本要求（胶囊那条必须真的存在「离开底部 + 又来新行」两个状态，否则恒等式空转）；
//  ③ 每条都配「删除实验」：测试内注入覆盖样式模拟骨架退回块流，断言判据必须转红（生产代码一字未动）。

type Lang = 'zh' | 'en';

const NAV_LOGS: Record<Lang, string> = { zh: '日志', en: 'Logs' };
const NAV_PARAMS: Record<Lang, string> = { zh: '参数设置', en: 'Parameters' };
// 2026-10-08 预设页签移除：参数页单视图直出 69 行控件，「长页面」样本不再需要切页签

/**
 * 冷启动进目标页。英文态直接用 `?lang=en`（mock 的 language 由 URL 取，见 demo-mock 的 DEMO_SETTINGS）——
 * 骨架判据要中英各跑一轮，而 mock 设置不落盘，走界面切换后一刷新就回中文。
 */
async function open(page: Page, lang: Lang, nav: string) {
  await page.goto(lang === 'en' ? '/?lang=en' : '/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: nav }).click();
  await expect(page.locator('.page-frame')).toBeVisible();
}

async function openLogs(page: Page, lang: Lang) {
  await open(page, lang, NAV_LOGS[lang]);
  await expect(page.locator('.console')).toBeVisible();
}

/**
 * 灌入 n 行框架输出（mock 钩子，与真实侧同一契约：SERVER_OUTPUT_BATCH 数组逐批推入）。
 * 2026-10-07 档 B 之后，日志页展示的是 llama-server 原始输出（应用操作日志已并到概览页），
 * 所以这一页的滚动判据必须灌框架行，而不是应用日志——沿用 __mockPushAppLog 会让
 * 「远多于一屏」的样本根本进不了这一页的 .console，判据退化成恒等式。
 */
async function pushConsole(page: Page, n: number) {
  const got = await page.evaluate((count) => {
    const hook = (window as unknown as { __mockPushConsole?: (n?: number) => number }).__mockPushConsole;
    if (!hook) throw new Error('缺少 __mockPushConsole 钩子：判据无法造出「远多于一屏」的输出');
    return hook(count);
  }, n);
  expect(got).toBe(n);
}

interface BoxMetric {
  h: number;
  sh: number;
  ch: number;
  innerScroll: boolean;
}

async function metric(page: Page, selector: string): Promise<BoxMetric> {
  return page.locator(selector).first().evaluate((el) => ({
    h: Math.round(el.getBoundingClientRect().height),
    sh: el.scrollHeight,
    ch: el.clientHeight,
    innerScroll: el.scrollHeight > el.clientHeight,
  }));
}

/** scrollTop 赋值后能否停住：这是「内部滚动真的生效」最直接的判别——空盒子恒为 0。 */
async function scrollAndRead(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    el.scrollTop = 99999;
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() => resolve(Math.round(el.scrollTop)));
    });
  });
}

async function injectStyle(page: Page, css: string): Promise<ElementHandle<HTMLElement>> {
  return (await page.addStyleTag({ content: css })) as unknown as ElementHandle<HTMLElement>;
}
async function removeStyle(handle: ElementHandle<HTMLElement>) {
  await handle.evaluate((el) => el.remove());
}

for (const lang of ['zh', 'en'] as Lang[]) {
  test.describe(`日志控制台内部滚动（${lang}）`, () => {
    test('控制台高度不随日志行数增长，且自身可滚', async ({ page }) => {
      await openLogs(page, lang);
      // 先要一个「远少于一屏」的参照：初始缓冲只有几条，此时若骨架正常，控制台已被拉满可视高
      const baseline = await metric(page, '.console');
      expect(baseline.h).toBeGreaterThan(0);

      await pushConsole(page, 400);
      await expect.poll(async () => (await metric(page, '.console')).sh, { timeout: 5000 }).toBeGreaterThan(baseline.sh);

      const after = await metric(page, '.console');
      // ① 高度不增长：行数涨了 400 条，盒子高度必须还是那个值（差值超过 2px 说明它在随内容长高）
      expect(Math.abs(after.h - baseline.h)).toBeLessThanOrEqual(2);
      // ② 内部滚动生效的前提：内容比盒子高
      expect(after.innerScroll).toBe(true);
      expect(after.sh).toBeGreaterThan(after.ch);
    });

    test('scrollTop 赋值后停在非 0 值（自动滚动不再是空转）', async ({ page }) => {
      await openLogs(page, lang);
      await pushConsole(page, 400);
      const top = await scrollAndRead(page, '.console');
      expect(top).toBeGreaterThan(0);
      // 这一页现在是框架控制台，mock 的正常输出流（startOutputFeed，1 行 / 2.5s）会持续追加，
      // 跟随底部时 scrollTop 只会被推向新的最大值。要求「两次读数相等」等于把「有正常输出流」
      // 判成骨架回归（首跑即因此全红：7562 → 7603）。要钉的只有两件事：没被拨回 0、没往回丢位置。
      await page.waitForTimeout(300);
      const again = await page.locator('.console').first().evaluate((el) => Math.round(el.scrollTop));
      expect(again).toBeGreaterThan(0);
      expect(again).toBeGreaterThanOrEqual(top);
    });

    test('滚离底部后来新行 ⇒ 胶囊出现，且不改变控制台高度；点击回到底部后消失', async ({ page }) => {
      await openLogs(page, lang);
      await pushConsole(page, 400);
      await scrollAndRead(page, '.console');

      // 样本要求：必须真的离开底部（否则「有新日志」这个状态根本不存在，判据恒不触发）
      await page.locator('.console').first().evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(200);
      const beforePill = await metric(page, '.console');

      await pushConsole(page, 40);
      const pill = page.locator('.new-logs-bar');
      await expect(pill).toBeVisible();

      // 这一条钉的是用户的原始诉求：提示按钮出现时日志框高度不得跳一档（胶囊是绝对定位）
      const afterPill = await metric(page, '.console');
      expect(afterPill.h).toBe(beforePill.h);

      await pill.click();
      await expect(pill).toHaveCount(0);
      const bottom = await page.locator('.console').first().evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
      expect(bottom).toBeLessThan(80); // 与页面同款判据：距底 < 80px 才算回到底部
    });

    test('长页面在 .page-frame 内滚，外层 .app-content 不再被撑高', async ({ page }) => {
      await open(page, lang, NAV_PARAMS[lang]);
      // 等参数行真的挂载再量几何（原页签点击兼任此等待，2026-10-08 单视图后需显式等）
      await expect(page.locator('.param-row-wrapper').first()).toBeVisible();
      const frame = await metric(page, '.page-frame');
      const content = await metric(page, '.app-content');
      expect(frame.innerScroll).toBe(true); // 参数页 69 行控件，必然超出可视高
      expect(content.innerScroll).toBe(false); // 外层保持等高：滚动位置下移到页面骨架内
      const reachBottom = await scrollAndRead(page, '.page-frame');
      expect(reachBottom).toBeGreaterThan(0);
    });

    test('删除实验：骨架退回块流时，上述判据必须转红', async ({ page }) => {
      await openLogs(page, lang);
      await pushConsole(page, 400);
      const fixed = await metric(page, '.console');
      expect(fixed.innerScroll).toBe(true);

      // 模拟本轮改动被删掉：上层不再给确定高度、页面根退回块流（正是 #82 修复前的形状）
      const handle = await injectStyle(
        page,
        '.app-content{display:block!important;overflow:auto!important}' +
          '.page-host{display:block!important;flex:none!important}' +
          '.page-frame{display:block!important;flex:none!important;min-height:100%!important;overflow:visible!important}',
      );
      await page.waitForTimeout(200);

      const broken = await metric(page, '.console');
      // 判据必须能区分：块流下控制台随内容长高（远大于修复后的高），且内部滚动消失
      expect(broken.h).toBeGreaterThan(fixed.h + 200);
      expect(broken.innerScroll).toBe(false);
      expect(await scrollAndRead(page, '.console')).toBe(0);

      await removeStyle(handle);
      await page.waitForTimeout(200);
      const restored = await metric(page, '.console');
      expect(restored.innerScroll).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// 行数计数的归属（2026-10-09 用户裁定）：自底部状态条并回工具条右簇。
// 底条当年只为它存在（自动滚动文案 b8c1d59 已撤），回潮 = 空占一行的死条。
// ---------------------------------------------------------------------------
type CountStat = { exists: boolean; visible: boolean; inToolbar: boolean; bottomBars: number };

async function collectCount(page: Page): Promise<CountStat> {
  return page.evaluate(() => {
    const lim = document.querySelector('.show-limit') as HTMLElement | null;
    const st = lim ? getComputedStyle(lim) : null;
    return {
      exists: !!lim,
      visible: !!lim && !!st && st.visibility === 'visible' && st.display !== 'none',
      inToolbar: !!lim?.closest('.toolbar-right'),
      bottomBars: document.querySelectorAll('.scroll-hint-bar').length,
    };
  });
}

function judgeCount(s: CountStat): string[] {
  const v: string[] = [];
  if (!s.exists) return ['行数计数元素缺失（.show-limit 不在页面上）'];
  if (!s.visible) v.push('行数计数存在但不可见');
  if (!s.inToolbar) v.push('行数计数不在工具条右簇（.toolbar-right）内');
  if (s.bottomBars > 0) v.push(`底部状态条回潮 ${s.bottomBars} 条（它只为行计数存在，计数并回后应整体拆除）`);
  return v;
}

for (const lang of ['zh', 'en'] as Lang[]) {
  test.describe(`行数计数并入工具条（${lang === 'zh' ? '中文' : '英文'}态）`, () => {
    test('计数在工具条右簇可见、底部状态条零残留；藏起计数时判据转红', async ({ page }) => {
      await openLogs(page, lang);
      expect(judgeCount(await collectCount(page)), `${lang}态计数归属`).toEqual([]);

      // 删除实验：把计数藏起来，判据必须转红（证明「可见」那条腿不是恒真）
      const handle = await injectStyle(page, '.show-limit{visibility:hidden !important}');
      await page.waitForTimeout(120);
      expect(judgeCount(await collectCount(page)).length, '计数被藏起判据必须报警').toBeGreaterThan(0);
      await removeStyle(handle);
      await page.waitForTimeout(120);
      expect(judgeCount(await collectCount(page)), '还原后判据必须转绿').toEqual([]);
    });

    // 计数文案（2026-10-11 用户裁定）：两个相同数字并排不携带信息，只有真的筛掉了行才报分母。
    // 数字全部从页面读，不写死——mock 的喂送定时器会让缓冲区继续增长。
    test('未筛选只报一个数字，筛掉行时才出现「命中 / 总数」', async ({ page }) => {
      await openLogs(page, lang);
      const countText = () => page.locator('.show-limit').innerText().then((t) => t.trim());

      // ① 未筛选：单数字 + 单位，斜杠不得出现（旧写法恒为「N / N 行」，这条判据即为其反例）
      expect(await countText(), `${lang}态未筛选应为单数字`).toMatch(/^\d+ \S+$/);

      // ② 灌 120 行后仍未筛选：还是单数字，且数值真的跟上来了（防「写死 0」的恒等式假绿）
      await pushConsole(page, 120);
      const grown = await countText();
      expect(grown, `${lang}态灌行后仍不得出现分母`).toMatch(/^\d+ \S+$/);
      expect(Number(grown.split(' ')[0]), `${lang}态计数未反映缓冲区：${grown}`).toBeGreaterThanOrEqual(120);

      // ③ 搜索命中一个子集（mock 的 LLAMA_LINES 里只有 2/9 行含 cuda）：分母必须出现，且命中 < 总数
      await page.locator('.search-box input').fill('cuda');
      await expect
        .poll(countText, { message: `${lang}态筛掉行后应报「命中 / 总数」`, timeout: 3000 })
        .toMatch(/^(\d+) \/ (\d+) \S+$/);
      const [hit, total] = (await countText()).split(' ').filter((s) => /^\d+$/.test(s)).map(Number);
      // 命中数必须 >0：漂成 0 命中时「0 / N 行」同样带斜杠，只判 hit<total 会把「搜索一行没命中」
      // 放过去（斜杠本身已蕴含 hit<total，这一条才是真样本要求）
      expect(hit, `${lang}态样本要求：搜索必须真的命中若干行`).toBeGreaterThan(0);
      expect(hit, `${lang}态样本要求：搜索必须真的筛掉行（命中 ${hit} / 总数 ${total}）`).toBeLessThan(total);

      // ④ 清空搜索回到未筛选：分母必须收回（否则③的分支只是加上了没去掉）
      await page.locator('.search-box input').fill('');
      await expect
        .poll(countText, { message: `${lang}态清空搜索应回到单数字`, timeout: 3000 })
        .toMatch(/^\d+ \S+$/);
    });

    // 首次使用空态（?fresh=1 不喂送输出，缓冲区恒 0）：用户批注抓到的正是这一格的「0 / 0 行」
    test('空缓冲区报「0 行」，不得出现「0 / 0」', async ({ page }) => {
      await page.goto(lang === 'en' ? '/?fresh=1&lang=en' : '/?fresh=1');
      await expect(page.locator('.sidebar')).toBeVisible();
      await page.locator('.sidebar .arco-menu-item', { hasText: NAV_LOGS[lang] }).click();
      const lim = page.locator('.show-limit');
      await expect(lim).toBeVisible();
      await expect(lim).toHaveText(lang === 'zh' ? '0 行' : '0 lines');
    });
  });
}
