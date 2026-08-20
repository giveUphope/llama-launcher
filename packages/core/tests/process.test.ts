import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LlamaServerProcess } from '../src/process.js';
import type { OutputEntry } from '@llama-launcher/shared';

// Helper: wait for an event on a process
function onEvent(proc: LlamaServerProcess, event: string): Promise<any[]> {
  return new Promise((resolve) => {
    proc.once(event, (...args: any[]) => resolve(args));
  });
}

// Helper: kill after a delay if not already killed
function safeKill(proc: LlamaServerProcess) {
  if (proc.isRunning()) {
    proc.kill();
  }
}

describe('LlamaServerProcess', () => {
  it('pid is null before start', () => {
    const proc = new LlamaServerProcess();
    expect(proc.pid).toBeNull();
    expect(proc.isRunning()).toBe(false);
  });

  it('starts a real subprocess and gets pid', async () => {
    const proc = new LlamaServerProcess();
    proc.start({ exePath: process.execPath, args: ['-e', 'setTimeout(() => {}, 2000)'] });
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.isRunning()).toBe(true);
    // Wait for exit and clean up
    await onEvent(proc, 'exit');
    expect(proc.isRunning()).toBe(false);
  });

  it('emits output for stdout lines', async () => {
    const proc = new LlamaServerProcess();
    const outputs: OutputEntry[] = [];
    proc.on('output', (entry: OutputEntry) => outputs.push(entry));

    proc.start({ exePath: process.execPath, args: ['-e', 'console.log("hello stdout"); console.log("world stdout")'] });

    // Wait for exit so we have all outputs
    await onEvent(proc, 'exit');
    expect(proc.isRunning()).toBe(false);

    const stdoutLines = outputs.filter(o => o.kind === 'stdout').map(o => o.data).join('');
    expect(stdoutLines).toContain('hello stdout');
    expect(stdoutLines).toContain('world stdout');
  });

  it('emits output for stderr lines', async () => {
    const proc = new LlamaServerProcess();
    const outputs: OutputEntry[] = [];
    proc.on('output', (entry: OutputEntry) => outputs.push(entry));

    proc.start({ exePath: process.execPath, args: ['-e', 'console.error("hello stderr"); console.error("world stderr")'] });

    await onEvent(proc, 'exit');

    const stderrLines = outputs.filter(o => o.kind === 'stderr').map(o => o.data).join('');
    expect(stderrLines).toContain('hello stderr');
    expect(stderrLines).toContain('world stderr');
  });

  it('emits exit event with correct code', async () => {
    const proc = new LlamaServerProcess();
    proc.start({ exePath: process.execPath, args: ['-e', 'process.exit(42)'] });
    const [code] = await onEvent(proc, 'exit');
    expect(code).toBe(42);
  });

  it('flushes trailing stdout without newline on exit', async () => {
    const proc = new LlamaServerProcess();
    const outputs: OutputEntry[] = [];
    proc.on('output', (entry: OutputEntry) => outputs.push(entry));

    proc.start({
      exePath: process.execPath,
      args: ['-e', 'process.stdout.write("trailing-no-newline"); process.exit(0)'],
    });

    await onEvent(proc, 'exit');

    const stdoutLines = outputs.filter(o => o.kind === 'stdout').map(o => o.data).join('');
    expect(stdoutLines).toContain('trailing-no-newline');
  });

  it('truncates overly long output lines with a marker', async () => {
    const proc = new LlamaServerProcess();
    const outputs: OutputEntry[] = [];
    proc.on('output', (entry: OutputEntry) => outputs.push(entry));

    // 20000 字符单行（远超 8KB 上限）
    const longLine = 'x'.repeat(20000);
    proc.start({
      exePath: process.execPath,
      args: ['-e', `console.log("${longLine}")`],
    });

    await onEvent(proc, 'exit');

    const stdoutEntries = outputs.filter((o) => o.kind === 'stdout');
    const joined = stdoutEntries.map((o) => o.data).join('');
    expect(joined).toContain('[truncated');
    // 每条 stdout 输出有界（8KB + 标记行）
    for (const o of stdoutEntries) {
      expect(o.data.length).toBeLessThanOrEqual(8 * 1024 + 200);
    }
  });

  it('caps unterminated output buffer growth (no newline flood)', async () => {
    const proc = new LlamaServerProcess();
    const outputs: OutputEntry[] = [];
    proc.on('output', (entry: OutputEntry) => outputs.push(entry));

    // 100KB 无换行输出：应被截断，总输出远小于原始体积
    proc.start({
      exePath: process.execPath,
      args: ['-e', 'process.stdout.write("y".repeat(100000)); process.exit(0)'],
    });

    await onEvent(proc, 'exit');

    const joined = outputs.filter((o) => o.kind === 'stdout').map((o) => o.data).join('');
    expect(joined.length).toBeLessThan(100000);
  });

  it('kill returns true when process is running', async () => {
    const proc = new LlamaServerProcess();
    proc.start({ exePath: process.execPath, args: ['-e', 'setTimeout(() => {}, 5000)'] });
    expect(proc.isRunning()).toBe(true);
    const killed = proc.kill();
    expect(killed).toBe(true);
    await onEvent(proc, 'exit');
    expect(proc.isRunning()).toBe(false);
  });

  it('kill returns false when not running', () => {
    const proc = new LlamaServerProcess();
    const killed = proc.kill();
    expect(killed).toBe(false);
  });

  it('emits error event when spawn fails', async () => {
    const proc = new LlamaServerProcess();
    const errorPromise = new Promise<string>((resolve) => {
      proc.on('output', (entry: OutputEntry) => {
        if (entry.kind === 'error') resolve(entry.data);
      });
    });
    proc.start({ exePath: '/nonexistent/path/to/exe', args: [] });
    // 用事件驱动代替固定 setTimeout，最多等待 3 秒避免 CI 卡死
    const error = await Promise.race([
      errorPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('timeout waiting for spawn error')), 3000),
      ),
    ]);
    expect(error).toBeTruthy();
  });
});
