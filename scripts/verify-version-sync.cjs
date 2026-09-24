#!/usr/bin/env node
/**
 * 版本号一致性门禁：断言所有「应用版本」声明处与 root package.json 完全相等。
 *
 * 为什么需要它（2026-09-21）：docs/zh/architecture.md 的 monorepo 包版本表 desktop 行
 * 已在 0.0.12 → 0.0.34 → 0.0.40 → 0.0.41 三轮发版中持续漂移。根因是
 * scripts/bump-version.cjs 的文档同步清单漏收该文件；补清单时又出现「只改了文件头
 * 注释、代码数组没动」的二次漂移——注释声称同步，实测没同步，等于没修。
 * 门禁直接核对最终不变量（各声明处相等），不再依赖「同步清单是否写全」。
 *
 * 每个声明处都要求「解析得到值」：解析不到即 fail，防止表格改版后检查静默变成空转。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sources = [];

function collect(rel, label, value) {
  sources.push({ rel, label, value: value ?? null });
}

// 1. root package.json —— 权威值
collect('package.json', 'root version', JSON.parse(read('package.json')).version);

// 2. desktop package.json
collect('apps/desktop/package.json', 'desktop version', JSON.parse(read('apps/desktop/package.json')).version);

// 3. shared/src/params/definitions.ts 的 APP_VERSION
collect(
  'packages/shared/src/params/definitions.ts',
  'APP_VERSION',
  (read('packages/shared/src/params/definitions.ts').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1]
);

// 4. docs/zh/architecture.md 与 docs/en/architecture.md 的 monorepo 包版本表 desktop 行
//    （只此一行跟随应用版本，core/shared/ui 各自固定 1.0.0，不参与断言；
//     双语两树都要收，否则英文表漂了没人管）
collect(
  'docs/zh/architecture.md',
  'monorepo 表 desktop 行',
  (read('docs/zh/architecture.md').match(/@llama-launcher\/desktop`?\s*\|\s*([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1]
);
collect(
  'docs/en/architecture.md',
  'monorepo 表 desktop 行（英文镜像）',
  (read('docs/en/architecture.md').match(/@llama-launcher\/desktop`?\s*\|\s*([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1]
);

// 5. docs/CHANGELOG.md 最新的已发布版本标题（跳过 [Unreleased]）
const changelogHeaders = [...read('docs/CHANGELOG.md').matchAll(/^## \\\??\[(\d+\.\d+\.\d+)\]/gm)].map(
  (m) => m[1]
);
collect('docs/CHANGELOG.md', '最新已发布标题', changelogHeaders[0]);

const expected = sources[0].value;
const problems = [];

for (const s of sources.slice(1)) {
  if (!s.value) problems.push(`${s.rel} · ${s.label}：解析不到版本号（声明位置已改版或被删，检查本身失效）`);
  else if (s.value !== expected) problems.push(`${s.rel} · ${s.label}：${s.value}（应为 ${expected}）`);
}

if (!expected) {
  console.error('【verify-version-sync】root package.json 解析不到 version，门禁无法工作。');
  process.exit(1);
}

if (problems.length) {
  console.error(`【verify-version-sync】版本号不一致（权威值 root package.json = ${expected}），共 ${problems.length} 处：`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n手工发版：node scripts/bump-version.cjs [patch|minor|major]；已在 CI bump 同步清单内的文件仍漂移时，检查该脚本第 5 步的清单数组。');
  process.exit(1);
}

console.log(`[verify-version-sync] ✅ ${sources.length} 处版本声明一致（${expected}）。`);
