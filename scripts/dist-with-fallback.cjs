// 包装 electron-builder 的打包命令，提供输出目录被锁时的自动回退。
// 当 ../../release 被 Defender/IDE/残留进程锁定时，自动切换到 release-tmp-<timestamp>，
// 避免打包流程完全阻塞。打包完成后尝试将产物移回 release/；若仍被锁定则保留在临时目录并提示用户。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appDir = process.cwd();
const repoRoot = path.resolve(appDir, '..', '..');
const scriptsDir = path.join(repoRoot, 'scripts');
const builderYml = path.join(appDir, 'electron-builder.yml');

// 应用版本：portable 输出的顶层可执行文件名带版本号（如 "llama Launcher 1.4.5.exe"），
// 从 package.json 动态读取，避免版本升级后提示信息与实际文件名不一致。
function getAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '';
  }
}
const appVersion = getAppVersion();

// 先执行打包前清理：终止旧进程、清理 release/、处理文件锁
function runCleanBeforePack() {
  const cleanScript = path.join(scriptsDir, 'clean-before-pack.cjs');
  console.log('[dist-fallback] Running pre-build cleanup...');
  // 用 process.execPath 而非 'node'：不依赖 PATH，确保在当前 Node 运行时下执行
  const result = spawnSync(process.execPath, [cleanScript], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.warn('[dist-fallback] Pre-build cleanup reported issues, continuing anyway...');
  }
}

function isDirLocked(target) {
  if (!fs.existsSync(target)) return false;
  // 尝试重命名目录本身来判断是否被锁：
  // 目录内可创建子目录并不代表整体可替换（app.asar 被占用时仍可创建 probe）。
  // Windows 下若目录被 Defender/索引器/进程工作目录持有，rename 会失败。
  const probeName = `${target}_probe_${Date.now()}`;
  try {
    fs.renameSync(target, probeName);
  } catch {
    return true;
  }
  try {
    fs.renameSync(probeName, target);
    return false;
  } catch {
    // 能移走但移不回：原名称已空出，创建空目录即可继续
    try { fs.mkdirSync(target, { recursive: true }); } catch { /* ignore */ }
    return false;
  }
}

function loadConfigText() {
  return fs.readFileSync(builderYml, 'utf-8');
}

function getConfiguredOutput(configText) {
  const match = configText.match(/^directories:\s*$([\s\S]*?)^(?=\S)/m);
  if (!match) return null;
  const outMatch = match[1].match(/^\s+output:\s*(.+)$/m);
  return outMatch ? outMatch[1].trim() : null;
}

function buildWithOutput(output) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const tmpConfigPath = path.join(appDir, `electron-builder.tmp-${stamp}.yml`);
  const originalText = loadConfigText();
  const newText = originalText.replace(
    /^(\s+output:\s*)(.+)$/m,
    `$1${output}`
  );
  fs.writeFileSync(tmpConfigPath, newText, 'utf-8');
  return { tmpConfigPath, stamp };
}

