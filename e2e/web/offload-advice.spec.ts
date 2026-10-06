import { test, expect, type Page, type ElementHandle } from '@playwright/test';
// flag 原文从事实源取（同 app.spec.ts / layout-stability.spec.ts）：建议按钮上的参数名必须是真实
// flag，写死字面量的话新收一条减负杠杆就得人来改数字，于是人会改数字而不是看界面。
import { PARAMS } from '../../packages/shared/dist/index.js';

// 权重落位行 + 减负建议行的几何与分流判据（docs/zh/params-system.md §5.6 第 2、3 项）。
//
// 出了什么事：模型权重比显存大时，界面从前要么等进程炸了才报错，要么一片沉默；本轮改成主动说明
// 「权重落在哪」并给出减负建议。两行都按 STYLE_TODO #81 用**静态预留常驻槽**实现
//（服务页 .cmd-placement 两档 36px / 概览页 .oom-row 一档 28px，未出声时 visibility: hidden
//  而不是 v-if），所以「出声」不允许把卡片顶高一档；同时减负条目**只来自 core** 的
//  recommendOffloadAdvice（条目带 offloadRelief 标记），渲染层一旦自己算「装不下」就成了第二套判据。
// 这两条都是后续改动里容易悄悄破掉的，本文件把它们变成可判别的自动化判据。
//
// 三条纪律沿用 layout-stability.spec.ts：
//  ① 阈值一律派生，不写死像素：档位判据写成「槽高 == 自己的 min-height」「槽高 ≥ 行内最高按钮」，
//     按钮上限由组件 slice 语义（≤2）判定而不是某个常量，flag 取自 PARAMS；
//  ② 判据自带样本要求：等式类判据必须先真的存在两种状态（出声/无声、有标记/无标记），
//     缺样本直接判红并说明是数据问题，不允许空转通过；
//  ③ 每条判据配一个删除实验：在**测试内**用 addStyleTag 撤掉预留、或用改数据撤掉 offloadRelief
//     标记（生产代码一字未动），断言判据必须转红；抓不住删除的判据等于没有价值，须当场暴露。
//
// 现场由 demo-mock 的 hw 现场提供（`/?hw=silent|all-vram|split|all-ram|relief|relief-off`），
// 载荷形状与 shared 的 VramEstimateResult 一致（mock 侧用 satisfies 钉住，字段名对不上就编不过）。

type Lang = 'zh' | 'en';
type Scene = 'silent' | 'all-vram' | 'split' | 'all-ram' | 'relief' | 'relief-off';
type Route = 'dashboard' | 'service';

const toPx = (n: number) => Math.round(n * 100) / 100;
const samePx = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

/**
 * 打开某个现场并校验标签确属本项目（防串台：标题 llama Launcher + 7 项侧边导航）。
 * 英文态走 `?lang=en`（mock 的语言从 URL 取，同 logs-scroll.spec.ts 的做法）。
 */
async function openScene(page: Page, lang: Lang, scene: Scene, route: Route): Promise<void> {
  const query = lang === 'en' ? `?lang=en&hw=${scene}` : `?hw=${scene}`;
  await page.goto(`/${query}#/${route}`);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page).toHaveTitle(/llama Launcher/);
  expect(await page.locator('.sidebar .arco-menu-item').count(), '侧栏必须是 7 项导航').toBe(7);
}

/** 轮询到「连续两次采样相等」再返回：落位行随异步估算落地，卡内文本框也会 auto-size，取稳态才可比。 */
async function settle<T>(read: () => Promise<T>, same: (a: T, b: T) => boolean, tries = 25): Promise<T> {
  let prev = await read();
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const now = await read();
    if (same(prev, now)) return now;
    prev = now;
  }
  return prev;
}

// ---------------------------------------------------------------------------
// ① 服务页权重落位行：槽恒在 + 出声/无声两态同高
// ---------------------------------------------------------------------------
interface PlacementStat {
  cardFound: boolean;
  cardH: number;
  rowFound: boolean;
  rowH: number;
  rowMin: number;
  rowVisible: boolean;
  rowActive: boolean;
  textLen: number;
  textClientH: number;
  textScrollH: number;
  textClientW: number;
  textScrollW: number;
  warn: boolean;
  titleLen: number;
  nextLabelY: number;
}

