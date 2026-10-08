import { test, expect, type Page } from '@playwright/test';
// 参数行数从事实源取（沿用 layout-stability.spec.ts 的做法）：写死的行数每加一个参数就红一次，
// 于是人会去改数字而不是看判据本身。
import { PARAMS } from '../../packages/shared/dist/index.js';

// 可访问性判据 E2E：把本轮已实测落地的三处修复钉成回归闸门，另补一条一直没人守的窄视口判据
// （窄视口见 narrow-viewport.spec.ts）。三处修复与它们各自「回归时长什么样」：
//   ① 侧栏导航：Arco 2.58 的 a-menu-item 渲染成无 tabindex / 无 role / 无键盘处理的 DIV，
//      实测连按 40 次 Tab 一次都落不到导航项，且 /params 与 /settings 除侧栏外没有任何入口
//      ——键盘用户根本到不了这两页。修法：a-menu 补 role=navigation + aria-label，
//      每个 item 补 role=link / tabindex=0 / aria-current，Enter·Space 走既有 navigate()。
//   ② 三个弹窗（文件浏览 / 二次确认 / 关闭确认）：Arco a-modal 不提供对话框语义也不管焦点
//      （全包 grep aria-modal 修复前为 0 命中）。修法：容器声明 role/aria-modal/aria-labelledby，
//      焦点由 packages/ui/src/composables/useDialogFocus.ts 管理。
//   ③ 参数行控件：69 个 .arco-form-item 的 label[for]/id 关联实测为 0（Arco form-item 的 props
//      表里没有 for，永远不会写关联）。修法：六个控件组件统一补 aria-label。
//
// 三条纪律沿用 layout-stability.spec.ts / logs-scroll.spec.ts：
//   ① 阈值派生，不写死几何：Tab 预算按「导航项数」而非像素给；无名称控件的判据是「计数 == 0」。
//   ② 判据自带样本要求：拿不到样本的用例显式判红（导航项数 ≠ 7、弹窗内可 Tab 控件 < 2、
//      普查页面上一个可 Tab 控件都没扫到——都会直接 fail，而不是留一条恒等式假绿）。
//   ③ 每条判据配「删除实验」：在测试内摘掉本轮补上的属性（tabindex / role / aria-modal /
//      aria-labelledby / aria-label），断言判据必须转红，随后原地还原再断言转绿。
//      抓不住删除的判据等于没守着。
//
// 实测数字（2026-10-07 于 vite dev 服务 127.0.0.1:5173，中英各一轮，视口 1280×720）：
//   ① 干净首屏 Tab 序列：导航项停在第 8–14 次停靠，7/7 全中且顺序 0→6；Enter 后 hash 逐项等于
//      /dashboard /models /service /params /logs /webui /settings；aria-current 恒只 1 个。
//   ② 文件浏览弹窗：DOM 内常驻 3 个 [role=dialog] 节点，打开时可见 1 个；aria-modal=true，
//      无障碍名经 aria-labelledby 解析为「选择模型目录」/「Select model directory」；
//      打开瞬间焦点已在弹窗内；Tab 16 次 16/16 在弹窗内（循环 4 个控件）；Esc 后可见数 0，
//      焦点回到触发按钮「更改」（按元素同一性比对）。
//   ③ 命名普查（可见且可 Tab 聚焦）：概览 19 / 模型 39 / 服务 21 / 参数自定义页签 121 / 设置 28
//      个控件，**未登记的无名称控件 == 0**（参数行 69/69 每行都至少有一个可 Tab 控件）。
//      **残留登记表已清空（RESIDUALS = []）**：判据回到「字面 == 0」。
//      曾登记过的 18 个「Arco 把名称留在外层、真正可聚焦的内层节点没名」（13 只滑杆句柄 +
//      5 只 Select 内层 input）由 `directives/innerAriaLabel.ts` 收口补名后归零；
//      设置页 2 只路径输入框走 `:input-attrs`，参数页 2 只仅图标钮走 `aria-label`。
//      仍然不进普查的只有 Arco 自绘的 22 只 `a-input-number` 步进钮——实测 `tabindex="-1"`，
//      不是键盘停靠点，且库没有给任何属性钩子。
//
// 判据只测本应用外壳：内置 Web UI 页是引擎 iframe（不属五页普查范围，也不经键盘判据）。

type Lang = 'zh' | 'en';

const NAV = [
  { to: '/dashboard', zh: '概览', en: 'Overview' },
  { to: '/models', zh: '模型管理', en: 'Models' },
  { to: '/service', zh: '服务', en: 'Service' },
  { to: '/params', zh: '参数设置', en: 'Parameters' },
  { to: '/logs', zh: '日志', en: 'Logs' },
  { to: '/webui', zh: '内置 Web UI', en: 'Built-in Web UI' },
  { to: '/settings', zh: '应用设置', en: 'Settings' },
];

