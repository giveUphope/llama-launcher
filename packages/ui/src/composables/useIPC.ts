import type { ElectronAPI, IpcResponse } from '@/env';

/**
 * 便捷封装：返回类型安全的 window.api，并提供自动校验 IPC 返回结果的 invoke 辅助函数。
 */
export function useIPC(): ElectronAPI {
  return window.api;
}

/**
 * 将 Vue reactive 代理转换为纯对象。
 *
 * contextBridge 在参数进入 preload 之前就使用结构化克隆，
 * reactive 代理无法被克隆会抛 "An object could not be cloned."。
 * 因此必须在渲染端调用 IPC 之前完成转换。
 */
export function toPlain<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * 调用返回 IpcResponse 的 IPC 接口，失败时自动抛出可读错误。
 */
export async function invokeOk<T>(promise: Promise<IpcResponse<T>>): Promise<T> {
  const res = await promise;
  // 防御性检查：浏览器预览/mock 环境下 IPC 可能返回 null
  if (!res || !res.ok) {
    throw new Error(res?.error || 'IPC call failed');
  }
  return res.data as T;
}
