// @vitest-environment happy-dom
/**
 * 弹窗焦点管理（useDialogFocus）：给 Arco a-modal 补的三件事——打开时焦点移入弹窗、
 * Tab/Shift+Tab 在弹窗内循环（焦点圈不漏到页面底层）、关闭时把焦点归还给打开它的元素。
 * 守的判据（对话框可访问性基线，WAI-ARIA APG modal dialog 模式）：
 *  - 打开后 nextTick 内焦点落进首个可交互控件；无常规控件时退而聚焦关闭钮，再退而聚焦容器本身；
 *  - Tab 在末位控件回绕到首控件，Shift+Tab 在首控件回绕到末控件；
 *    焦点被抢到弹窗外（点遮罩/被别处接管）时按 Tab 拉回弹窗边缘；
 *  - 关闭时焦点仍在弹窗内（或落在 body）→ 归还 opener；用户已把焦点移到页面其它控件
 *    → 不抢回（关弹窗不得改写用户的焦点选择）；opener 已从文档移除 → 不聚焦已死节点；
 *  - titleId 供 aria-labelledby 引用，各实例唯一。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useDialogFocus } from './useDialogFocus';

// happy-dom 没有布局引擎，getClientRects 恒为空——isVisibleElement 会把所有控件当「不可见」
// 排除出 Tab 环。测试里统一给一个假矩形（等价于「弹窗可见、控件都在场」），visible 元素判定
// 退化为「都在 Tab 环里」。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: function () {
      return [{}];
    },
  });
});

const CONTAINER_CLASS = 'fc-test-dialog';

/** 可见性 ref 与宿主组件绑定（composable 的 watch 挂在组件作用域上） */
const visible = ref(false);
let hostWrapper: VueWrapper | null = null;

/** 在 document.body 上搭一个「弹窗」：容器带 containerClass，子元素由用例注入 */
function mountDialog(children: string, containerAttrs = ''): HTMLElement {
  const root = document.createElement('div');
  root.className = CONTAINER_CLASS;
  if (containerAttrs) root.setAttribute('style', containerAttrs);
  root.innerHTML = children;
  document.body.appendChild(root);
  return root;
}

/** 挂一个调用 composable 的宿主组件（onScopeDispose 的清理跟随它 unmount） */
function mountHost(): VueWrapper {
  const Host = defineComponent({
    setup() {
      const { titleId } = useDialogFocus({ visible, containerClass: CONTAINER_CLASS });
      return () => h('div', { id: titleId });
    },
  });
  hostWrapper = mount(Host);
  return hostWrapper;
}

/** 切换可见性并冲刷 watch（pre-flush）与 nextTick 里的聚焦回调 */
async function setVisible(v: boolean) {
  visible.value = v;
  await nextTick();
  await nextTick();
}

function activeEl(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function pressTab(shift = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }));
}

function buttonsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button')];
}

beforeEach(() => {
  visible.value = false;
  document.body.innerHTML = '';
  mountHost();
});

afterEach(() => {
  hostWrapper?.unmount();
  hostWrapper = null;
  document.body.innerHTML = '';
});

describe('useDialogFocus - 打开移入', () => {
  it('visible 转 true 后，nextTick 内焦点落进弹窗首个可交互控件', async () => {
    const root = mountDialog('<button id="b1">一</button><button id="b2">二</button>');
    mountHost();
    await setVisible(true);
    expect(activeEl(), '打开弹窗即聚焦首个控件，键盘用户不必先按一轮 Tab').toBe(buttonsOf(root)[0]);
  });

  it('无常规控件时退而聚焦 Arco 关闭钮；连关闭钮也没有则聚焦容器本身', async () => {
    const root = mountDialog('<div>纯文本弹窗</div><button class="arco-modal-close-btn">✕</button>');
    await setVisible(true);
    expect(activeEl(), '焦点必须留在弹窗内（APG：焦点不得落到被遮住的页面底层）').toBe(
      root.querySelector('.arco-modal-close-btn'),
    );

    // 连关闭钮也没有：退到容器自身（真实模板在 a-modal 对话框上带 tabindex="-1"，可聚焦）
    root.querySelector('.arco-modal-close-btn')?.remove();
    root.setAttribute('tabindex', '-1');
    await setVisible(false);
    await setVisible(true);
    expect(activeEl()).toBe(root);
  });

  it('titleId 形如 dlg-title-*，不同实例互不相同', async () => {
    const w1 = hostWrapper!;
    const id1 = w1.find('div').attributes('id');
    expect(id1).toMatch(/^dlg-title-/);
    hostWrapper?.unmount();
    mountHost();
    const id2 = hostWrapper!.find('div').attributes('id');
    expect(id2).toMatch(/^dlg-title-/);
    expect(id2).not.toBe(id1);
  });
});

