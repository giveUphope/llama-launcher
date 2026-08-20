// 开发热重载监视器：配合 `tsc -b --watch`（dev:tsc:watch）与 Vite HMR（dev:vite 的 vite 进程）。
// 主进程构建产物 / preload 源 / shared 类型（含 IPC 常量）变更时，
// 自动重新生成并复制 preload、重启 Electron —— 改 core/shared/主进程代码即热更，无需手动重启。
// 通过 LLAMA_DEV_SKIP_QUIT_KILL 通知主进程跳过"退出时杀 dev 会话树"，避免连带杀掉本监视器。
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const MAIN_DIST_DIR = path.join(DESKTOP, 'dist', 'main');
const MAIN_DIST_ENTRY = path.join(MAIN_DIST_DIR, 'index.js');
const PRELOAD_SRC = path.join(DESKTOP, 'src', 'preload');
const SHARED_TYPES = path.join(ROOT, 'packages', 'shared', 'src', 'types');
const UI_PORT_FILE = path.join(ROOT, 'packages', 'ui', '.vite-dev-port');
const COPY_PRELOAD = path.join(ROOT, 'scripts', 'copy-preload.cjs');

const DEBOUNCE_MS = 250;
const RESTART_GAP_MS = 400;
// 启动 Electron 前等待 dist/main 构建产物静止的窗口：tsc 初始构建可能在入口文件
// index.js 先出现后仍在写其余产物，过早启动会导致 fs.watch 立即触发"变更→重启"
const BUILD_SETTLE_MS = 1000;
// dist/main 最近一次变更事件时间戳（用于构建稳定检测）
let lastDistEventAt = 0;

// 熔断：滑动窗口内重启次数超限后停止自动重启，防止崩溃循环/自持触发烧 CPU。
// 正常情况下一次源码变更只触发 1 次重启；窗口内连续 8+ 次基本可判定为异常循环。
const RESTART_BUDGET = 8;
const RESTART_WINDOW_MS = 30000;
// 启动即退出（<1.5s）判定为崩溃/单实例锁冲突，不自动重启（避免锁冲突循环）
const MIN_RUN_MS = 1500;
const restartTimes = [];
let budgetTripped = false;
let electronStartedAt = 0;
let shuttingDown = false;

/** 退出清理：dev-watch 被终止时一并杀掉其 spawn 的 Electron，避免孤儿进程占住单实例锁。 */
function cleanup() {
  shuttingDown = true;
  if (electronProc) {
    try { electronProc.kill(); } catch { /* 已退出 */ }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

/** 滑动窗口计数；窗口内未超限则记录本次并返回 true。 */
function allowRestart() {
  const now = Date.now();
  while (restartTimes.length && now - restartTimes[0] >= RESTART_WINDOW_MS) restartTimes.shift();
  if (restartTimes.length >= RESTART_BUDGET) return false;
  restartTimes.push(now);
  budgetTripped = false;
  return true;
}

/** 熔断提示（每个连续触发周期只打印一次）。 */
function tripReport() {
  if (budgetTripped) return;
  budgetTripped = true;
  console.error(
    `[dev-watch] ⚠ 连续重启 ${RESTART_BUDGET} 次 / ${RESTART_WINDOW_MS / 1000}s，` +
    '疑似崩溃循环或自持触发，已停止自动重启。请检查主进程启动报错后重新运行 pnpm dev。',
  );
}

let electronProc = null;
let restartTimer = null;

/** 轮询等待条件成立（用于等待 tsc 产物与 Vite 端口文件）。 */
function waitFor(check, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`[dev-watch] ${label} 超时`));
      }
    }, 300);
  });
}

/** 重新生成 preload 常量并复制到 dist（copy-preload 内部先跑 generate-preload）。 */
function regenPreload() {
  try {
    spawnSync(process.execPath, [COPY_PRELOAD], { stdio: 'inherit' });
  } catch (e) {
    console.error('[dev-watch] copy-preload 失败:', e.message);
  }
}

