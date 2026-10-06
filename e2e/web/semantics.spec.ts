import { test, expect, type Page } from '@playwright/test';

// STYLE_TODO #92 的判据：标题层级、`main` 地标唯一、服务状态变化播报。
// 三条都是「没人守着就会漂回去」的那类——改完只是把 DOM 形状摆对了，下次谁再套一层
// `a-layout-content`、把标题写成 `<div class="title">`、或给状态行换个不带 live 的壳，
// 界面看起来一模一样，读屏那边却塌了。所以每条判据都配一组删除实验（本文件最后那个 describe）。
//
// 实测（2026-10-07 于 vite dev 127.0.0.1:5173 与 `pnpm e2e:web` 的 preview 产物，视口 1280×720）：
//   ① 地标：改前每页 `main,[role=main]` 命中 **2 个**（外壳 `.app-content` + `PageFrame`），
//      模型页两层 PageFrame 嵌套时是 **3 个**；改后 7 页全部 **1 个**，且那一个就是 `.app-content`。
//   ② 标题：改前 7 页只有概览有 1 个 `<h2>`、其余 **0 个标题**；改后每页恰 1 个 `<h1>`
//      （文本＝侧栏页名，随路由逐项改名：概览/模型管理/服务/参数设置/日志/内置 Web UI/应用设置），
//      卡片小节标题为 `<h2>`（概览 2 / 模型 3 / 服务 4 / 参数 14 / 设置 1 个，日志与内置 Web UI 无卡片）。
//      页标题是「视觉隐藏但读得到」的 sr-only：实测 1×1px、`clip-path: inset(50%)`、
//      `position: absolute`，`main` 的矩形与改前逐项相等（见 STYLE_TODO #92 修复记录）。
//   ③ 播报：全站 `[aria-live]` 改前只有失败横幅那 1 处 `role="alert"`；改后状态行自身
//      `aria-live="polite"`（Arco Space 属性透传，不新包元素——live 根与状态行是同一个节点），
//      顶栏启停实测出声序列 运行中 → 未运行 → 启动中 → 运行中 →（失败现场）启动失败，
//      状态行高恒 20px（宽随文字变，高不变＝卡片不跳档）。
//
// 三条纪律沿用 a11y.spec.ts / logs-scroll.spec.ts：
//   ① 阈值派生，不写死像素：几何判据写成「同元素前后两次测量相等」，标题层级判据写成
//      「可见标题序列不得跳级」，而不是钉死某个 px 数或某份标题清单。
//   ② 判据自带样本要求：`main` 一个都没有、h1 一个都没有、指定页一张卡片都没扫到、
//      状态行不存在——全部显式判红，不留「计数恰好为 0 所以通过」的恒等式假绿。
//   ③ 每条判据配删除实验：在测试里把这一轮的改动退回旧形状（`.page-frame` 重新挂上 main 地标、
//      把 h1 降级、把卡片标题的 h2 拆掉、摘掉 aria-live），断言判据必须转红，随后原地还原断言转绿。

type Lang = 'zh' | 'en';

const NAV: Array<{ to: string; zh: string; en: string }> = [
  { to: '/dashboard', zh: '概览', en: 'Overview' },
  { to: '/models', zh: '模型管理', en: 'Models' },
  { to: '/service', zh: '服务', en: 'Service' },
  { to: '/params', zh: '参数设置', en: 'Parameters' },
  { to: '/logs', zh: '日志', en: 'Logs' },
  { to: '/webui', zh: '内置 Web UI', en: 'Built-in Web UI' },
  { to: '/settings', zh: '应用设置', en: 'Settings' },
];

/** 每页至少应扫到几张带标题的卡片（样本要求，不是基线：卡片变少了要人来确认，不是让判据静默）。 */
const MIN_CARDS: Record<string, number> = {
  '/dashboard': 1,
  '/models': 1,
  '/service': 1,
  '/params': 1,
  '/logs': 0,
  '/webui': 0,
  '/settings': 1,
};

const UI: Record<Lang, { start: string; stop: string; running: string; starting: string; stopped: string; failed: string }> = {
  zh: { start: '启动', stop: '停止', running: '运行中', starting: '启动中', stopped: '未运行', failed: '启动失败' },
  en: { start: 'Start', stop: 'Stop', running: 'Running', starting: 'Starting', stopped: 'Stopped', failed: 'Failed to Start' },
};

