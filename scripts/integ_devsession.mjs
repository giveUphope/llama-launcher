// 集成验证：模拟 `turbo run dev` 进程树，从 electron 子进程调用真正构建好的
// packages/core/dist/process.js 的 findDevSessionRoot + killProcessTree，验证整棵 dev 树被杀死。
// 用法：先 `pnpm build`（需 core/dist 产物），再 `node scripts/integ_devsession.mjs`。
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cwd = process.cwd();
// core 产物路径基于脚本位置解析，与运行 cwd 无关
const coreProcessJs = fileURLToPath(new URL('../packages/core/dist/process.js', import.meta.url));

// probe 子进程（扮演 electron）：找到 turbo 根并杀树，结果写文件
const probe = `
import { findDevSessionRoot, killProcessTree } from '${coreProcessJs.replace(/\\/g, '/')}';
import { writeFileSync } from 'node:fs';
try {
  const root = findDevSessionRoot();
  let killed = false;
  if (root) killed = killProcessTree(root);
  writeFileSync('${cwd.replace(/\\/g, '/')}/probe_result.json', JSON.stringify({ root, killed, self: process.pid, ok: true }));
} catch (e) {
  writeFileSync('${cwd.replace(/\\/g, '/')}/probe_result.json', JSON.stringify({ error: String((e && e.stack) || e) }));
}
`;
writeFileSync('probe_child.mjs', probe);

// turbo 父进程：命令行含 "turbo run dev"（嵌在 -e 脚本里），衍生 vite 子 + probe(electron)子
const turboScript = `
// marker: turbo run dev
const cp = require('child_process');
cp.spawn(process.execPath, ['-e', "setInterval(()=>{},1000)"], { windowsHide: true, stdio: 'ignore' });
cp.spawn(process.execPath, ['${cwd.replace(/\\/g, '/')}/probe_child.mjs'], { windowsHide: true, stdio: ['ignore','ignore','${cwd.replace(/\\/g, '/')}/probe_err.log'] });
setInterval(()=>{}, 1000);
`;
const turbo = spawn(process.execPath, ['-e', turboScript], {
  windowsHide: true,
  stdio: 'ignore',
});
const turboPid = turbo.pid;
console.log('turbo pid =', turboPid);

await sleep(1200);
if (existsSync(`${cwd}/probe_result.json`)) {
  const r = JSON.parse(readFileSync(`${cwd}/probe_result.json`, 'utf8'));
  console.log('PROBE:', JSON.stringify(r));
  if (r.error) { console.log('PROBE ERROR - see above'); cleanup(); process.exit(1); }
  await sleep(1500);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const turboAlive = alive(turboPid);
  console.log('turbo root alive:', turboAlive);
  console.log('electron self alive:', alive(r.self));
  console.log(r.root && !turboAlive ? 'PASS: dev session tree killed' : 'FAIL');
  cleanup();
  process.exit(r.root && !turboAlive ? 0 : 1);
} else {
  console.log('FAIL: probe did not write result');
  cleanup();
  process.exit(1);
}

function cleanup() {
  try { unlinkSync(`${cwd}/probe_result.json`); } catch {}
  try { unlinkSync(`${cwd}/probe_child.mjs`); } catch {}
}
