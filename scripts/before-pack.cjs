// electron-builder beforePack 钩子
// 在打包前确保 `apps/desktop/node_modules/@llama-launcher/<pkg>` 仅含 dist/ 与 package.json。
// 背景：pnpm 在 Windows 上常用 junction（目录联接）而非 symlink，Node 的 fs.lstat().isSymbolicLink()
// 在 Windows 上对 junction 返回 false，导致原本只针对 symlink 的检测失效，electron-builder
// 会直接打包 node_modules 里的整个目录（含过时 dist、可能含 src/tests）。
// 另外，使用 shamefully-hoist=true 时，apps/desktop/node_modules/@llama-launcher/<pkg>
// 可能出现循环/自引用符号链接（fs.existsSync=false，realpath 抛 ELOOP），需要检测并移除。
// 修复策略：
//   1) 通过 fs.realpathSync 与原始路径比对：realpath !== path 即为有效链接（symlink 或 junction）；
//   2) 若路径不存在但 lstat 显示为 symlink → 视为损坏/循环链接，用 unlink 移除；
//   3) 若已是链接 → 解析目标、删除、用真实 dist/ 重建（仅含 .js）；
//   4) 若已是真实目录 → 清空 dist/ 并从 packages/<pkg>/dist 重新复制 .js（保证使用最新构建）；
//   5) 当 apps/desktop/node_modules 中的包无效时，回退到 root node_modules/@llama-launcher/<pkg>
//      或 packages/<pkg> 作为 dist/package.json 来源；
//   6) 记录替换过的路径与恢复目标，afterPack 钩子据此恢复。
const fs = require('fs');
const path = require('path');

const PACKAGES = ['core', 'shared'];

exports.default = async function (context) {
  const appDir = context.appDir || context.packager?.appDir || context.packager?.info?.appDir || process.cwd();
  const nmDir = path.join(appDir, 'node_modules', '@llama-launcher');
  const rootDir = path.resolve(appDir, '..', '..'); // apps/desktop → 仓库根
  const rootNmDir = path.join(rootDir, 'node_modules', '@llama-launcher');
  const linkMap = {};

  for (const pkg of PACKAGES) {
    const pkgPath = path.join(nmDir, pkg);
    const rootPkgPath = path.join(rootNmDir, pkg);
    const packagesPath = path.join(rootDir, 'packages', pkg);

    // 探测原始节点状态：有效链接 / 损坏循环链接 / 真实目录 / 不存在
    const lstat = fs.lstatSync(pkgPath, { throwIfNoEntry: false });
    const exists = fs.existsSync(pkgPath);
    const isBrokenLink = !exists && lstat?.isSymbolicLink();
    let isLink = false;
    let real;

    if (exists && lstat) {
      try {
        real = fs.realpathSync(pkgPath);
        isLink = real !== pkgPath;
      } catch (e) {
        // 能 lstat 但不能 realpath（不应发生），按损坏链接处理
        console.log(`[beforePack] ${pkg}: realpath failed (${e.message}), treating as broken link`);
        isBrokenLink = true;
      }
    }

    // 确定 dist/package.json 来源：
    // 1) 有效链接 → 使用链接目标；
    // 2) 损坏链接 / 不存在 → 优先使用 root node_modules，其次 packages/<pkg>
    let resolved;
    if (isLink && real) {
      resolved = real;
    } else if (fs.existsSync(rootPkgPath)) {
      try {
        resolved = fs.realpathSync(rootPkgPath);
      } catch {
        resolved = rootPkgPath;
      }
    } else {
      resolved = packagesPath;
    }

    // 验证 dist 源
    const distSrc = fs.existsSync(path.join(resolved, 'dist'))
      ? path.join(resolved, 'dist')
      : path.join(packagesPath, 'dist');
    if (!fs.existsSync(distSrc)) {
      console.log(`[beforePack] ${pkg}: dist not found at ${distSrc}, skipping`);
      continue;
    }
    const pkgJsonSrc = fs.existsSync(path.join(resolved, 'package.json'))
      ? path.join(resolved, 'package.json')
      : path.join(packagesPath, 'package.json');
    if (!fs.existsSync(pkgJsonSrc)) {
      console.log(`[beforePack] ${pkg}: package.json not found at ${pkgJsonSrc}, skipping`);
      continue;
    }

    // 删除原节点（链接用 unlink，目录用 rm，损坏链接也用 unlink）
    try {
      if (isBrokenLink || (lstat && lstat.isSymbolicLink())) {
        fs.unlinkSync(pkgPath);
      } else if (lstat?.isDirectory()) {
        const entries = fs.readdirSync(pkgPath);
        for (const name of entries) {
          if (name.startsWith('.ignored_')) continue;
          fs.rmSync(path.join(pkgPath, name), { recursive: true, force: true });
        }
      }
    } catch (e) {
      console.log(`[beforePack] ${pkg}: failed to clean ${pkgPath} (${e.message}), skipping`);
      continue;
    }
    fs.mkdirSync(pkgPath, { recursive: true });

    // 复制 package.json
    fs.copyFileSync(pkgJsonSrc, path.join(pkgPath, 'package.json'));
    // 复制 dist/（仅 .js 文件，排除 .map/.d.ts/.d.ts.map）
    copyJsOnly(distSrc, path.join(pkgPath, 'dist'));

    // 记录恢复目标：有效链接恢复至原目标；损坏/缺失链接恢复至 root node_modules 目标
    const restoreTarget = (isLink && real) ? real : (resolved || rootPkgPath || packagesPath);
    linkMap[pkg] = { wasLink: isLink || isBrokenLink || (lstat?.isSymbolicLink() ?? false), originalReal: restoreTarget, originalPath: pkgPath };
    console.log(`[beforePack] ${pkg}: ${isBrokenLink ? 'replaced broken link' : (isLink ? 'replaced link' : 'synced real dir')} with dist-only contents from ${distSrc}`);
  }

  // 将映射保存到临时文件，供 afterPack 读取
  fs.writeFileSync(path.join(appDir, '.pack-link-map.json'), JSON.stringify(linkMap, null, 2));
  console.log('[beforePack] Processed:', Object.keys(linkMap).join(', ') || '(none)');
};

function copyJsOnly(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyJsOnly(s, d);
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts.js')) {
      fs.copyFileSync(s, d);
    }
  }
}