/** 侧栏项文案 → NAV 下标（判据按「命中集合 == 全集」比较，少一项就是漏）。 */
const navLabel = (lang: Lang, i: number) => NAV[i][lang];

/**
 * Tab 预算：实测首个导航项停在第 8 次、末项停在第 14 次停靠。
 * 这里给的是「次数」不是像素：预算取 30 ≈ 实测上界的 2 倍，够容纳顶栏按钮数随状态增减，
 * 又远小于旧实现的「40 次全落空」——预算的存在只在「一个都没命中」时才有意义。
 */
const TAB_BUDGET = 30;
/** 弹窗内 Tab 圈数预算：实测弹窗内 4 个可 Tab 控件，16 次 = 4 圈。 */
const DIALOG_TAB_BUDGET = 16;

const UI: Record<Lang, { change: string; dlgTitle: string }> = {
  zh: { change: '更改', dlgTitle: '选择模型目录' },
  en: { change: 'Change', dlgTitle: 'Select model directory' },
};

/** 冷启动 → 走侧栏进目标页（demo 的 last_tab 会回跳概览，故不用 URL 直达）。 */
async function open(page: Page, lang: Lang, index: number) {
  await page.goto(lang === 'en' ? '/?lang=en' : '/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: navLabel(lang, index) }).click();
  await expect(page).toHaveURL(new RegExp(`#${NAV[index].to}(\\?|$)`));
  // 就绪门禁用 .page-host 的直接子节点：keep-alive 会把访问过的页面留在 DOM 里
  // （藏进 display:none 的容器），此时 .page-frame 匹配到 2 个，strict mode 当场失败
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

/**
 * 属性摘除/还原：Vue 会把 data-* 选择器 patch 掉，故按元素引用记录原值再原地还原。
 * 多次摘除累加进同一份 stash（一条删除实验里连着摘 aria-modal 与 aria-labelledby，
 * 覆盖式记录只会还原最后一次——第一次的破坏就永久留场了）。
 */
interface StripEntry {
  el: HTMLElement;
  attr: string;
  value: string | null;
}
async function stripAttr(page: Page, selector: string, attr: string): Promise<number> {
  return page.evaluate(
    ([sel, name]: [string, string]) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      const win = window as unknown as { __a11yStrip?: StripEntry[] };
      win.__a11yStrip = win.__a11yStrip ?? [];
      for (const el of els) {
        win.__a11yStrip.push({ el, attr: name, value: el.getAttribute(name) });
        el.removeAttribute(name);
      }
      return els.length;
    },
    [selector, attr],
  );
}
async function restoreAttr(page: Page): Promise<number> {
  return page.evaluate(() => {
    const win = window as unknown as { __a11yStrip?: StripEntry[] };
    const stash = win.__a11yStrip ?? [];
    let n = 0;
    for (const { el, attr, value } of stash) {
      if (value !== null) {
        el.setAttribute(attr, value);
        n++;
      }
    }
    delete win.__a11yStrip;
    return n;
  });
}

// ---------------------------------------------------------------------------
// ① 侧栏可达导航：语义属性 + 从干净首屏按 Tab 依次命中全部导航项
// ---------------------------------------------------------------------------
interface NavRow {
  text: string;
  role: string | null;
  tabindex: string | null;
  ariaCurrent: string | null;
}
interface MenuRoot {
  role: string | null;
  ariaLabel: string | null;
}

const readNav = (page: Page): Promise<NavRow[]> =>
  page
    .locator('.sidebar .arco-menu-item')
    .evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
        role: el.getAttribute('role'),
        tabindex: el.getAttribute('tabindex'),
        ariaCurrent: el.getAttribute('aria-current'),
      })),
    );

const readMenuRoot = (page: Page): Promise<MenuRoot> =>
  page.locator('.sidebar .arco-menu').first().evaluate((el) => ({
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
  }));

/** 从当前焦点（干净首屏为 body）连按 budget 次 Tab，记录命中导航项的停靠序号与下标。 */
async function tabSweep(page: Page, budget: number): Promise<{ stop: number; idx: number }[]> {
  const hits: { stop: number; idx: number }[] = [];
  for (let stop = 1; stop <= budget; stop++) {
    await page.keyboard.press('Tab');
    const idx = await page.evaluate(
      () => Array.from(document.querySelectorAll('.sidebar .arco-menu-item')).indexOf(document.activeElement),
    );
    if (idx >= 0) hits.push({ stop, idx });
    if (hits.length === NAV.length) break; // 全中即可停：再多按只会在页面里绕圈
  }
  return hits;
}

