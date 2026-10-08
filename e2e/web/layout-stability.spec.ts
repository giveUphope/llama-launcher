import { test, expect, type Page, type ElementHandle } from '@playwright/test';
// 参数总数从事实源取（同 app.spec.ts）：写死的行数每加一个参数就红一次，于是人去改数字而不是看布局。
import { PARAMS } from '../../packages/shared/dist/index.js';

// 布局跳变判据 E2E（STYLE_TODO #81）：这一轮修的是「v-if 元素没有默认占位、数据到位才插进正常流」
// 造成的界面跳一下，修法全是**静态预留**（常驻槽 flex: 0 0 Npx / min-height / visibility: hidden / 绝对定位）。
// 本文件把这些预留变成可判别的自动化判据，三条纪律：
//  ① 阈值一律派生，不写死像素：宽度判据写成「全行取集合后 size === 1」，行数取 PARAMS.length；
//     唯一写死的数是「非零」——预留若塌成 0 高/0 宽就等于没预留，这一条不依赖具体档位。
//  ② 判据自带样本要求：例如「行高不随徽章数变化」必须真的存在两种徽章数，否则等式恒成立＝空转，
//     这类情形直接判红并说明是数据问题。
//  ③ 每条判据配一个「删除实验」用例：在**测试内**用 addStyleTag 注入覆盖样式模拟预留被删
//     （生产代码一字未动），断言判据必须转红；随后移除注入。判据抓不住删除＝没有价值，须当场暴露。
// 注意：scoped 样式带 [data-v-xxx] 属性选择器，注入 !important 规则仍可覆盖（特异性 + important）。

type Lang = 'zh' | 'en';

// 侧栏/页签文案：zh 为权威，en 取 shared/src/i18n/en.ts 的实测值。
// 设置页与「外观」页签恒按中文点击——每条用例都是全新 context，mock 初始语言是 zh，
// 语言切换发生在切到目标语言之前（沿用 app.spec.ts setLanguage 的做法）。
const UI = {
  zh: { dashboard: '概览', models: '模型管理', params: '参数设置', local: '本地模型', library: '模型库' },
  en: { dashboard: 'Overview', models: 'Models', params: 'Parameters', local: 'Local', library: 'Library' },
};

const ROUTE: Record<string, string> = {
  dashboard: '#/dashboard',
  models: '#/models',
  params: '#/params',
};

/** 冷启动 → 需要时切英文 → 走侧栏到目标页（demo 的 last_tab 会回跳概览，故不用 URL 直达）。 */
async function gotoPage(page: Page, lang: Lang, key: 'dashboard' | 'models' | 'params') {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  if (lang === 'en') {
    await page.locator('.sidebar .arco-menu-item', { hasText: '应用设置' }).click();
    await page.locator('.arco-tabs-tab', { hasText: '外观' }).click();
    await page.locator('.arco-form-item', { hasText: '语言' }).first().locator('.arco-select').click();
    await page.locator('.arco-select-option', { hasText: 'English' }).first().click();
    await expect(page.locator('.sidebar .arco-menu-item', { hasText: 'Overview' })).toBeVisible();
  }
  await page.locator('.sidebar .arco-menu-item', { hasText: UI[lang][key] }).click();
  await expect(page).toHaveURL(new RegExp(`${ROUTE[key]}(\\?|$)`));
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

/** 点模型页的子页签（本地模型 / 模型库）。 */
async function openModelsTab(page: Page, lang: Lang, key: 'local' | 'library') {
  await page.locator('.page-tabs .arco-tabs-tab', { hasText: UI[lang][key] }).click();
}

/** 注入覆盖样式，返回句柄；测毕 removeStyle 撤掉，避免同一条用例后续判据互相污染。 */
async function injectStyle(page: Page, css: string): Promise<ElementHandle<HTMLElement>> {
  return (await page.addStyleTag({ content: css })) as unknown as ElementHandle<HTMLElement>;
}
async function removeStyle(handle: ElementHandle<HTMLElement>) {
  await handle.evaluate((el) => el.remove());
}

const toPx = (n: number) => Math.round(n * 100) / 100;
const samePx = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
/** 一维数组的去重结果（按 0.01px 归整，避开 subpixel 噪声） */
const distinct = (xs: number[]) => Array.from(new Set(xs.map(toPx)));

// ---------------------------------------------------------------------------
// ① 参数页三类常驻槽：.gguf-hint-slot / .dep-hint-slot / .clear-slot
//    判据：槽数量 = 参数行数（槽恒在，缺席即回归为「后插入挤压」），
//         同类槽宽度全行唯一（去掉定宽后：空槽塌成 0 宽、有内容槽按内容变宽，两个方向都会破这条），
//         宽度 > 0（定宽被删且内容空 = 预留名存实亡）。
// ---------------------------------------------------------------------------
type SlotRow = { gguf: number | null; dep: number | null; clear: number | null };
const SLOT_LABEL: Record<keyof SlotRow, string> = {
  gguf: '.gguf-hint-slot（建议值提示槽）',
  dep: '.dep-hint-slot（依赖警示槽）',
  clear: '.clear-slot（还原 ✕ 槽）',
};

async function collectParamSlots(page: Page): Promise<SlotRow[]> {
  return page
    .locator('.param-row-wrapper')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const widthOf = (sel: string) => {
          const el = row.querySelector(sel) as HTMLElement | null;
          return el ? el.getBoundingClientRect().width : null;
        };
        return { gguf: widthOf('.gguf-hint-slot'), dep: widthOf('.dep-hint-slot'), clear: widthOf('.clear-slot') };
      }),
    );
}

