// 开发模式编排器：Vite(UI HMR) + `tsc -b --watch`（主进程增量重建）+ dev-watch.cjs（Electron 热重启）。
//
// 为什么不用 turbo/concurrently/cross-env：Windows 上 `node_modules/.bin/*` 全是 .cmd 批处理
// shim，而 cmd.exe 在批处理等待子进程时收到 CTRL_C_EVENT 会打印 "Terminate batch job (Y/N)?"
// 并阻塞等待按键。`pnpm dev` 旧链路里 turbo + 3 个 concurrently 子命令各是一层批处理，
// 一次 Ctrl+C 只能让 node 子进程退出，批处理层全部卡在无人应答的按键提示上
// —— 表现即"要按两次 Ctrl+C 才退得掉"，且 turbo 要等满优雅超时再强杀。
// 这里所有子进程都由 node 直接执行真实 JS 入口（零 .cmd 层），Ctrl+C 一次即整棵进程树清理退出。
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const UI = path.join(ROOT, 'packages', 'ui');
const IS_WIN = process.platform === 'win32';
// 子进程被强杀后仍未报 exit 的兜底退出延迟：保证终端绝不卡在退出流程上
const EXIT_FALLBACK_MS = 2000;

const COLOR = { magenta: 35, cyan: 36, blue: 34 };

/** 解析 workspace 依赖 bin 的真实 JS 入口，绕开 .bin 的 .cmd 批处理 shim。 */
function binEntry(fromPkgDir, dep, binName) {
  const pkgRequire = createRequire(path.join(fromPkgDir, 'noop.js'));
  const pkgJson = pkgRequire.resolve(`${dep}/package.json`, { paths: [fromPkgDir] });
  const bin = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).bin;
  const rel = typeof bin === 'string' ? bin : bin[binName];
  if (!rel) throw new Error(`${dep} 未声明 bin: ${binName}`);
  return path.join(path.dirname(pkgJson), rel);
}

const TASKS = [
  { name: 'vite', color: COLOR.magenta, cwd: UI, entry: binEntry(UI, 'vite', 'vite'), args: [] },
  {
    name: 'tsc',
    color: COLOR.cyan,
    cwd: DESKTOP,
    entry: binEntry(DESKTOP, 'typescript', 'tsc'),
    args: ['-b', '--watch'],
  },
  { name: 'electron', color: COLOR.blue, cwd: DESKTOP, entry: path.join(ROOT, 'scripts', 'dev-watch.cjs'), args: [] },
];

const env = { ...process.env, NODE_ENV: 'development' };
if (process.argv.slice(2).includes('--console')) env.LLAMA_DEV_CONSOLE = '1';

/** 杀掉进程树：Windows 递归 taskkill（含 Electron 及其 GPU/渲染子进程），类 Unix 走进程组。 */
function killTree(pid) {
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
}

/** 任务名前缀；非 TTY（重定向到文件）时去色，避免日志里混入 ANSI 转义序列。 */
function prefix(task) {
  return process.stdout.isTTY ? `\x1b[${task.color}m[${task.name}]\x1b[0m ` : `[${task.name}] `;
}

/** 按行转发子进程输出并加任务名前缀（与旧 concurrently -n vite,tsc,electron 的观感一致）。 */
function forward(stream, task) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) process.stdout.write(prefix(task) + line + '\n');
  });
  stream.on('end', () => {
    if (rest) process.stdout.write(prefix(task) + rest + '\n');
    rest = '';
  });
  stream.on('error', () => {
    /* 子进程管道断裂：随 exit 事件收尾 */
  });
}

let shuttingDown = false;
let exitCode = 0;

function aliveTasks() {
  return TASKS.filter((t) => t.alive);
}

/** 结束会话：以最先退出的子进程退出码为准（concurrently --success first 语义），其余整树杀掉。 */
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  for (const task of aliveTasks()) killTree(task.child.pid);
  // taskkill 与 exit 事件的先后不确定：到点无论子进程是否已回报都退出，避免终端挂住
  setTimeout(() => process.exit(exitCode), EXIT_FALLBACK_MS);
  finishIfIdle();
}

function finishIfIdle() {
  if (shuttingDown && aliveTasks().length === 0) process.exit(exitCode);
}

for (const task of TASKS) {
  // detached(!win)：子进程自成一个进程组，便于按 -pid 整组强杀
  const child = spawn(process.execPath, [task.entry, ...task.args], {
    cwd: task.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: IS_WIN,
    detached: !IS_WIN,
  });
  task.child = child;
  task.alive = true;
  forward(child.stdout, task);
  forward(child.stderr, task);
  child.on('error', (e) => {
    task.alive = false;
    process.stdout.write(prefix(task) + `启动失败: ${e.message}\n`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    task.alive = false;
    // 只把"真实失败码"带给整体退出码；被信号终止（含 Ctrl+C 时子进程与编排器同受
    // CTRL_C_EVENT 先一步退出）计 0，避免退出码取决于事件先后顺序而误报失败。
    if (!shuttingDown) shutdown(typeof code === 'number' ? code : 0);
    else finishIfIdle();
  });
}

// 终端 Ctrl+C / 关闭信号：立即杀掉全部子进程树后退出，不等任何子进程自行收尾。
// 退出码取 0：中断 dev 会话是用户的正常收尾动作，不该让 pnpm 报 ELIFECYCLE 失败
// （与旧 concurrently --success first 以 Electron 退出码为准的取舍一致）
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0));
}

// 兜底防孤儿：编排器因任何原因退出时，仍在世的子进程整树带走（Electron/vite/tsc 不得残留）
process.on('exit', () => {
  for (const task of aliveTasks()) killTree(task.child.pid);
});
