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
// ③ 概览服务状态卡：无隐藏预留 + 端点提示按需 a-alert（2026-10-09 用户裁定废除
//    #81/#82 静态预留槽模式——出现即占位、不出现不占位，布局随内容流动）
//    + 字段区「字段名+字段」左右排布（2026-10-09 用户裁定：a-descriptions；2026-10-10
//    再裁定单组一行——双组一行的四列底层空白分配不均）
// ---------------------------------------------------------------------------
type PairGeo = { sameRow: boolean; labelLeft: boolean };
type ServiceCardStat = {
  hiddenReserves: Array<{ cls: string; h: number }>;
  alertVisible: boolean;
  alertType: string | null;
  itemCount: number;  // 字段对数（字段名+字段值）
  pairs: PairGeo[];   // 每对：名与值同行、名在值左
  rowTops: number;    // 去重后的行数（双组一行 ⇒ 行数 = ⌈对数/2⌉）
};

async function collectServiceCard(page: Page): Promise<ServiceCardStat> {
  return page.evaluate(() => {
    const card = document.querySelector('.section-card:has(.status-desc)') as HTMLElement | null;
    if (!card) return { hiddenReserves: [], alertVisible: false, alertType: null, itemCount: 0, pairs: [], rowTops: 0 };
    const hiddenReserves: Array<{ cls: string; h: number }> = [];
    // 隐藏预留 = 布局中占据真实高度（static 定位）却 visibility:hidden 的块；
    // absolute 悬浮层（出错跳转钮）不占布局，不算预留
    const walk = (el: HTMLElement) => {
      for (const child of Array.from(el.children) as HTMLElement[]) {
        const st = getComputedStyle(child);
        const r = child.getBoundingClientRect();
        if (st.visibility === 'hidden' && st.position === 'static' && r.height > 8) {
          hiddenReserves.push({ cls: String(child.className).split(' ')[0], h: Math.round(r.height) });
        }
        walk(child);
      }
    };
    walk(card);
    const alert = card.querySelector('a-alert.sec-hint, .sec-hint') as HTMLElement | null;
    const alertSt = alert ? getComputedStyle(alert) : null;
    // Arco descriptions 渲染成表：.arco-descriptions-row（tr）内「标签td|值td」交替，没有
    // .arco-descriptions-item 元素——判据按行取对（每行 2 对：字段名|值|字段名|值）
    const rows = Array.from(card.querySelectorAll('.arco-descriptions-row')) as HTMLElement[];
    const pairs: PairGeo[] = [];
    for (const row of rows) {
      const labels = Array.from(row.querySelectorAll('.arco-descriptions-item-label')) as HTMLElement[];
      const values = Array.from(row.querySelectorAll('.arco-descriptions-item-value')) as HTMLElement[];
      for (let i = 0; i < labels.length; i++) {
        const l = labels[i].getBoundingClientRect();
        const r = values[i]?.getBoundingClientRect();
        if (!r) { pairs.push({ sameRow: false, labelLeft: false }); continue; }
        // 同行 = 纵向有实质重叠（标签行高与值行高不同，取重叠量占矮者一半以上）
        const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
        const sameRow = overlap > Math.min(l.height, r.height) * 0.5;
        pairs.push({ sameRow, labelLeft: sameRow && l.right <= r.left + 1 });
      }
    }
    return {
      hiddenReserves,
      alertVisible: !!alert && !!alertSt && alertSt.visibility === 'visible' && alertSt.display !== 'none',
      alertType: alert ? alert.getAttribute('type') : null,
      itemCount: pairs.length,
      pairs,
      rowTops: rows.length,
    };
  });
}