function judgeParamSlots(rows: SlotRow[], expected: number): string[] {
  const v: string[] = [];
  if (rows.length !== expected) v.push(`参数行渲染数 ${rows.length} ≠ PARAMS.length ${expected}`);
  (Object.keys(SLOT_LABEL) as Array<keyof SlotRow>).forEach((k) => {
    const widths = rows.map((r) => r[k]);
    const absent = widths.filter((w) => w === null).length;
    if (absent) v.push(`${SLOT_LABEL[k]} 缺席 ${absent}/${rows.length} 行（槽必须常驻）`);
    const have = widths.filter((w): w is number => w !== null);
    if (!have.length) return;
    const uniq = distinct(have);
    if (uniq.length > 1) v.push(`${SLOT_LABEL[k]} 宽度不唯一：[${uniq.join(', ')}]（定宽槽被内容或空塌挤成多档）`);
    else if (uniq[0] <= 0) v.push(`${SLOT_LABEL[k]} 宽度塌为 ${uniq[0]}px（预留不存在）`);
  });
  return v;
}

async function openCustomParams(page: Page, lang: Lang) {
  await gotoPage(page, lang, 'params');
  // 2026-10-08 预设页签移除：参数页单视图直出 69 行，无需切页签
  await expect(page.locator('.param-row-wrapper').first()).toBeVisible();
}

// ---------------------------------------------------------------------------
// ② 模型表行高不随徽章数变化：.model-tags 容器恒渲染 + min-height 预留一行
//    判据：每行都有徽章排容器 / 其 min-height > 0 / 行高集合唯一；
//         并额外要求样本里徽章数确实有两种以上，否则「等式」无人守护（判红并说明是数据问题）。
// ---------------------------------------------------------------------------
type ModelRowStat = { h: number; badges: number; hasWrap: boolean; minH: number };

async function collectModelRows(page: Page): Promise<ModelRowStat[]> {
  return page
    .locator('.models-table tbody .arco-table-tr')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const wrap = row.querySelector('.model-tags') as HTMLElement | null;
        return {
          h: row.getBoundingClientRect().height,
          badges: wrap ? wrap.querySelectorAll('.arco-tag').length : -1,
          hasWrap: !!wrap,
          minH: wrap ? parseFloat(getComputedStyle(wrap).minHeight) || 0 : 0,
        };
      }),
    );
}

