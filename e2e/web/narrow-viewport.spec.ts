import { test, expect, type Page, type ElementHandle } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 窄视口判据 E2E：窗口最小宽度是应用对外承诺的契约（apps/desktop/src/main/window.ts 的
// minWidth/minHeight，实测 1024×680），但 e2e 此前只在 1280×720 的 Desktop Chrome 下跑过——
// 没有任何一条用例把「缩到最小窗口也不横向溢出」钉住。上一轮 STYLE_TODO #82 记的
// 「7 页中英横向溢出 0」是一次性手工脚本、没入库，且那次运行第 2 页就中止了（实际只有概览被量到），
// 所以本文件是这条判据的第一次落地，7 页中英各 14 次逐页实测。
//
// 三条纪律沿用 layout-stability.spec.ts / logs-scroll.spec.ts：
//   ① 阈值派生，不写死像素：视口尺寸从 window.ts 解析（解析不到即显式失败，不留静默空转），
//      容差 1px 与「撑破注入」的量级（2×clientWidth）都由实测宽度算出来；
//   ② 判据自带样本要求：每页必须真的扫到可见元素（<60 个判红；实测最省的一页是内置 Web UI
//      的 113 个——那页只测本应用外壳，iframe 内容不属本文档），且必须确认视口真的被
//      改成承诺尺寸（documentElement.clientWidth ≠ 承诺宽 就判红——否则量的是 1280，绿灯无意义）；
//   ③ 删除实验三条腿各一条：页内撑宽（.param-grid）、「取消外壳裁剪 + 撑宽顶栏」（文档级）、
//      把顶栏整簇移出视口（可达性）。
//      实测记录见文件末尾三个用例的控制台输出：**外壳 .app-layout 带 overflow:hidden，
//      单撑宽页内元素时文档级 scrollWidth 一动不动（恒 0）**，只有元素级那一条抓得住——
//      这正是「不撑宽文档但够不着/被裁掉」的那类回归，也是两条腿都要留着的原因。
//
// 实测数字（2026-10-07 于 vite dev 服务 127.0.0.1:5173，视口 1024×680 = window.ts 的
// minWidth/minHeight，中英各 8 次测量 = 16 次）：
//   /dashboard 可见 183 · /models 447 · /service 206 · /params 208 ·
//   /logs 183 · /webui 113 · /settings 213；**文档溢出 0px、越界元素 0 个，16 次全为 0**。
//   （2026-10-08 起参数页单视图直出，原「/params?自定义参数 1457」二测随页签移除而删；
//   当轮实测 /params 单视图本身零溢出）
//   主操作区（顶栏 4 只按钮 + 窗口控制 + 侧栏 + 7 个导航项 + 折叠按钮）逐页 toBeInViewport 通过；
//   注意 .window-controls 顶边实测 -0.5px（亚像素），Playwright 仍判在视口内。
//   删除实验：注入 .param-grid{min-width:2048px} → 越界元素 687 个、最大 +1289px，
//   Top 指认到 DIV.param-grid，而同一时刻文档溢出仍为 0px；
//   注入「取消 .app-layout 裁剪 + 顶栏 2048px」→ 文档溢出 1024px（scrollWidth 2048）。
//
// 判据只测本应用外壳：内置 Web UI 页里的引擎 iframe 内容属另一个文档，
// 不进越界普查（querySelectorAll 到不了它的内部），iframe 元素本身按普通元素量。

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

/** 主操作区：顶栏按钮簇 + 窗口控制 + 侧栏（含 7 个导航项与折叠按钮）。 */
const CHROME = [
  '.tb-model',
  '.tb-stop',
  '.tb-restart',
  '.tb-openweb',
  '.window-controls',
  '.sidebar',
  '.sidebar .arco-menu-item',
  '.sidebar-footer .arco-btn',
];

/**
 * 视口尺寸从事实源派生：minWidth/minHeight 改了就跟着改，避免「测试里写死 1024」与契约漂移。
 * 解析不到直接抛——这与 scripts/verify-*.cjs 的「解析不到同样 fail」同一条纪律。
 */