/** 冷启动 → 走侧栏进目标页（与 a11y.spec.ts 同款：demo 的 last_tab 会回跳概览，故不用 URL 直达）。 */
async function open(page: Page, lang: Lang, index: number) {
  await page.goto(lang === 'en' ? '/?lang=en' : '/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: NAV[index][lang] }).click();
  await expect(page).toHaveURL(new RegExp(`#${NAV[index].to}(\\?|$)`));
  // 就绪门禁仍取 `.page-host` 的直接子节点：页标题（`.page-title`）刻意挂在 `.page-host` **外面**，
  // 否则会先命中同步渲染的标题、让这条「异步页面组件已挂载」的门禁变成空转。
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

/**
 * 属性临时改写/还原：按元素引用记录**原值**（含「原本没有该属性」这一态，还原时真的删掉），
 * 与 a11y.spec.ts 的 stripAttr 同一套理由——Vue 会 patch 掉 data-* 之类的临时选择器，
 * 而覆盖式记录只会还原最后一次。
 */
interface AttrEntry {
  el: HTMLElement;
  attr: string;
  value: string | null;
}
async function writeAttr(page: Page, selector: string, attr: string, value: string | null): Promise<number> {
  return page.evaluate(
    ([sel, name, val]: [string, string, string | null]) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      const win = window as unknown as { __semanticsStash?: AttrEntry[] };
      win.__semanticsStash = win.__semanticsStash ?? [];
      for (const el of els) {
        win.__semanticsStash.push({ el, attr: name, value: el.getAttribute(name) });
        if (val === null) el.removeAttribute(name);
        else el.setAttribute(name, val);
      }
      return els.length;
    },
    [selector, attr, value],
  );
}
async function restoreAttrs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const win = window as unknown as { __semanticsStash?: AttrEntry[] };
    const stash = win.__semanticsStash ?? [];
    for (const { el, attr, value } of stash) {
      if (value === null) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    }
    delete win.__semanticsStash;
    return stash.length;
  });
}

// ---------------------------------------------------------------------------
// ① + ② 地标与标题层级
// ---------------------------------------------------------------------------
interface SemanticsStat {
  mainTotal: number;
  mainVisible: number;
  mainNested: number;
  shellIsMain: boolean;
  frameIsMain: boolean;
  mainDesc: string[];
  h1Total: number;
  h1Visible: number;
  h1Text: string;
  h1InMain: boolean;
  h1RectArea: number;
  levels: number[];
  headingDesc: string[];
  cardTitles: number;
  cardTitlesNoHeading: number;
  noHeadingSamples: string[];
}

