import { test, expect, type Page } from '@playwright/test';

/**
 * 目录选择器的滚动判据（真机报「所有目录选择器滚不动」，mock 此前测不出来）
 *
 * 出了什么事：目录浏览弹窗里条目一多过一屏，下面的行就看不见也拖不出来——列表被裁在盒子里。
 * 成因是滚动挂错了层：`class="fb-list"` 落在 Arco `a-list` 的**外层 wrapper**（`.arco-list-wrapper`）上，
 * 而库对该 wrapper 写死 `overflow: hidden`；我们往它加的 `overflow: auto` 等于给一个被裁的容器装滚动条。
 * 库自己的 `max-height` prop 才把 `maxHeight + overflow-y:auto` 加在**内层 `.arco-list`**（List.js 的 contentStyle）。
 *
 * mock 为什么以前看不见：`system.listDir` 是恒回 `entries: []`（且 `path: null`）的空桩，弹窗里只有空态，
 * 归档里就记着这条不可达（docs/archive/style-todo-resolved.md 的 FileBrowserModal 段）。
 * 现在 demo-mock 给了一棵静态目录树（目录在前文件在后，与主进程 FS_LIST_DIR 同一形状），判据才跑得起来。
 *
 * 判据为什么写成几何 + 真滚轮，而不是「有没有滚动条元素」：
 *   ① 滚动宿主必须是内层 `.arco-list`（computed `overflow-y: auto`），外层 wrapper 保持 hidden；
 *   ② 内容必须高于可视区（`scrollHeight > clientHeight`），可视区取组件给的 300px；
 *   ③ 真滚轮事件能把 `scrollTop` 推离 0——**必须用 `page.mouse.wheel`**：脚本里 dispatch 的
 *      合成 `WheelEvent` 不产生默认滚动（实测 dispatch 后 scrollTop 仍是 0），拿它当判据会永久红；
 *   ④ 滚到底后最后一行进入可视区——这才是「用户看得见后面的目录」这个用户视角结论。
 *
 * 删除实验：去掉 `a-list` 的 `:max-height` ⇒ ② 当场不成立（内容被 wrapper 裁掉，scrollHeight == clientHeight）。
 */

type Lang = 'zh' | 'en';
const NAV_LABEL: Record<Lang, string> = { zh: '应用设置', en: 'Settings' };
const CHANGE_LABEL: Record<Lang, string> = { zh: '更改', en: 'Change' };
/** demo-mock 目录树里条目足够多的那一层（30 个量化档，专为把列表撑过 300px） */
const CROWDED_DIR = 'Qwen3-32B-A3B-Instruct';

/** 冷启动 → 侧栏进设置页 → 点模型目录行的「更改」开弹窗（不用 URL 直达：demo 的 last_tab 会回跳概览）。 */
async function openPicker(page: Page, lang: Lang): Promise<void> {
  await page.goto(lang === 'en' ? '/?lang=en' : '/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar .arco-menu-item', { hasText: NAV_LABEL[lang] }).click();
  const trigger = page.locator('.path-row button.arco-btn', { hasText: CHANGE_LABEL[lang] }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('.fc-file-browser .fb-path-input')).toBeVisible();
  await page.locator('.fc-file-browser .fb-row').first().waitFor();
}

/** 进入条目最多的目录，返回滚动宿主的几何读数 */
async function measureList(page: Page) {
  await page.locator('.fc-file-browser .fb-row', { hasText: CROWDED_DIR }).click();
  await expect(page.locator('.fc-file-browser .fb-row')).not.toHaveCount(0);
  const rows = await page.locator('.fc-file-browser .fb-row').count();
  const geo = await page.locator('.fc-file-browser .fb-list-wrap').evaluate((wrap) => {
    const inner = wrap.querySelector('.arco-list') as HTMLElement;
    const outer = wrap.querySelector('.arco-list-wrapper') as HTMLElement;
    // 外层高度取**计算样式**而不是 getBoundingClientRect：Arco 弹窗开合带 transform 动画，
    // rect 是变换后的渲染值（首跑 1/20 读到 287px，于是「样式 vs 渲染」的等式当场假红）。
    // clientHeight/scrollHeight 是布局值，不受 transform 影响，可以照旧用。
    return {
      wrapStyleH: getComputedStyle(wrap).height,
      clientH: inner.clientHeight,
      scrollH: inner.scrollHeight,
      innerOverflowY: getComputedStyle(inner).overflowY,
      innerMaxHeight: getComputedStyle(inner).maxHeight,
      outerOverflow: getComputedStyle(outer).overflow,
    };
  });
  return { rows, ...geo };
}

for (const lang of ['zh', 'en'] as const) {
  test.describe(`目录选择器滚动（${lang === 'zh' ? '中文' : '英文'}态）`, () => {
    test('列表挂错层就滚不动：宿主是内层 .arco-list，滚轮推得动，末行滚得进', async ({ page }) => {
      await openPicker(page, lang);
      const m = await measureList(page);

      // ① 滚动宿主 = 内层 .arco-list；外层 wrapper 必须还是库的 hidden（若这里变 auto，说明有人又把滚动挂回外层）
      expect(m.innerOverflowY, '内层 .arco-list 必须是滚动宿主').toBe('auto');
      expect(m.innerMaxHeight, 'max-height 由组件的 LIST_VIEWPORT_HEIGHT 单点给出').toBe(m.wrapStyleH);
      expect(m.outerOverflow, '外层 wrapper 保持库的 overflow: hidden').toBe('hidden');

      // ② 内容确实超出一屏（不超出就没有任何可滚的东西，判据会空转）
      expect(m.rows, '演示目录条目要足够撑满可视区').toBeGreaterThan(8);
      expect(m.scrollH, '内容高度必须大于可视区').toBeGreaterThan(m.clientH);
      // 布局值（clientHeight，px 数字）与样式值（'300px'）比之前必须换算单位——直接 toBe 是类型不匹配
      expect(m.clientH, '可视区高度就是组件给的那个高度').toBe(parseFloat(m.wrapStyleH));

      // ③ 真滚轮：悬停在列表上再 wheel（合成 WheelEvent 不产生默认滚动，量不到这一层）。
      // 必须轮询等滚动生效——Playwright 的 mouse.wheel 不等滚动落地（走合成器），
      // 紧接着读 scrollTop 会拿到 0（首跑即因此两态全红）。
      await page.locator('.fc-file-browser .fb-list-wrap').hover();
      await page.mouse.wheel(0, 300);
      await expect
        .poll(
          () => page.locator('.fc-file-browser .fb-list-wrap').evaluate((wrap) =>
            (wrap.querySelector('.arco-list') as HTMLElement).scrollTop,
          ),
          { message: '滚轮必须把列表推离 0', timeout: 3_000 },
        )
        .toBeGreaterThan(0);

      // ④ 滚到底，末行进入可视区（用户视角的结论：后面的目录看得见）
      const lastVisible = await page.locator('.fc-file-browser .fb-list-wrap').evaluate((wrap) => {
        const inner = wrap.querySelector('.arco-list') as HTMLElement;
        inner.scrollTop = inner.scrollHeight;
        const rows = inner.querySelectorAll('.fb-row');
        const last = rows[rows.length - 1].getBoundingClientRect();
        const box = inner.getBoundingClientRect();
        return last.bottom <= box.bottom + 1 && last.top >= box.top - 1;
      });
      expect(lastVisible, '滚到底后最后一行应在可视区内').toBe(true);

      await page.keyboard.press('Escape');
      await expect(page.locator('.fc-file-browser .fb-path-input')).toBeHidden();
    });
  });
}
