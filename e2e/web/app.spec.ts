import { test, expect, type Page } from '@playwright/test';
// 参数总数从事实源取，不写死字面量（写死的数字每加一个参数就要人去改一次）。
// 走 dist 相对路径而非包名：Playwright 从仓库根解析模块，而根 package.json 不依赖
// workspace 包。代价是 shared/dist 得由 e2e:web 自己产——ui 的 build 经 tsconfig paths
// 直接吃 ../shared/src，不产出 dist（本机 dist 长期存在，掩盖了这条隐式依赖，
// clean 检出下 CI 的 e2e job 因此整只红过一次，现由脚本显式先 build shared）。
import { PARAMS } from '../../packages/shared/dist/index.js';

// Web 渲染层 E2E：跑真实构建产物（vite preview + demo-mock 数据）。
// demo-mock 在无 window.api 时由 main.ts 注入，静态 UI 自足可离线验证。
// 注意：demo 设置的 last_tab 会在启动时强制回跳「概览」，故导航统一走侧栏点击。

const NAV = [
  { to: '#/dashboard', label: '概览' },
  { to: '#/models', label: '模型管理' },
  { to: '#/service', label: '服务' },
  { to: '#/params', label: '参数设置' },
  { to: '#/logs', label: '日志' },
  { to: '#/webui', label: '内置 Web UI' },
  { to: '#/settings', label: '应用设置' },
];

/** 打开首页等启动完成，再通过侧栏导航到目标页面，返回已就绪的页面。 */
async function openPage(page: Page, label: string, to: string) {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: label }).click();
  await expect(page).toHaveURL(new RegExp(`${to}(\\?|$)`));
  // 页面主体渲染（非白屏）：page-host 下存在激活页面根元素
  await expect(page.locator('.page-host > *').first()).toBeVisible();
}

test.describe('侧边栏导航', () => {
  for (const item of NAV) {
    test(`「${item.label}」可点击并切换到对应页面`, async ({ page }) => {
      await openPage(page, item.label, item.to);
    });
  }
});

test.describe('demo-mock 数据注入', () => {
  test('模型页展示演示模型列表', async ({ page }) => {
    await openPage(page, '模型管理', '#/models');
    await expect(
      page.locator('.models-table .model-name-row', { hasText: 'Qwen3-32B-A3B-Instruct-Q4_K_M.gguf' }),
    ).toBeVisible();
  });

  test('服务页展示 running 状态卡', async ({ page }) => {
    await openPage(page, '服务', '#/service');
    await expect(page.getByText('运行中', { exact: true }).first()).toBeVisible();
  });
});

// ---- 表单标签几何（STYLE_TODO #79）----
// 英文标签普遍比中文长（实测 Advanced「Max Concurrent Downloads」172px vs 中文 84px），
// 而 Arco 的 label-col 默认 overflow: visible + nowrap：列宽不足时文本不截断而是溢出，
// 实测直接压进控件左侧 24px。列宽按双语最长标签定，这里逐行断言「不压控件 + 不截断」，
// 使两种语言、每个面板都受检（只改一处文案不会漏）。
const SETTINGS_TABS = [
  { zh: '常规', en: 'General' },
  { zh: '外观', en: 'Appearance' },
  { zh: '高级', en: 'Advanced' },
];

/**
 * 通过设置页「外观 → 语言」切换界面语言。
 * 入口一律按中文标签点：每个 test 都是全新 context，mock 初始语言恒为 zh，
 * 若用目标语言的标签去找侧栏项，切到英文的那条用例会在切换前就找不到元素。
 */
async function setLanguage(page: Page, lang: 'zh' | 'en') {
  await page.locator('.sidebar .arco-menu-item', { hasText: '应用设置' }).click();
  await page.locator('.arco-tabs-tab', { hasText: '外观' }).click();
  await page.locator('.arco-form-item', { hasText: '语言' }).first().locator('.arco-select').click();
  await page.locator('.arco-select-option', { hasText: lang === 'zh' ? '中文' : 'English' }).first().click();
  await expect(page.locator('.sidebar .arco-menu-item', { hasText: lang === 'zh' ? '概览' : 'Overview' })).toBeVisible();
}

/** 返回每个表单行的标签溢出量（>0 表示压到控件）与截断量（>0 表示标签被省略号截断）。 */
async function measureFormLabels(page: Page) {
  return page.locator('.arco-form-item').evaluateAll((items) =>
    items
      .map((it) => {
        const col = it.querySelector('.arco-form-item-label-col') as HTMLElement | null;
        const wrap = it.querySelector('.arco-form-item-wrapper-col') as HTMLElement | null;
        const label = (col?.querySelector('.arco-form-item-label') ?? col) as HTMLElement | null;
        if (!col || !wrap || !label) return null;
        const range = document.createRange();
        range.selectNodeContents(label);
        return {
          text: (label.textContent ?? '').trim(),
          slack: Math.round(wrap.getBoundingClientRect().left - range.getBoundingClientRect().right),
          truncated: Math.round(label.scrollWidth - label.clientWidth),
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.text),
  );
}

/** 逐行断言：标签既不压控件（slack ≥ 0）也不被省略号截断（scrollWidth ≤ clientWidth）。 */
async function expectLabelsFit(page: Page, where: string) {
  const rows = await measureFormLabels(page);
  expect(rows.length, `${where} 应有表单行`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.slack, `${where} 标签「${row.text}」与控件间隙`).toBeGreaterThanOrEqual(0);
    expect(row.truncated, `${where} 标签「${row.text}」不应被截断`).toBeLessThanOrEqual(1);
  }
}

test.describe('表单标签几何（双语）', () => {
  for (const lang of ['zh', 'en'] as const) {
    test(`${lang === 'zh' ? '中文' : '英文'}态设置页各面板标签既不压控件也不截断`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();
      await setLanguage(page, lang);
      for (const tab of SETTINGS_TABS) {
        await page.locator('.arco-tabs-tab', { hasText: tab[lang] }).click();
        await expect(page.locator('.arco-form-item').first()).toBeVisible();
        await expectLabelsFit(page, `设置/${tab[lang]}`);
      }
    });

    // 参数页全行纳入：该页列宽 124 是 #78 按中文最长标签（122.8px）定的，
    // 英文曾有 11 条超出被省略号截断（STYLE_TODO #80 改文案后归零）。断言零截断，
    // 使「新增参数用了长英文标签」这类回归在 CI 就被拦下，而不是靠人工逐视口复测。
    // 行数取 PARAMS.length 而非写死：写死的数字每加一个参数就红一次，
    // 于是人会去改数字而不是看布局——b11178 收录 CORS 族时正撞在这上面。
    test(`${lang === 'zh' ? '中文' : '英文'}态参数页全行标签不截断不压控件`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();
      await setLanguage(page, lang);
      await page.locator('.sidebar .arco-menu-item', { hasText: lang === 'zh' ? '参数设置' : 'Parameters' }).click();
      await page.locator('.arco-tabs-tab', { hasText: lang === 'zh' ? '自定义参数' : 'Custom Params' }).click();
      await expect(page.locator('.param-row-wrapper').first()).toBeVisible();
      await expectLabelsFit(page, '参数页');
      // 全部参数行都在 DOM 内（无虚拟列表），少一行说明渲染或选择器变了
      expect(await page.locator('.param-row-wrapper').count()).toBe(PARAMS.length);
    });
  }
});