async function collectPlacement(page: Page): Promise<PlacementStat> {
  return page.evaluate(() => {
    const card = document.querySelector('.section-card:has(.cmd-placement)') as HTMLElement | null;
    const row = document.querySelector('.cmd-placement') as HTMLElement | null;
    const txt = row?.querySelector('.cmd-status-text') as HTMLElement | null;
    const next = card?.querySelector('.cmd-section:nth-child(2) .cmd-section-label') as HTMLElement | null;
    const cs = row ? getComputedStyle(row) : null;
    return {
      cardFound: !!card,
      cardH: card ? card.getBoundingClientRect().height : 0,
      rowFound: !!row,
      rowH: row ? row.getBoundingClientRect().height : 0,
      rowMin: cs ? parseFloat(cs.minHeight) || 0 : 0,
      rowVisible: !!row && !!cs && cs.visibility === 'visible',
      rowActive: !!row && row.classList.contains('is-active'),
      textLen: txt ? (txt.textContent ?? '').trim().length : 0,
      textClientH: txt ? txt.clientHeight : 0,
      textScrollH: txt ? txt.scrollHeight : 0,
      textClientW: txt ? txt.clientWidth : 0,
      textScrollW: txt ? txt.scrollWidth : 0,
      warn: !!txt && txt.classList.contains('cmd-status-text--warn'),
      titleLen: txt ? (txt.getAttribute('title') ?? '').trim().length : 0,
      nextLabelY: next ? next.getBoundingClientRect().y : 0,
    };
  });
}

function samePlacement(a: PlacementStat, b: PlacementStat): boolean {
  return samePx(a.cardH, b.cardH) && samePx(a.nextLabelY, b.nextLabelY) && a.textLen === b.textLen;
}

const readPlacement = (page: Page) => settle(() => collectPlacement(page), samePlacement);

/** 两态共同的档位判据：槽高恒等于自己的 min-height 且非零（预留是静态 CSS，不是测量回填）。 */
function judgePlacementSlot(s: PlacementStat): string[] {
  const v: string[] = [];
  if (!s.cardFound || !s.rowFound) return ['.section-card / .cmd-placement 有缺席（落位行不再常驻）'];
  if (s.rowMin <= 0) v.push(`.cmd-placement min-height 为 0（实测高 ${toPx(s.rowH)}），档位不再锁定`);
  if (!samePx(s.rowH, s.rowMin)) {
    v.push(`落位行高 ${toPx(s.rowH)} ≠ min-height ${toPx(s.rowMin)}（内容超出预留档，会把下方内容顶高）`);
  }
  return v;
}

/** 无声态：整行隐藏但占位不塌，且没有半句话（不把「没量过」写成「没问题」）。 */
function judgePlacementSilent(s: PlacementStat): string[] {
  const v = judgePlacementSlot(s);
  if (s.rowVisible) v.push('无声态里落位行仍然可见（silent 现场没有任何落位结论可说）');
  if (s.textLen > 0) v.push(`无声态却渲染了 ${s.textLen} 个字符的落位文案`);
  return v;
}

/** 出声态：整行可见且真有文案，两档封顶内放得下（scrollHeight 不得超出 clientHeight）。 */
function judgePlacementSpeaking(s: PlacementStat): string[] {
  const v = judgePlacementSlot(s);
  if (!s.rowVisible) v.push('出声态落位行仍被隐藏（is-active 没跟上数据）');
  if (!s.rowActive) v.push('出声态缺少 is-active 类（常驻槽的切换条件失效）');
  if (s.textLen === 0) v.push('出声态文案为空：mock 现场或 store 派生失效（样本要求不满足，等式会空转）');
  if (s.textScrollH > s.textClientH + 1) {
    v.push(`落位文案被封顶截断（需要 ${s.textScrollH}px / 只有 ${s.textClientH}px 预留）`);
  }
  if (s.textScrollW > s.textClientW + 1) v.push(`落位文案横向溢出 ${toPx(s.textScrollW - s.textClientW)}px`);
  if (s.titleLen === 0) v.push('落位行没有 title 属性（文案万一超出两档时用户无从看全文）');
  return v;
}