function readMinViewport(): { width: number; height: number; from: string } {
  const bases = [typeof __dirname === 'string' ? resolve(__dirname, '..', '..') : process.cwd(), process.cwd()];
  for (const base of bases) {
    const file = join(base, 'apps', 'desktop', 'src', 'main', 'window.ts');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const w = /minWidth:\s*(\d+)/.exec(src);
    const h = /minHeight:\s*(\d+)/.exec(src);
    if (!w || !h) {
      throw new Error(`窄视口判据无法从 ${file} 解析 minWidth/minHeight（窗口契约写法变了，判据须同步改，不接受静默跳过）`);
    }
    return { width: Number(w[1]), height: Number(h[1]), from: file };
  }
  throw new Error('找不到 apps/desktop/src/main/window.ts：窄视口判据的尺寸无从派生');
}

const MIN = readMinViewport();
/** 越界容差：亚像素取整噪声（实测 .window-controls 顶边就是 -0.5px）。 */
const TOL = 1;

interface OverflowStat {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  docOverflow: number;
  visible: number;
  offenders: number;
  maxOver: number;
  worst: { chain: string; over: number; text: string; scrollHost: string | null }[];
}

const measureOverflow = (page: Page): Promise<OverflowStat> =>
  page.evaluate(
    ([tol]: [number]) => {
      const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
      const styles = new Map<Element, CSSStyleDeclaration>(all.map((el) => [el, getComputedStyle(el)]));
      const isVisible = (el: Element): boolean => {
        for (let n: Element | null = el; n && n.nodeType === 1; n = n.parentElement) {
          const s = styles.get(n) ?? getComputedStyle(n);
          if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
          if (parseFloat(s.opacity || '1') === 0) return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      /** 仅供报告：最近的横向可滚祖先（有它说明「能横滚到」，没有说明「被裁掉且够不着」）。 */
      const scrollHost = (el: Element): string | null => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const ox = (styles.get(n) ?? getComputedStyle(n)).overflowX;
          if (ox === 'auto' || ox === 'scroll') return `${String(n.className).split(/\s+/)[0]}(可横滚)`;
          if (ox === 'hidden') return `${String(n.className).split(/\s+/)[0]}(裁切)`;
        }
        return null;
      };
      const cw = document.documentElement.clientWidth;
      const ch = document.documentElement.clientHeight;
      const sw = document.documentElement.scrollWidth;
      let visible = 0;
      const rows: { chain: string; over: number; text: string; scrollHost: string | null }[] = [];
      for (const el of all) {
        if (!isVisible(el)) continue;
        visible++;
        const r = el.getBoundingClientRect();
        if (r.right <= cw + tol) continue;
        rows.push({
          chain: `${el.tagName}.${String(el.className ?? '').trim().split(/\s+/).slice(0, 2).join('.')}`,
          over: Math.round((r.right - cw) * 10) / 10,
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 16),
          scrollHost: scrollHost(el),
        });
      }
      rows.sort((a, b) => b.over - a.over);
      return {
        clientWidth: cw,
        clientHeight: ch,
        scrollWidth: sw,
        docOverflow: sw - cw,
        visible,
        offenders: rows.length,
        maxOver: rows.length ? rows[0].over : 0,
        worst: rows.slice(0, 5),
      };
    },
    [TOL],
  );

function judgeOverflow(where: string, s: OverflowStat): string[] {
  const v: string[] = [];
  if (s.clientWidth !== MIN.width) {
    v.push(`${where}：视口宽 ${s.clientWidth}px ≠ 应用 minWidth ${MIN.width}px，窄视口判据没有真的窄下去`);
  }
  if (s.visible < 60) v.push(`${where}：只扫到 ${s.visible} 个可见元素，样本不足（页面没渲染完就量了）`);
  if (s.docOverflow !== 0) {
    v.push(`${where}①：文档横向溢出 ${s.docOverflow}px（scrollWidth ${s.scrollWidth} > clientWidth ${s.clientWidth}）`);
  }
  if (s.offenders !== 0) {
    v.push(
      `${where}②：${s.offenders} 个可见元素越出可视宽，最大 ${s.maxOver}px → ${JSON.stringify(s.worst.map((w) => `${w.chain} +${w.over}px ${w.scrollHost ?? ''}`.trim()))}`,
    );
  }
  return v;
}