function runBuilder(configPath) {
  // 用 `pnpm exec` 而非 `npx` 调用 electron-builder：electron-builder 是
  // apps/desktop 的 devDependencies，由 pnpm 管理，本地离线可用；
  // npx 在本地缺失时会从 registry 在线下载，绕过 pnpm 包管理并依赖网络。
  const args = ['exec', 'electron-builder', '--win'];
  if (configPath) args.push('--config', configPath);
  const result = spawnSync('pnpm', args, {
    cwd: appDir,
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

function moveWithRobocopy(src, dest) {
  // Windows 下目录被 Defender/索引器持有句柄时，fs.renameSync/rmSync 会失败。
  // robocopy /MIR 可以绕过这类锁，直接覆盖目标目录中的文件，无需先删除目录。
  const result = spawnSync('robocopy', [src, dest, '/MIR', '/MT:8', '/R:2', '/W:1', '/NDL', '/NFL'], {
    cwd: path.dirname(src),
    stdio: 'pipe',
    shell: true,
  });
  const stdout = result.stdout?.toString() || '';
  const stderr = result.stderr?.toString() || '';
  const ok = (result.status ?? 1) < 8;
  if (!ok) {
    console.warn(`[dist-fallback] robocopy failed with exit ${result.status}: ${stderr || stdout}`);
  }
  return ok;
}

function moveOutput(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return { ok: false, moved: [], left: [], reason: 'source dir not found' };
  fs.mkdirSync(destDir, { recursive: true });
  const moved = [];
  let firstError = null;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    try {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(src, dest);
      moved.push(entry.name);
    } catch (e) {
      if (!firstError) firstError = e;
      if (process.platform !== 'win32') continue;
      // Windows 回退：按目标类型选择覆盖策略
      if (entry.isDirectory()) {
        console.log(`[dist-fallback] rename failed for ${entry.name}, trying robocopy /MIR...`);
        if (moveWithRobocopy(src, dest)) {
          moved.push(entry.name);
          try { fs.rmSync(src, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      } else {
        console.log(`[dist-fallback] rename failed for ${entry.name}, trying copyFile...`);
        try {
          fs.copyFileSync(src, dest);
          moved.push(entry.name);
          try { fs.unlinkSync(src); } catch { /* ignore */ }
        } catch (copyErr) {
          console.warn(`[dist-fallback] copyFile also failed for ${entry.name}: ${copyErr.message}`);
        }
      }
    }
  }
  const left = entries.map((e) => e.name).filter((n) => !moved.includes(n));
  if (left.length === 0) {
    try { fs.rmdirSync(srcDir); } catch { /* ignore */ }
    return { ok: true, moved, left: [], reason: null };
  }
  return { ok: false, moved, left, reason: firstError?.message || 'unknown' };
}

// ============================================================
// 主流程
// ============================================================

runCleanBeforePack();

const configText = loadConfigText();
const outputValue = getConfiguredOutput(configText) || '../../release';
const configuredOutput = path.resolve(appDir, outputValue);

let configPath = null;
let actualOutput = configuredOutput;
let usedFallback = false;

if (isDirLocked(configuredOutput)) {
  // release/ 被系统进程锁定（Defender/索引器），切换到临时目录
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const fallbackOutputName = `release-tmp-${stamp}`;
  const fallbackOutput = path.join(repoRoot, fallbackOutputName);
  const relativeFallback = path.relative(appDir, fallbackOutput).replace(/\\/g, '/');
  console.log(`[dist-fallback] release/ is locked by system process, using fallback: ${fallbackOutputName}`);
  const tmp = buildWithOutput(relativeFallback);
  configPath = tmp.tmpConfigPath;
  actualOutput = fallbackOutput;
  usedFallback = true;
} else {
  console.log(`[dist-fallback] Output directory is ready: ${configuredOutput}`);
}

const code = runBuilder(configPath);

// 清理临时配置文件
if (configPath && fs.existsSync(configPath)) {
  try { fs.unlinkSync(configPath); } catch { /* ignore */ }
}

// 如果使用了 fallback，尝试将产物移回 release/
if (usedFallback && code === 0) {
  console.log(`[dist-fallback] Build succeeded. Migrating artifacts back to release/...`);
  const result = moveOutput(actualOutput, configuredOutput);
  if (result.ok) {
    console.log('[dist-fallback] All artifacts migrated to release/ successfully.');
  } else if (result.moved.length > 0) {
    console.log(`[dist-fallback] Migrated: ${result.moved.join(', ')}`);
    console.warn(`[dist-fallback] Could not migrate: ${result.left.join(', ')}`);
    console.warn(`[dist-fallback] Remaining artifacts in: ${actualOutput}`);
    console.warn('[dist-fallback] Close programs locking release/ and move files manually if needed.');
  } else {
    console.warn(`[dist-fallback] Artifacts remain in: ${actualOutput}`);
    console.warn('[dist-fallback] Close programs locking release/ and move files manually if needed.');
  }
} else if (usedFallback && code !== 0) {
  console.warn(`[dist-fallback] Build failed. Artifacts (if any) remain in: ${actualOutput}`);
}

// 打印最终状态摘要
console.log('');
if (code === 0) {
  const target = usedFallback ? configuredOutput : actualOutput;
  const exePath = path.join(target, 'win-unpacked', 'llama Launcher.exe');
  const portablePath = path.join(target, `llama Launcher ${appVersion}.exe`);
  console.log('[dist-fallback] ========================================');
  console.log(`[dist-fallback] BUILD SUCCEEDED ${usedFallback ? '(via fallback)' : ''}`);
  console.log(`[dist-fallback] Output: ${target}`);
  if (fs.existsSync(portablePath)) {
    console.log(`[dist-fallback] Portable: ${portablePath}`);
  }
  console.log('[dist-fallback] ========================================');
} else {
  console.error(`[dist-fallback] BUILD FAILED (exit code ${code})`);
}

process.exit(code);
