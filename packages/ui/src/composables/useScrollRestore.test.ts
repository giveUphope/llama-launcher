// @vitest-environment happy-dom
/**
 * 切页滚动位置恢复（TODO T09）的时序判据。假容器驱动（与 useAutoScroll.test.ts 同模式，
 * rAF 用手动排队桩拨帧）：真布局在 happy-dom 里滚不动，判据盯的是恢复机制的时序规则——
 *  ① 高度就绪才写入（keep-alive 切回高度立即就绪是常态，循环只是兜底）；
 *  ② 高度长期不就绪时 30 帧上限强制写入；
 *  ③ 快速连切打断未完成的恢复，旧值不得污染新页。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createScrollRestore } from './useScrollRestore';

// ---- rAF 手动排队桩：拨帧驱动，不依赖真实渲染时序 ----
let queue: Array<(t: number) => void> = [];
function flushFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const fns = queue;
    queue = [];
    fns.forEach((f) => f(0));
  }
}
const raf = (f: (t: number) => void) => (queue.push(f), queue.length);
const caf = () => {};

/** 假滚动容器：结构类型（lib.dom 的 scrollHeight 是 readonly，不能 as HTMLElement 再赋值） */
function makeEl() {
  return { scrollTop: 0, scrollHeight: 0 };
}

let el: { scrollTop: number; scrollHeight: number };
let restore: ReturnType<typeof createScrollRestore>;

beforeEach(() => {
  queue = [];
  el = makeEl();
  restore = createScrollRestore(() => el, raf, caf);
});

describe('useScrollRestore - 恢复时序判据（T09）', () => {
  it('高度立即就绪（keep-alive 缓存态）：恢复在首帧写入离开时的 scrollTop', () => {
    el.scrollHeight = 2654;
    el.scrollTop = 1934;
    restore.save('/params');
    // 模拟切走丢位置再切回：容器重新布局后 scrollTop 归零、高度恢复
    el.scrollTop = 0;
    restore.restore('/params');
    flushFrames(1);
    expect(el.scrollTop, '切回首帧就应写回离开时的位置').toBe(1934);
  });

  it('高度未就绪：逐帧等待，长到离开时的量级才写入（写入过早会被夹回 0）', () => {
    el.scrollHeight = 2654;
    el.scrollTop = 1934;
    restore.save('/params');
    el.scrollTop = 0;
    // 切回初期内容还没长回来
    el.scrollHeight = 720;
    restore.restore('/params');
    // 每帧内容长 300，第 7 帧起高度 ≥ 2654
    for (let i = 0; i < 7; i++) {
      flushFrames(1);
      el.scrollHeight = Math.min(2654, el.scrollHeight + 300);
    }
    flushFrames(1);
    expect(el.scrollTop).toBe(1934);
  });

  it('高度长期不就绪：30 帧上限后强制写入（写了不比不写差）', () => {
    el.scrollHeight = 2654;
    el.scrollTop = 1934;
    restore.save('/params');
    el.scrollTop = 0;
    el.scrollHeight = 720; // 永远长不到 2654
    restore.restore('/params');
    flushFrames(35);
    expect(el.scrollTop, '超限后必须写入而不是静默放弃').toBe(1934);
  });

  it('快速连切：save 打断上一页未完成的恢复，旧值不得写进新页', () => {
    el.scrollHeight = 2000;
    el.scrollTop = 500;
    restore.save('/a');
    el.scrollTop = 0;
    restore.restore('/a'); // 恢复帧已排队
    // 连切到 /b：save 内部 cancel 掉排队的恢复
    el.scrollHeight = 800;
    restore.save('/b');
    flushFrames(5);
    expect(el.scrollTop, '被取消的恢复不得执行').toBe(0);
    // 切回 /a 仍可正常恢复
    el.scrollHeight = 2000;
    restore.restore('/a');
    flushFrames(1);
    expect(el.scrollTop).toBe(500);
  });
});
