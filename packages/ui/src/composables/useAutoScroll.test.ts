// @vitest-environment happy-dom
/**
 * 控制台/日志自动滚动（useAutoScroll）的滚动状态机。守的判据（frontend.md §7.1 铁律①③
 * 在此收敛为一处实现，三页共用）：
 *  - 「用户在底部」只由距底距离 < 60 判定；在底部时新行滚到底，拨离后新行只亮「有新日志」胶囊；
 *  - 同帧多条日志只滚一次（rAF 合帧）：scrollTop 的写入次数必须与帧数一致、与日志条数无关；
 *  - 排队帧执行前用户已拨走滚动条：非强制的那一帧尊重用户位置，不覆盖（logs-scroll e2e
 *    曾因该竞态间歇失败）；
 *  - keep-alive 失活期不滚动（读 scrollHeight 是强制同步布局），已排队的帧随失活撤销，
 *    只记「有新日志」；重回本页强制补滚一次到底（即便之前被拨离）。
 * rAF 用手动排队桩驱动，滚不动真布局：容器是带 scrollTop 写入计数的假对象。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useAutoScroll } from './useAutoScroll';

// ---- rAF 手动排队桩：帧的执行时机由用例控制 ----
let frames: Map<number, FrameRequestCallback>;
let rafSeq = 0;
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(16);
}

// ---- 假滚动容器：scrollTop 记录写入次数（合帧判据的观测点） ----
let scrollTopValue = 0;
let scrollTopWrites = 0;
const container = {
  scrollHeight: 1000,
  clientHeight: 400,
  get scrollTop() {
    return scrollTopValue;
  },
  set scrollTop(v: number) {
    scrollTopWrites += 1;
    scrollTopValue = v;
  },
} as unknown as HTMLElement;

const count = ref(0);
const containerRef = ref<HTMLElement | null>(null);
/** 用例里模拟用户滚动：直接写值并触发 onScroll 判定 */
function userScrollTo(top: number) {
  scrollTopValue = top;
}

const AutoScrollHost = defineComponent({
  name: 'AutoScrollHost',
  props: { pill: { type: Boolean, default: true } },
  setup(props, { expose }) {
    const ret = useAutoScroll(containerRef, { count: () => count.value, pill: props.pill });
    expose({ scrollToBottom: ret.scrollToBottom, state: ret });
    return () => h('div');
  },
});

let wrapper: VueWrapper | null = null;

/** KeepAlive 包裹挂载（activated 首挂即触发一次强制补滚帧），返回暴露的 composable 状态 */
async function mountHost(pill = true) {
  containerRef.value = container;
  wrapper = mount(
    {
      components: { AutoScrollHost },
      template: '<KeepAlive><AutoScrollHost v-if="show" :pill="pill" /></KeepAlive>',
      data: () => ({ show: true, pill }),
    },
  );
  const host = wrapper.findComponent(AutoScrollHost);
  await nextTick();
  flushFrames(); // 首挂 activated 的强制补滚帧当场排掉
  return host.vm as unknown as {
    scrollToBottom: (force?: boolean) => void;
    state: ReturnType<typeof useAutoScroll>;
  };
}

/** KeepAlive 失活/重入（模拟「切走页签再切回来」） */
async function setActive(show: boolean) {
  (wrapper!.vm as unknown as { show: boolean }).show = show;
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  frames = new Map();
  rafSeq = 0;
  scrollTopValue = 0;
  scrollTopWrites = 0;
  count.value = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  wrapper?.unmount();
  wrapper = null;
});

describe('useAutoScroll - 在底部：新行滚到底（rAF 合帧）', () => {
  it('新行到来排一帧滚到底；同帧窗口内的多条日志只写一次 scrollTop', async () => {
    const { state } = await mountHost();
    scrollTopWrites = 0;

    count.value += 1;
    count.value += 1;
    count.value += 30;
    await nextTick();
    expect(frames.size, '三条日志只排一帧（rAF 合帧）').toBe(1);
    flushFrames();
    expect(scrollTopWrites, '一帧只写一次 scrollTop').toBe(1);
    expect(scrollTopValue).toBe(1000);
    expect(state.autoScroll.value).toBe(true);
    expect(state.hasNewLogs.value, '一路跟底就没有「新日志」可言').toBe(false);
  });

  it('已排队未执行的帧前再来新行：不再叠加新帧', async () => {
    const { state } = await mountHost();
    scrollTopWrites = 0;

    count.value += 1;
    await nextTick();
    expect(frames.size).toBe(1);
    count.value += 1;
    await nextTick();
    expect(frames.size, '排队中的滚动不需要第二帧').toBe(1);
    flushFrames();
    expect(scrollTopWrites).toBe(1);
    expect(state.hasNewLogs.value).toBe(false);
  });
});