/** 跨两态的等式：卡片高与「下一区块标签」的纵坐标都不许因出声而移动。 */
function judgePlacementEqual(silent: PlacementStat, spoken: PlacementStat): string[] {
  const v: string[] = [];
  if (!silent.cardFound || !spoken.cardFound) return ['状态卡缺席，两态等式无从比较（非生产问题）'];
  if (spoken.textLen === 0 || silent.textLen !== 0) {
    return ['样本要求未满足：两态没有真的形成「无声 / 出声」对照，等式会空转'];
  }
  if (!samePx(silent.cardH, spoken.cardH)) {
    v.push(`出声把命令预览卡顶高了：无声 ${toPx(silent.cardH)} vs 出声 ${toPx(spoken.cardH)}`);
  }
  if (!samePx(silent.nextLabelY, spoken.nextLabelY)) {
    v.push(`出声把「扩展参数」区下推了：无声 y=${toPx(silent.nextLabelY)} vs 出声 y=${toPx(spoken.nextLabelY)}`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// ② 概览页减负建议行：条目只由 core 的 offloadRelief 标记驱动
// ---------------------------------------------------------------------------
interface ReliefStat {
  cardFound: boolean;
  cardH: number;
  cardBottom: number;
  rowFound: boolean;
  rowH: number;
  rowMin: number;
  rowVisible: boolean;
  hintPresent: boolean;
  btnCount: number;
  btnLabels: string[];
  btnHeights: number[];
  btnInsideCard: boolean[];
  btnTitleLens: number[];
  textSw: number;
  textCw: number;
}

async function collectRelief(page: Page): Promise<ReliefStat> {
  return page.evaluate(() => {
    const card = document.querySelector('.section-card:has(.oom-row)') as HTMLElement | null;
    const row = document.querySelector('.oom-row') as HTMLElement | null;
    const hint = row?.querySelector('.oom-hint--relief') as HTMLElement | null;
    const txt = hint?.querySelector('.oom-text') as HTMLElement | null;
    const btns = hint ? (Array.from(hint.querySelectorAll('.arco-btn')) as HTMLElement[]) : [];
    const cs = row ? getComputedStyle(row) : null;
    const cardRect = card ? card.getBoundingClientRect() : null;
    return {
      cardFound: !!card,
      cardH: card ? card.getBoundingClientRect().height : 0,
      cardBottom: card ? card.getBoundingClientRect().bottom : 0,
      rowFound: !!row,
      rowH: row ? row.getBoundingClientRect().height : 0,
      rowMin: cs ? parseFloat(cs.minHeight) || 0 : 0,
      rowVisible: !!row && !!cs && cs.visibility === 'visible',
      hintPresent: !!hint,
      btnCount: btns.length,
      btnLabels: btns.map((b) => (b.textContent ?? '').trim()),
      btnHeights: btns.map((b) => b.getBoundingClientRect().height),
      btnInsideCard: btns.map((b) => !!cardRect && b.getBoundingClientRect().right <= cardRect.right + 0.5),
      btnTitleLens: btns.map((b) => (b.getAttribute('title') ?? '').trim().length),
      textSw: txt ? txt.scrollWidth : 0,
      textCw: txt ? txt.clientWidth : 0,
    };
  });
}

function sameRelief(a: ReliefStat, b: ReliefStat): boolean {
  return samePx(a.cardH, b.cardH) && a.btnCount === b.btnCount && a.hintPresent === b.hintPresent;
}

const readRelief = (page: Page) => settle(() => collectRelief(page), sameRelief);

/** 档位判据：行高恒等于自己的 min-height、非零，且行内按钮不得比预留档更高（比它高就说明会换行）。 */
function judgeReliefSlot(s: ReliefStat): string[] {
  const v: string[] = [];
  if (!s.cardFound || !s.rowFound) return ['.section-card / .oom-row 有缺席（建议行不再常驻）'];
  if (s.rowMin <= 0) v.push(`.oom-row min-height 为 0（实测高 ${toPx(s.rowH)}），建议到位就会顶高下方`);
  if (!samePx(s.rowH, s.rowMin)) {
    v.push(`建议行高 ${toPx(s.rowH)} ≠ min-height ${toPx(s.rowMin)}（内容超出预留档）`);
  }
  const tallest = Math.max(0, ...s.btnHeights);
  if (tallest > s.rowH + 0.5) v.push(`行内按钮高 ${toPx(tallest)} 超出建议行档位 ${toPx(s.rowH)}`);
  return v;
}

/** 有声态（core 发了带标记的条目）：按钮存在、label 用真实 flag 原文、理由走原生 title、不越出卡片。 */
function judgeReliefSpeaking(s: ReliefStat): string[] {
  const v = judgeReliefSlot(s);
  if (!s.hintPresent) return [...v, 'core 发了减负条目却没有建议行（分流或渲染条件失效）'];
  if (!s.rowVisible) v.push('有声态建议行仍被隐藏（is-active 没跟上数据）');
  if (s.btnCount === 0) v.push('有声态没有任何建议按钮');
  if (s.btnCount > 2) v.push(`建议按钮 ${s.btnCount} 个，超出常驻一档放得下的上限（换行就是卡片长高）`);
  const flags = PARAMS.map((p: { flag?: string }) => p.flag).filter(Boolean) as string[];
  for (const label of s.btnLabels) {
    if (!label) {
      v.push('有建议按钮文案为空');
      continue;
    }
    if (!flags.some((f) => label.includes(f))) {
      v.push(`建议按钮「${label}」不含任何真实 flag（PARAMS 里找不到，用户点完在命令行对不上号）`);
    }
  }
  if (s.btnTitleLens.some((n) => n === 0)) v.push('建议按钮没带 title（按钮只写参数名，理由必须有地方看）');
  if (s.btnInsideCard.some((inside) => !inside)) v.push('建议按钮越出卡片右边界（长文案把按钮顶出去了）');
  if (s.textCw <= 0) v.push(`建议说明文案可用宽度为 ${s.textCw}（文案被按钮挤没了）`);
  return v;
}

/** 无声态（core 没发带标记的条目）：一条建议都不许显示，但档位必须还在。 */
function judgeReliefSilent(s: ReliefStat): string[] {
  const v = judgeReliefSlot(s);
  if (s.hintPresent) v.push('core 没发 offloadRelief 条目却渲染了建议行（渲染层在自己算「装不下」）');
  if (s.btnCount > 0) v.push(`core 没发减负条目仍出现 ${s.btnCount} 个建议按钮`);
  if (s.rowVisible) v.push('无声态建议行仍然可见（应当只有占位、没有内容）');
  return v;
}

// ===========================================================================
// 判据用例
// ===========================================================================
for (const lang of ['zh', 'en'] as const) {
  const langName = lang === 'zh' ? '中文' : '英文';

  test.describe(`权重落位行（${langName}态）`, () => {
    test('无声/出声两态同高，且各自的档位与文案规则都成立', async ({ page }) => {
      await openScene(page, lang, 'silent', 'service');
      const silent = await readPlacement(page);
      expect(judgePlacementSilent(silent), `${langName}态 silent 现场`).toEqual([]);

      await openScene(page, lang, 'split', 'service');
      const spoken = await readPlacement(page);
      expect(judgePlacementSpeaking(spoken), `${langName}态 split 现场`).toEqual([]);

      expect(judgePlacementEqual(silent, spoken), `${langName}态两态对比`).toEqual([]);
    });

    test('四种落位现场都在两档预留内（英文长句不截断、全在显卡不标警示）', async ({ page }) => {
      for (const scene of ['all-vram', 'split', 'all-ram', 'relief'] as Scene[]) {
        await openScene(page, lang, scene, 'service');
        const s = await readPlacement(page);
        expect(judgePlacementSpeaking(s), `${langName}态 ${scene} 现场`).toEqual([]);
      }
      // 显卡装得下（all-vram）不该用警示色；有权重在内存侧的态才该用
      await openScene(page, lang, 'all-vram', 'service');
      expect((await readPlacement(page)).warn, `${langName}态 all-vram 不该标搬运警示`).toBe(false);
      await openScene(page, lang, 'split', 'service');
      expect((await readPlacement(page)).warn, `${langName}态 split 应标搬运警示`).toBe(true);
    });
  });

  test.describe(`减负建议行（${langName}态）`, () => {
    test('core 发了条目才出声，且两态同高、按钮不越出卡片', async ({ page }) => {
      await openScene(page, lang, 'relief', 'dashboard');
      const spoken = await readRelief(page);
      expect(judgeReliefSpeaking(spoken), `${langName}态 relief 现场`).toEqual([]);

      await openScene(page, lang, 'relief-off', 'dashboard');
      const silent = await readRelief(page);
      expect(judgeReliefSilent(silent), `${langName}态 relief-off 现场`).toEqual([]);

      expect(silent.cardFound && spoken.cardFound, '状态卡未渲染，等式无从比较').toBe(true);
      expect(
        samePx(silent.cardH, spoken.cardH),
        `建议出声把状态卡顶高了：无声 ${toPx(silent.cardH)} vs 出声 ${toPx(spoken.cardH)}`,
      ).toBe(true);
      expect(
        samePx(silent.cardBottom, spoken.cardBottom),
        `建议出声把下方卡片推走了：无声底边 ${toPx(silent.cardBottom)} vs 出声底边 ${toPx(spoken.cardBottom)}`,
      ).toBe(true);
    });

    test('判据不在渲染层：同一份「装不下」形状，无标记条目时一条建议都不出', async ({ page }) => {
      // relief-off 与 relief 的占用载荷逐字段相同，唯一差别是 recommendations 里有没有 offloadRelief。
      // 落位行在 relief-off 里照常出声（它消费的是占用数字），建议行必须全哑——
      // 这一对照同时钉住「界面不许自己算装不下」与「装不下的数据确实在场」。
      await openScene(page, lang, 'relief-off', 'dashboard');
      const stat = await readRelief(page);
      expect(judgeReliefSilent(stat), `${langName}态 relief-off 现场`).toEqual([]);

      await openScene(page, lang, 'relief-off', 'service');
      const placement = await readPlacement(page);
      expect(
        judgePlacementSpeaking(placement),
        `${langName}态 relief-off 的落位行（样本要求：装不下的数据必须在场）`,
      ).toEqual([]);
    });
  });
}

test.describe('减负建议的动作语义', () => {
  /**
   * 判据：点一条建议 ⇒ **那条**从建议里去掉，排在后面的那条补位上来。
   * 为什么不是「按钮少一个」：core 在 relief 现场发 4 条（-cmoe / -ngl / -dev / -ts），常驻一档只放 2 个，
   * 所以应用一条之后是「后面的补位」而不是「总数减一」——按钮数恒为 2 恰恰是 slice 生效的证据。
   * 这条用例真正钉住的是 hardware store 的那半句过滤：会话里已经是这个值就不再建议
   *（否则用户点完按钮界面还挂着同一条，看起来像「点了没反应」）。
   */
  test('点一条建议 ⇒ 那条消失、后一条补位，卡片高度不变', async ({ page }) => {
    await openScene(page, 'zh', 'relief', 'dashboard');
    const before = await readRelief(page);
    expect(before.btnCount, '样本要求：至少两条建议才能验「一条消失、一条补位」').toBeGreaterThan(1);

    const clicked = before.btnLabels[0];
    const promoted = before.btnLabels[1];
    await page.locator('.oom-hint--relief .arco-btn').first().click();
    await expect
      .poll(async () => (await collectRelief(page)).btnLabels.join(' | '), { timeout: 8_000 })
      .not.toBe(before.btnLabels.join(' | '));

    const after = await readRelief(page);
    expect(after.hintPresent, '还有其余建议时建议行不应整体消失').toBe(true);
    expect(after.btnLabels, `被应用的那条「${clicked}」必须从建议里去掉`).not.toContain(clicked);
    expect(after.btnLabels[0], '排在后面的那条应补位到第一个').toBe(promoted);
    expect(
      samePx(after.cardH, before.cardH),
      `应用建议后卡片高度变了：${toPx(before.cardH)} → ${toPx(after.cardH)}`,
    ).toBe(true);
  });
});

// ===========================================================================
// 删除实验（判据自证）：测试内撤掉预留或撤掉标记，断言上面的判据必须转红。
// 抓不住删除的判据等于没守着，须当场暴露。
// ===========================================================================
async function injectStyle(page: Page, css: string): Promise<ElementHandle<HTMLElement>> {
  return (await page.addStyleTag({ content: css })) as unknown as ElementHandle<HTMLElement>;
}
async function removeStyle(handle: ElementHandle<HTMLElement>) {
  await handle.evaluate((el) => el.remove());
}

test.describe('判据自证：撤掉预留 / 撤掉标记后必须报警', () => {
  test('①落位槽退回 v-if（无声时 display:none）⇒ 两态同高判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'silent', 'service');
    expect(judgePlacementSilent(await readPlacement(page)), '基线（注入前）应无报警').toEqual([]);

    const handle = await injectStyle(page, '.cmd-placement:not(.is-active){display:none !important}');
    await page.waitForTimeout(200);
    const brokenSilent = await readPlacement(page);
    await removeStyle(handle);

    await openScene(page, 'zh', 'split', 'service');
    const spoken = await readPlacement(page);
    const broken = judgePlacementEqual(brokenSilent, spoken);
    expect(broken.length, '无声态塌掉一行后两态等式仍成立＝①判据空转').toBeGreaterThan(0);
  });

  test('②落位槽 min-height 归零 ⇒ 档位判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'silent', 'service');
    expect(judgePlacementSlot(await readPlacement(page)), '基线（注入前）应无报警').toEqual([]);
    const handle = await injectStyle(page, '.cmd-placement{min-height:0 !important}');
    const after = judgePlacementSlot(await readPlacement(page));
    await removeStyle(handle);
    expect(after.length, 'min-height 归零后仍无报警＝②档位判据空转').toBeGreaterThan(0);
  });

  test('③建议行 min-height 归零 ⇒ 档位判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'relief', 'dashboard');
    expect(judgeReliefSlot(await readRelief(page)), '基线（注入前）应无报警').toEqual([]);
    const handle = await injectStyle(page, '.oom-row{min-height:0 !important}');
    const after = judgeReliefSlot(await readRelief(page));
    await removeStyle(handle);
    expect(after.length, 'min-height 归零后仍无报警＝③建议行档位判据空转').toBeGreaterThan(0);
  });

  test('④建议行改回 v-if（无声时整行消失）⇒ 无声态档位判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'relief-off', 'dashboard');
    expect(judgeReliefSilent(await readRelief(page)), '基线（注入前）应无报警').toEqual([]);
    const handle = await injectStyle(page, '.oom-row{visibility:visible !important;display:none !important}');
    const after = judgeReliefSilent(await readRelief(page));
    await removeStyle(handle);
    expect(after.length, '整行被 v-if 抽掉后仍无报警＝④预留判据空转').toBeGreaterThan(0);
  });

  test('⑤offloadRelief 标记是唯一开关：有标记必出声、无标记必静默（两条腿都要成立）', async ({ page }) => {
    await openScene(page, 'zh', 'relief', 'dashboard');
    const spoken = await readRelief(page);
    expect(judgeReliefSpeaking(spoken), '基线（有标记）应出声').toEqual([]);
    expect(spoken.btnCount, '有标记时的按钮数（若为 0，说明本判据与数据无关）').toBeGreaterThan(0);

    await openScene(page, 'zh', 'relief-off', 'dashboard');
    const unmarked = await readRelief(page);
    expect(judgeReliefSilent(unmarked), '基线（无标记）应静默').toEqual([]);
    expect(unmarked.btnCount, '无标记时的按钮数').toBe(0);
  });

  test('⑥英文不截断的对照腿：封顶降到一档必须判出截断', async ({ page }) => {
    await openScene(page, 'en', 'split', 'service');
    const before = judgePlacementSpeaking(await readPlacement(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);

    const handle = await injectStyle(
      page,
      '.cmd-placement .cmd-status-text{-webkit-line-clamp:1 !important;line-clamp:1 !important}',
    );
    await page.waitForTimeout(150);
    const after = judgePlacementSpeaking(await readPlacement(page));
    await removeStyle(handle);
    expect(after.length, '封顶降到一档后仍判不出截断＝⑥英文判据只会恒真').toBeGreaterThan(0);
  });
});
