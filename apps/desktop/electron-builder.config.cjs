// electron-builder 26 配置（JS 形态，替代 electron-builder.yml）。
// 动机：v26 拒绝 YAML 中解析到 workspace 根之外的 hook 路径字符串
// （"Hook module path resolves outside the workspace root"），
// 改为函数式 hooks —— beforePack/afterPack 从 scripts/ 直接注入。
// 注意：本文件被 scripts/dist-with-fallback.cjs 读取（directories.output 需保持可解析）。
const beforePack = require('../../scripts/before-pack.cjs').default;
const afterPack = require('../../scripts/after-pack.cjs').default;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.llama-launcher.app',
  productName: 'llama Launcher',
  directories: {
    output: '../../release',
    buildResources: 'resources',
  },
  icon: 'resources/icon.ico',
  asar: true,
  beforePack,
  afterPack,
  files: ['dist/**/*', 'package.json', 'node_modules/@llama-launcher/**/*', '!dist/**/*.map'],
  extraResources: [
    { from: 'resources/icon-32.png', to: 'icon-32.png' },
    { from: 'resources/icon-16.png', to: 'icon-16.png' },
    { from: 'resources/icon.ico', to: 'icon.ico' },
  ],
  win: {
    target: ['portable'],
    signAndEditExecutable: false,
  },
};
