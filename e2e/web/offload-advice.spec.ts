import { test, expect, type Page, type ElementHandle } from '@playwright/test';
// flag 原文从事实源取（同 app.spec.ts / layout-stability.spec.ts）：建议按钮上的参数名必须是真实
// flag，写死字面量的话新收一条减负杠杆就得人来改数字，于是人会改数字而不是看界面。
import { PARAMS } from '../../packages/shared/dist/index.js';

// 概览页「减负建议行」的分流与呈现判据（docs/zh/params-system.md §5.6 第 3 项）。
//
// 出了什么事：模型权重比显存大时，界面从前要么等进程炸了才报错，要么一片沉默；本轮改成在**还没起服务**
// 时就给出减负建议（概览状态卡内，最多两只按钮，点击即写参数）。判据只有一份：条目由 core 的
// `recommendOffloadAdvice` 产出、带 `offloadRelief` 标记随已有的 `system:estimateVram` 通道下发，
// 渲染层一旦自己算「装不下」就成了第二套实现。
//
// 2026-10-09 用户裁定废除 #81/#82 静态预留常驻槽模式：减负建议改 **Arco 官方 a-alert 按需展示**
//（`.oom-alert--relief`，v-if——出现即占位、不出现不占位），「出声/无声」的卡片高度不再恒等，
// 本文件随之改守三类判据：① 有标记 ⇒ a-alert 出声、按钮合规（真实 flag、ToolTip 载体、不越出卡片）；
// ② 无标记 ⇒ 全程静默（连告警元素都不渲染）；③ 删除实验（隐藏告警 / 撤掉标记必须转红）。
//
// 现场由 demo-mock 的 hw 现场提供（`/?hw=silent|all-vram|split|all-ram|relief|relief-off`），
// 载荷形状与 shared 的 VramEstimateResult 一致（mock 侧用 satisfies 钉住，字段名对不上就编不过）。
// relief 与 relief-off 的占用载荷**逐字段相同**，唯一差别是 recommendations 里有没有 offloadRelief。

type Lang = 'zh' | 'en';
type Scene = 'silent' | 'all-vram' | 'split' | 'all-ram' | 'relief' | 'relief-off';

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
  alertFound: boolean;   // .oom-alert--relief 元素存在（v-if 由 offloadRelief 标记驱动）
  alertVisible: boolean; // 且可见
  msgPresent: boolean;   // 建议说明文案在（msg_offload_advice）
  cardFound: boolean;
  cardH: number;
  btnCount: number;
  btnLabels: string[];
  btnInsideCard: boolean[];
  btnTipWrapped: boolean[];
}

async function collectRelief(page: Page): Promise<ReliefStat> {
  return page.evaluate(() => {
    const alert = document.querySelector('.oom-alert--relief') as HTMLElement | null;
    const card = document.querySelector('.section-card:has(.status-desc)') as HTMLElement | null;
    const cardRect = card ? card.getBoundingClientRect() : null;
    const btns = alert ? (Array.from(alert.querySelectorAll('.arco-btn')) as HTMLElement[]) : [];
    const cs = alert ? getComputedStyle(alert) : null;
    const msg = alert?.querySelector('.oom-alert-msg');
    return {
      alertFound: !!alert,
      alertVisible: !!alert && !!cs && cs.visibility === 'visible' && cs.display !== 'none',
      msgPresent: !!(msg && (msg.textContent ?? '').trim()),
      cardFound: !!card,
      cardH: card ? card.getBoundingClientRect().height : 0,
      btnCount: btns.length,
      btnLabels: btns.map((b) => (b.textContent ?? '').trim()),
      btnInsideCard: btns.map((b) => !!cardRect && b.getBoundingClientRect().right <= cardRect.right + 0.5),
      btnTipWrapped: btns.map((b) => b.parentElement?.classList.contains('tooltip-host') ?? false),
    };
  });
}

const readRelief = (page: Page) => settle(() => collectRelief(page), (a, b) =>
  a.alertVisible === b.alertVisible && a.btnCount === b.btnCount && a.msgPresent === b.msgPresent);

/** 有声态（core 发了带标记的条目）：官方告警可见、说明文案在、按钮用真实 flag 原文、
 *  理由走 ToolTip、不越出卡片。按钮上限由组件 slice 语义（≤2）判定而不是某个常量。 */
