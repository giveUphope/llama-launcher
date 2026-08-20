// electron-builder afterPack 钩子
// 1) 将 llama Launcher 的产品信息写入主程序 exe 的 VS_VERSION_INFO 版本资源
// 2) 打包完成后将羊驼图标原地写入主程序 exe 的 RT_ICON 资源（任务栏/窗口使用）
// 3) 恢复 beforePack 钩子对 pnpm 工作区包做的替换
const fs = require('fs');
const path = require('path');

const PACKAGES = ['core', 'shared'];

// 将 llama Launcher 的产品信息写入主 exe 的 VS_VERSION_INFO 资源。
// signAndEditExecutable 设为 false 会让 electron-builder 跳过自带的 rcedit，
// exe 版本资源因此保持 Electron 默认（ProductName/FileDescription=Electron、
// OriginalFilename=electron.exe、版本号为 Electron 版本），任务管理器"应用名称"列与
// exe 属性会显示 Electron。这里用 resedit（纯 JS，不依赖 app-builder 工具链/签名）
// 重写版本资源，与下方 setExeIcon 的图标注入互补。
function setExeVersionInfo(context) {
  try {
    const { NtExecutable, NtExecutableResource, Resource } = require('resedit');
    const appOutDir = context.appOutDir;
    const exeName = `${context.packager.appInfo.productFilename}.exe`;
    const exePath = path.join(appOutDir, exeName);
    if (!fs.existsSync(exePath)) return;
    const version = context.packager.appInfo.version;

    const exe = NtExecutable.from(fs.readFileSync(exePath));
    const res = NtExecutableResource.from(exe);
    const viList = Resource.VersionInfo.fromEntries(res.entries);
    if (!viList.length) {
      console.warn('[afterPack] No VS_VERSION_INFO found on', exeName);
      return;
    }
    const vi = viList[0];
    // 沿用现有 translation（Electron 默认 en-US/1033），codepage 1200 = UTF-16
    const lang = vi.getAvailableLanguages()[0]?.lang ?? 1033;
    vi.setFileVersion(version, lang);
    vi.setProductVersion(version, lang);
    vi.setStringValues(
      { lang, codepage: 1200 },
      {
        FileDescription: 'llama Launcher',
        ProductName: 'llama Launcher',
        CompanyName: 'llama Launcher',
        InternalName: exeName,
        LegalCopyright: '',
        OriginalFilename: exeName,
      },
    );
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    console.log(`[afterPack] Set llama Launcher version info (v${version}) on ${exeName}`);
  } catch (e) {
    console.warn('[afterPack] Failed to set exe version info:', e.message);
  }
}

// 将 icon.ico 的羊驼 PNG 原地覆写进主 exe 的 RT_ICON 资源。
// signAndEditExecutable 设为 false 会让 electron-builder 跳过自带的 rcedit 图标注入，
// 因此这里在 afterPack 阶段显式注入。采用「同字节长度原地覆写」策略（见 inject-icon.cjs），
// 不改动资源目录 / RVA / GROUP_ICON 头部，规避本机环境下 app-builder rcedit / winCodeSign
// 解包符号链接失败的问题，且不涉及代码签名。
function setExeIcon(context) {
  try {
    const { injectIcon } = require('./inject-icon.cjs');
    const appOutDir = context.appOutDir;
    const exeName = `${context.packager.appInfo.productFilename}.exe`;
    const exePath = path.join(appOutDir, exeName);
    if (!fs.existsSync(exePath)) return;
    // 图标位于 buildResources 目录（resources/icon.ico）
    const iconPath = path.join(context.packager.buildResourcesDir || path.join(context.appDir, 'resources'), 'icon.ico');
    if (!fs.existsSync(iconPath)) { console.warn('[afterPack] icon not found:', iconPath); return; }
    const ok = injectIcon(exePath, iconPath);
    if (ok) console.log(`[afterPack] Set llama icon on ${exeName}`);
    else console.warn('[afterPack] No RT_ICON replaced on', exeName);
  } catch (e) {
    console.warn('[afterPack] Failed to set exe icon:', e.message);
  }
}

exports.default = async function (context) {
  // 先重写版本资源（resedit 会重建 PE），再原地覆写图标（inject-icon 基于字节级解析，
  // 对 resedit 产出的标准 PE 同样适用），避免两者相互影响
  setExeVersionInfo(context);
  setExeIcon(context);

  const appDir = context.appDir || context.packager?.appDir || context.packager?.info?.appDir || process.cwd();
  const nmDir = path.join(appDir, 'node_modules', '@llama-launcher');
  const rootDir = path.resolve(appDir, '..', '..');
  const rootNmDir = path.join(rootDir, 'node_modules', '@llama-launcher');
  const mapFile = path.join(appDir, '.pack-link-map.json');
  if (!fs.existsSync(mapFile)) {
    console.log('[afterPack] No link map found, nothing to restore');
    return;
  }
  const linkMap = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
  for (const pkg of PACKAGES) {
    const info = linkMap[pkg];
    if (!info) continue;
    const pkgPath = path.join(nmDir, pkg);

    // 选择恢复目标：优先原目标，其次 root node_modules，最后 packages/<pkg>
    const packagesPath = path.join(rootDir, 'packages', pkg);
    const rootPkgPath = path.join(rootNmDir, pkg);
    let target = info.originalReal;
    if (!target || !fs.existsSync(target)) {
      target = fs.existsSync(rootPkgPath) ? rootPkgPath : packagesPath;
    }
    if (!fs.existsSync(target)) {
      console.warn(`[afterPack] ${pkg}: restore target does not exist (${target}), skipping`);
      continue;
    }

    // 删除临时真实目录（可能是目录或残留链接）
    const lstat = fs.lstatSync(pkgPath, { throwIfNoEntry: false });
    try {
      if (lstat?.isSymbolicLink()) {
        fs.unlinkSync(pkgPath);
      } else {
        fs.rmSync(pkgPath, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`[afterPack] ${pkg}: failed to remove temp dir (${e.message})`);
    }

    // 恢复链接：Windows 使用 junction（不需要管理员权限），其他平台使用 symlink
    if (process.platform === 'win32') {
      try {
        fs.symlinkSync(target, pkgPath, 'junction');
        console.log(`[afterPack] Restored junction for ${pkg} → ${target}`);
      } catch (e) {
        // junction 失败时回退为 symlink
        console.warn(`[afterPack] junction restore failed for ${pkg}, falling back to symlink: ${e.message}`);
        try { fs.symlinkSync(target, pkgPath, 'dir'); } catch (e2) {
          console.error(`[afterPack] failed to restore ${pkg}: ${e2.message}`);
        }
      }
    } else {
      const rel = path.relative(path.dirname(pkgPath), target);
      try {
        fs.symlinkSync(rel, pkgPath, 'dir');
        console.log(`[afterPack] Restored symlink for ${pkg} → ${rel}`);
      } catch (e) {
        console.error(`[afterPack] failed to restore ${pkg}: ${e.message}`);
      }
    }
  }
  // 清理映射文件
  try { fs.unlinkSync(mapFile); } catch { /* ignore */ }
  console.log('[afterPack] Restored:', Object.keys(linkMap).join(', '));
};