function judgeNavSemantics(rows: NavRow[], menu: MenuRoot): string[] {
  const v: string[] = [];
  if (rows.length !== NAV.length) v.push(`侧栏导航项数 ${rows.length} ≠ 判据表 ${NAV.length}（判据表需同步更新）`);
  if (menu.role !== 'navigation') v.push(`a-menu 根节点 role=${JSON.stringify(menu.role)}，读屏认不出这是导航地标`);
  if (!(menu.ariaLabel ?? '').trim()) v.push(`a-menu 根节点 aria-label=${JSON.stringify(menu.ariaLabel)}，导航地标无名`);
  rows.forEach((r, i) => {
    if (r.role !== 'link') v.push(`第 ${i} 项「${r.text}」role=${JSON.stringify(r.role)}（应为 link）`);
    if (r.tabindex !== '0') v.push(`第 ${i} 项「${r.text}」tabindex=${JSON.stringify(r.tabindex)}（应为 0，否则键盘到不了）`);
  });
  return v;
}

function judgeNavReach(rows: NavRow[], hits: { stop: number; idx: number }[]): string[] {
  const v: string[] = [];
  if (!rows.length) return ['侧栏未渲染任何导航项，Tab 判据没有样本'];
  const got = new Set(hits.map((h) => h.idx));
  const missing = rows.map((r, i) => ({ r, i })).filter(({ i }) => !got.has(i)).map(({ r }) => r.text);
  if (missing.length) v.push(`前 ${TAB_BUDGET} 次 Tab 未命中：[${missing.join(' / ')}]（命中集必须等于全集，少一项就是漏）`);
  const idxs = hits.map((h) => h.idx);
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] <= idxs[i - 1]) v.push(`命中顺序非侧栏顺序：${idxs.join('→')}`);
  }
  return v;
}

function judgeAriaCurrent(rows: NavRow[], expected: number): string[] {
  const v: string[] = [];
  const on = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.ariaCurrent === 'page').map(({ i }) => i);
  if (on.length !== 1) {
    v.push(`aria-current="page" 出现 ${on.length} 次（必须恰好 1 次）：${JSON.stringify(rows.map((r) => r.ariaCurrent))}`);
  } else if (on[0] !== expected) {
    v.push(`aria-current 落在第 ${on[0]} 项，当前页应为第 ${expected} 项`);
  }
  const bogus = rows.filter((r) => r.ariaCurrent !== null && r.ariaCurrent !== 'page');
  if (bogus.length) v.push(`出现非 page 的 aria-current 值：${JSON.stringify(bogus.map((r) => r.ariaCurrent))}`);
  return v;
}

// ---------------------------------------------------------------------------
// ② 对话框语义 + 焦点管理
// ---------------------------------------------------------------------------
interface DialogStat {
  nodes: number;
  visible: number;
  modal: string | null;
  labelledby: string | null;
  name: string | null;
  focusInside: boolean;
  activeTag: string | null;
  tabbables: number;
}

/**
 * 只测**可见**弹窗：三个 a-modal 挂在 App 层，关闭态的 .arco-modal-container 也常驻 DOM
 * （实测 nodes=3 / visible=1），按 getClientRects().length>0 过滤——不过滤会选中关闭态节点，
 * 得出与真实弹窗相反的假结论。
 */
const readDialog = (page: Page): Promise<DialogStat> =>
  page.evaluate(() => {
    const TABBABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const nodes = Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
    const visible = nodes.filter((el) => el.getClientRects().length > 0);
    const one = visible[0] ?? null;
    const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const lb = one?.getAttribute('aria-labelledby') ?? null;
    const name = lb ? textOf(document.getElementById(lb)) : null;
    const active = document.activeElement as HTMLElement | null;
    return {
      nodes: nodes.length,
      visible: visible.length,
      modal: one?.getAttribute('aria-modal') ?? null,
      labelledby: lb,
      name: name || null,
      focusInside: !!one && !!active && one.contains(active),
      activeTag: active ? active.tagName : null,
      tabbables: one ? (Array.from(one.querySelectorAll(TABBABLE)) as HTMLElement[]).filter((e) => e.getClientRects().length > 0).length : 0,
    };
  });

/** 弹窗内每按一次 Tab 记录：焦点是否仍在可见弹窗内 + 落在第几个可 Tab 控件（用于数圈）。 */
function dialogTabLoop(page: Page, budget: number): Promise<{ inside: number; outside: number; slots: number[] }> {
  return (async () => {
    let inside = 0;
    let outside = 0;
    const slots: number[] = [];
    for (let i = 0; i < budget; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const visible = (Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[]).filter(
          (el) => el.getClientRects().length > 0,
        );
        const one = visible[0] ?? null;
        const active = document.activeElement as HTMLElement | null;
        if (!one || !active || !one.contains(active)) return { in: false, slot: -1 };
        const TABBABLE = [
          'a[href]',
          'button:not([disabled])',
          'input:not([disabled])',
          'select:not([disabled])',
          'textarea:not([disabled])',
          '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const list = Array.from(one.querySelectorAll(TABBABLE)).filter((e) => (e as HTMLElement).getClientRects().length > 0);
        return { in: true, slot: list.indexOf(active) };
      });
      if (r.in) inside++;
      else outside++;
      slots.push(r.slot);
    }
    return { inside, outside, slots };
  })();
}

