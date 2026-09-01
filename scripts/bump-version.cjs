#!/usr/bin/env node
/**
 * 自动更新版本号：读取 root package.json 中的 version，按类型（patch/minor/major）
 * 递增，然后同步更新所有版本声明文件并生成新的 git tag。
 *
 * 用法：node scripts/bump-version.cjs [patch|minor|major]
 *   默认 patch。
 *
 * 同步范围：
 *   - root package.json
 *   - apps/desktop/package.json
 *   - packages/shared/src/params/definitions.ts（APP_VERSION）
 *   - docs/CHANGELOG.md（[Unreleased] 标题 → 新版本）
 *   - docs/packaging.md（所有旧版本号引用）
 *   - README.md（旧版本号引用）
 *   - AGENTS.md（旧版本号引用）
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeJson(rel, obj) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeText(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function run() {
  const type = process.argv[2] || 'patch';
  if (!['patch', 'minor', 'major'].includes(type)) {
    console.error(`Usage: node scripts/bump-version.cjs [patch|minor|major]`);
    process.exit(2);
  }

  const root = readJson('package.json');
  const currentVersion = root.version;
  const newVersion = bumpVersion(currentVersion, type);
  console.log(`Bumping ${type}: ${currentVersion} → ${newVersion}`);

  // 1. root package.json
  root.version = newVersion;
  writeJson('package.json', root);

  // 2. apps/desktop/package.json
  const desktop = readJson('apps/desktop/package.json');
  desktop.version = newVersion;
  writeJson('apps/desktop/package.json', desktop);

  // 3. APP_VERSION in definitions.ts
  let defs = readText('packages/shared/src/params/definitions.ts');
  defs = defs.replace(/export const APP_VERSION = '[^']*'/, `export const APP_VERSION = '${newVersion}'`);
  writeText('packages/shared/src/params/definitions.ts', defs);

  // 4. CHANGELOG.md：[Unreleased] 标题 → 新版本，带今天的日期
  const today = new Date().toISOString().slice(0, 10);
  let changelog = readText('docs/CHANGELOG.md');
  changelog = changelog.replace(
    /^## \[Unreleased\]/m,
    `## [Unreleased]\n\n## [${newVersion}] - ${today}\n`,
  );
  // 但如果已是最新版本（上一次 bump 未合并），避免重复
  if (!changelog.includes(`## [${newVersion}]`)) {
    // 找不到 Unreleased，就在顶部插入
    changelog = changelog.replace(/^## \[Unreleased\]\s*$/m, `## [Unreleased]\n\n## [${newVersion}] - ${today}\n`);
  }
  writeText('docs/CHANGELOG.md', changelog);

  // 5. docs/packaging.md, README.md, AGENTS.md 中所有旧版本号引用
  for (const rel of ['docs/packaging.md', 'README.md', 'AGENTS.md']) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    let text = readText(rel);
    text = text.replace(new RegExp(currentVersion.replace(/\./g, '\\.'), 'g'), newVersion);
    writeText(rel, text);
  }

  console.log(`Done. New version: ${newVersion}`);
}

run();
