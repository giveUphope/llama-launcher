import { BrowserWindow } from 'electron';
import { LlamaServerProcess } from '@llama-launcher/core';
import { cleanupLogger } from '@llama-launcher/core';

/**
 * 窗口 ↔ 进程 关联注册表。
 *
 * 维护 `windowId -> 该窗口关联的子进程集合` 的映射，实现：
 *  1) 建立窗口与相关进程（llama-server）的关联映射；
 *  2) 窗口关闭时通过 `cleanupWindow` 触发只针对该窗口进程的清理；
 *  3) 两阶段终止策略：先优雅退出（SIGTERM / taskkill 不带 /F），超时未退出再强制终止（SIGKILL / taskkill /F /T）；
 *  4) 每次清理的步骤与结果均通过 cleanupLogger 记录，便于调试。
 *
 * 设计为可跨多窗口扩展：当前产品为单窗口，但注册表天然支持多窗口各自管理自己的进程。
 */

interface TrackedProcess {
  proc: LlamaServerProcess;
  exeName: string | null;
  startedAt: number;
}

export class ProcessRegistry {
  // key: BrowserWindow.id（Electron 赋予的整数 id）
  private map = new Map<number, Set<TrackedProcess>>();

  constructor() {}

  /**
   * 将某窗口与一个已拉起的子进程建立关联。
   * @param win 窗口实例（用于取 id）
   * @param proc 已 start() 的 LlamaServerProcess
   * @param exeName 可执行文件名（用于按名兜底扫杀），可为空
   */
  associate(win: BrowserWindow, proc: LlamaServerProcess, exeName: string | null): void {
    if (!win || win.isDestroyed()) return;
    const id = win.id;
    let set = this.map.get(id);
    if (!set) {
      set = new Set();
      this.map.set(id, set);
    }
    // 去重：同一 LlamaServerProcess 实例只关联一次，避免重复 start / 多路径
    // 触发导致同一 pid 被记多次（否则扫杀时会重复 taskkill 同一 exe）。
    const already = [...set].some((t) => t.proc === proc);
    if (already) {
      cleanupLogger.debug('associate', `window#${id} pid ${proc.pid ?? '?'} already associated, skip dup`);
      return;
    }
    set.add({ proc, exeName, startedAt: Date.now() });
    cleanupLogger.debug('associate', `window#${id} <-> pid ${proc.pid ?? '?'}${exeName ? ` (${exeName})` : ''}`, {
      tracked: set.size,
    });
  }

  /** 返回某窗口当前关联的进程数量。 */
  countFor(win: BrowserWindow): number {
    if (!win || win.isDestroyed()) return 0;
    return this.map.get(win.id)?.size ?? 0;
  }

  /**
   * 清理指定窗口关联的所有进程。返回被清理的进程 pid 列表（已终止的）。
   * 幂等：重复调用安全；清理完成后移除映射。若窗口已销毁则按 id 直接清理。
   */
  cleanupWindow(win: BrowserWindow | number): { windowId: number; killedPids: number[]; forced: number[] } {
    const id = typeof win === 'number' ? win : win?.id;
    const set = this.map.get(id);
    if (!set || set.size === 0) {
      cleanupLogger.debug('cleanup', `window#${id} has no associated processes, skip`);
      this.map.delete(id);
      return { windowId: id, killedPids: [], forced: [] };
    }

    const killedPids: number[] = [];
    const forced: number[] = [];
    // 兜底扫杀记录（按 exe 名去重，避免重复 taskkill）
    const sweptSet = new Set<string>();
    cleanupLogger.info('cleanup', `window#${id} closing: terminating ${set.size} associated process(es)`);

    for (const tracked of set) {
      const pid = tracked.proc.pid ?? -1;
      let confirmed = true;
      try {
        confirmed = tracked.proc.terminate((step, detail) => {
          switch (step) {
            case 'already-dead':
              cleanupLogger.debug('cleanup', `pid ${pid} already exited`);
              break;
            case 'graceful':
              cleanupLogger.info('cleanup', `pid ${pid} terminated gracefully (SIGTERM)`);
              break;
            case 'forced':
              forced.push(pid > 0 ? pid : 0);
              cleanupLogger.warn('cleanup', `pid ${pid} not responsive, force-killed (SIGKILL/taskkill /F /T)`);
              break;
            case 'error':
              cleanupLogger.error('cleanup', `pid ${pid} terminate step error`, detail);
              break;
          }
        });
        if (pid > 0) killedPids.push(pid);
      } catch (e) {
        confirmed = false;
        cleanupLogger.error('cleanup', `pid ${pid} unexpected error during terminate`, e);
      }

      // 安全兜底（收紧版）：仅当 PID 定向终止未能确认死亡时，按 exe 名去重扫杀。
      // 无条件全局扫杀（taskkill /F /IM <exeName>）会杀掉系统中所有同名进程，
      // 包括用户自行启动、与本应用无关的 llama-server 实例——两阶段 terminate()
      // 已通过 PID 进程树精确命中目标，扫杀只应在极少数"定向终止失效"时兜底。
      if (!confirmed && tracked.exeName && !sweptSet.has(tracked.exeName)) {
        sweptSet.add(tracked.exeName);
        try {
          tracked.proc.sweepByName(tracked.exeName);
        } catch (e) {
          cleanupLogger.error('cleanup', `sweep by name ${tracked.exeName} failed`, e);
        }
      }
    }

    const swept = [...sweptSet];
    if (swept.length > 0) {
      cleanupLogger.warn('cleanup', `window#${id} swept residual by exe name (confirm-failed fallback)`, { swept });
    }

    set.clear();
    this.map.delete(id);
    cleanupLogger.info('cleanup', `window#${id} cleanup done`, { killed: killedPids, forced, swept });
    return { windowId: id, killedPids, forced: forced.filter((p) => p > 0) };
  }

  /** 清理所有窗口关联的所有进程（用于应用退出兜底）。 */
  cleanupAll(): { killedPids: number[]; forced: number[] } {
    const ids = Array.from(this.map.keys());
    const killedPids: number[] = [];
    const forced: number[] = [];
    for (const id of ids) {
      const r = this.cleanupWindow(id);
      killedPids.push(...r.killedPids);
      forced.push(...r.forced);
    }
    cleanupLogger.info('cleanup', `cleanupAll done`, { windows: ids.length, killed: killedPids, forced });
    return { killedPids, forced };
  }

  /** 当前映射中仍存活的进程 pid 列表（调试用，验证无残留）。 */
  listAlivePids(): number[] {
    const alive: number[] = [];
    for (const set of this.map.values()) {
      for (const t of set) {
        if (t.proc.isRunning() && t.proc.pid) alive.push(t.proc.pid);
      }
    }
    return alive;
  }
}

// 单例：跨 IPC 处理与窗口生命周期共享同一份映射
export const processRegistry = new ProcessRegistry();
