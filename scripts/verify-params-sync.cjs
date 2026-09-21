const fs = require('node:fs');
const path = require('node:path');

const DEFS_FILE = path.join(__dirname, '..', 'packages', 'shared', 'src', 'params', 'definitions.ts');
const DOC_FILE = path.join(__dirname, '..', 'docs', 'params', 'LLAMA_SERVER_PARAMS.md');
const HELP_FILE = path.join(__dirname, '..', 'docs', 'params', 'llama-server-help-out.txt');

const defsText = fs.readFileSync(DEFS_FILE, 'utf8');
const docText = fs.readFileSync(DOC_FILE, 'utf8');
const helpText = fs.readFileSync(HELP_FILE, 'utf8');

// Extract supported flags from definitions.ts (including invert_flag aliases)
const codeFlags = new Set();
for (const m of defsText.matchAll(/flag:\s*'([^']+)'/g)) {
  codeFlags.add(m[1]);
}
for (const m of defsText.matchAll(/invert_flag:\s*'([^']+)'/g)) {
  codeFlags.add(m[1]);
}

// Parse official help into params (same logic as generate-params-doc.cjs)
const rawLines = helpText.split(/\r?\n/);
const mergedLines = [];
let currentLine = '';
for (const rawLine of rawLines) {
  const trimmed = rawLine.trim();
  if (!trimmed || /^-----\s+.+\s+-----$/.test(trimmed)) {
    if (currentLine) { mergedLines.push(currentLine); currentLine = ''; }
    mergedLines.push(rawLine);
    continue;
  }
  if (/^-[a-zA-Z0-9?-]|^--[a-zA-Z0-9_-]/.test(trimmed)) {
    if (currentLine) mergedLines.push(currentLine);
    currentLine = rawLine;
  } else if (currentLine) {
    currentLine += ' ' + trimmed;
  }
}
if (currentLine) mergedLines.push(currentLine);

