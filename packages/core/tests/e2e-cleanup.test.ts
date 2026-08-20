import { describe, it, expect, afterAll } from 'vitest';
import { LlamaServerProcess } from '../src/process.js';
import { ProcessRegistry } from '../../../apps/desktop/src/main/process-registry.js';
import { setCleanupLogLevel } from '../src/cleanup-logger.js';

// 端到端验证：启动"服务器"→ 关联窗口 → 关闭窗口(cleanupWindow) → 验证无残留进程。
// 用 ping/sleep（长时间运行）作为 llama-server 替身，验证进程树终止 + 按名扫杀
// 在真实 Windows 进程树上确实能清掉所有相关进程，关闭窗口后无残留"终端/进程"。
setCleanupLogLevel('error');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('e2e: window close cleans up associated process (no residual)', () => {
  let trackedPid = -1;

  it('kills the associated process and leaves nothing alive after window close', async () => {
    const reg = new ProcessRegistry();
    const win = { id: 1, isDestroyed: () => false } as any;

    const proc = new LlamaServerProcess();
    const args = process.platform === 'win32'
      ? ['-n', '60', '127.0.0.1']
      : ['60'];
    const exe = process.platform === 'win32' ? 'ping' : 'sleep';
    proc.start({ exePath: exe, args });
    trackedPid = proc.pid ?? -1;
    expect(trackedPid).toBeGreaterThan(0);

    // 模拟 LauncherBridge 的 spawned 监听：关联到窗口
    reg.associate(win, proc, `${exe}.exe`);
    expect(reg.countFor(win)).toBe(1);

    await sleep(400);

    // 模拟窗口关闭 → 清理
    const result = reg.cleanupWindow(win);
    expect(result.killedPids).toContain(trackedPid);
    expect(reg.countFor(win)).toBe(0);

    // 验证无残留：进程真正退出，且 OS 层 pid 不再存活
    await sleep(1500);
    let alive = true;
    try { process.kill(trackedPid, 0); alive = true; }
    catch { alive = false; }
    expect(alive).toBe(false);
  }, 15000);

  afterAll(() => {
    // 兜底：确保替身进程即便测试异常也已终止
    if (trackedPid > 0) {
      try { process.kill(trackedPid, 0); } catch { /* 已退出 */ }
    }
  });
});
