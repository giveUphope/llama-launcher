/**
 * 全局确认弹窗队列（useConfirm）：所有页面的确认弹窗共用一个模块级单例队列，
 * ModalHost 渲染队首、点击后按 id 唤醒对应请求。守的判据：
 *  - confirm() 入队并返回待定 Promise，缺省字段补齐（showCancel/variant/确认取消文案键）；
 *  - 调用方显式传入的字段覆盖缺省值（variant=danger、关掉取消钮、actions 多动作等）；
 *  - resolve(id) 按 id **精确**唤醒对应 Promise 并把条目出队——多条排队互不串扰
 *    （队列是单例，前一条没答完时后一条照样能入队，答谁必须看 id 不能看队首）；
 *  - 未知 id 的 resolve 是静默空操作（迟到的二次 resolve / 已被清理的请求不得炸）；
 *  - 布尔模式 resolve boolean，actions 模式 resolve 动作 key（取消/遮罩语义为 ''）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { confirm, useConfirmQueue } from './useConfirm';

const { queue, resolve } = useConfirmQueue();

beforeEach(() => {
  // 队列是模块级单例：上一条用例没答完的请求要清掉，避免计数断言被前序污染
  queue.value.splice(0);
});

/** Promise 在微任务后仍未落定的探针（confirm() 的返回在 resolve 前必须保持待定） */
async function expectPending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(() => { settled = true; });
  await Promise.resolve();
  await Promise.resolve();
  return !settled;
}

describe('useConfirm - 入队与缺省值', () => {
  it('confirm() 入队一条请求并补齐缺省字段，Promise 在应答前保持待定', async () => {
    const p = confirm({ title: '删除模型', message: '确定要删除吗？' });
    expect(queue.value, '请求进入全局单例队列等待 ModalHost 渲染').toHaveLength(1);
    const req = queue.value[0];
    expect(req.title).toBe('删除模型');
    expect(req.message).toBe('确定要删除吗？');
    expect(req.showCancel, '缺省显示取消钮').toBe(true);
    expect(req.variant, '缺省 info 语义').toBe('info');
    expect(req.confirmKey).toBe('dlg_confirm');
    expect(req.cancelKey).toBe('dlg_cancel');
    expect(await expectPending(p), '没人应答前调用方必须一直等').toBe(true);
  });

  it('调用方传入的字段覆盖缺省值（danger 语义 / 关掉取消钮）', () => {
    void confirm({ title: 't', message: 'm', variant: 'danger', showCancel: false });
    const req = queue.value[0];
    expect(req.variant).toBe('danger');
    expect(req.showCancel).toBe(false);
    // 未传的文案键仍走缺省
    expect(req.confirmKey).toBe('dlg_confirm');
  });

  it('连续调用各自入队：FIFO 排列，id 单调递增', () => {
    void confirm({ title: 'a', message: 'm' });
    void confirm({ title: 'b', message: 'm' });
    void confirm({ title: 'c', message: 'm' });
    expect(queue.value.map((q) => q.title)).toEqual(['a', 'b', 'c']);
    const [id1, id2, id3] = queue.value.map((q) => q.id);
    expect(id2, 'id 单调递增，ModalHost 按 id 定位应答').toBeGreaterThan(id1);
    expect(id3).toBeGreaterThan(id2);
  });
});

describe('useConfirm - resolve 语义', () => {
  it('resolve(id, true/false) 唤醒对应 Promise，布尔模式答的是 boolean', async () => {
    const p1 = confirm({ title: 'a', message: 'm' });
    const req = queue.value[0];
    resolve(req.id, true);
    await expect(p1).resolves.toBe(true);
    expect(queue.value, '已应答的请求必须出队').toHaveLength(0);

    const p2 = confirm({ title: 'b', message: 'm' });
    resolve(queue.value[0].id, false);
    await expect(p2).resolves.toBe(false);
  });

  it('多条排队：resolve 按 id 精确对应，答后条不影响先条', async () => {
    const pA = confirm({ title: 'a', message: 'm' });
    const pB = confirm({ title: 'b', message: 'm' });
    const pC = confirm({ title: 'c', message: 'm' });
    // 故意乱序应答：先答后入队的 B，再答 A；C 不答
    resolve(queue.value[1].id, 'key-b');
    resolve(queue.value[0].id, true);
    await expect(pB).resolves.toBe('key-b');
    await expect(pA).resolves.toBe(true);
    expect(await expectPending(pC), '未应答的 C 必须仍待定').toBe(true);
    expect(queue.value.map((q) => q.title), '只有已应答的出队').toEqual(['c']);
  });

  it('未知 id 的 resolve 是静默空操作：不炸、队列不动、已挂的 Promise 不受影响', async () => {
    const p = confirm({ title: 'a', message: 'm' });
    expect(() => resolve(999_999, true)).not.toThrow();
    expect(queue.value).toHaveLength(1);
    expect(await expectPending(p), '错误的 id 不得误唤醒在队的请求').toBe(true);
  });
});

describe('useConfirm - actions 多动作模式', () => {
  it('提供 actions 时原样透传，resolve 的是被点动作的 key', async () => {
    const p = confirm({
      title: '端口被占用',
      message: '检测到外部 llama-server',
      actions: [
        { key: 'adopt', labelKey: 'dlg_adopt', variant: 'primary' },
        { key: 'abort', labelKey: 'dlg_abort', variant: 'danger' },
      ],
    });
    const req = queue.value[0];
    expect(req.actions?.map((a) => a.key), 'actions 列表原样透传给 ModalHost 渲染').toEqual(['adopt', 'abort']);
    resolve(req.id, 'adopt');
    await expect(p).resolves.toBe('adopt');
  });
});