describe('useAutoScroll - 用户拨离：尊重用户位置', () => {
  it('距底 ≥ 60 判为拨离：之后的新行不滚动，只亮「有新日志」胶囊', async () => {
    const { state } = await mountHost();
    // 用户把滚动条拨到距底 200 处
    userScrollTo(1000 - 400 - 200);
    state.onScroll();
    expect(state.autoScroll.value, '距底 200 ≥ 阈值 60 → 判为拨离').toBe(false);

    scrollTopWrites = 0;
    count.value += 1;
    await nextTick();
    flushFrames();
    expect(scrollTopWrites, '拨离后来新行绝不强行拨底').toBe(0);
    expect(state.hasNewLogs.value, '必须亮「有新日志」胶囊把决定权还给用户').toBe(true);
  });

  it('排队帧执行前用户拨走：非强制帧尊重用户位置，不覆盖也不清胶囊', async () => {
    const { state } = await mountHost();
    // 新行排了帧，但帧还没跑
    count.value += 1;
    await nextTick();
    expect(frames.size).toBe(1);

    // 帧执行前用户把滚动条拨走
    userScrollTo(0);
    state.onScroll();
    expect(state.autoScroll.value).toBe(false);

    scrollTopWrites = 0;
    flushFrames();
    expect(scrollTopWrites, '排队帧发现用户已拨走必须让位（logs-scroll e2e 的竞态判据）').toBe(0);
    // 注意：这 16ms 竞态窗口里胶囊不会亮（count 变化发生在仍跟底时，走的是排帧分支而非记账分支）——
    // 这是现状语义的模糊边缘，此处只钉「不覆盖用户位置」这条承重判据，胶囊行为不在此钉。
  });

  it('距底 < 60 判为回到底部：autoScroll 恢复并清掉胶囊', async () => {
    const { state } = await mountHost();
    userScrollTo(0);
    state.onScroll();
    expect(state.autoScroll.value).toBe(false);
    count.value += 1;
    await nextTick();
    flushFrames();
    expect(state.hasNewLogs.value).toBe(true);

    // 用户拨回距底 30 处
    userScrollTo(1000 - 400 - 30);
    state.onScroll();
    expect(state.autoScroll.value, '距底 30 < 60 → 恢复跟随').toBe(true);
    expect(state.hasNewLogs.value, '回到底部就没有「新日志」可言').toBe(false);
  });

  it('pill=false（概览迷你列表）：拨离后新行只不滚，不记账胶囊', async () => {
    const { state } = await mountHost(false);
    userScrollTo(0);
    state.onScroll();
    count.value += 1;
    await nextTick();
    flushFrames();
    expect(state.autoScroll.value).toBe(false);
    expect(state.hasNewLogs.value, '没有胶囊的消费方就不该有胶囊状态').toBe(false);
  });

  it('scrollToBottom(true)（胶囊点击）：即便 autoScroll 已被拨离也强制滚到底', async () => {
    const { state, scrollToBottom } = await mountHost();
    userScrollTo(0);
    state.onScroll();
    expect(state.autoScroll.value).toBe(false);

    scrollTopWrites = 0;
    scrollToBottom(true);
    flushFrames();
    expect(scrollTopWrites).toBe(1);
    expect(scrollTopValue).toBe(1000);
    expect(state.autoScroll.value, '用户点了「回到底部」即重新跟随').toBe(true);
    expect(state.hasNewLogs.value).toBe(false);
  });
});

describe('useAutoScroll - keep-alive 失活/重入（铁律①）', () => {
  it('失活期新行不滚动、不排帧，只记「有新日志」；已排队帧随失活撤销', async () => {
    const { state } = await mountHost();
    // 挂起一帧后立刻切走：帧必须被撤销而不是等后台页回来才执行
    count.value += 1;
    await nextTick();
    expect(frames.size).toBe(1);

    await setActive(false);
    expect(frames.size, '失活必须撤掉已排队未执行的帧（后台页不做强制同步布局）').toBe(0);
    expect(state.pageActive.value).toBe(false);

    scrollTopWrites = 0;
    count.value += 5;
    await nextTick();
    expect(frames.size, '失活期的新行不排帧').toBe(0);
    flushFrames();
    expect(scrollTopWrites).toBe(0);
    expect(state.hasNewLogs.value, '失活期只记账，回来看时胶囊亮着').toBe(true);
  });

  it('重回本页（activated）强制补滚到底：即便此前被用户拨离，且胶囊清零', async () => {
    const { state } = await mountHost();
    // 拨离并积累「有新日志」
    userScrollTo(0);
    state.onScroll();
    count.value += 1;
    await nextTick();
    flushFrames();
    expect(state.hasNewLogs.value).toBe(true);

    await setActive(false);
    await setActive(true);
    expect(frames.size, 'activated 立刻排一帧强制补滚').toBe(1);
    flushFrames();
    expect(scrollTopValue).toBe(1000);
    expect(state.autoScroll.value, '补滚后恢复跟随').toBe(true);
    expect(state.hasNewLogs.value, '人已经回来看了，胶囊清零').toBe(false);
  });
});
