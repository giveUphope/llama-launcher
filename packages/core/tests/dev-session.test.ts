import { describe, it, expect } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { killProcessTree, findDevSessionRoot, pickTurboDevRoot } from '../src/process.js';
import type { SimpleProcessInfo } from '../src/process.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('killProcessTree (dev session teardown)', () => {
  it('kills a process and its descendants by root pid', async () => {
    const inner = [
      "const cp = require('child_process');",
      "const args = process.platform === 'win32' ? ['-n','40','127.0.0.1'] : ['40'];",
      "const exe = process.platform === 'win32' ? 'ping' : 'sleep';",
      "cp.spawn(exe, args, { windowsHide: true, stdio: 'ignore' });",
      'setInterval(function(){}, 1000);',
    ].join('\n');
    const parent = spawn(process.execPath, ['-e', inner], { windowsHide: true, stdio: 'ignore' });
    const ppid = parent.pid!;
    expect(ppid).toBeGreaterThan(0);

    await sleep(600);

    let childPid = -1;
    try {
      const name = process.platform === 'win32' ? 'ping.exe' : 'sleep';
      const out = execSync(
        `wmic process where "Name='${name}'" get ProcessId,ParentProcessId /FORMAT:CSV /NH`,
        { encoding: 'utf8' },
      );
      for (const line of out.split(/\r?\n/)) {
        const cols = line.split(',');
        if (cols.length >= 3 && Number(cols[2]) === ppid) { childPid = Number(cols[1]); break; }
      }
    } catch { /* ignore */ }

    const ok = killProcessTree(ppid);
    expect(ok).toBe(true);

    await sleep(1200);
    let pAlive = true;
    try { process.kill(ppid, 0); } catch { pAlive = false; }
    expect(pAlive).toBe(false);

    if (childPid > 0) {
      let cAlive = true;
      try { process.kill(childPid, 0); } catch { cAlive = false; }
      expect(cAlive).toBe(false);
    }
  });

  it('is safe when given an invalid pid', () => {
    expect(killProcessTree(0)).toBe(false);
    expect(killProcessTree(-1)).toBe(false);
  });
});

describe('findDevSessionRoot', () => {
  it('does not throw and returns null|number without killing anything', () => {
    let result: number | null = null;
    expect(() => { result = findDevSessionRoot(); }).not.toThrow();
    expect(result === null || typeof result === 'number').toBe(true);
  });
});

// 复现真实 Windows 场景：electron 主进程的 WMI 条目 ParentProcessId 为空，
// 从它向上回溯会立即中断；正确的"自顶向下"策略应直接定位到 turbo 根。
describe('pickTurboDevRoot (top-down, real-world WMI gaps)', () => {
  // 真实进程树：cmd /c turbo run dev (24296)
  //   └ node ...\turbo run dev (15272)
  //        └ turbo.exe (8456, 命令行无 "run")
  //             └ electron.exe (24952, ppid 为空！)
  const infos: SimpleProcessInfo[] = [
    { pid: 24296, ppid: 19856, cmd: 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c turbo run dev' },
    { pid: 15272, ppid: 24296, cmd: 'node "D:\\DEV\\llama_launcher\\node_modules\\.bin\\..\\turbo\\bin\\turbo" run dev' },
    { pid: 8456, ppid: 15272, cmd: 'D:\\DEV\\llama_launcher\\node_modules\\.pnpm\\@turbo+windows-64@2.10.3\\node_modules\\@turbo\\windows-64\\bin\\turbo.exe' },
    { pid: 24952, ppid: 0, cmd: '' }, // electron：WMI 下 ppid/cmd 为空
  ];
  const byPid = new Map<number, SimpleProcessInfo>();
  infos.forEach((i) => byPid.set(i.pid, i));

  it('returns the topmost turbo root even when electron WMI entry is empty', () => {
    const root = pickTurboDevRoot(infos, byPid);
    // 24296 的父进程 19856 不是 turbo → 它是顶端 turbo 根
    expect(root).toBe(24296);
  });

  it('returns null when no turbo run process exists', () => {
    const none: SimpleProcessInfo[] = [
      { pid: 1, ppid: 0, cmd: 'explorer.exe' },
      { pid: 2, ppid: 1, cmd: 'node some-other-script.js' },
    ];
    const m = new Map<number, SimpleProcessInfo>();
    none.forEach((i) => m.set(i.pid, i));
    expect(pickTurboDevRoot(none, m)).toBeNull();
  });
});
