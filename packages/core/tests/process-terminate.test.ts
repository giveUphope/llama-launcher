import { describe, it, expect, afterEach } from 'vitest';
import { LlamaServerProcess } from '../src/process.js';
import { cleanupLogger, setCleanupLogLevel } from '../src/cleanup-logger.js';

// 测试期间仅保留 error 级日志，避免 warn/info 写入 stderr 干扰测试运行环境
setCleanupLogLevel('error');

// 辅助：轮询等待进程退出
function waitExit(proc: LlamaServerProcess, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting exit')), timeoutMs);
    proc.once('exit', (code: number) => { clearTimeout(timer); resolve(code); });
  });
}

// 生成一个子进程：sleep 一段时间（Windows 用 ping 近似 sleep）
function longRunningProc(): LlamaServerProcess {
  const proc = new LlamaServerProcess();
  if (process.platform === 'win32') {
    proc.start({ exePath: 'ping', args: ['-n', '30', '127.0.0.1'] });
  } else {
    proc.start({ exePath: process.execPath, args: ['-e', 'setTimeout(() => {}, 30000)'] });
  }
  return proc;
}

describe('LlamaServerProcess.terminate (graceful → forced)', () => {
  it('terminates a running child process and reports graceful step', async () => {
    const proc = longRunningProc();
    expect(proc.isRunning()).toBe(true);

    const steps: string[] = [];
    const ok = proc.terminate((step) => steps.push(step));
    expect(ok).toBe(true);

    // 子进程应已退出
    await expect(waitExit(proc)).resolves.toBeDefined();
    expect(proc.isRunning()).toBe(false);

    // 终止应当经历过 graceful 或 forced 阶段（至少其一）
    expect(steps.some((s) => s === 'graceful' || s === 'forced' || s === 'already-dead')).toBe(true);
  });

  it('is idempotent: repeated terminate is safe and returns true', () => {
    const proc = longRunningProc();
    expect(proc.terminate()).toBe(true);
    expect(proc.terminate()).toBe(true);
    expect(proc.terminate()).toBe(true);
  });

  it('terminate on already-exited process returns true without error', async () => {
    const proc = new LlamaServerProcess();
    proc.start({ exePath: process.execPath, args: ['-e', 'process.exit(0)'] });
    await waitExit(proc);
    expect(proc.isRunning()).toBe(false);

    const steps: string[] = [];
    expect(proc.terminate((s) => steps.push(s))).toBe(true);
    // 句柄仍存在但进程已退出：不会触发强制终止，且不应抛错
    expect(steps).not.toContain('forced');
    expect(steps.some((s) => s === 'already-dead' || s === 'graceful')).toBe(true);
  });

  it('leaves no residual process after terminate (pid no longer alive)', async () => {
    const proc = longRunningProc();
    const pid = proc.pid!;
    expect(pid).toBeGreaterThan(0);

    proc.terminate();
    await waitExit(proc);

    // 进程句柄应释放，且 OS 层面 pid 不再存活
    expect(proc.isRunning()).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe('cleanupLogger', () => {
  it('respects minimum level filter', () => {
    setCleanupLogLevel('error');
    // 不抛错即可（level 过滤内部处理）
    cleanupLogger.debug('test', 'should be filtered');
    cleanupLogger.error('test', 'should appear');
    setCleanupLogLevel('info');
    cleanupLogger.info('test', 'restored');
  });
});
