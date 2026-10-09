/**
 * dev 会话集成验证（原 scripts/integ_devsession.mjs 迁入，2026-10-09）。
 * 端到端复现 `turbo run dev` 进程树：「turbo」父进程（命令行含 turbo run dev 标记，
 * findDevSessionRoot 只认它）衍生 vite 替身 + probe 子进程（扮演 electron，导入
 * **构建产物** dist/process.js），probe 沿真实 OS 进程表向上找到 turbo 根并杀树。
 * 断言：① probe 找到的根 == 已知的假 turbo pid；② 杀树后 turbo 与 vite 替身全部死亡。
 * 与 dev-session.test.ts 的分工：那边用合成进程表测 pickTurboDevRoot 纯函数、从测试
 * 进程直接杀树；这里走真实进程枚举 + 构建产物，验证「编排器视角」的完整收尾链路。
 * 迁移时修掉原脚本两个潜伏缺陷：① ESM 静态 import 裸盘符路径（C:/... 非法 specifier，
 * 解析失败时模块不求值、try/catch 救不了）→ 改 try 内动态 import + pathToFileURL；
 * ② 异步 spawn 的 stdio 传文件路径字符串抛 ERR_INVALID_SYNC_FORK_INPUT（probe 从未
 * 被启动、结果文件永不出现——原脚本「FAIL: probe did not write result」的真因）→
 * 先 openSync 拿 fd 再传入。前置：packages/core/dist 产物（CI 先 build；未构建跳过）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { killProcessTree } from '../src/process.js';

const DIST_PROCESS = fileURLToPath(new URL('../dist/process.js', import.meta.url));
const hasDist = existsSync(DIST_PROCESS);

describe.skipIf(!hasDist)('dev session teardown (end-to-end via built dist)', () => {
  let workDir = '';
  let turboPid = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  afterAll(() => {
    // 兜底：残留的假 turbo 树整树收掉，临时目录清空（失败路径也不留孤儿进程）
    if (turboPid > 0) {
      try { killProcessTree(turboPid); } catch { /* 已死 */ }
    }
    if (workDir) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟，忽略 */ }
    }
  });

  it('finds the turbo root via real OS enumeration and kills the whole tree', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'llama-dev-session-integ-'));
    const resultPath = join(workDir, 'probe_result.json');
    const metaPath = join(workDir, 'tree_meta.json');
    const errLog = join(workDir, 'probe_err.log');
    const probePath = join(workDir, 'probe_child.mjs');
    // probe（扮演 electron）：结果文件在杀树**之前**落盘——probe 自身在树内，若杀树
    // 语义连带调用者，先写后杀才保证结果存在；turbo/vite 的死亡由测试进程轮询断言
    const probeScript = `
import { writeFileSync } from 'node:fs';
try {
  const { findDevSessionRoot, killProcessTree } = await import(${JSON.stringify(pathToFileURL(DIST_PROCESS).href)});
  const root = findDevSessionRoot();
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ root, self: process.pid, ok: true }));
  if (root) killProcessTree(root);
} catch (e) {
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String((e && e.stack) || e) }));
}
`;
    writeFileSync(probePath, probeScript);
    // 假 turbo：命令行含 turbo run dev 标记，衍生 vite 替身 + probe，写 meta 供断言
    //（原来只打印，现在可断言 vite 替身也死——比原脚本只看 turbo 更强）
    const turboScript = [
      '// marker: turbo run dev',
      "const cp = require('child_process');",
      "const fs = require('fs');",
      `const vite = cp.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });`,
      `fs.writeFileSync(${JSON.stringify(metaPath)}, JSON.stringify({ turbo: process.pid, vite: vite.pid }));`,
      `const errFd = fs.openSync(${JSON.stringify(errLog)}, 'a');`,
      `cp.spawn(process.execPath, [${JSON.stringify(probePath)}], { windowsHide: true, stdio: ['ignore', 'ignore', errFd] });`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const turbo = spawn(process.execPath, ['-e', turboScript], {
      windowsHide: true,
      stdio: 'ignore',
      // 与 dev.cjs 同一契约：Unix 上 detached 让假 turbo 自成进程组，killProcessTree 的
      // 「向 -pid 发信号」才成立——不 detached 的话 vite 替身游离在组外，Linux 上杀不到
      detached: process.platform !== 'win32',
    });
    turboPid = turbo.pid!;
    expect(turboPid).toBeGreaterThan(0);

    const waitUntil = async (check: () => boolean, timeoutMs: number, label: string) => {
      const start = Date.now();
      while (!check()) {
        if (Date.now() - start > timeoutMs) throw new Error(`dev-session-integ: 等待 ${label} 超时`);
        await sleep(200);
      }
    };

    // 1) 假 turbo 起来并写下 meta（含 vite pid）
    await waitUntil(() => existsSync(metaPath), 10_000, 'fake turbo meta');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { turbo: number; vite: number };
    turboPid = meta.turbo;
    const vitePid = meta.vite;
    expect(turboPid).toBeGreaterThan(0);
    expect(vitePid).toBeGreaterThan(0);

    // 2) probe 写回结果（内含真实进程枚举；turbo 下与 ui 测试并行抢 CPU，枚举可达数十秒）
    await waitUntil(() => existsSync(resultPath), 60_000, 'probe result');
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as { root?: number | null; error?: string };
    if (result.error) throw new Error(`probe 失败: ${result.error}`);

    // 3) findDevSessionRoot 命中的正是这个假 turbo 根（topmost：vitest 链上的
    //    `turbo run test` 不含 dev 标记，不会截胡）
    expect(result.root).toBe(turboPid);

    // 4) 杀树后 turbo 与 vite 替身全部死亡（整棵 dev 树被收掉）
    await waitUntil(() => !alive(turboPid), 30_000, 'turbo 死亡');
    expect(alive(turboPid)).toBe(false);
    await waitUntil(() => !alive(vitePid), 30_000, 'vite 替身死亡');
    expect(alive(vitePid)).toBe(false);
  }, 150_000);
});