function judgeModelRows(rows: ModelRowStat[]): string[] {
  const v: string[] = [];
  if (rows.length < 2) {
    v.push(`模型表行数为 ${rows.length}，样本不足无法判「行高与徽章数无关」`);
    return v;
  }
  const missingWrap = rows.filter((r) => !r.hasWrap).length;
  if (missingWrap) v.push(`徽章排容器 .model-tags 缺席 ${missingWrap}/${rows.length} 行（应为恒渲染）`);
  const minHs = rows.map((r) => r.minH);
  if (minHs.some((m) => m <= 0)) {
    v.push(`.model-tags 预留 min-height 为 0（[${distinct(minHs).join(', ')}]），行高重新由徽章数决定`);
  }
  const badgeCounts = distinct(rows.map((r) => r.badges));
  if (badgeCounts.length < 2) {
    v.push(`演示数据里徽章数只有 ${badgeCounts[0]} 一种，行高等式在此数据上不可判别（非生产问题）`);
  }
  const hs = distinct(rows.map((r) => r.h));
  if (hs.length > 1) {
    v.push(`行高出现 ${hs.length} 档：[${hs.join(', ')}]；各行徽章数=${rows.map((r) => r.badges).join('/')}（行高被徽章数带着走）`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// ③ 概览页两档失败槽 + 端点提示槽
// ---------------------------------------------------------------------------
type FailureStat = { exists: boolean; slotH: number; rowH: number; oomH: number; rowMin: number; oomMin: number; oomMargin: number };

async function collectFailureSlot(page: Page): Promise<FailureStat> {
  return page.evaluate(() => {
    const pick = (sel: string) => document.querySelector(sel) as HTMLElement | null;
    const box = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().height : 0);
    const min = (el: HTMLElement | null) => (el ? parseFloat(getComputedStyle(el).minHeight) || 0 : 0);
    const marg = (el: HTMLElement | null) => (el ? parseFloat(getComputedStyle(el).marginTop) || 0 : 0);
    const slot = pick('.failure-banner-slot');
    const row = pick('.failure-row');
    const oom = pick('.oom-row');
    return {
      exists: !!slot && !!row && !!oom,
      slotH: box(slot),
      rowH: box(row),
      oomH: box(oom),
      rowMin: min(row),
      oomMin: min(oom),
      oomMargin: marg(oom),
    };
  });
}

function judgeFailureSlot(s: FailureStat): string[] {
  const v: string[] = [];
  if (!s.exists) return ['.failure-banner-slot / .failure-row / .oom-row 有缺席（两档预留被拆）'];
  if (s.rowMin <= 0 || s.oomMin <= 0) v.push(`两档 min-height 出现 0（banner ${s.rowMin} / oom ${s.oomMin}），内容到位就会顶高下方`);
  if (s.rowH <= 0 || s.oomH <= 0) v.push(`隐藏态档位高度塌为 0（banner ${s.rowH} / oom ${s.oomH}），占位没留住`);
  const sum = s.rowH + s.oomH + s.oomMargin;
  if (!samePx(s.slotH, sum)) v.push(`槽高 ${toPx(s.slotH)} ≠ 两档之和 ${toPx(sum)}（banner ${toPx(s.rowH)} + oom ${toPx(s.oomH)} + 上边距 ${toPx(s.oomMargin)}）`);
  return v;
}

type SecHintStat = { exists: boolean; h: number; min: number };

async function collectSecHint(page: Page): Promise<SecHintStat> {
  return page.evaluate(() => {
    const el = document.querySelector('.sec-hint-slot') as HTMLElement | null;
    return {
      exists: !!el,
      h: el ? el.getBoundingClientRect().height : 0,
      min: el ? parseFloat(getComputedStyle(el).minHeight) || 0 : 0,
    };
  });
}

function judgeSecHint(s: SecHintStat): string[] {
  if (!s.exists) return ['.sec-hint-slot 缺席（提示行改回 v-if 了）'];
  if (s.min <= 0) return [`.sec-hint-slot min-height 为 0，档位不再锁定（实测高 ${toPx(s.h)}）`];
  if (!samePx(s.h, s.min)) return [`.sec-hint-slot 高 ${toPx(s.h)} ≠ min-height ${toPx(s.min)}（内容超出预留档，会顶高下方）`];
  return [];
}

// ---------------------------------------------------------------------------
// ④ 下载卡空态即占位：.parse-status-slot（解析结果空态）与 .task-empty（无任务空态）
//    两者是同一预留档（DownloadCard 注释「统一到 38 档」），故判「各自 > 0 且同高」；
//    同高比「只判 > 0」更可判别：.task-empty 自带文案，删掉 min-height 后它仍 > 0，
//    但对不上兄弟槽的档位——单靠 > 0 会漏。
// ---------------------------------------------------------------------------
type EmptySlot = { exists: boolean; h: number; min: number };
type DownloadStat = { parse: EmptySlot; taskEmpty: EmptySlot };

async function collectDownloadSlots(page: Page): Promise<DownloadStat> {
  return page.evaluate(() => {
    const one = (sel: string): EmptySlot => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return {
        exists: !!el,
        h: el ? el.getBoundingClientRect().height : 0,
        min: el ? parseFloat(getComputedStyle(el).minHeight) || 0 : 0,
      };
    };
    return { parse: one('.parse-status-slot'), taskEmpty: one('.task-empty') };
  });
}

function judgeDownloadSlots(s: DownloadStat): string[] {
  const v: string[] = [];
  if (!s.parse.exists) v.push('.parse-status-slot 缺席（解析状态槽改回 v-if 了）');
  if (!s.taskEmpty.exists) v.push('.task-empty 缺席（0 任务时任务区不再有空态占位）');
  for (const [name, one] of [['.parse-status-slot', s.parse], ['.task-empty', s.taskEmpty]] as const) {
    if (!one.exists) continue;
    if (one.min <= 0) v.push(`${name} min-height 为 0，预留档消失（实测高 ${toPx(one.h)}）`);
    if (one.h <= 0) v.push(`${name} 空态高度塌为 0（内容到位即整块下移）`);
  }
  if (s.parse.exists && s.taskEmpty.exists && !samePx(s.parse.h, s.taskEmpty.h)) {
    v.push(`两处空态不同档：.parse-status-slot ${toPx(s.parse.h)} vs .task-empty ${toPx(s.taskEmpty.h)}`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// ⑤ 顶栏模型按钮定宽：.model-name 的 min-width
//    两条腿：a) 真切换两个模型（用户流程）名字长度不同、宽度必须相同；
//           b) 文本探针——同一元素换成短名后宽度必须不变。
//    b 才是能抓住 min-width 被删的那条：演示模型名都长于 180px 上限，删掉 min-width 后
//    a 的两个名字仍各自被 max-width 夹到同一档，等式照样成立（该局限写进报告，不当作已验证）。
// ---------------------------------------------------------------------------
type NameStat = { w: number; name: string; nameLen: number };
type TopBarStat = { longW: number | null; shortW: number | null; picks: NameStat[] };

async function modelNameWidth(page: Page): Promise<number> {
  return page.locator('.tb-model .model-name').evaluate((el) => el.getBoundingClientRect().width);
}

/** 打开顶栏模型下拉，按序号（支持 -1 取末项）选一个模型，返回按钮上的名字与宽度。 */
async function pickModel(page: Page, index: number): Promise<NameStat> {
  await page.locator('.tb-model').click();
  const opts = page.locator('.dd-item');
  await expect(opts.first()).toBeVisible();
  const n = await opts.count();
  const target = opts.nth(index < 0 ? n + index : index);
  const name = (await target.locator('.dropdown-name').textContent())?.trim() ?? '';
  await target.click();
  await expect(page.locator('.tb-model .model-name')).toHaveText(name, { timeout: 5_000 }).catch(() => undefined);
  return { w: await modelNameWidth(page), name, nameLen: name.length };
}

async function collectTopBar(page: Page): Promise<TopBarStat> {
  await gotoPage(page, 'zh', 'dashboard');
  const picks: NameStat[] = [];
  for (const idx of [0, -1, 1]) {
    const p = await pickModel(page, idx);
    if (!picks.some((x) => x.name === p.name)) picks.push(p);
  }
  const handle = await page.locator('.tb-model .model-name');
  const longW = await handle.evaluate((el) => el.getBoundingClientRect().width);
  const original = await handle.evaluate((el) => el.textContent ?? '');
  // 探针：把文本换成远短于预留档的名字（Vue 不重渲该节点，量完还原）
  await handle.evaluate((el) => {
    (el as HTMLElement).textContent = 'a.gguf';
  });
  const shortW = await handle.evaluate((el) => el.getBoundingClientRect().width);
  await handle.evaluate((el, text) => {
    (el as HTMLElement).textContent = text;
  }, original);
  return { longW, shortW, picks };
}

function judgeTopBar(s: TopBarStat): string[] {
  const v: string[] = [];
  if (s.longW === null || s.shortW === null) return ['.model-name 选择失败'];
  if (s.longW <= 0) v.push(`.model-name 宽度为 ${toPx(s.longW)}（按钮名区塌陷）`);
  if (!samePx(s.longW, s.shortW ?? -1)) {
    v.push(`短名把 .model-name 缩窄：长名 ${toPx(s.longW)} vs 短名 ${toPx(s.shortW ?? NaN)}（min-width 预留未生效）`);
  }
  const picked = distinct(s.picks.map((p) => p.w));
  if (picked.length > 1) v.push(`切换模型后按钮名区宽窄不一：[${picked.join(', ')}]，模型：${s.picks.map((p) => `${p.name}(${p.nameLen})`).join(' / ')}`);
  if (distinct(s.picks.map((p) => p.nameLen)).length < 2) {
    v.push(`下拉里取到的模型名长度全等（${s.picks.map((p) => p.nameLen).join('/')}），切换判据无区分力（非生产问题）`);
  }
  return v;
}

// ===========================================================================
// 判据用例
// ===========================================================================
for (const lang of ['zh', 'en'] as const) {
  const langName = lang === 'zh' ? '中文' : '英文';

  test.describe(`布局跳变判据（${langName}态）`, () => {
    test(`①参数页三类常驻槽：数量=参数行数且同类宽度唯一非零`, async ({ page }) => {
      await openCustomParams(page, lang);
      expect(judgeParamSlots(await collectParamSlots(page), PARAMS.length), `${langName}态参数页槽位`).toEqual([]);
    });

    test(`②模型表行高不随徽章数变化`, async ({ page }) => {
      await gotoPage(page, lang, 'models');
      await openModelsTab(page, lang, 'local');
      await expect(page.locator('.models-table tbody .arco-table-tr').first()).toBeVisible();
      expect(judgeModelRows(await collectModelRows(page)), `${langName}态模型表`).toEqual([]);
    });

    test(`③概览失败槽两档常驻且等高，端点提示槽恒等于 min-height`, async ({ page }) => {
      await gotoPage(page, lang, 'dashboard');
      await expect(page.locator('.failure-banner-slot')).toBeAttached();
      expect(judgeFailureSlot(await collectFailureSlot(page)), `${langName}态失败槽`).toEqual([]);
      expect(judgeSecHint(await collectSecHint(page)), `${langName}态端点提示槽`).toEqual([]);
    });

    test(`④下载卡空态即占位（解析槽与任务空态同档非零）`, async ({ page }) => {
      await gotoPage(page, lang, 'models');
      await openModelsTab(page, lang, 'library');
      await expect(page.locator('.parse-status-slot')).toBeAttached();
      expect(judgeDownloadSlots(await collectDownloadSlots(page)), `${langName}态下载卡`).toEqual([]);
    });
  });
}

test.describe('布局跳变判据（顶栏）', () => {
  test('⑤顶栏模型名区定宽：切换不同模型与短名探针都不改变宽度', async ({ page }) => {
    expect(judgeTopBar(await collectTopBar(page)), '顶栏模型按钮').toEqual([]);
  });
});

// ===========================================================================
// 删除实验（判据自证）：注入「预留被删掉」的等价样式，断言上面那条判据必须转红。
// 每条先跑基线（必须绿），再注入（必须红），最后撤掉注入。跑不进红的判据等于没守着。
// ===========================================================================
test.describe('判据自证：删除预留后必须报警', () => {
  test('①三类槽改回内容自适应（去掉 flex 定宽）→ 宽度判据转红', async ({ page }) => {
    await openCustomParams(page, 'zh');
    const before = judgeParamSlots(await collectParamSlots(page), PARAMS.length);
    expect(before, '基线（注入前）应无报警').toEqual([]);
    const h = await injectStyle(
      page,
      '.gguf-hint-slot,.dep-hint-slot,.clear-slot{flex:0 0 auto !important;min-width:0 !important;width:auto !important}',
    );
    const after = judgeParamSlots(await collectParamSlots(page), PARAMS.length);
    expect(after.length, `槽宽改为内容驱动后仍无报警＝①判据空转（注入前结论：${before.join('；') || '通过'}）`).toBeGreaterThan(0);
    await removeStyle(h);
  });

  test('②徽章排容器按「少徽章数行缺席 + 全部档位 min-height 归零」两种删法 → 行高判据转红', async ({ page }) => {
    await gotoPage(page, 'zh', 'models');
    await openModelsTab(page, 'zh', 'local');
    const rows = await page.locator('.models-table tbody .arco-table-tr').count();
    const target = rows > 1 ? 1 : 0;
    const scope = `.models-table tbody .arco-table-tr:nth-of-type(${target + 1})`;
    const before = judgeModelRows(await collectModelRows(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    // 模拟修复前的 v-if：只让一行没有徽章排 → 该行少一行高度，等式当场破
    const h1 = await injectStyle(page, `${scope} .model-tags{display:none !important}`);
    const afterWrap = judgeModelRows(await collectModelRows(page));
    await removeStyle(h1);
    expect(afterWrap.length, '抽掉一行徽章排后行高判据未报警＝②-等式空转').toBeGreaterThan(0);
    // 模拟「容器在但 min-height 删了」：等式抓不到，须由 min-height>0 那一支报警
    const h2 = await injectStyle(page, '.model-tags{min-height:0 !important}');
    const afterMin = judgeModelRows(await collectModelRows(page));
    await removeStyle(h2);
    expect(afterMin.length, 'min-height 归零后判据未报警＝②-预留档空转').toBeGreaterThan(0);
  });

  test('③两档 min-height 归零 → 失败槽判据转红', async ({ page }) => {
    await gotoPage(page, 'zh', 'dashboard');
    const before = judgeFailureSlot(await collectFailureSlot(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    const h = await injectStyle(page, '.failure-row,.oom-row{min-height:0 !important}');
    const after = judgeFailureSlot(await collectFailureSlot(page));
    await removeStyle(h);
    expect(after.length, `min-height 归零后仍无报警＝③-失败槽空转（两档高 ${JSON.stringify(await collectFailureSlot(page))}）`).toBeGreaterThan(0);
  });

  test('③端点提示槽 min-height 归零 → 恒等 min-height 的判据转红', async ({ page }) => {
    await gotoPage(page, 'zh', 'dashboard');
    const before = judgeSecHint(await collectSecHint(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    const h = await injectStyle(page, '.sec-hint-slot{min-height:0 !important}');
    const after = judgeSecHint(await collectSecHint(page));
    await removeStyle(h);
    expect(after.length, 'min-height 归零后仍无报警＝③-提示槽空转').toBeGreaterThan(0);
  });

  test('④空态预留归零 → 下载卡判据转红（两个槽分别试）', async ({ page }) => {
    await gotoPage(page, 'zh', 'models');
    await openModelsTab(page, 'zh', 'library');
    const before = judgeDownloadSlots(await collectDownloadSlots(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    const h1 = await injectStyle(page, '.task-empty{min-height:0 !important}');
    const afterEmpty = judgeDownloadSlots(await collectDownloadSlots(page));
    await removeStyle(h1);
    expect(afterEmpty.length, '.task-empty 预留归零后仍无报警＝④-任务空态空转').toBeGreaterThan(0);
    const h2 = await injectStyle(page, '.parse-status-slot{min-height:0 !important}');
    const afterParse = judgeDownloadSlots(await collectDownloadSlots(page));
    await removeStyle(h2);
    expect(afterParse.length, '.parse-status-slot 预留归零后仍无报警＝④-解析槽空转').toBeGreaterThan(0);
  });

  test('⑤model-name 的 min-width 归零 → 短名探针转红', async ({ page }) => {
    const before = judgeTopBar(await collectTopBar(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    await gotoPage(page, 'zh', 'dashboard');
    const handle = page.locator('.tb-model .model-name');
    const original = await handle.evaluate((el) => el.textContent ?? '');
    const h = await injectStyle(page, '.model-name{min-width:0 !important}');
    const longW = await handle.evaluate((el) => el.getBoundingClientRect().width);
    await handle.evaluate((el) => {
      (el as HTMLElement).textContent = 'a.gguf';
    });
    const shortW = await handle.evaluate((el) => el.getBoundingClientRect().width);
    await handle.evaluate((el, text) => {
      (el as HTMLElement).textContent = text;
    }, original);
    await removeStyle(h);
    expect(samePx(longW, shortW), `min-width 归零后长名 ${toPx(longW)} 与短名 ${toPx(shortW)} 仍等宽＝⑤探针没有区分力`).toBe(false);
  });
});
