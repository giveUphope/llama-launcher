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
 *   - docs/zh/packaging.md 与 docs/en/packaging.md（所有旧版本号引用）
 *   - docs/zh/architecture.md 与 docs/en/architecture.md（monorepo 包版本表中的 desktop 行）
 *   - README.md（中文，GitHub 默认展示）/ README.en.md（旧版本号引用）
 *   - AGENTS.md（旧版本号引用）
 *
 * 文档侧按行替换，含 `bump-ignore` 标记的行跳过（历史反例/举例用的版本号不该被改写）。
 * 一致性由 scripts/verify-version-sync.cjs 在 pnpm lint 侧兜底（清单漏收 ≠ 没人发现）。
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
  // 标题存在两种形态：`## [Unreleased]` 与 markdown 转义体 `## \[Unreleased]`（2026-09 格式化引入）——
  // 旧正则只匹配前者，导致 v0.0.11 起替换静默 no-op、版本条目漏插。现兼容两种并沿用文件现行风格。
  const today = new Date().toISOString().slice(0, 10);
  let changelog = readText('docs/CHANGELOG.md');
  const UNREL_RE = /^## (\\?)\[Unreleased\]/m;
  const mUnrel = changelog.match(UNREL_RE);
  const esc = mUnrel && mUnrel[1] ? '\\' : '';
  const header = `## ${esc}[Unreleased]\n\n## ${esc}[${newVersion}] - ${today}\n`;
  if (mUnrel) {
    changelog = changelog.replace(UNREL_RE, header);
  } else {
    // 找不到 Unreleased 标题：在文首（一级标题之后）插入
    changelog = changelog.replace(/^# [^\n]*\n/, (h) => `${h}\n${header}\n`);
  }
  writeText('docs/CHANGELOG.md', changelog);

  // 5. 文档中的旧版本号引用统一刷新（清单须与文件头注释一致）
  //    逐行替换，跳过含 `bump-ignore` 标记的行：文档里有「引用当前版本号作为反例/历史」
  //    的散文（如 packaging.md 记录「旧文字错误声称 electron-builder 会剥尾零」），
  //    全文 replace 会让这类反例每轮发版被改写成当时的新版本号，历史断言被静默篡改。
  //    机制与 i18n 的 `// i18n-ignore` 同构。
  const BUMP_IGNORE = 'bump-ignore';
  // 双语两树都要在清单里（docs/zh/* 与 docs/en/* 各一份版本声明），漏一侧就是发版后单边漂移；
  // 是否真的对得上由 scripts/verify-version-sync.cjs 兜底，不要只信这张表。
  for (const rel of [
    'docs/zh/packaging.md',
    'docs/en/packaging.md',
    'docs/zh/architecture.md',
    'docs/en/architecture.md',
    'README.md',
    'README.en.md',
    'AGENTS.md',
  ]) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const text = readText(rel);
    const next = text
      .split('\n')
      .map((line) =>
        line.includes(BUMP_IGNORE)
          ? line
          : line.replace(new RegExp(currentVersion.replace(/\./g, '\\.'), 'g'), newVersion)
      )
      .join('\n');
    writeText(rel, next);
  }

  console.log(`Done. New version: ${newVersion}`);
}

run();