const helpParams = [];
let inSection = false;
for (const line of mergedLines) {
  if (/^-----\s+(.+?)\s+-----$/.test(line.trim())) { inSection = true; continue; }
  if (!inSection) continue;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith('[')) continue;
  const paramMatch = trimmed.match(/^((?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+)(?:,\s+(?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+))*(?:\s+[A-Z_<>'"[\]{}|]+)?)\s+(.*)$/);
  if (!paramMatch) continue;
  const tokens = paramMatch[1].split(/[,\s]+/).filter(Boolean);
  const flags = tokens.filter(t => /^(-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+)$/.test(t));
  if (!flags.length) continue;
  helpParams.push({ flags, description: paramMatch[2].trim() });
}

// Parse supported params from the doc
const docSupportedParams = [];
const docLines = docText.split(/\r?\n/);
for (const line of docLines) {
  if (!line.includes('✅ 已支持')) continue;
  const cellMatch = line.match(/^\|\s*([^|]+)\|/);
  if (!cellMatch) continue;
  const flags = [...cellMatch[1].matchAll(/`([^`]+)`/g)].map(m => m[1].trim()).filter(Boolean);
  if (flags.length) docSupportedParams.push(flags);
}

// Compare by parameter (not by individual flag)
const codeSupportedSet = new Set();
for (const p of helpParams) {
  if (p.flags.some(f => codeFlags.has(f))) {
    for (const f of p.flags) codeSupportedSet.add(f);
  }
}

const docSupportedSet = new Set();
for (const flags of docSupportedParams) {
  for (const f of flags) docSupportedSet.add(f);
}

const onlyInCode = [...codeFlags].filter(f => !docSupportedSet.has(f));
const both = [...codeFlags].filter(f => docSupportedSet.has(f));

console.log('=== 参数清单一致性检查（按参数维度） ===\n');
console.log(`代码中参数 flag 数: ${codeFlags.size}`);
console.log(`清单中已支持参数所含 flag 数: ${docSupportedSet.size}`);
console.log(`两边一致的 flag 数: ${both.length}\n`);

// Also report truly unsupported-by-function params in doc
const docParamsNotInCode = docSupportedParams.filter(flags => !flags.some(f => codeFlags.has(f)));
if (docParamsNotInCode.length) {
  console.log('【清单标为已支持，但代码中没有任何对应 flag 的参数】');
  for (const flags of docParamsNotInCode) console.log(`  ${flags.join(', ')}`);
  console.log('');
}

if (onlyInCode.length) {
  console.log('【代码中有 flag，但清单未把这些参数标为已支持】');
  for (const f of onlyInCode.sort()) console.log(`  ${f}`);
  console.log('');
}

if (!onlyInCode.length && !docParamsNotInCode.length) {
  console.log('✅ 按参数维度检查完全一致，无出入。\n');
}

// ============================================================
// 文档里的参数计数声明必须等于 definitions.ts 实测（2026-09-21 硬编码审计补）。
// 为什么用显式声明表而不是全文扫「N 个参数」：文档里该句式也用于局部语境
// （如「以下 4 个参数」），泛扫会把无关数字判成全局声明。
// ============================================================
const GROUP_COUNTS = { basic: 0, advanced: 0, server: 0 };
for (const m of defsText.matchAll(/group:\s*'([a-z]+)'/g)) {
  if (!(m[1] in GROUP_COUNTS)) {
    console.error(`【definitions.ts 出现未知参数组】${m[1]}（文档计数声明表需同步）`);
    process.exit(1);
  }
  GROUP_COUNTS[m[1]]++;
}
const PARAM_TOTAL = GROUP_COUNTS.basic + GROUP_COUNTS.advanced + GROUP_COUNTS.server;

const DOC_PARAM_CLAIMS = [
  { file: 'AGENTS.md', re: /the (\d+)-param table/, want: [PARAM_TOTAL] },
  { file: 'README.md', re: /(\d+) 个参数与 llama-server/, want: [PARAM_TOTAL] },
  { file: 'docs/architecture.md', re: /参数表（(\d+) 组 \/ (\d+) 个参数）/, want: [Object.keys(GROUP_COUNTS).length, PARAM_TOTAL] },
  { file: 'docs/core-modules.md', re: /`PARAMS`（(\d+)：basic (\d+) \/ advanced (\d+) \/ server (\d+)）/, want: [PARAM_TOTAL, GROUP_COUNTS.basic, GROUP_COUNTS.advanced, GROUP_COUNTS.server] },
  { file: 'docs/params-system.md', re: /共 (\d+) 个参数/, want: [PARAM_TOTAL] },
  { file: 'docs/frontend.md', re: /；(\d+) 参数经/, want: [PARAM_TOTAL] },
  { file: 'docs/testing.md', re: /全部 (\d+) 参数/, want: [PARAM_TOTAL] },
];

const paramClaimErrors = [];
for (const { file, re, want } of DOC_PARAM_CLAIMS) {
  const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const m = text.match(re);
  if (!m) {
    paramClaimErrors.push(`  - ${file}: 声明未匹配（改口径须同步本表与门禁）：${re}`);
    continue;
  }
  want.forEach((expected, i) => {
    if (Number(m[i + 1]) !== expected) {
      paramClaimErrors.push(`  - ${file}: 声明 ${m[i + 1]}，实际 ${expected}（${re.source.slice(0, 40)}）`);
    }
  });
}
if (paramClaimErrors.length) {
  console.error(`[verify-params-sync] ❌ 文档参数计数与实测(${PARAM_TOTAL}：basic ${GROUP_COUNTS.basic} / advanced ${GROUP_COUNTS.advanced} / server ${GROUP_COUNTS.server})不符：`);
  for (const e of paramClaimErrors) console.error(e);
  console.error('修复：改文档数字（参数表唯一事实源仍是 packages/shared/src/params/definitions.ts）。');
  process.exit(1);
}
console.log(`[verify-params-sync] ✅ 文档参数计数声明与实测一致（${PARAM_TOTAL}：basic ${GROUP_COUNTS.basic} / advanced ${GROUP_COUNTS.advanced} / server ${GROUP_COUNTS.server}）。`);
