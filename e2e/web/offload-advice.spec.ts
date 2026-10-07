import { test, expect, type Page, type ElementHandle } from '@playwright/test';
// flag 原文从事实源取（同 app.spec.ts / layout-stability.spec.ts）：建议按钮上的参数名必须是真实
// flag，写死字面量的话新收一条减负杠杆就得人来改数字，于是人会改数字而不是看界面。
import { PARAMS } from '../../packages/shared/dist/index.js';

// 概览页「减负建议行」的几何与分流判据（docs/zh/params-system.md §5.6 第 3 项）。
//
// 出了什么事：模型权重比显存大时，界面从前要么等进程炸了才报错，要么一片沉默；本轮改成在**还没起服务**
// 时就给出减负建议（概览状态卡常驻行，最多两只按钮，点击即写参数）。判据只有一份：条目由 core 的
// `recommendOffloadAdvice` 产出、带 `offloadRelief` 标记随已有的 `system:estimateVram` 通道下发，
// 渲染层一旦自己算「装不下」就成了第二套实现。行按 STYLE_TODO #81 用**静态预留常驻槽**实现
//（`.oom-row` 一档 28px，未出声时 visibility: hidden 而不是 v-if），所以「出声」不允许把卡片顶高一档。
// 这两条都是后续改动里容易悄悄破掉的，本文件把它们变成可判别的自动化判据。
//
// 注：服务页原先还有一行「权重落位」说明，与参数页的占用估算 stat 功能重复，2026-10-06 按用户标注
// 删除（那句「为什么慢」并入参数页占用 tooltip 的 `msg_occ_spill_line`），本文件同步只守剩下的建议行。
//
// 三条纪律沿用 layout-stability.spec.ts：
//  ① 阈值一律派生，不写死像素：档位判据写成「槽高 == 自己的 min-height」，按钮上限由组件 slice
//     语义（≤2）判定而不是某个常量，flag 取自 PARAMS；
//  ② 判据自带样本要求：等式类判据必须先真的存在两种状态（出声/无声、有标记/无标记），
//     缺样本直接判红并说明是数据问题，不允许空转通过；
//  ③ 每条判据配一个删除实验：在**测试内**用 addStyleTag 撤掉预留、或用改数据撤掉 offloadRelief
//     标记（生产代码一字未动），断言判据必须转红；抓不住删除的判据等于没有价值，须当场暴露。
//
// 现场由 demo-mock 的 hw 现场提供（`/?hw=silent|all-vram|split|all-ram|relief|relief-off`），
// 载荷形状与 shared 的 VramEstimateResult 一致（mock 侧用 satisfies 钉住，字段名对不上就编不过）。
// relief 与 relief-off 的占用载荷**逐字段相同**，唯一差别是 recommendations 里有没有 offloadRelief。

type Lang = 'zh' | 'en';
type Scene = 'silent' | 'all-vram' | 'split' | 'all-ram' | 'relief' | 'relief-off';

const toPx = (n: number) => Math.round(n * 100) / 100;
const samePx = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

/**
 * 打开某个现场并校验标签确属本项目（防串台：标题 llama Launcher + 7 项侧边导航）。
 * 英文态走 `?lang=en`（mock 的语言从 URL 取，同 logs-scroll.spec.ts 的做法）。
 */
async function openScene(page: Page, lang: Lang, scene: Scene): Promise<void> {
  const query = lang === 'en' ? `?lang=en&hw=${scene}` : `?hw=${scene}`;
  await page.goto(`/${query}#/dashboard`);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page).toHaveTitle(/llama Launcher/);
  expect(await page.locator('.sidebar .arco-menu-item').count(), '侧栏必须是 7 项导航').toBe(7);
}

/** 轮询到「连续两次采样相等」再返回：建议行随异步估算落地，取稳态才可比。 */
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
  btnTipWrapped: boolean[];
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
      btnTipWrapped: btns.map((b) => b.parentElement?.classList.contains('tooltip-host') ?? false),
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

