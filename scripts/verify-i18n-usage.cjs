#!/usr/bin/env node
// i18n 键使用一致性检查：防止「字典删键、代码留引用」导致界面渲染出原始 key
// （历史事故：b8c1d59 移除 msg_autoscroll_* 后，Arco 迁移拉取又把引用带回，
// 控制台直接显示 "msg_autoscroll_on"）。
//
// 检查两件事：
//  1. 悬空引用：ui/core 源码中字面量 t('key') / i18n.t('key') 的键必须同时存在于
//     zh.ts 与 en.ts（动态拼接 t('x' + v) 与模板字符串不检查——无法静态判定）。
//  2. 中英键集差异：zh 与 en 的键集合必须完全一致。
//
// 用法：node scripts/verify-i18n-usage.cjs（已接入 pnpm lint）
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'packages', 'shared', 'src', 'i18n');
const SCAN_DIRS = [
  path.join(ROOT, 'packages', 'ui', 'src'),
  path.join(ROOT, 'packages', 'core', 'src'),
];

/** 递归收集 .vue / .ts 文件（跳过 node_modules、dist、测试文件）。 */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else if (/\.(vue|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 解析扁平 i18n 字典（两空格缩进的 `key:` 行）的键集合。 */
function dictKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/^ {2}([a-z0-9_]+)\s*:/gm)) keys.add(m[1]);
  return keys;
}

function main() {
  const zh = dictKeys(path.join(I18N_DIR, 'zh.ts'));
  const en = dictKeys(path.join(I18N_DIR, 'en.ts'));
  if (zh.size === 0 || en.size === 0) {
    console.error('[verify-i18n-usage] 字典解析为空（格式变更？），拒绝通过。');
    process.exit(1);
  }

  const errors = [];

  // 1) 中英键集差异
  for (const k of zh) if (!en.has(k)) errors.push(`en.ts 缺键: ${k}`);
  for (const k of en) if (!zh.has(k)) errors.push(`zh.ts 缺键: ${k}`);

  // 2) 悬空引用：独立的 t('key') / i18n.t('key')，且参数为纯字面量（后跟 , 或 )）
  const RE = /(?<![A-Za-z0-9_$.])(?:i18n\.)?t\(\s*['"]([a-z0-9_]+)['"]\s*[,)]/g;
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(RE)) {
          const key = m[1];
          if (!zh.has(key) || !en.has(key)) {
            const rel = path.relative(ROOT, file).replace(/\\/g, '/');
            errors.push(`悬空引用: ${key}  ${rel}:${i + 1}`);
          }
        }
      }
    }
  }

  if (errors.length) {
    console.error(`[verify-i18n-usage] ❌ 发现 ${errors.length} 个问题：`);
    for (const e of errors) console.error('  - ' + e);
    console.error('修复：补回字典键，或移除对已删键的引用（见 git log 中该键的删除提交意图）。');
    process.exit(1);
  }
  console.log(`[verify-i18n-usage] ✅ zh/en 各 ${zh.size} 键一致，无悬空引用。`);
}

main();
