#!/usr/bin/env node
// 手动（重新）安装 Electron 二进制，走项目根 .npmrc 配置的镜像。
//
// 为什么需要它：
// - @electron/get 只从环境变量（npm_config_electron_mirror / ELECTRON_MIRROR）解析下载镜像，不会主动
//   读取 .npmrc。直接 `node <electron>/install.js` 不经 npm/pnpm，拿不到 electron_mirror，会回退到默认
//   GitHub 地址，国内网络下报 `TypeError: fetch failed`。
// - pnpm 的 side-effects 缓存还可能整体跳过 electron 的 postinstall（`pnpm install` / `pnpm rebuild` 都
//   不重新下载），导致 apps/desktop 下 electron 缺 dist/electron.exe 与 path.txt，dev/dist 启动即失败。
//
// 做法：读取 .npmrc 的 electron_mirror（单一事实源，不硬编码 URL），注入 ELECTRON_MIRROR 与
// npm_config_electron_mirror 后运行 electron 的 install.js；已安装时 install.js 自行短路退出（幂等）。
//
// 用法：pnpm reinstall:electron
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');

/** 解析 .npmrc 的 key=value（忽略注释与空行）。 */
function readNpmrc(dir) {
  const cfg = {};
  const file = path.join(dir, '.npmrc');
  if (!fs.existsSync(file)) return cfg;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ';') continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    cfg[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return cfg;
}

/** 定位 electron 包目录（require.resolve 跟随 pnpm 的 symlink/junction）。 */
function resolveElectronDir() {
  try {
    return path.dirname(require.resolve('electron', { paths: [DESKTOP, ROOT] }));
  } catch {
    return null;
  }
}

function main() {
  const electronDir = resolveElectronDir();
  if (!electronDir) {
    console.error('[reinstall-electron] 找不到 electron 包，请先运行 pnpm install。');
    process.exit(1);
  }
  const installJs = path.join(electronDir, 'install.js');
  if (!fs.existsSync(installJs)) {
    console.error('[reinstall-electron] 找不到 install.js:', installJs);
    process.exit(1);
  }

  // 镜像优先级：进程环境变量 > desktop/.npmrc > 根 .npmrc（.npmrc 为单一事实源，不硬编码 URL）
  const mirror =
    process.env.ELECTRON_MIRROR ||
    readNpmrc(DESKTOP).electron_mirror ||
    readNpmrc(ROOT).electron_mirror;

  const env = { ...process.env };
  if (mirror) {
    // @electron/get 读取优先级 npm_config_electron_mirror > ELECTRON_MIRROR，两者都设最稳妥
    env.ELECTRON_MIRROR = mirror;
    env.npm_config_electron_mirror = mirror;
    console.log('[reinstall-electron] 使用镜像:', mirror);
  } else {
    console.log('[reinstall-electron] 未配置 electron_mirror，回退官方 GitHub 源。');
  }

  const res = spawnSync(process.execPath, [installJs], {
    cwd: electronDir,
    stdio: 'inherit',
    env,
  });
  if (res.error) {
    console.error('[reinstall-electron] 运行 install.js 失败:', res.error.message);
    process.exit(1);
  }

  const pathTxt = path.join(electronDir, 'path.txt');
  if (res.status === 0 && fs.existsSync(pathTxt)) {
    const rel = fs.readFileSync(pathTxt, 'utf8').trim();
    console.log('[reinstall-electron] Electron 二进制就绪:', path.join(electronDir, 'dist', rel));
  }
  process.exit(res.status == null ? 1 : res.status);
}

main();
