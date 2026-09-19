// Web E2E 驱动器：**preview 进程的唯一拥有者**（本地与 CI 同一条路径——`pnpm e2e:web` 就是本脚本）。
// 职责：起 vite preview 服务 packages/ui/dist → 跑 `playwright test --project=web` → 无论成败都清理 → 按子命令退出码返回。
// 不用 Playwright 的 webServer：一是它在此沙箱环境 spawn 会失败，二是实测「只写 port 不写 url」时
// 它会白起一个必死进程并吞掉退出码（详见 playwright.config.ts 内注释）。
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;
const READY_TIMEOUT_MS = 30_000;

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(PREVIEW_URL)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// 端口已被占用 → 直接失败。静默复用会让测试跑在别人的/上一轮残留的 dist 上，
// 得到「绿了但验的是旧产物」这种最坏结果的假阳性。
if (await probe(PREVIEW_URL)) {
  console.error(`[web-e2e] ${PREVIEW_URL} 已有服务在监听，先停掉它再跑（避免 E2E 验到非本轮构建产物）`);
  process.exit(1);
}

const logs = [];
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1', '--strictPort'],
  { cwd: 'packages/ui', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
server.unref();
for (const stream of [server.stdout, server.stderr]) {
  stream?.on('data', (d) => {
    logs.push(...d.toString().split(/\r?\n/).filter(Boolean));
    if (logs.length > 60) logs.splice(0, logs.length - 60);
  });
}
const spawnError = new Promise((_, reject) => server.on('error', (e) => reject(e)));

let status = 1;
try {
  await Promise.race([
    waitReady(READY_TIMEOUT_MS).then((ok) => {
      if (ok) return;
      throw new Error(`等待 preview 就绪超时（${READY_TIMEOUT_MS}ms）`);
    }),
    spawnError,
  ]);

  // 定位 playwright CLI（import.meta.resolve 尊重 exports 映射）
  const cliPath = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
  const result = spawnSync(process.execPath, [cliPath, 'test', '--project=web'], { stdio: 'inherit' });
  status = result.status ?? 1;
  if (result.error) throw result.error;
} catch (e) {
  console.error(`[web-e2e] ${e?.message ?? String(e)}`);
  if (logs.length) console.error(`[web-e2e] vite preview 输出（末 ${logs.length} 行）:\n${logs.join('\n')}`);
  status = 1;
} finally {
  server.kill();
}

process.exit(status);