function startElectron() {
  if (electronProc) return;
  regenPreload();
  let electronPath;
  try {
    // 在普通 node 进程中 require('electron') 返回可执行文件路径
    electronPath = require(path.join(DESKTOP, 'node_modules', 'electron'));
  } catch {
    electronPath = 'electron';
  }
  const child = spawn(electronPath, ['.'], {
    cwd: DESKTOP,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development', LLAMA_DEV_SKIP_QUIT_KILL: '1' },
  });
  electronProc = child;
  electronStartedAt = Date.now();
  child.on('exit', (code, signal) => {
    // 主动 kill（killAndRestart / cleanup 已置空 electronProc 或置 shuttingDown）时不重复处理；
    // 退出码 0 = 用户主动关闭/应用自退（含单实例锁冲突 app.quit()）：不自动重启；
    // 非 0/信号终止 = 崩溃：启动时长 ≥ MIN_RUN_MS 才自动重启（快速崩溃按熔断逻辑停止）
    if (electronProc === child) {
      electronProc = null;
      if (shuttingDown) return;
      const ranMs = Date.now() - electronStartedAt;
      if (code === 0) {
        // 退出码 0 = 用户主动关闭/应用自退（含单实例锁冲突 app.quit()）：不自动重启，
        // 并结束本 dev 会话——dev-watch 退出后 concurrently -k 会连带终止 vite/tsc，
        // 终端不再残留进程
        console.log(
          ranMs < MIN_RUN_MS
            ? '[dev-watch] Electron 因单实例锁被占用而退出（可能为上次 dev 残留实例），dev 会话随之结束；请关闭已有窗口后重新运行 pnpm dev。'
            : '[dev-watch] Electron 正常退出（用户关闭窗口/应用退出），dev 会话结束。',
        );
        // 留 300ms 让日志刷出（stdio inherit 同步写，兜底防并发截断）
        setTimeout(() => process.exit(0), 300);
        return;
      }
      if (ranMs < MIN_RUN_MS) {
        console.error(
          `[dev-watch] Electron 启动 ${ranMs}ms 即异常退出（code=${code}${signal ? ', signal=' + signal : ''}），` +
            '已停止自动重启，请检查主进程输出后重新运行 pnpm dev。',
        );
        return;
      }
      console.log(`[dev-watch] Electron 异常退出（code=${code}），自动重启...`);
      scheduleRestart();
    }
  });
  console.log('[dev-watch] Electron 已启动（改 core/shared/主进程/preload 即自动重启）');
}

/** 重启：等待旧进程退出（释放单例锁）后再启动新进程。 */
function killAndRestart() {
  // 熔断优先：超限时不再杀/重启，保留当前进程状态
  if (!allowRestart()) {
    tripReport();
    return;
  }
  if (electronProc) {
    const old = electronProc;
    electronProc = null;
    console.log('[dev-watch] 检测到变更，重启 Electron...');
    old.kill();
    old.on('exit', () => {
      setTimeout(startElectron, RESTART_GAP_MS);
    });
  } else {
    setTimeout(startElectron, RESTART_GAP_MS);
  }
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    killAndRestart();
  }, DEBOUNCE_MS);
}

/** 注册热重载监视；dist/main 的变更事件同时记录时间戳，供"构建产物稳定"检测使用。 */
function registerWatchers() {
  const targets = [
    // 只监视 tsc 的主进程产物 dist/main；dist/preload 是本脚本自己 copy-preload 的写入，
    // 监视整个 dist/ 会让"重启 → 写 preload → 触发重启"形成自持循环（实测 123 次/90s）
    [MAIN_DIST_DIR, { recursive: true }], // 主进程编译产物
    [PRELOAD_SRC, { recursive: true }], // preload 源（copy-preload 复制）
    [SHARED_TYPES, { recursive: true }], // shared 类型/IPC 常量（generate-preload 重新生成）
  ];
  for (const [dir, opts] of targets) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.watch(dir, opts, () => {
        if (dir === MAIN_DIST_DIR) lastDistEventAt = Date.now();
        scheduleRestart();
      });
    } catch (e) {
      console.error('[dev-watch] 监视失败:', dir, e.message);
    }
  }
}

(async () => {
  try {
    await waitFor(() => fs.existsSync(MAIN_DIST_ENTRY), 120000, '等待 tsc -b --watch 产出主进程 dist');
    await waitFor(() => fs.existsSync(UI_PORT_FILE), 60000, '等待 Vite dev server');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  // 先注册监视（记录 dist/main 事件时间戳），再等待构建产物静止后启动 Electron
  registerWatchers();

  // tsc 初始构建可能在入口 index.js 先出现后仍在写其余产物：
  // 等待 dist/main 一段时间无写入再启动，避免"启动后立即检测到变更再重启一次"
  try {
    await waitFor(() => Date.now() - lastDistEventAt > BUILD_SETTLE_MS, 20000, '等待主进程构建产物稳定');
  } catch (e) {
    console.warn('[dev-watch] ' + e.message + '，直接启动 Electron');
  }

  startElectron();
  console.log('[dev-watch] 热重载监视中（dist/main / preload / shared types）');
})();