const readSemantics = (page: Page): Promise<SemanticsStat> =>
  page.evaluate(() => {
    const vis = (el: Element) => el.getClientRects().length > 0;
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    // 标题级别：真 h1–h6 用标签，ARIA 写法用 aria-level（两种都认，判据才不会被 role=heading 绕过去）
    const levelOf = (el: Element): number | null => {
      const tag = /^H([1-6])$/.exec(el.tagName);
      if (tag) return Number(tag[1]);
      if (el.getAttribute('role') === 'heading') {
        const n = Number(el.getAttribute('aria-level') ?? '');
        return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
      }
      return null;
    };
    const cls = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className ?? '').trim().split(/\s+/).slice(0, 2).join('.')}`;

    const mains = Array.from(document.querySelectorAll('main,[role=main]'));
    const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]'));
    const visHeads = heads.filter(vis);
    const h1s = heads.filter((el) => levelOf(el) === 1);
    // 卡片标题盒：`.arco-card-header-title` 有文字却没包着任何标题元素的，就是「标题只是长得像标题」
    const titleBoxes = Array.from(document.querySelectorAll('.arco-card > .arco-card-header > .arco-card-header-title')).filter(
      (el) => vis(el) && text(el).length > 0,
    );
    const noHeading = titleBoxes.filter((el) => !el.matches('h1,h2,h3,h4,h5,h6,[role=heading]') && !el.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]'));
    const firstH1 = h1s[0] ?? null;
    const r = firstH1?.getBoundingClientRect();
    return {
      mainTotal: mains.length,
      mainVisible: mains.filter(vis).length,
      // 「main 里还有 main」：从父级往上看（用 parentElement.closest 才不含自身，closest 会把元素自己算进去）
      mainNested: mains.filter((el) => !!el.parentElement?.closest('main,[role=main]')).length,
      shellIsMain: !!document.querySelector('.app-content')?.matches('main,[role=main]'),
      frameIsMain: !!document.querySelector('.page-frame')?.matches('main,[role=main]'),
      mainDesc: mains.map((el) => `${cls(el)}${vis(el) ? '' : '（隐藏）'}`),
      h1Total: h1s.length,
      h1Visible: h1s.filter(vis).length,
      h1Text: text(firstH1),
      h1InMain: !!firstH1?.closest('main,[role=main]'),
      h1RectArea: r ? Math.round(r.width * r.height) : -1,
      levels: visHeads.map((el) => levelOf(el) ?? 0),
      headingDesc: visHeads.map((el) => `${levelOf(el) ?? '?'}:${text(el).slice(0, 12)}`),
      cardTitles: titleBoxes.length,
      cardTitlesNoHeading: noHeading.length,
      noHeadingSamples: noHeading.map((el) => text(el).slice(0, 14)),
    };
  });

function judgeSemantics(s: SemanticsStat, where: string, expectH1: string, minCards: number): string[] {
  const v: string[] = [];
  // 样本要求：一个 main 都没有 = 页面坏了，此时「不多于 1 个」会假绿
  if (s.mainTotal === 0) v.push(`${where}：文档里一个 main/[role=main] 都没有，地标判据没有样本`);
  if (s.mainTotal !== 1 || s.mainVisible !== 1) v.push(`${where}：main 地标 ${s.mainTotal} 个（可见 ${s.mainVisible}）应恰好 1 个 → ${JSON.stringify(s.mainDesc)}`);
  if (s.mainNested > 0) v.push(`${where}：出现 main 套 main（${s.mainNested} 处），读屏「跳到主内容」落点含糊`);
  if (!s.shellIsMain) v.push(`${where}：外壳 .app-content 不再是 main——唯一那个地标跑到了别处，读屏落点会落在页面骨架之外`);
  if (s.frameIsMain) v.push(`${where}：.page-frame 又渲染成 main —— #92 的双地标回归`);
  if (s.h1Total === 0) v.push(`${where}：一个 h1 都没有（读屏无法按标题定位当前页），标题判据没有样本`);
  if (s.h1Total !== 1 || s.h1Visible !== 1) v.push(`${where}：h1 ${s.h1Total} 个（可见 ${s.h1Visible}）应恰好 1 个`);
  if (s.h1Total >= 1 && s.h1Text !== expectH1) v.push(`${where}：页标题文本「${s.h1Text}」≠ 侧栏页名「${expectH1}」（标题没跟着路由改名）`);
  if (s.h1Total >= 1 && !s.h1InMain) v.push(`${where}：h1 不在 main 地标内`);
  if (s.h1RectArea >= 10000) v.push(`${where}：h1 可见面积 ${s.h1RectArea}px² —— 页标题应当是「视觉隐藏但读得到」，别把它做成一个看得见的空行`);
  // 层级形状：第一个标题必须是 h1，且不得跳级（h1 → h3 这种）
  if (s.levels.length && s.levels[0] !== 1) v.push(`${where}：文档序第一个标题是 ${s.levels[0]} 级（应为 1 级）→ ${JSON.stringify(s.headingDesc)}`);
  for (let i = 1; i < s.levels.length; i++) {
    if (s.levels[i] === 0) v.push(`${where}：出现无法定级的标题节点（role=heading 缺 aria-level）→ ${JSON.stringify(s.headingDesc[i])}`);
    else if (s.levels[i] - s.levels[i - 1] > 1) v.push(`${where}：标题跳级 ${s.levels[i - 1]} → ${s.levels[i]}（${JSON.stringify(s.headingDesc.slice(i - 1, i + 1))}）`);
  }
  if (s.cardTitles < minCards) v.push(`${where}：只扫到 ${s.cardTitles} 张带标题的卡片（预期至少 ${minCards}），卡片标题判据没有样本`);
  if (s.cardTitlesNoHeading > 0) v.push(`${where}：${s.cardTitlesNoHeading} 张卡片的标题只是文字、不是标题元素 → ${JSON.stringify(s.noHeadingSamples)}`);
  return v;
}