function judgeReliefSpeaking(s: ReliefStat): string[] {
  const v: string[] = [];
  if (!s.alertFound) return ['core 发了减负条目却没有建议告警（分流或渲染条件失效）'];
  if (!s.alertVisible) v.push('有声态建议告警仍被隐藏（数据没跟上渲染）');
  if (!s.msgPresent) v.push('建议告警缺少说明文案');
  if (s.btnCount === 0) v.push('有声态没有任何建议按钮');
  if (s.btnCount > 2) v.push(`建议按钮 ${s.btnCount} 个，超出组件 slice 上限（换行就是告警长高）`);
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
  return v;
}

/** 无声态（core 没发带标记的条目）：连告警元素都不渲染（v-if），更没有按钮。 */
function judgeReliefSilent(s: ReliefStat): string[] {
  const v: string[] = [];
  if (s.alertFound) v.push('core 没发 offloadRelief 条目却渲染了建议告警（渲染层在自己算「装不下」）');
  if (s.btnCount > 0) v.push(`core 没发减负条目仍出现 ${s.btnCount} 个建议按钮`);
  return v;
}

// ===========================================================================
// 判据用例
// ===========================================================================
for (const lang of ['zh', 'en'] as const) {
  const langName = lang === 'zh' ? '中文' : '英文';

  test.describe(`减负建议行（${langName}态）`, () => {
    test('core 发了条目才出声：出声态告警合规，无声态连告警元素都不渲染', async ({ page }) => {
      await openScene(page, lang, 'relief');
      const spoken = await readRelief(page);
      expect(judgeReliefSpeaking(spoken), `${langName}态 relief 现场`).toEqual([]);

      // 理由悬浮端到端：真悬停第一只建议钮，官方弹层要带着理由文案出现
      // （包装检测只证明「有载体」，这条证明「载体里有内容」）
      const firstTipBtn = page.locator('.oom-alert--relief .tooltip-host .arco-btn').first();
      await firstTipBtn.hover();
      await expect(
        page.locator('.arco-tooltip-content', { hasText: /\S/ }).first(),
        '悬停建议钮未出现理由弹层（ToolTip 内容为空或载体没接上）',
      ).toBeVisible();

      await openScene(page, lang, 'relief-off');
      const silent = await readRelief(page);
      expect(judgeReliefSilent(silent), `${langName}态 relief-off 现场`).toEqual([]);
      // 按需展示（v-if）：无声态连告警元素都不存在，卡片不再为它预留任何空间
      expect(await page.locator('.oom-alert--relief').count(), '无声态不应渲染建议告警元素').toBe(0);
      expect(silent.cardFound, '状态卡未渲染，判据无从比较').toBe(true);
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
  test('点一条建议 ⇒ 那条消失、后一条补位', async ({ page }) => {
    await openScene(page, 'zh', 'relief');
    const before = await readRelief(page);
    expect(before.btnCount, '样本要求：至少两条建议才能验「一条消失、一条补位」').toBeGreaterThan(1);

    const clicked = before.btnLabels[0];
    const promoted = before.btnLabels[1];
    await page.locator('.oom-alert--relief .arco-btn').first().click();
    await expect
      .poll(async () => (await collectRelief(page)).btnLabels.join(' | '), { timeout: 8_000 })
      .not.toBe(before.btnLabels.join(' | '));

    const after = await readRelief(page);
    expect(after.alertFound, '还有其余建议时建议告警不应整体消失').toBe(true);
    expect(after.btnLabels, `被应用的那条「${clicked}」必须从建议里去掉`).not.toContain(clicked);
    expect(after.btnLabels[0], '排在后面的那条应补位到第一个').toBe(promoted);
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

test.describe('判据自证：隐藏告警 / 撤掉标记后必须报警', () => {
  test('①建议告警被隐藏 ⇒ 出声判据转红', async ({ page }) => {
    await openScene(page, 'zh', 'relief');
    expect(judgeReliefSpeaking(await readRelief(page)), '基线（注入前）应无报警').toEqual([]);
    const handle = await injectStyle(page, '.oom-alert--relief{visibility:hidden !important}');
    const after = judgeReliefSpeaking(await readRelief(page));
    await removeStyle(handle);
    expect(after.length, '告警被隐藏后仍无报警＝①出声判据空转').toBeGreaterThan(0);
  });

  test('②offloadRelief 标记是唯一开关：有标记必出声、无标记必静默（两条腿都要成立）', async ({ page }) => {
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
