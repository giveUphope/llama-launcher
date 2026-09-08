// Web E2E 驱动器：独立于 Playwright 的 webServer 机制（后者在此沙箱环境 spawn 会失败）。
// 职责：启动 vite preview 服务 packages/ui/dist → 跑 `playwright test --project=web` → 清理后按子命令退出码返回。
// CI（ubuntu）不走本驱动：Playwright 自身的 webServer 在 Linux 可正常 spawn。
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PREVIEW_PORT = 4173;

function waitPort(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        res.on('end', () => resolve());
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`等待 preview 端口超时: ${url}`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PREVIEW_PORT), '--host', '127.0.0.1', '--strictPort'],
  { cwd: 'packages/ui', stdio: 'ignore', windowsHide: true },
);
server.unref();

try {
  await waitPort(`http://127.0.0.1:${PREVIEW_PORT}/`, 30_000);
} catch (e) {
  server.kill();
  console.error('[web-e2e]', e.message);
  process.exit(1);
}

// 定位 playwright CLI（import.meta.resolve 尊重 exports 映射）
const cliUrl = import.meta.resolve('@playwright/test/cli');
const cliPath = fileURLToPath(cliUrl);
const result = spawnSync(process.execPath, [cliPath, 'test', '--project=web'], { stdio: 'inherit' });

server.kill();
process.exit(result.status ?? 1);