function judgeDialog(stat: DialogStat, expectTitle: string): string[] {
  const v: string[] = [];
  if (stat.nodes < 2) v.push(`DOM 内 [role=dialog] 节点只有 ${stat.nodes} 个：判据依赖「多节点里挑可见的」这一前提，节点数变了须复核本判据`);
  if (stat.visible !== 1) v.push(`打开后可见弹窗节点数 ${stat.visible}（应为 1）`);
  if (stat.modal !== 'true') v.push(`可见弹窗 aria-modal=${JSON.stringify(stat.modal)}（读屏因此不会把焦点关进对话框）`);
  if (!stat.labelledby) v.push('可见弹窗无 aria-labelledby，无障碍名不可解析');
  else if (!stat.name) v.push(`aria-labelledby=${JSON.stringify(stat.labelledby)} 没解析到真实文本节点`);
  else if (stat.name !== expectTitle) v.push(`解析出的弹窗名「${stat.name}」≠ 期望「${expectTitle}」`);
  if (!stat.focusInside) v.push(`打开瞬间焦点不在弹窗内（activeElement=${JSON.stringify(stat.activeTag)}），读屏从页面开头读起`);
  if (stat.tabbables < 2) v.push(`弹窗内可 Tab 控件只有 ${stat.tabbables} 个，焦点环判据没有样本`);
  return v;
}