async function judgePage(page: Page, lang: Lang, index: number): Promise<SemanticsStat> {
  const nav = NAV[index];
  const s = await readSemantics(page);
  console.log(
    `[semantics][${lang}] ${nav.to}: main ${s.mainTotal}（嵌套 ${s.mainNested}）· h1「${s.h1Text}」· 可见标题 ${JSON.stringify(s.levels)} · 卡片标题 ${s.cardTitles}/${s.cardTitles - s.cardTitlesNoHeading} 是标题元素`,
  );
  expect(judgeSemantics(s, `${lang === 'zh' ? '中文' : '英文'}态 ${nav.to}`, nav[lang], MIN_CARDS[nav.to]), `${nav.to} 地标与标题层级`).toEqual([]);
  return s;
}

// ---------------------------------------------------------------------------
// ③ 服务状态播报
// ---------------------------------------------------------------------------
interface LiveStat {
  found: boolean;
  rowCls: string;
  liveSelf: boolean;
  liveAncestorCls: string | null;
  polite: string | null;
  text: string;
  h: number;
  w: number;
  inMain: boolean;
}

const readLive = (page: Page): Promise<LiveStat> =>
  page.evaluate(() => {
    const row = document.querySelector('.status-row') as HTMLElement | null;
    if (!row) return { found: false, rowCls: '', liveSelf: false, liveAncestorCls: null, polite: null, text: '', h: 0, w: 0, inMain: false };
    // live 根：状态行自身或它的祖先（祖先那一档意味着「包了新元素」，几何判据要抓）
    const root = (row.closest('[aria-live],[role=status]') ?? null) as HTMLElement | null;
    const r = row.getBoundingClientRect();
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      found: true,
      rowCls: String(row.className),
      liveSelf: root === row,
      liveAncestorCls: root && root !== row ? `${root.tagName.toLowerCase()}.${String(root.className).slice(0, 30)}` : null,
      polite: root ? (root.getAttribute('aria-live') ?? `role=${root.getAttribute('role')}`) : null,
      text: text(row),
      h: Math.round(r.height * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      inMain: !!row.closest('main,[role=main]'),
    };
  });

function judgeLive(s: LiveStat, where: string): string[] {
  const v: string[] = [];
  if (!s.found) return [`${where}：没找到状态行（.status-row），播报判据没有样本`];
  if (!s.polite) v.push(`${where}：状态行及其祖先都没有 aria-live / role=status —— 状态变了读屏不出声`);
  else if (s.polite !== 'polite') v.push(`${where}：live 档位是 ${JSON.stringify(s.polite)}（应为 polite：状态变化不该打断用户正在读的内容）`);
  if (!s.liveSelf) v.push(`${where}：live 根不是状态行本身而是 ${JSON.stringify(s.liveAncestorCls)} —— 播报要靠属性透传，新包一层元素就是第二套几何`);
  if (!s.inMain) v.push(`${where}：状态行不在 main 地标内，live 区可能落在读屏读不到的地方`);
  return v;
}

/** 顶栏启停驱动（mock 的 engine 文件存在性默认 false，启动这条路要先开钩子才走得通）。 */
async function enableEngineFile(page: Page) {
  await page.evaluate(() => {
    (globalThis as unknown as { __mockEngineFileExists?: boolean }).__mockEngineFileExists = true;
  });
}
async function setMockStopReason(page: Page, reason: string | null) {
  await page.evaluate((r) => {
    const g = globalThis as unknown as { __mockStopReason?: string };
    if (r === null) delete g.__mockStopReason;
    else g.__mockStopReason = r;
  }, reason);
}
async function statusRowText(page: Page): Promise<string> {
  return (await readLive(page)).text;
}

/**
 * 启停一轮：运行中 → 未运行 → 启动中 → 运行中，再在失败现场停一次（启动失败）。
 * 返回观测到的状态文本序列与状态行高度序列（高度序列用来钉「播报不改变几何」）。
 */
