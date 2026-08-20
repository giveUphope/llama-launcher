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
  const paramMatch = trimmed.match(/^((?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+)(?:,\s+(?:-[a-zA-Z0-9?-]+|--[a-zA-Z0-9_-]+))*(?:\s+[A-Z_<>\'"\[\]{}|]+)?)\s+(.*)$/);
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
const onlyInDoc = [...docSupportedSet].filter(f => !codeSupportedSet.has(f));
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
