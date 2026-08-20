/**
 * 二进制升级后的参数漂移审计：对比「新 llama-server --help」与「已固定 help」，
 * 并核对应用参数表（definitions.ts）在新版本中是否有缺失。
 *
 * 用法：
 *   node scripts/verify-help-drift.cjs <new-help.txt> [--pinned <pinned-help.txt>]
 *
 * 默认 pinned = docs/params/llama-server-help-out.txt（仓库固定的 help 基线）。
 * 输出三层结果：
 *   1. flag 级：新版本相对基线 新增/移除 的 flag（语义漂移重点）
 *   2. 默认值级：两侧 "(default: ...)" 行的差异
 *   3. 应用侧：definitions.ts 全部 flag 在新 help 中是否存在
 *
 * 退出码：发现「flag 新增/移除」或「应用 flag 缺失」时返回 1（供 CI/手动流程拦截）。
 * 默认值变化只提示不失败（默认值变化通常需要人工决策是否跟随）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PINNED = path.join(ROOT, 'docs', 'params', 'llama-server-help-out.txt');
const DEFS = path.join(ROOT, 'packages', 'shared', 'src', 'params', 'definitions.ts');

function readArgs(argv) {
  const newFile = argv.find((a) => !a.startsWith('--'));
  if (!newFile) {
    console.error('用法: node scripts/verify-help-drift.cjs <new-help.txt> [--pinned <pinned-help.txt>]');
    process.exit(2);
  }
  let pinned = DEFAULT_PINNED;
  const pi = argv.indexOf('--pinned');
  if (pi >= 0 && argv[pi + 1]) pinned = argv[pi + 1];
  return { newFile, pinned };
}

/** 从 help 文本提取 flag 集合：整行分词，取 flag 形态 token（两侧同一解析器，噪声对称）。 */
function helpFlags(text) {
  const set = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('(') || line.includes('-----')) continue;
    for (const tok of line.split(/[\s,]+/)) {
      const word = tok.replace(/[=[\]<>{}|.:]/g, '');
      if (/^-{1,2}[a-z]/i.test(word) && word.length > 1 && word.length < 45) set.add(word);
    }
  }
  return set;
}

function extractDefaults(text) {
  // 返回 [{ line: flag 行首段, def: default 值 }]
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(.*?default: ([^)\n]*))/);
    if (m) {
      const flag = m[1].trim().split(/\s{2,}/)[0].slice(0, 60);
      out.push({ line: flag, def: m[2].trim() });
    }
  }
  return out;
}

function main() {
  const { newFile, pinned } = readArgs(process.argv.slice(2));
  const newText = fs.readFileSync(newFile, 'utf8');
  const pinnedText = fs.readFileSync(pinned, 'utf8');

  const fNew = helpFlags(newText);
  const fPinned = helpFlags(pinnedText);
  const added = [...fNew].filter((f) => !fPinned.has(f));
  const removed = [...fPinned].filter((f) => !fNew.has(f));

  console.log('=== 参数漂移审计 ===');
  console.log(`基线 help : ${pinned}`);
  console.log(`新   help : ${newFile}`);
  console.log(`基线 flags: ${fPinned.size} | 新 flags: ${fNew.size}`);
  console.log(`\n[1/3] flag 新增: ${added.length ? added.join(', ') : '无'}`);
  console.log(`[1/3] flag 移除: ${removed.length ? removed.join(', ') : '无'}`);

  // 默认值按「flag 行 + default 值」对齐对比
  const dNew = extractDefaults(newText);
  const dPinned = extractDefaults(pinnedText);
  const diffLines = [];
  for (const a of dPinned) {
    const b = dNew.find((x) => x.line === a.line);
    if (!b) diffLines.push(`  - ${a.line}  (default: ${a.def} → 已删除)`);
    else if (b.def !== a.def) diffLines.push(`  - ${a.line}  (default: ${a.def} → ${b.def})`);
  }
  for (const b of dNew) {
    if (!dPinned.some((x) => x.line === b.line)) diffLines.push(`  + ${b.line}  (default: ${b.def})`);
  }
  console.log(`\n[2/3] 默认值/描述变化(${diffLines.length}):`);
  console.log(diffLines.length ? diffLines.join('\n') : '  无');

  const defsText = fs.readFileSync(DEFS, 'utf8');
  const appFlags = [...new Set([...defsText.matchAll(/\b(?:flag|invert_flag):\s*'([^']+)'/g)].map((m) => m[1]))];
  const appMissing = appFlags.filter((f) => !fNew.has(f));
  console.log(`\n[3/3] 应用 flag 数: ${appFlags.length} | 新 help 中缺失: ${appMissing.length ? appMissing.join(', ') : '无'}`);

  if (added.length || removed.length || appMissing.length) {
    console.error('\n❌ 存在 flag 级漂移（新增/移除/应用缺失），需更新 definitions.ts 后重跑 generate-params-doc + verify-params-sync。');
    process.exit(1);
  }
  console.log('\n✅ flag 级无漂移；默认值变化请人工确认是否跟随（默认值变化不阻塞，见上）。');
}

main();