describe('useDialogFocus - Tab 焦点圈', () => {
  it('Tab 在末位控件回绕到首控件；Shift+Tab 在首控件回绕到末控件', async () => {
    const root = mountDialog('<button id="b1">一</button><button id="b2">二</button><button id="b3">三</button>');
    const [b1, , b3] = buttonsOf(root);
    await setVisible(true);
    expect(activeEl()).toBe(b1);

    b3.focus();
    pressTab();
    expect(activeEl(), '末位再按 Tab 必须绕回首控件，不能漏到弹窗外的页面').toBe(b1);

    b1.focus();
    pressTab(true);
    expect(activeEl(), '首件 Shift+Tab 绕回末控件').toBe(b3);
  });

  it('焦点被抢到弹窗外时按 Tab 拉回：正向回首控件、Shift 回末控件', async () => {
    const root = mountDialog('<button id="b1">一</button><button id="b2">二</button>');
    const [b1, b2] = buttonsOf(root);
    await setVisible(true);

    // 模拟「点遮罩 / 被页面其它控件抢走焦点」
    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    expect(activeEl()).toBe(outside);

    pressTab();
    expect(activeEl(), '焦点在弹窗外按 Tab 必须被拉回弹窗首控件').toBe(b1);

    outside.focus();
    pressTab(true);
    expect(activeEl(), 'Shift+Tab 从弹窗外回来落在末控件').toBe(b2);
  });

  it('弹窗内没有任何可交互控件时，Tab 把焦点按在容器上', async () => {
    const root = mountDialog('<div>纯文本弹窗</div>');
    root.setAttribute('tabindex', '-1');
    await setVisible(true);
    expect(activeEl()).toBe(root);
    // 焦点移走后再按 Tab：items 为空分支把焦点按回容器
    document.body.focus();
    pressTab();
    expect(activeEl(), '无控件弹窗按 Tab 不得让焦点漏出').toBe(root);
  });
});

describe('useDialogFocus - 关闭归还', () => {
  it('关闭时焦点仍在弹窗内 → 归还给打开前聚焦的 opener', async () => {
    const opener = document.createElement('button');
    opener.id = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    const root = mountDialog('<button id="b1">一</button>');
    await setVisible(true);
    expect(activeEl()).toBe(buttonsOf(root)[0]);

    await setVisible(false);
    expect(activeEl(), '关闭后焦点必须回到打开弹窗的那个控件（APG 对话框收尾规则）').toBe(opener);
  });

  it('关闭时用户已把焦点移到页面其它控件 → 不抢回', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    mountDialog('<button id="b1">一</button>');
    await setVisible(true);

    const elsewhere = document.createElement('button');
    elsewhere.id = 'elsewhere';
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    await setVisible(false);
    expect(activeEl(), '用户点到的控件不得被关弹窗动作改写焦点').toBe(elsewhere);
  });

  it('opener 已从文档移除（如它所在的卡片被收起）→ 不聚焦已死节点', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    mountDialog('<button id="b1">一</button>');
    await setVisible(true);

    opener.remove();
    await setVisible(false);
    expect(document.contains(opener)).toBe(false);
    expect(activeEl(), '已断开的节点 focus() 是静默空操作，这里断言焦点没有指向已死节点').not.toBe(opener);
  });
});
