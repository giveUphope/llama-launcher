import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessRegistry } from '../../../apps/desktop/src/main/process-registry.js';
import { LlamaServerProcess } from '../src/process.js';
import { setCleanupLogLevel } from '../src/cleanup-logger.js';

// 测试期间仅保留 error 级日志，避免 warn/info 写入 stderr 干扰测试运行环境
setCleanupLogLevel('error');

// 记录本文件启动过的子进程，afterEach 兜底强杀：用例超时或断言提前失败时，未清理的 ping 会残留
// 至多 30s，拖慢后续 taskkill/spawn，导致连续重跑越跑越慢、稳定超时。
const spawned: LlamaServerProcess[] = [];

// 模拟 BrowserWindow 的最小结构（registry 仅使用 id 与 isDestroyed）
function fakeWin(id: number): any {
  return { id, isDestroyed: () => false };
}

// 生成一个会运行一段时间的子进程，用于验证清理后无残留
function longRunningProc(): LlamaServerProcess {
  const proc = new LlamaServerProcess();
  if (process.platform === 'win32') {
    proc.start({ exePath: 'ping', args: ['-n', '30', '127.0.0.1'] });
  } else {
    proc.start({ exePath: process.execPath, args: ['-e', 'setTimeout(() => {}, 30000)'] });
  }
  spawned.push(proc);
  return proc;
}

function waitExit(proc: LlamaServerProcess, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    proc.once('exit', (code: number) => { clearTimeout(timer); resolve(code); });
  });
}

describe('ProcessRegistry (window ↔ process mapping)', () => {
  let reg: ProcessRegistry;
  beforeEach(() => {
    reg = new ProcessRegistry();
    spawned.length = 0;
  });
  // 兜底清理：强杀仍存活的子进程（已 terminate 的实例 kill() 为 no-op），防止泄漏累积拖慢后续用例
  afterEach(() => {
    for (const p of spawned) {
      if (p.isRunning()) p.kill();
    }
  });

  it('associates a process with a window and counts it', () => {
    const win = fakeWin(1);
    const proc = longRunningProc();
    reg.associate(win, proc, 'ping.exe');
    expect(reg.countFor(win)).toBe(1);
  });

  it('cleanupWindow terminates associated processes and leaves no residual', async () => {
    const win = fakeWin(7);
    const proc = longRunningProc();
    const pid = proc.pid!;
    expect(pid).toBeGreaterThan(0);
    reg.associate(win, proc, 'ping.exe');

    const result = reg.cleanupWindow(win);
    expect(result.windowId).toBe(7);
    expect(result.killedPids).toContain(pid);
    expect(reg.countFor(win)).toBe(0);

    // 等待 exit 事件确认进程真正退出，且 OS 层面 pid 不再存活
    await waitExit(proc);
    expect(proc.isRunning()).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('cleanupWindow is idempotent on an already-cleaned window', () => {
    const win = fakeWin(2);
    reg.associate(win, longRunningProc(), 'ping.exe');
    reg.cleanupWindow(win);
    const again = reg.cleanupWindow(win);
    expect(again.killedPids).toEqual([]);
  });

  it('isolates processes per window: closing one window does not affect another', async () => {
    const winA = fakeWin(10);
    const winB = fakeWin(20);
    const procA = longRunningProc();
    const procB = longRunningProc();
    reg.associate(winA, procA, 'ping.exe');
    reg.associate(winB, procB, 'ping.exe');

    reg.cleanupWindow(winA);
    expect(reg.countFor(winA)).toBe(0);
    expect(reg.countFor(winB)).toBe(1);
    expect(procB.isRunning()).toBe(true);

    await waitExit(procA);
    reg.cleanupWindow(winB);
    await waitExit(procB);
    expect(reg.listAlivePids()).toEqual([]);
  });

  it('cleanupAll clears every window and reports all killed pids', async () => {
    const p1 = longRunningProc();
    const p2 = longRunningProc();
    reg.associate(fakeWin(100), p1, 'ping.exe');
    reg.associate(fakeWin(200), p2, 'ping.exe');

    const all = reg.cleanupAll();
    expect(all.killedPids.length).toBe(2);
    await Promise.all([waitExit(p1), waitExit(p2)]);
    expect(reg.listAlivePids()).toEqual([]);
  });
});