async function driveStatusCycle(page: Page, lang: Lang): Promise<{ texts: string[]; heights: number[] }> {
  const texts: string[] = [];
  const heights: number[] = [];
  const sample = async () => {
    const s = await readLive(page);
    expect(judgeLive(s, `${lang}态 状态行`), `${lang}态 播报容器`).toEqual([]);
    texts.push(s.text);
    heights.push(s.h);
  };
  await enableEngineFile(page);
  const start = page.locator('.topbar button', { hasText: UI[lang].start }).first();
  const stop = page.locator('.topbar button.tb-stop').first();
  await sample(); // 初始现场：mock 默认 running
  await stop.click();
  await expect.poll(() => statusRowText(page), { timeout: 5000 }).toBe(UI[lang].stopped);
  await sample();
  await start.click();
  await expect.poll(() => statusRowText(page), { timeout: 5000 }).toBe(UI[lang].starting);
  await sample();
  await expect.poll(() => statusRowText(page), { timeout: 8000 }).toBe(UI[lang].running);
  await sample();
  // 失败现场：停止事实换成 spawn_failed → 状态标签翻成「启动失败」（这正是 #92 描述里「界面只换个颜色」的那一态）
  await setMockStopReason(page, 'spawn_failed');
  await stop.click();
  await expect.poll(() => statusRowText(page), { timeout: 5000 }).toBe(UI[lang].failed);
  await sample();
  await setMockStopReason(page, null);
  return { texts, heights };
}

// ===========================================================================
// 判据用例（中英各一轮）
// ===========================================================================
for (const lang of ['zh', 'en'] as const) {
  const langName = lang === 'zh' ? '中文' : '英文';

  test.describe('地标与标题层级判据（' + langName + '态）', () => {
    test(`①②七页逐个：main 恰好 1 个、h1 恰好 1 个且文本＝侧栏页名、卡片标题是 h2`, async ({ page }) => {
      for (let i = 0; i < NAV.length; i++) {
        await open(page, lang, i);
        await judgePage(page, lang, i);
      }
    });

    test(`③服务状态变化在 live 区内出声，且状态行高度不随之跳档`, async ({ page }) => {
      await open(page, lang, 0); // 概览页：ServiceStatusCard 是服务状态的唯一页面级展示区
      const { texts, heights } = await driveStatusCycle(page, lang);
      const distinct = Array.from(new Set(texts));
      console.log(`[semantics][${lang}] 启停一轮文本序列：${JSON.stringify(texts)} · distinct ${JSON.stringify(distinct)} · 高度序列 ${JSON.stringify(heights)}`);
      // 样本要求 + 播报有效性：至少听见 4 个不同状态（运行中/未运行/启动中/启动失败），
      // 少了说明有一条其实没变（或者变了但 live 区里根本没有那段文字，readLive 已按 live 根取文本）
      expect(distinct.length, `状态一轮下来只有 ${distinct.length} 种文本：${JSON.stringify(distinct)}`).toBeGreaterThanOrEqual(4);
      const badHeight = heights.filter((h) => h !== heights[0]);
      expect(badHeight, `状态行高度在启停过程中跳档了：${JSON.stringify(heights)}`).toEqual([]);
    });
  });
}

