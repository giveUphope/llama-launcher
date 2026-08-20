/**
 * 退出行为：关闭窗口时的处理（直接退出 / 最小化到托盘 / 首次询问并可选记住），
 * 以及"模型服务运行中退出需二次确认"。
 * 设置项 close_behavior（ask | exit | tray）在 设置-外观与语言 页配置，由 settings-store 持久化。
 *
 * 弹窗实现：所有询问走渲染进程的应用内弹窗（CloseDialog.vue，与应用 UI 风格一致），
 * 通过 IPC 一问一答——主进程窗口 close 事件被拦截后发送 WINDOW_SHOW_CLOSE_DIALOG，
 * 渲染进程展示弹窗并把选择经 WINDOW_CLOSE_DIALOG_RESULT 回传。渲染进程不可用时
 * （窗口已销毁 / 加载失败）超时兜底，不再回退原生 dialog。
 */
import { app, BrowserWindow } from 'electron';
import { IPC, type CloseDialogRequest, type CloseDialogResult } from '@llama-launcher/shared';
import { loadSettings, saveSettings } from '@llama-launcher/core';
import type { CloseBehavior } from '@llama-launcher/shared';
import { launcherBridge } from './launcher-bridge.js';

// 正在退出标志：requestExit 置位后，窗口 close 事件放行（否则 preventDefault 会拦截
// app.quit() 触发的窗口关闭，形成"退出请求→拦截→再退出"循环）
let quitting = false;

export function isQuitting(): boolean {
  return quitting;
}

// ----- 关闭弹窗 IPC 一问一答 -----
let closeDialogId = 0;
const closeDialogPending = new Map<number, (r: CloseDialogResult) => void>();
// 渲染进程无响应（窗口销毁/UI 未加载）时的兜底超时：ask 默认最小化到托盘（不丢数据），
// 退出确认默认取消（不误停模型服务）
const CLOSE_DIALOG_TIMEOUT_MS = 10_000;

/** 渲染进程回复（由 ipc/window.ts 的 WINDOW_CLOSE_DIALOG_RESULT 处理器转发）。 */
export function handleCloseDialogResult(result: CloseDialogResult): void {
  const resolve = closeDialogPending.get(result.id);
  if (!resolve) return;
  closeDialogPending.delete(result.id);
  resolve(result);
}

/** 向渲染进程发起关闭询问，返回用户选择；超时或窗口不可用时返回兜底结果。 */
async function askCloseDialog(
  win: BrowserWindow,
  mode: CloseDialogRequest['mode'],
  fallback: CloseDialogResult['action'],
): Promise<CloseDialogResult> {
  const id = ++closeDialogId;
  const request: CloseDialogRequest = { id, mode };
  try {
    if (!win.isDestroyed()) win.webContents.send(IPC.WINDOW_SHOW_CLOSE_DIALOG, request);
  } catch {
    // webContents.send 失败（窗口正在销毁）按超时兜底处理
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      closeDialogPending.delete(id);
      resolve({ id, action: fallback, remember: false });
    }, CLOSE_DIALOG_TIMEOUT_MS);
    closeDialogPending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/**
 * 真正退出应用。模型服务（llama-server）运行中先弹应用内二次确认；
 * 确认后 app.quit() —— before-quit 阶段会 dispose 下载管理器并停止 llama-server。
 */
export async function requestExit(win: BrowserWindow | null): Promise<void> {
  if (launcherBridge.isRunning()) {
    if (!win || win.isDestroyed()) {
      // 无窗口可弹（理论罕见）：直接退出，保留原语义
      quitting = true;
      app.quit();
      return;
    }
    const result = await askCloseDialog(win, 'exit-confirm', 'cancel');
    if (result.action !== 'exit') return;
  }
  quitting = true;
  app.quit();
}

/** 最小化到托盘（窗口隐藏、应用保活，进程不退出）。 */
export function minimizeToTray(win: BrowserWindow): void {
  win.hide();
}

/** 窗口关闭请求统一入口：按 close_behavior 决定行为。 */
export async function handleWindowClose(win: BrowserWindow): Promise<void> {
  const behavior = loadSettings().close_behavior;
  if (behavior === 'tray') {
    minimizeToTray(win);
    return;
  }
  if (behavior === 'exit') {
    await requestExit(win);
    return;
  }
  // ask：弹应用内弹窗，可选择退出或托盘，并可记住选择（写入设置，之后按记忆执行）
  const result = await askCloseDialog(win, 'ask', 'tray');
  if (result.remember && result.action !== 'cancel') {
    const chosen: CloseBehavior = result.action === 'exit' ? 'exit' : 'tray';
    try {
      const s = loadSettings();
      saveSettings({ ...s, close_behavior: chosen });
    } catch {
      // 记住选择失败不影响本次操作
    }
  }
  // 取消（点遮罩/超时）在 ask 语义下等同最小化到托盘，与原生弹窗关闭行为一致
  if (result.action === 'exit') await requestExit(win);
  else minimizeToTray(win);
}
