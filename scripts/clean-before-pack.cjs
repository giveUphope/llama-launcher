/**
 * 打包前清理脚本：
 * 1. 终止可能占用文件的 llama Launcher 进程（含版本化文件名）
 * 2. 关闭指向 release/ 的文件资源管理器窗口
 * 3. 清理输出目录（release/），避免残留文件导致打包失败
 * 4. 若目录被系统进程（Defender/索引器）锁定且无法删除/重命名，
 *    不再长时间重试——dist-with-fallback.cjs 会自动切换到临时输出目录。
 */
const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const releaseDir = path.resolve(__dirname, '..', 'release');
const rootDir = path.resolve(__dirname, '..');

// 同步睡眠
function sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* empty */ }
  }
}

// 历史遗留的临时输出目录
const legacyDirs = [
  path.resolve(__dirname, '..', 'release2'),
  path.resolve(__dirname, '..', 'release3'),
  path.resolve(__dirname, '..', 'release-fixed'),
  path.resolve(__dirname, '..', 'release-1.3.0-backup'),
  path.resolve(__dirname, '..', 'release_v1.4.0_fix'),
];

// 1. 终止 llama Launcher 进程（Windows）
// 注意：electron-builder portable 输出的顶层可执行文件名带版本号（如 "llama Launcher 1.4.5.exe"），
// 其进程映像名也包含版本号；仅 taskkill /IM "llama Launcher.exe" 无法匹配。
// 因此使用 PowerShell 按名称通配符 + 可执行路径前缀双重匹配，确保终止所有从 release/
// 启动的 llama Launcher 进程（包括版本化文件名和 win-unpacked 内的基础文件名）。
function killLauncherProcesses() {
  if (process.platform !== 'win32') return;

  // 快速兜底：终止映像名恰好为 llama Launcher.exe 的进程
  try {
    execSync('taskkill /F /IM "llama Launcher.exe" 2>nul', { stdio: 'ignore' });
  } catch { /* 进程不存在 */ }

  // 主要手段：PowerShell 通配匹配版本化文件名及任何 release/ 下启动的进程
  try {
    const releaseDirEscaped = releaseDir.replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'llama Launcher*.exe' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith('${releaseDirEscaped}')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
    console.log('[clean] Killed running llama Launcher processes');
  } catch { /* 无运行中进程或 PowerShell 不可用 */ }
}

// 2. 关闭指向 release/ 的文件资源管理器窗口（Windows）
// Explorer 窗口以 release/ 为当前目录时会持有目录句柄，导致无法删除/重命名。
function closeExplorerWindows() {
  if (process.platform !== 'win32') return;
  try {
    const releaseDirEscaped = releaseDir.replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "$shell = New-Object -ComObject Shell.Application; foreach ($w in $shell.Windows()) { try { if ($w.LocationURL -and $w.LocationURL.Contains('${releaseDirEscaped}')) { $w.Quit() } } catch {} }"`,
      { stdio: 'ignore' }
    );
  } catch { /* 忽略 */ }
}

killLauncherProcesses();
closeExplorerWindows();
// 给已终止的进程和关闭的窗口留出释放句柄的时间
sleep(1000);

// 3. 清理主输出目录
// 当目录被 Defender/索引器等系统进程锁定时，重试也无法突破文件系统过滤驱动。
// 因此只尝试 2 次 × 3 秒（而非原来的 6 次 × 5 秒），失败后交给 dist-with-fallback.cjs 的临时目录回退。
function forceRemoveDir(target, attempts = 2, delayMs = 3000) {
  if (!fs.existsSync(target)) return true;
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[clean] Removed (attempt ${i}):`, target);
      return true;
    } catch {
      // Windows: 尝试重命名再用 cmd rd 删除，绕过 mmap 句柄
      try {
        const renamed = target + '_tmp_' + Date.now();
        fs.renameSync(target, renamed);
        spawnSync('cmd', ['/c', 'rd', '/s', '/q', renamed], { stdio: 'ignore' });
        if (!fs.existsSync(renamed)) {
          console.log(`[clean] Removed via rename+rd (attempt ${i}):`, target);
          return true;
        }
        try { fs.rmSync(renamed, { recursive: true, force: true }); } catch { /* ignore */ }
      } catch { /* 继续重试 */ }
      if (i < attempts) {
        console.log(`[clean] Remove attempt ${i} failed, retrying in ${delayMs}ms...`);
        sleep(delayMs);
      }
    }
  }
  return false;
}

const removed = forceRemoveDir(releaseDir);
if (!removed && fs.existsSync(releaseDir)) {
  // 尝试将锁定的目录重命名，为 electron-builder 让出路径
  try {
    const stuckName = `release_stuck_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
    const stuckPath = path.join(rootDir, stuckName);
    fs.renameSync(releaseDir, stuckPath);
    fs.mkdirSync(releaseDir, { recursive: true });
    console.log(`[clean] Renamed locked release dir to ${stuckName} and created fresh release/`);
    // best-effort 清理 stuck 目录
    spawnSync('cmd', ['/c', 'rd', '/s', '/q', stuckPath], { stdio: 'ignore' });
  } catch {
    // rename 也失败：目录被系统进程（Defender/索引器）锁定，无法程序化释放。
    // 不报错——dist-with-fallback.cjs 会检测锁定并切换到 release-tmp-* 临时目录。
    console.log('[clean] release/ is locked by a system process (Defender/Indexer). Will use fallback output directory.');
  }
}
console.log('[clean] Pre-build cleanup done');

// 4. 清理历史遗留的临时输出目录
for (const dir of legacyDirs) {
  if (!fs.existsSync(dir)) continue;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('[clean] Removed legacy dir:', path.basename(dir));
  } catch {
    if (process.platform === 'win32') {
      try { execSync(`rd /s /q "${dir}"`, { stdio: 'ignore' }); } catch { /* 忽略 */ }
    }
  }
}

// 5. 清理历史遗留的 release_stuck_* 目录（best effort）
for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('release_stuck_')) {
    const stuckPath = path.join(rootDir, entry.name);
    try {
      fs.rmSync(stuckPath, { recursive: true, force: true });
      console.log('[clean] Removed old stuck dir:', entry.name);
    } catch {
      if (process.platform === 'win32') {
        try { execSync(`rd /s /q "${stuckPath}"`, { stdio: 'ignore' }); } catch { /* ignore */ }
      }
    }
  }
}

// 6. 清理 dist-with-fallback.cjs 留下的 release-tmp-* 目录（best effort）
for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('release-tmp-')) {
    const tmpPath = path.join(rootDir, entry.name);
    try {
      fs.rmSync(tmpPath, { recursive: true, force: true });
      console.log('[clean] Removed old tmp dir:', entry.name);
    } catch {
      if (process.platform === 'win32') {
        try { execSync(`rd /s /q "${tmpPath}"`, { stdio: 'ignore' }); } catch { /* ignore */ }
      }
    }
  }
}