// ===========================================================================
// 删除实验（判据自证）：把本轮改动在测试里退回旧形状，断言判据必须转红，再原地还原断言转绿。
// 只跑中文态：扰动改的是结构而非文案（文案回归由中英两轮覆盖）。
// ===========================================================================
test.describe('判据自证：退回旧形状必须转红', () => {
  test('①把 .page-frame 重新挂成 main 地标（＝PageFrame 退回 a-layout-content）→ 地标判据转红', async ({ page }) => {
    await open(page, 'zh', 0);
    expect(judgeSemantics(await readSemantics(page), '基线', NAV[0].zh, MIN_CARDS['/dashboard']), '基线应无报警').toEqual([]);

    const marked = await writeAttr(page, '.page-frame', 'role', 'main');
    expect(marked, '样本要求：页面上必须有 .page-frame 可挂回 main').toBeGreaterThan(0);
    const broken = judgeSemantics(await readSemantics(page), '退回旧形状', NAV[0].zh, MIN_CARDS['/dashboard']);
    console.log(`[semantics][删除实验] .page-frame 挂上 role=main 后报警 ${broken.length} 条：${JSON.stringify(broken)}`);
    expect(broken.some((m) => m.includes('main 地标')), '退回双 main 后计数判据未报警＝①空转').toBe(true);
    expect(broken.some((m) => m.includes('main 套 main')), '退回双 main 后嵌套判据未报警＝①的另一条腿空转').toBe(true);
    expect(broken.some((m) => m.includes('.page-frame 又渲染成 main')), '退回双 main 后未点名 .page-frame＝①的归因腿空转').toBe(true);

    expect(await restoreAttrs(page), '还原样本数').toBe(marked);
    expect(judgeSemantics(await readSemantics(page), '还原后', NAV[0].zh, MIN_CARDS['/dashboard']), '还原后应转绿').toEqual([]);
  });

  test('①注入第二个 main 节点 → 计数判据同样转红（防「只认 role=main 不认元素」）', async ({ page }) => {
    await open(page, 'zh', 2);
    const base = await readSemantics(page);
    expect(judgeSemantics(base, '基线', NAV[2].zh, MIN_CARDS['/service']), '基线应无报警').toEqual([]);
    const added = await page.evaluate(() => {
      const el = document.createElement('main');
      el.className = 'semantics-probe-main';
      document.querySelector('.page-host')?.appendChild(el);
      return document.querySelectorAll('main,[role=main]').length;
    });
    const broken = judgeSemantics(await readSemantics(page), '注入额外 main', NAV[2].zh, MIN_CARDS['/service']);
    console.log(`[semantics][删除实验] 注入额外 main 后文档内 main=${added}，报警：${JSON.stringify(broken)}`);
    expect(added, '注入后 main 数应为 2').toBe(base.mainTotal + 1);
    expect(broken.length, '注入第二个 main 后判据未报警＝①空转').toBeGreaterThan(0);
    await page.evaluate(() => document.querySelector('.semantics-probe-main')?.remove());
    expect(judgeSemantics(await readSemantics(page), '撤掉后', NAV[2].zh, MIN_CARDS['/service']), '撤掉后应转绿').toEqual([]);
  });

  test('②把页标题降级成 h2（模拟 h1 被删）→ 标题判据转红；还原后转绿', async ({ page }) => {
    await open(page, 'zh', 4);
    const base = await readSemantics(page);
    expect(judgeSemantics(base, '基线', NAV[4].zh, MIN_CARDS['/logs']), '基线应无报警').toEqual([]);

    const demoted = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return false;
      const clone = document.createElement('h2');
      clone.className = h1.className;
      // 复制而不是搬走子节点：搬走的话「还原」回来的就是个空 h1，转绿那条断言验的就不是原形状了
      clone.textContent = h1.textContent;
      h1.replaceWith(clone);
      (window as unknown as { __semanticsH1?: HTMLElement }).__semanticsH1 = h1;
      return true;
    });
    expect(demoted, '样本要求：日志页必须有一个 h1 可降级').toBe(true);
    const brokenStat = await readSemantics(page);
    const broken = judgeSemantics(brokenStat, 'h1 降级后', NAV[4].zh, MIN_CARDS['/logs']);
    console.log(`[semantics][删除实验] h1 降级后 h1 数=${brokenStat.h1Total}、标题序列=${JSON.stringify(brokenStat.levels)}，报警 ${broken.length} 条`);
    expect(broken.length, '把 h1 降级后标题判据未报警＝②空转').toBeGreaterThan(0);
    expect(broken.some((m) => m.includes('一个 h1 都没有')), '降级后未点名「h1 缺失」＝②的计数腿空转').toBe(true);

    await page.evaluate(() => {
      const win = window as unknown as { __semanticsH1?: HTMLElement };
      const h1 = win.__semanticsH1;
      const h2 = document.querySelector('.page-title');
      if (h1 && h2) h2.replaceWith(h1);
      delete win.__semanticsH1;
    });
    expect(judgeSemantics(await readSemantics(page), '还原后', NAV[4].zh, MIN_CARDS['/logs']), '还原后应转绿').toEqual([]);
  });

  test('②拆掉卡片标题的 h2（退回「只是文字」）→ 卡片标题判据转红；还原后转绿', async ({ page }) => {
    await open(page, 'zh', 2);
    expect(judgeSemantics(await readSemantics(page), '基线', NAV[2].zh, MIN_CARDS['/service']), '基线应无报警').toEqual([]);

    const unwrapped = await page.evaluate(() => {
      let n = 0;
      for (const el of Array.from(document.querySelectorAll('.section-card__title'))) {
        const inner = el.querySelector('button');
        const next = inner ?? (() => {
          const span = document.createElement('span');
          span.append(...Array.from(el.childNodes));
          return span;
        })();
        next.setAttribute('data-semantics-old', '1');
        el.replaceWith(next);
        n++;
      }
      return n;
    });
    expect(unwrapped, '样本要求：服务页必须有卡片标题可拆').toBeGreaterThan(0);
    const broken = judgeSemantics(await readSemantics(page), '拆掉卡片 h2', NAV[2].zh, MIN_CARDS['/service']);
    console.log(`[semantics][删除实验] 拆掉 ${unwrapped} 个卡片标题的 h2 后报警：${JSON.stringify(broken)}`);
    expect(broken.some((m) => m.includes('不是标题元素')), '拆掉卡片 h2 后判据未报警＝②的卡片腿空转').toBe(true);

    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('[data-semantics-old]'))) {
        const h2 = document.createElement('h2');
        h2.className = 'section-card__title';
        el.removeAttribute('data-semantics-old');
        el.replaceWith(h2);
        h2.append(el);
      }
    });
    expect(judgeSemantics(await readSemantics(page), '还原后', NAV[2].zh, MIN_CARDS['/service']), '还原后应转绿').toEqual([]);
  });

  test('③摘掉状态行的 aria-live → 播报判据转红；还原后转绿', async ({ page }) => {
    await open(page, 'zh', 0);
    const base = await readLive(page);
    expect(judgeLive(base, '基线'), '基线应无报警').toEqual([]);

    const stripped = await writeAttr(page, '.status-row', 'aria-live', null);
    expect(stripped, '样本要求：状态行必须存在').toBe(1);
    const broken = judgeLive(await readLive(page), '摘掉 aria-live');
    console.log(`[semantics][删除实验] 摘掉 aria-live 后报警：${JSON.stringify(broken)}`);
    expect(broken.length, '摘掉 aria-live 后播报判据未报警＝③空转').toBeGreaterThan(0);
    expect(broken.some((m) => m.includes('aria-live')), '报警未点名 aria-live＝③的归因腿空转').toBe(true);

    expect(await restoreAttrs(page), '还原样本数').toBe(stripped);
    expect(judgeLive(await readLive(page), '还原后'), '还原后应转绿').toEqual([]);
  });

  test('③把 live 改成「外面包一层新元素」→ 「不新包元素」那条腿转红；撤掉后转绿', async ({ page }) => {
    await open(page, 'zh', 0);
    expect(judgeLive(await readLive(page), '基线'), '基线应无报警').toEqual([]);
    // 先摘掉行上的 aria-live（否则 closest 会先命中状态行自己，包外层也测不出差异），
    // 再把 live 挂到一个新插入的祖先 div 上——这就是「用包壳代替透传」的旧写法
    const stripped = await writeAttr(page, '.status-row', 'aria-live', null);
    expect(stripped, '样本要求：状态行必须存在').toBe(1);
    const wrapped = await page.evaluate(() => {
      const row = document.querySelector('.status-row');
      const box = document.createElement('div');
      box.setAttribute('aria-live', 'polite');
      box.className = 'semantics-probe-wrap';
      row?.parentNode?.insertBefore(box, row);
      box.appendChild(row);
      return !!row;
    });
    expect(wrapped, '样本要求：状态行必须有父节点可包').toBe(true);
    const broken = judgeLive(await readLive(page), 'live 根外包了一层元素');
    console.log(`[semantics][删除实验] live 根改为祖先节点后报警：${JSON.stringify(broken)}`);
    expect(broken.some((m) => m.includes('live 根不是状态行本身')), '包一层元素后未报警＝③的「不新包元素」腿空转').toBe(true);
    await page.evaluate(() => {
      const box = document.querySelector('.semantics-probe-wrap');
      const row = box?.querySelector('.status-row');
      if (box && row) {
        box.parentNode?.insertBefore(row, box);
        box.remove();
      }
    });
    expect(await restoreAttrs(page), '还原样本数').toBe(stripped);
    expect(judgeLive(await readLive(page), '撤掉包装并还原后'), '撤掉包装后应转绿').toEqual([]);
  });
});