/** 冷启动 → 设定最小视口 → 走侧栏进目标页（demo 的 last_tab 会回跳概览，故不用 URL 直达）。 */
async function openNarrow(page: Page, lang: Lang, index: number) {
  await page.setViewportSize({ width: MIN.width, height: MIN.height });
  await page.goto(lang === 'en' ? '/?lang=en' : '/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: NAV[index][lang] }).click();
  await expect(page).toHaveURL(new RegExp(`#${NAV[index].to}(\\?|$)`));
  // 就绪门禁用 .page-host 的直接子节点：keep-alive 会把访问过的页留在 DOM 内
  // （装进 display:none 的容器），此时 .page-frame 匹配到多个，strict mode 当场失败
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

async function expectChromeReachable(page: Page, where: string) {
  for (const sel of CHROME) {
    await expect(page.locator(sel).first(), `${where}：主操作区 ${sel} 应仍在视口内`).toBeInViewport();
  }
  // 折叠开关按钮与 7 个导航项逐个查（.sidebar .arco-menu-item 的 first 只查了一个）
  const items = page.locator('.sidebar .arco-menu-item');
  const n = await items.count();
  expect(n, `${where}：侧栏导航项数应等于判据表 ${NAV.length}`).toBe(NAV.length);
  for (let i = 0; i < n; i++) {
    await expect(items.nth(i), `${where}：第 ${i} 个导航项应仍在视口内`).toBeInViewport();
  }
}

async function measureAndJudge(page: Page, lang: Lang, where: string): Promise<OverflowStat> {
  const s = await measureOverflow(page);
  console.log(
    `[narrow][${lang}] ${where}: 视口 ${s.clientWidth}×${s.clientHeight} · scrollWidth ${s.scrollWidth} · 文档溢出 ${s.docOverflow}px · 可见元素 ${s.visible} · 越界元素 ${s.offenders} · 最大越界 ${s.maxOver}px · Top ${JSON.stringify(s.worst.map((w) => `${w.chain}+${w.over}`))}`,
  );
  expect(judgeOverflow(where, s), `${lang}态 ${where} 窄视口溢出`).toEqual([]);
  return s;
}

// ===========================================================================
// ⑥ 最小视口：7 页中英各跑一轮
// ===========================================================================
for (const lang of ['zh', 'en'] as const) {
  const langName = lang === 'zh' ? '中文' : '英文';
  test.describe(`最小视口判据（${langName}态，${MIN.width}×${MIN.height} 派生自 ${MIN.from}）`, () => {
    test(`⑥${NAV.length} 页逐页：文档零横向溢出 + 零元素越界 + 主操作区可达`, async ({ page }) => {
      for (let i = 0; i < NAV.length; i++) {
        await openNarrow(page, lang, i);
        await measureAndJudge(page, lang, NAV[i].to);
        await expectChromeReachable(page, NAV[i].to);
        // 2026-10-08 预设页签移除：参数页单视图直出 69 行（最密一屏就是默认页），原「切自定义参数页签二测」分支随之删除
      }
    });
  });
}

// ===========================================================================
// ⑦ 删除实验：两条腿各一条，注入后必须转红并能指认到元素，撤掉后必须转绿
// ===========================================================================
async function injectStyle(page: Page, css: string): Promise<ElementHandle<HTMLElement>> {
  return (await page.addStyleTag({ content: css })) as unknown as ElementHandle<HTMLElement>;
}
async function removeStyle(handle: ElementHandle<HTMLElement>) {
  await handle.evaluate((el) => el.remove());
}

test.describe('判据自证：撑破最小视口必须报警', () => {
  test('⑦-②元素级：把参数网格撑到 2 倍可视宽 → 越界判据转红且指认到 .param-grid（文档级此刻仍为 0，正是它抓不到的那类）', async ({ page }) => {
    await openNarrow(page, 'zh', 3);
    // 2026-10-08 预设页签移除：参数页单视图直出，等行挂载即可
    await expect(page.locator('.param-row-wrapper').first()).toBeVisible();
    const base = await measureAndJudge(page, 'zh', '/params（基线）');
    const handle = await injectStyle(page, `.param-grid{min-width:${base.clientWidth * 2}px !important}`);
    const broken = await measureOverflow(page);
    console.log(
      `[narrow][删除实验] 注入 .param-grid{min-width:${base.clientWidth * 2}px} → 文档溢出 ${broken.docOverflow}px / 越界元素 ${broken.offenders} 个 / 最大 ${broken.maxOver}px · Top ${JSON.stringify(broken.worst.map((w) => `${w.chain}+${w.over}(${w.scrollHost ?? '无'})`))}`,
    );
    const v = judgeOverflow('注入后', broken);
    expect(v.length, '撑宽参数网格后判据未报警＝⑥-②空转').toBeGreaterThan(0);
    expect(v.some((m) => m.includes('②')), `元素级那一条没抓到越界（报警：${JSON.stringify(v)}）`).toBe(true);
    expect(broken.worst.some((w) => w.chain.includes('param-grid')), `最大越界元素里认不出 .param-grid：${JSON.stringify(broken.worst)}`).toBe(true);
    // 实测事实（写进判据而非只写注释）：外壳裁剪下文档级完全不响，删掉元素级这条就等于没判据
    expect(broken.docOverflow, '文档级这条在此类越界下必须仍是 0（若哪天变成非 0，说明外壳裁剪改了，须复核两条腿的分工）').toBe(0);
    await removeStyle(handle);
    await measureAndJudge(page, 'zh', '/params（撤掉注入后）');
  });

  test('⑦-①文档级：取消外壳裁剪并撑宽顶栏 → 文档溢出判据转红（证明⑥-①不是恒等式）', async ({ page }) => {
    await openNarrow(page, 'zh', 0);
    const base = await measureAndJudge(page, 'zh', '/dashboard（基线）');
    const handle = await injectStyle(
      page,
      // 两步注入：① .app-layout 的 overflow:hidden 正是「页内元素越界也不撑破文档」的原因（实测），
      // 取消它；② 再把顶栏撑到 2 倍可视宽。这样文档级 scrollWidth 才可能动起来，用来验 ⑥-① 有牙。
      `.app-layout{overflow:visible !important}.topbar{min-width:${base.clientWidth * 2}px !important}`,
    );
    const broken = await measureOverflow(page);
    console.log(`[narrow][删除实验] 取消外壳裁剪 + 撑宽顶栏 → 文档溢出 ${broken.docOverflow}px（scrollWidth ${broken.scrollWidth} > clientWidth ${broken.clientWidth}）`);
    const v = judgeOverflow('注入后', broken);
    expect(v.some((m) => m.includes('①')), `取消裁剪并撑宽后文档级判据未报警＝⑥-①恒等式假绿（实测 ${JSON.stringify(v)}）`).toBe(true);
    await removeStyle(handle);
    await measureAndJudge(page, 'zh', '/dashboard（撤掉注入后）');
  });

  test('⑦-③可达性腿：把顶栏整簇移出视口 → toBeInViewport 必须判红（证明「主操作区可达」不是恒真）', async ({ page }) => {
    await openNarrow(page, 'zh', 0);
    await expectChromeReachable(page, '/dashboard（基线）');
    const handle = await injectStyle(page, '.topbar{transform:translateY(-300px) !important}');
    let rejected = 0;
    const verdicts: string[] = [];
    for (const sel of ['.tb-model', '.tb-stop', '.tb-restart', '.tb-openweb']) {
      const ok = await expect(page.locator(sel).first())
        .toBeInViewport({ timeout: 800 })
        .then(() => true)
        .catch(() => false);
      verdicts.push(`${sel}=${ok ? '仍在视口内' : '判不可达'}`);
      if (!ok) rejected++;
    }
    console.log(`[narrow][删除实验] 顶栏整簇上移 300px → ${verdicts.join(' / ')}，判红 ${rejected} 个`);
    expect(rejected, '把主操作区整簇移出视口后 toBeInViewport 仍全绿＝⑥-③恒真，没有守着任何东西').toBeGreaterThan(0);
    await removeStyle(handle);
    await expectChromeReachable(page, '/dashboard（撤掉注入后）');
  });
});
