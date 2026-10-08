/**
 * IPC 便捷封装（useIPC）的纯函数部分。守的判据：
 *  - toPlain 必须把 Vue reactive 代理解包成纯对象：contextBridge/structuredClone 克隆不了
 *    Proxy（DataCloneError），跨桥载荷漏包一层整个调用当场炸——这里用 structuredClone
 *    实证「代理克隆必炸、toPlain 产物必可克隆」；
 *  - invokeOk 对 IpcResponse 的三种形态各有明确语义：ok=true 吐 data；ok=false 或响应缺失
 *    抛可读错误（浏览器预览/mock 环境下响应可能是 null）。
 */
import { describe, it, expect } from 'vitest';
import { reactive } from 'vue';
import { invokeOk, toPlain } from './useIPC';

describe('toPlain - reactive 代理解包', () => {
  it('reactive 对象解包为结构相等的纯对象，且可被 structuredClone（跨桥前提）', () => {
    const proxy = reactive({ name: 'm.gguf', nested: { ctx: 4096 } });
    // 直接克隆代理就是生产里那颗雷：An object could not be cloned
    expect(() => structuredClone(proxy)).toThrow();
    const plain = toPlain(proxy);
    expect(plain).toEqual({ name: 'm.gguf', nested: { ctx: 4096 } });
    expect(() => structuredClone(plain), 'toPlain 产物必须能过结构化克隆这一关').not.toThrow();
  });

  it('原始值与 null/undefined 原样穿透（不做无谓包装）', () => {
    expect(toPlain(0)).toBe(0);
    expect(toPlain('x')).toBe('x');
    expect(toPlain(null)).toBeNull();
    expect(toPlain(undefined)).toBeUndefined();
  });
});

describe('invokeOk - IpcResponse 三形态', () => {
  it('ok=true 吐出 data', async () => {
    await expect(invokeOk(Promise.resolve({ ok: true, data: ['a.gguf'] }))).resolves.toEqual(['a.gguf']);
  });

  it('ok=false 抛出后端给的 error 文案', async () => {
    await expect(invokeOk(Promise.resolve({ ok: false, error: 'model not found' }))).rejects.toThrow(
      'model not found',
    );
  });

  it('响应缺失（浏览器 mock 返回 null）与缺 error 字段都有兜底文案', async () => {
    // 防御性检查的动机：浏览器预览环境 api 可能不存在，包装层返回 null
    await expect(invokeOk(Promise.resolve(null) as unknown as Promise<never>)).rejects.toThrow('IPC call failed');
    await expect(
      invokeOk(Promise.resolve({ ok: false }) as unknown as Promise<never>),
    ).rejects.toThrow('IPC call failed');
  });

  it('上游 promise 本身 reject 时错误原样上抛', async () => {
    await expect(invokeOk(Promise.reject(new Error('bridge down')))).rejects.toThrow('bridge down');
  });
});