function judgeDialogTabs(stat: DialogStat, loop: { inside: number; outside: number; slots: number[] }, budget: number): string[] {
  const v: string[] = [];
  if (loop.outside !== 0) v.push(`Tab ${budget} 次里有 ${loop.outside} 次跑出弹窗（焦点环漏了）`);
  if (loop.inside !== budget) v.push(`Tab ${budget} 次只有 ${loop.inside} 次落在弹窗内`);
  const distinct = new Set(loop.slots.filter((s) => s >= 0));
  if (distinct.size !== stat.tabbables) {
    v.push(`焦点环只走过 ${distinct.size} 个槽位，弹窗内却有 ${stat.tabbables} 个可 Tab 控件（环与控件集不一致）`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// ③ 命名普查：可见且可 Tab 聚焦的交互控件里，未登记的无名称控件必须为 0
// ---------------------------------------------------------------------------
/**
 * 已登记残留（不是本轮补名范围的回归，逐条打印不计红）：共同根因是 Arco 把 attrs 落在**外层**，
 * 真正可聚焦的**内层**节点没有名——摘掉本轮补的 aria-label 不会命中这里的任何一条，
 * 删除实验因此仍然有效。修复这些残留时应来删这里的条目，而不是把判据改成「只数外层」。
 */
const RESIDUALS: { css: string; why: string }[] = [];
// 想加条目之前先读 directives/innerAriaLabel.ts：内层可聚焦节点是有解的（指令挂在
// a-form-item 这一层即可，a-select 是多根组件、指令挂它会被 Vue 整体跳过）。
// 放松这条判据的正确方式是修掉它，不是登记它。

interface CensusStat {
  scanned: number;
  tabbable: number;
  named: number;
  unnamed: number;
  unregistered: number;
  breakdown: Record<string, number>;
  nameSources: Record<string, number>;
  rows: number;
  rowsWithTabbable: number;
  unregisteredSamples: { chain: string; text: string }[];
}

/**
 * 取数口径（写死在页面函数里，避免与判据描述漂移）：
 * 选择器 a[href] / button:not([disabled]) / input / select / textarea:not([disabled]) /
 * [tabindex]:not([tabindex="-1"])；祖先链上任一 display:none / visibility:hidden / opacity:0 一律跳过；
 * 名称来源：aria-label、aria-labelledby（须解析到真实节点）、可见文字、placeholder、label[for=id]、
 * 包裹式 label。**注意**：a-input-number 的 22 个步进按钮带 tabindex="-1"，被口径排除（实测如此）。
 */
const runCensus = (page: Page): Promise<CensusStat> =>
  page.evaluate((residualCss: string[]) => {
    const SEL = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
    const styles = new Map<Element, CSSStyleDeclaration>(all.map((el) => [el, getComputedStyle(el)]));
    const isHidden = (el: Element): boolean => {
      for (let n: Element | null = el; n && n.nodeType === 1; n = n.parentElement) {
        const s = styles.get(n) ?? getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return true;
        if (parseFloat(s.opacity || '1') === 0) return true;
      }
      return false;
    };
    const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const nameSrc = (el: Element): string | null => {
      if ((el.getAttribute('aria-label') ?? '').trim()) return 'aria-label';
      const lb = el.getAttribute('aria-labelledby');
      if (lb && lb.split(/\s+/).some((id) => textOf(document.getElementById(id)))) return 'aria-labelledby';
      if (textOf(el)) return 'text';
      if ((el.getAttribute('placeholder') ?? '').trim()) return 'placeholder';
      const id = el.getAttribute('id');
      if (id && textOf(document.querySelector(`label[for="${id}"]`))) return 'label[for]';
      const w = el.closest('label');
      if (w && textOf(w)) return 'label-wrap';
      return null;
    };
    const hits: { css: string | null; chain: string; text: string }[] = [];
    let tabbable = 0;
    const nameSources: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll(SEL))) {
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') continue;
      if (isHidden(el)) continue;
      tabbable++;
      const src = nameSrc(el);
      if (src) {
        nameSources[src] = (nameSources[src] ?? 0) + 1;
        continue;
      }
      const css = residualCss.find((c) => {
        try {
          return el.matches(c);
        } catch {
          return false;
        }
      }) ?? null;
      hits.push({ css, chain: `${el.tagName}.${String(el.className ?? '').trim().split(/\s+/).slice(0, 2).join('.')}`, text: textOf(el).slice(0, 16) });
    }
    const rows = Array.from(document.querySelectorAll('.param-row-wrapper'));
    let rowsWithTabbable = 0;
    for (const row of rows) {
      const list = Array.from(row.querySelectorAll(SEL)).filter(
        (el) => !(el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') && !isHidden(el),
      );
      if (list.length > 0) rowsWithTabbable++;
    }
    const breakdown: Record<string, number> = {};
    for (const h of hits) {
      const k = h.css ?? 'UNREGISTERED';
      breakdown[k] = (breakdown[k] ?? 0) + 1;
    }
    return {
      scanned: all.length,
      tabbable,
      named: tabbable - hits.length,
      unnamed: hits.length,
      unregistered: hits.filter((h) => !h.css).length,
      breakdown,
      nameSources,
      rows: rows.length,
      rowsWithTabbable,
      unregisteredSamples: hits.filter((h) => !h.css).slice(0, 8),
    };
  }, RESIDUALS.map((r) => r.css));

function judgeCensus(where: string, s: CensusStat, opts: { minTabbable: number; expectRows?: number }): string[] {
  const v: string[] = [];
  // 样本要求：一个控件都没扫到说明口径/页面坏了，此时「==0」是假绿
  if (s.scanned < 50) v.push(`${where}：DOM 只扫到 ${s.scanned} 个元素，普查没有样本`);
  if (s.tabbable < opts.minTabbable) v.push(`${where}：可见且可 Tab 的控件只有 ${s.tabbable} 个（预期至少 ${opts.minTabbable}），口径可能失效`);
  if (s.named + s.unnamed !== s.tabbable) v.push(`${where}：命名计数不自洽 named=${s.named} + unnamed=${s.unnamed} ≠ tabbable=${s.tabbable}`);
  if (opts.expectRows !== undefined) {
    if (s.rows !== opts.expectRows) v.push(`${where}：参数行渲染数 ${s.rows} ≠ PARAMS.length ${opts.expectRows}`);
    if (s.rowsWithTabbable !== s.rows) v.push(`${where}：${s.rows} 个参数行里有 ${s.rows - s.rowsWithTabbable} 行没有任何可 Tab 控件（该行未被普查覆盖）`);
  }
  if (s.unregistered !== 0) {
    v.push(`${where}：未登记的无名称控件 ${s.unregistered} 个 → ${JSON.stringify(s.unregisteredSamples)}`);
  }
  return v;
}

/** 逐页普查并打印实测数字（报告里要能看到是哪页、几个、哪些类别）。 */
async function censusOn(page: Page, lang: Lang, where: string, opts: { minTabbable: number; expectRows?: number }): Promise<CensusStat> {
  const s = await runCensus(page);
  console.log(
    `[a11y][${lang}] ${where}: 扫描 ${s.scanned} 节点 · 可Tab控件 ${s.tabbable} · 有名 ${s.named} · 无名 ${s.unnamed} · 未登记 ${s.unregistered} · 参数行 ${s.rows}/${s.rowsWithTabbable} · 名称来源 ${JSON.stringify(s.nameSources)} · 残留分布 ${JSON.stringify(s.breakdown)}`,
  );
  expect(judgeCensus(`${where}`, s, opts), `${lang}态 ${where} 命名普查`).toEqual([]);
  return s;
}

// ===========================================================================
// 判据用例（中英各一轮）
// ===========================================================================
for (const lang of ['zh', 'en'] as const) {
  const langName = lang === 'zh' ? '中文' : '英文';

  test.describe(`可访问性判据（${langName}态）`, () => {
    test(`①侧栏是可达导航：语义属性齐备且前 ${TAB_BUDGET} 次 Tab 依次命中全部 ${NAV.length} 项`, async ({ page }) => {
      await page.goto(lang === 'en' ? '/?lang=en' : '/');
      await expect(page.locator('.sidebar')).toBeVisible();
      const rows = await readNav(page);
      const menu = await readMenuRoot(page);
      expect(judgeNavSemantics(rows, menu), `${langName}态侧栏语义属性`).toEqual([]);
      expect(judgeNavReach(rows, await tabSweep(page, TAB_BUDGET)), `${langName}态 Tab 命中`).toEqual([]);
    });

    test(`②Enter/Space 走既有导航，且 aria-current 只落在当前页（逐页验 ${NAV.length} 次）`, async ({ page }) => {
      await page.goto(lang === 'en' ? '/?lang=en' : '/');
      await expect(page.locator('.sidebar')).toBeVisible();
      // Tab 到第一个导航项后，Enter → 校验 → 一次 Tab 前进到下一项（实测焦点在 Enter 后仍留在该项）
      let idx = -1;
      for (let stop = 1; stop <= TAB_BUDGET; stop++) {
        await page.keyboard.press('Tab');
        idx = await page.evaluate(
          () => Array.from(document.querySelectorAll('.sidebar .arco-menu-item')).indexOf(document.activeElement),
        );
        if (idx >= 0) break;
      }
      expect(idx, `${langName}态未能 Tab 到首个导航项（第 ${TAB_BUDGET} 次内没落到侧栏）`).toBe(0);
      for (let i = 0; i < NAV.length; i++) {
        const focused = await page.evaluate(
          () => Array.from(document.querySelectorAll('.sidebar .arco-menu-item')).indexOf(document.activeElement),
        );
        expect(focused, `${langName}态第 ${i} 项：焦点应先停在该项`).toBe(i);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`#${NAV[i].to}(\\?|$)`), { timeout: 5_000 });
        expect(judgeAriaCurrent(await readNav(page), i), `${langName}态停在 ${NAV[i].to} 时的 aria-current`).toEqual([]);
        if (i < NAV.length - 1) await page.keyboard.press('Tab');
      }
      // Space 是同一套 navigate 的第二条按键路径（实测停在第 5 项按空格 → #/logs）
      await page.goto(lang === 'en' ? '/?lang=en' : '/');
      await expect(page.locator('.sidebar')).toBeVisible();
      for (let guard = 0; guard < TAB_BUDGET; guard++) {
        await page.keyboard.press('Tab');
        const at = await page.evaluate(
          () => Array.from(document.querySelectorAll('.sidebar .arco-menu-item')).indexOf(document.activeElement),
        );
        if (at === 2) break;
      }
      await page.keyboard.press(' ');
      await expect(page).toHaveURL(/#\/service(\?|$)/, { timeout: 5_000 });
    });

    test('③文件浏览弹窗：对话框语义可解析、焦点困在弹窗内、Esc 归位到触发按钮', async ({ page }) => {
      await open(page, lang, 6); // 应用设置：模型目录行的「更改 / Change」是主路径入口
      const trigger = page.locator('.path-row button.arco-btn', { hasText: UI[lang].change }).first();
      expect(await page.locator('.path-row button.arco-btn', { hasText: UI[lang].change }).count(), '两个目录行都有「更改」按钮').toBe(2);
      // 关闭态：3 个 dialog 节点常驻 DOM，可见数必须为 0——这一条就是「按可见性过滤」存在的理由
      const closed = await readDialog(page);
      expect(closed.nodes, `${langName}态关闭态应有多个 [role=dialog] 节点常驻 DOM`).toBeGreaterThanOrEqual(2);
      expect(closed.visible, `${langName}态关闭态不应有可见弹窗`).toBe(0);

      await trigger.click();
      await expect(page.locator('.fc-file-browser .fb-path-input')).toBeVisible();
      const stat = await readDialog(page);
      expect(judgeDialog(stat, UI[lang].dlgTitle), `${langName}态弹窗语义`).toEqual([]);

      const loop = await dialogTabLoop(page, DIALOG_TAB_BUDGET);
      console.log(
        `[a11y][${lang}] 弹窗 Tab ${DIALOG_TAB_BUDGET} 次：弹窗内 ${loop.inside} / 弹窗外 ${loop.outside}，环内槽位数 ${stat.tabbables}，实走 ${new Set(loop.slots.filter((s) => s >= 0)).size} 个`,
      );
      expect(judgeDialogTabs(stat, loop, DIALOG_TAB_BUDGET), `${langName}态弹窗焦点环`).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(page.locator('.fc-file-browser .fb-path-input')).toBeHidden();
      const after = await readDialog(page);
      expect(after.visible, `${langName}态 Esc 后可见弹窗数`).toBe(0);
      // 按元素同一性比对（不靠 data-* 选择器：Vue 的 patch 会吃掉临时属性）
      expect(await trigger.evaluate((el) => document.activeElement === el), `${langName}态 Esc 后焦点应回到触发按钮`).toBe(true);
    });

    test('④命名普查：可见且可 Tab 的控件里未登记的无名称数为 0（五页）', async ({ page }) => {
      // minTabbable 一律取实测值的六成以下：它的职责是「口径/页面坏了要显式判红」，
      // 不是把控件个数钉成基线（钉死个数会让任何正常改动去改数字而不是看判据）。
      // 实测：概览 19 / 模型 39 / 服务 21 / 参数自定义页签 121 / 应用设置 28。
      await open(page, lang, 0);
      await censusOn(page, lang, '概览', { minTabbable: 10 });
      await open(page, lang, 1);
      await censusOn(page, lang, '模型管理', { minTabbable: 20 });
      await open(page, lang, 2);
      await censusOn(page, lang, '服务', { minTabbable: 12 });
      await open(page, lang, 3);
      // 2026-10-08 预设页签移除：参数页单视图直出 69 行控件，六类控件的补名随页覆盖
      await expect(page.locator('.param-row-wrapper').first()).toBeVisible();
      await censusOn(page, lang, '参数设置', { minTabbable: 100, expectRows: PARAMS.length });
      await open(page, lang, 6);
      await censusOn(page, lang, '应用设置', { minTabbable: 15 });
    });
  });
}

// ===========================================================================
// 删除实验（判据自证）：摘掉本轮补上的属性，断言对应判据必须转红，再原地还原断言转绿。
// 只跑中文态：这些扰动改的是属性而非文案，双语各跑一遍不增加判别力（文案回归由①②③④双语覆盖）。
// ===========================================================================
test.describe('判据自证：摘掉本轮补上的属性必须转红', () => {
  test('①摘掉 tabindex（模拟 $attrs 透传失效）→ Tab 命中判据转红；还原后转绿', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(judgeNavReach(await readNav(page), await tabSweep(page, TAB_BUDGET)), '基线应无报警').toEqual([]);

    const stripped = await stripAttr(page, '.sidebar .arco-menu-item', 'tabindex');
    expect(stripped, '摘除样本：7 个导航项').toBe(NAV.length);
    const rows = await readNav(page);
    const brokenSem = judgeNavSemantics(rows, await readMenuRoot(page));
    const brokenReach = judgeNavReach(rows, await tabSweep(page, TAB_BUDGET));
    console.log(`[a11y][删除实验] tabindex 摘除后：语义报警 ${brokenSem.length} 条 / Tab 报警 ${brokenReach.length} 条 · ${JSON.stringify(brokenReach[0] ?? '')}`);
    expect(brokenReach.length, '摘掉 tabindex 后 Tab 判据仍无报警＝①-可达性空转').toBeGreaterThan(0);
    expect(brokenSem.length, '摘掉 tabindex 后语义判据未记录 tabindex 缺失＝属性腿空转').toBeGreaterThan(0);

    expect(await restoreAttr(page), '还原样本数').toBe(NAV.length);
    expect(judgeNavSemantics(await readNav(page), await readMenuRoot(page)), '还原后语义应转绿').toEqual([]);
    expect(judgeNavReach(await readNav(page), await tabSweep(page, TAB_BUDGET)), '还原后 Tab 应转绿').toEqual([]);
  });

  test('①把 role 改成 null（模拟 role=link 被删）→ 语义判据转红', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(judgeNavSemantics(await readNav(page), await readMenuRoot(page)), '基线应无报警').toEqual([]);
    const stripped = await stripAttr(page, '.sidebar .arco-menu-item', 'role');
    expect(stripped).toBe(NAV.length);
    const broken = judgeNavSemantics(await readNav(page), await readMenuRoot(page));
    expect(broken.length, 'role 置空后语义判据未报警＝①-语义腿空转').toBeGreaterThan(0);
    expect(broken[0], `报警内容应点在 role 上：${broken[0]}`).toContain('role');
    await restoreAttr(page);
    expect(judgeNavSemantics(await readNav(page), await readMenuRoot(page)), '还原后应转绿').toEqual([]);
  });

  test('②摘掉 aria-modal 与 aria-labelledby → 弹窗语义判据转红；还原后转绿', async ({ page }) => {
    await open(page, 'zh', 6);
    await page.locator('.path-row button.arco-btn', { hasText: UI.zh.change }).first().click();
    await expect(page.locator('.fc-file-browser .fb-path-input')).toBeVisible();
    const base = await readDialog(page);
    expect(judgeDialog(base, UI.zh.dlgTitle), '基线应无报警').toEqual([]);

    const stripped = await stripAttr(page, '[role="dialog"]', 'aria-modal');
    expect(stripped, '摘除样本应覆盖 DOM 内的弹窗节点').toBeGreaterThanOrEqual(base.nodes);
    const afterModal = await readDialog(page);
    const brokenModal = judgeDialog(afterModal, UI.zh.dlgTitle);
    console.log(`[a11y][删除实验] aria-modal 摘除后可见弹窗 aria-modal=${JSON.stringify(afterModal.modal)}，报警：${JSON.stringify(brokenModal)}`);
    expect(brokenModal.some((m) => m.includes('aria-modal')), '摘掉 aria-modal 后弹窗判据未报警＝②-语义腿空转').toBe(true);

    const stripped2 = await stripAttr(page, '[role="dialog"]', 'aria-labelledby');
    expect(stripped2).toBeGreaterThanOrEqual(base.nodes);
    const brokenName = judgeDialog(await readDialog(page), UI.zh.dlgTitle);
    expect(brokenName.some((m) => m.includes('aria-labelledby')), '摘掉 aria-labelledby 后名称判据未报警＝②-名称腿空转').toBe(true);

    await restoreAttr(page);
    expect(judgeDialog(await readDialog(page), UI.zh.dlgTitle), '还原后应转绿').toEqual([]);
  });

  test('②Esc 前把焦点挪到弹窗外 → 焦点归位判据仍要求回到触发按钮（防「挪走的也算成功」）', async ({ page }) => {
    await open(page, 'zh', 6);
    const trigger = page.locator('.path-row button.arco-btn', { hasText: UI.zh.change }).first();
    await trigger.click();
    await expect(page.locator('.fc-file-browser .fb-path-input')).toBeVisible();
    // 用户在弹窗里改了路径输入框的内容焦点：关闭时仍应回到「更改」
    await page.locator('.fc-file-browser .fb-path-input input').first().focus();
    expect(await trigger.evaluate((el) => document.activeElement === el), '焦点应已在弹窗内的输入框').toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('.fc-file-browser .fb-path-input')).toBeHidden();
    expect(await trigger.evaluate((el) => document.activeElement === el), '焦点未归位到触发按钮').toBe(true);
  });

  test('③摘掉参数控件的 aria-label → 命名普查判据转红；还原后转绿', async ({ page }) => {
    await open(page, 'zh', 3);
    // 2026-10-08 预设页签移除：参数页单视图直出
    await expect(page.locator('.param-row-wrapper').first()).toBeVisible();
    expect(judgeCensus('基线', await runCensus(page), { minTabbable: 100, expectRows: PARAMS.length }), '基线应无报警').toEqual([]);

    // 两类各摘一批：开关（a-switch 直接带 aria-label）与数值输入（aria-label 须经 input-attrs 落到真 input）
    const n1 = await stripAttr(page, '.param-row-wrapper .arco-switch', 'aria-label');
    expect(n1, '样本要求：参数页必须有开关控件可摘').toBeGreaterThan(0);
    const s1 = await runCensus(page);
    const broken1 = judgeCensus('摘开关名', s1, { minTabbable: 100, expectRows: PARAMS.length });
    console.log(`[a11y][删除实验] 摘掉 ${n1} 只开关的 aria-label → 未登记无名称控件 ${s1.unregistered} 个：${JSON.stringify(s1.unregisteredSamples.map((x) => x.chain))}`);
    expect(broken1.length, '摘掉 aria-label 后普查未报警＝③空转').toBeGreaterThan(0);
    expect(s1.unregistered, `摘掉 ${n1} 只开关名应产生 ${n1} 个未登记无名称控件（实测 ${s1.unregistered}）`).toBe(n1);
    await restoreAttr(page);

    const n2 = await stripAttr(page, '.param-row-wrapper .arco-input-number input', 'aria-label');
    expect(n2, '样本要求：参数页必须有数值输入框可摘').toBeGreaterThan(0);
    const s2 = await runCensus(page);
    console.log(`[a11y][删除实验] 摘掉 ${n2} 只数值输入框的 aria-label → 未登记无名称控件 ${s2.unregistered} 个`);
    expect(s2.unregistered, '摘掉数值输入框 aria-label 后未登记数应与摘除数一致').toBe(n2);
    await restoreAttr(page);
    expect(judgeCensus('还原后', await runCensus(page), { minTabbable: 100, expectRows: PARAMS.length }), '还原后应转绿').toEqual([]);
  });

  test('②aria-current 摘掉后播报判据转红（当前页播报不是恒等式）', async ({ page }) => {
    await open(page, 'zh', 0);
    expect(judgeAriaCurrent(await readNav(page), 0), '基线应无报警').toEqual([]);
    await stripAttr(page, '.sidebar .arco-menu-item', 'aria-current');
    const broken = judgeAriaCurrent(await readNav(page), 0);
    expect(broken.length, '摘掉 aria-current 后播报判据未报警＝②-播报空转').toBeGreaterThan(0);
    await restoreAttr(page);
    expect(judgeAriaCurrent(await readNav(page), 0), '还原后应转绿').toEqual([]);
  });
});