function judgeServiceCard(s: ServiceCardStat): string[] {
  const v: string[] = [];
  if (s.hiddenReserves.length) {
    v.push(`卡内仍有隐藏预留块（直接占用空间）：${JSON.stringify(s.hiddenReserves)}`);
  }
  if (!s.alertVisible) v.push('端点暴露提示未按需展示为可见的官方告警（a-alert）');
  if (s.itemCount !== 6) v.push(`字段对数 ${s.itemCount}，应为 6（模型/地址/主机/端口/PID/运行时长）`);
  s.pairs.forEach((p, i) => {
    if (!p.sameRow) v.push(`第 ${i + 1} 对字段的名与值不在同一行（版式退回「标签在值上方」）`);
    else if (!p.labelLeft) v.push(`第 ${i + 1} 对字段的名字不在值左侧`);
  });
  if (s.itemCount > 0 && s.rowTops !== s.itemCount) {
    v.push(`字段排成 ${s.rowTops} 行，单组一行应为 ${s.itemCount} 行（两列版式：字段名|值）`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// ④ 下载卡：解析状态按需展示（隐藏预留废除）+ 任务空态为可见的官方空态展示
// ---------------------------------------------------------------------------
type EmptySlot = { exists: boolean; visible: boolean; hasText: boolean };
type DownloadStat = { parseSlotCount: number; taskEmpty: EmptySlot };

async function collectDownloadSlots(page: Page): Promise<DownloadStat> {
  return page.evaluate(() => {
    const slots = document.querySelectorAll('.parse-status-slot');
    const taskEmpty = document.querySelector('.task-empty') as HTMLElement | null;
    const st = taskEmpty ? getComputedStyle(taskEmpty) : null;
    return {
      parseSlotCount: slots.length,
      taskEmpty: {
        exists: !!taskEmpty,
        visible: !!taskEmpty && !!st && st.visibility !== 'hidden' && st.display !== 'none',
        hasText: !!(taskEmpty?.textContent ?? '').trim(),
      },
    };
  });
}

function judgeDownloadSlots(s: DownloadStat): string[] {
  const v: string[] = [];
  if (s.parseSlotCount > 0) {
    v.push(`.parse-status-slot 仍在（${s.parseSlotCount} 个）：隐藏预留废除后解析状态必须按需渲染`);
  }
  if (!s.taskEmpty.exists) v.push('.task-empty 缺席（0 任务时不再有官方空态展示）');
  if (s.taskEmpty.exists && !s.taskEmpty.visible) v.push('.task-empty 存在但不可见（空态展示失效）');
  if (s.taskEmpty.exists && !s.taskEmpty.hasText) v.push('.task-empty 空态没有文案（纯空白占位）');
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

    test(`③概览服务状态卡无隐藏预留，端点提示按需 a-alert 展示`, async ({ page }) => {
      await gotoPage(page, lang, 'dashboard');
      await expect(page.locator('.status-desc')).toBeVisible();
      expect(judgeServiceCard(await collectServiceCard(page)), `${langName}态服务状态卡`).toEqual([]);
    });

    test(`④下载卡解析状态按需展示，任务空态为可见官方空态`, async ({ page }) => {
      await gotoPage(page, lang, 'models');
      await openModelsTab(page, lang, 'library');
      await expect(page.locator('.task-empty')).toBeVisible();
      expect(judgeDownloadSlots(await collectDownloadSlots(page)), `${langName}态下载卡`).toEqual([]);
    });

    test(`⑥文件行徽章列对齐：cat/quant/size 三列跨行一致，来源徽章不继承标题大写（#119）`, async ({ page }) => {
      await gotoPage(page, lang, 'models');
      await openModelsTab(page, lang, 'library');
      // 驱动 mock 下载流到文件列表：填 URL → 解析（ModelScope 源直出文件列表）
      await page.locator('.url-row input').fill('https://modelscope.cn/models/Qwen/Qwen3-8B');
      await page.locator('.parse-btn').click();
      await expect(page.locator('.file-item').first()).toBeVisible();
      const cols = await page.evaluate(() => {
        const right = (row: Element, sel: string) => {
          const el = row.querySelector(sel);
          return el ? Math.round(el.getBoundingClientRect().right) : null;
        };
        const rows = Array.from(document.querySelectorAll('.file-item .arco-list-item-content'));
        const badge = document.querySelector('.files-header .source-badge');
        const title = document.querySelector('.files-header .section-title');
        return {
          catRight: rows.map((r) => right(r, '.file-cat')),
          sizeRight: rows.map((r) => right(r, '.file-size')),
          quantRight: rows.map((r) => right(r, '.quant-badge')).filter((v): v is number => v !== null),
          badgeOutOfTitle: !!(badge && title && badge.parentElement !== title),
          badgeUppercase: badge ? getComputedStyle(badge).textTransform : null,
        };
      });
      // 徽章组右缘成列（宽度随文字不同的徽章左缘允许漂移，右缘必须齐）；容差 2px = 取整噪声
      const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
      expect(spread(cols.catRight), `${langName}态 cat 列错位：${JSON.stringify(cols.catRight)}`).toBeLessThanOrEqual(2);
      expect(spread(cols.sizeRight), `${langName}态 size 右缘错位：${JSON.stringify(cols.sizeRight)}`).toBeLessThanOrEqual(2);
      expect(spread(cols.quantRight), `${langName}态 quant 列错位：${JSON.stringify(cols.quantRight)}`).toBeLessThanOrEqual(2);
      expect(cols.badgeOutOfTitle, '来源徽章应移出 section-title（不继承 uppercase 组标题体例）').toBe(true);
      expect(cols.badgeUppercase, '来源徽章不应渲染成大写').not.toBe('uppercase');
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

  test('③端点提示 a-alert 被隐藏 → 按需可见判据转红', async ({ page }) => {
    await gotoPage(page, 'zh', 'dashboard');
    const before = judgeServiceCard(await collectServiceCard(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    const h = await injectStyle(page, '.sec-hint{display:none !important}');
    const after = judgeServiceCard(await collectServiceCard(page));
    await removeStyle(h);
    expect(after.length, '端点提示被隐藏后仍无报警＝③按需展示判据空转').toBeGreaterThan(0);
  });

  test('④任务空态被隐藏 → 空态展示判据转红', async ({ page }) => {
    await gotoPage(page, 'zh', 'models');
    await openModelsTab(page, 'zh', 'library');
    const before = judgeDownloadSlots(await collectDownloadSlots(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);
    const h1 = await injectStyle(page, '.task-empty{display:none !important}');
    const afterEmpty = judgeDownloadSlots(await collectDownloadSlots(page));
    await removeStyle(h1);
    expect(afterEmpty.length, '.task-empty 被隐藏后仍无报警＝④-空态展示判据空转').toBeGreaterThan(0);
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
