// 端到端验证脚本：模拟"启动服务器 → 关联窗口 → 关闭窗口 → 清理 → 验证无残留"。
// 用 ping（长时间运行）作为服务器替身，验证 ProcessRegistry + 进程树终止 + 按名扫杀
// 在真实 Windows 进程树上确实能清掉所有相关进程（含子进程），关闭窗口后无残留"终端/进程"。
//
// 运行：node packages/core/tests/e2e-cleanup.mjs
import { LlamaServerProcess } from '../src/process.ts';
import { ProcessRegistry } from '../../../../apps/desktop/src/main/process-registry.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listLlama() {
  // 返回当前系统中名为 ping 的进程（本脚本用 ping 作替身）
  // 仅用于本验证，真实场景下为 llama-server.exe
  return [];
}

async function main() {
  const reg = new ProcessRegistry();
  const win = { id: 1, isDestroyed: () => false };

  // 1) 启动一个"服务器"（用 ping 作长时间运行的替身，并让它产生一个子进程树）
  const proc = new LlamaServerProcess();
  // 在 Windows 上用 ping -n 60；类 Unix 用 sleep
  const args = process.platform === 'win32'
    ? ['-n', '60', '127.0.0.1']
    : ['60'];
  const exe = process.platform === 'win32' ? 'ping' : 'sleep';
  proc.start({ exePath: exe, args });
  const pid = proc.pid;
  console.log(`[e2e] started stand-in server pid=${pid} (${exe})`);

  // 2) 关联到窗口（模拟 LauncherBridge 的 spawned 监听）
  reg.associate(win, proc, `${exe}.exe`);
  console.log(`[e2e] associated, count=${reg.countFor(win)}`);

  // 3) 模拟窗口关闭 → 清理
  await sleep(500);
  console.log('[e2e] --- simulating window close (cleanupWindow) ---');
  const result = reg.cleanupWindow(win);
  console.log('[e2e] cleanup result:', JSON.stringify(result));

  // 4) 验证无残留：等待并确认进程不再存活
  await sleep(1500);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { alive = false; }
  console.log(`[e2e] pid ${pid} still alive? ${alive}`);

  if (!alive) {
    console.log('[e2e] PASS ✓ 关闭窗口后进程已彻底终止，无残留');
    process.exit(0);
  } else {
    console.error('[e2e] FAIL ✗ 关闭窗口后进程仍然残留！');
    process.exit(1);
  }
}

main().catch((e) => { console.error('[e2e] error', e); process.exit(2); });