/** 有声态（core 发了带标记的条目）：按钮存在、label 用真实 flag 原文、理由走 ToolTip、不越出卡片。 */
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
  if (s.btnTipWrapped.some((w) => !w)) v.push('建议按钮没有包 ToolTip（理由必须有官方悬浮载体）');
  if (s.btnInsideCard.some((inside) => !inside)) v.push('建议按钮越出卡片右边界（长文案把按钮顶出去了）');
  if (s.textCw <= 0) v.push(`建议说明文案可用宽度为 ${s.textCw}（文案被按钮挤没了）`);
  // 说明文字是单行 + 省略号（.oom-text 的 nowrap/hidden/ellipsis）：被省略 = 用户看不到完整提示。
  // 英文句子比中文长得多，这条在英文态最容易先红（#79/#80 同一族教训）。
  if (s.textSw > s.textCw + 1) {
    v.push(`建议说明文案被省略号截断（scrollWidth ${toPx(s.textSw)} > clientWidth ${toPx(s.textCw)}）`);
  }
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

  test.describe(`减负建议行（${langName}态）`, () => {
    test('core 发了条目才出声，且两态同高、按钮不越出卡片', async ({ page }) => {
      await openScene(page, lang, 'relief');
      const spoken = await readRelief(page);
      expect(judgeReliefSpeaking(spoken), `${langName}态 relief 现场`).toEqual([]);

      // 理由悬浮端到端：真悬停第一只建议钮，官方弹层要带着理由文案出现
      // （包装检测只证明「有载体」，这条证明「载体里有内容」）
      const firstTipBtn = page.locator('.oom-hint--relief .tooltip-host .arco-btn').first();
      await firstTipBtn.hover();
      await expect(
        page.locator('.arco-tooltip-content', { hasText: /\S/ }).first(),
        '悬停建议钮未出现理由弹层（ToolTip 内容为空或载体没接上）',
      ).toBeVisible();

      await openScene(page, lang, 'relief-off');
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
    await openScene(page, 'zh', 'relief');
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
  test('①建议行 min-height 归零 ⇒ 档位判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'relief');
    expect(judgeReliefSlot(await readRelief(page)), '基线（注入前）应无报警').toEqual([]);
    const handle = await injectStyle(page, '.oom-row{min-height:0 !important}');
    const after = judgeReliefSlot(await readRelief(page));
    await removeStyle(handle);
    expect(after.length, 'min-height 归零后仍无报警＝①档位判据空转').toBeGreaterThan(0);
  });

  test('②建议行改回 v-if（无声时整行消失）⇒ 无声态预留判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'relief-off');
    expect(judgeReliefSilent(await readRelief(page)), '基线（注入前）应无报警').toEqual([]);
    const handle = await injectStyle(page, '.oom-row{visibility:visible !important;display:none !important}');
    const after = judgeReliefSilent(await readRelief(page));
    await removeStyle(handle);
    expect(after.length, '整行被 v-if 抽掉后仍无报警＝②预留判据空转').toBeGreaterThan(0);
  });

  test('③英文说明不截断的对照腿：把可用宽度压小必须判出省略', async ({ page }) => {
    await openScene(page, 'en', 'relief');
    const before = judgeReliefSpeaking(await readRelief(page));
    expect(before, '基线（注入前）应无报警').toEqual([]);

    const handle = await injectStyle(page, '.oom-hint--relief .oom-text{max-width:48px !important}');
    await page.waitForTimeout(150);
    const after = judgeReliefSpeaking(await readRelief(page));
    await removeStyle(handle);
    expect(after.length, '把宽度压到 48px 仍判不出省略＝③英文判据只会恒真').toBeGreaterThan(0);
  });

  test('④offloadRelief 标记是唯一开关：有标记必出声、无标记必静默（两条腿都要成立）', async ({ page }) => {
    await openScene(page, 'zh', 'relief');
    const spoken = await readRelief(page);
    expect(judgeReliefSpeaking(spoken), '基线（有标记）应出声').toEqual([]);
    expect(spoken.btnCount, '有标记时的按钮数（若为 0，说明本判据与数据无关）').toBeGreaterThan(0);

    await openScene(page, 'zh', 'relief-off');
    const unmarked = await readRelief(page);
    expect(judgeReliefSilent(unmarked), '基线（无标记）应静默').toEqual([]);
    expect(unmarked.btnCount, '无标记时的按钮数').toBe(0);
  });
});
