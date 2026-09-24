const fs = require('node:fs');
const path = require('node:path');

const DEFS_FILE = path.join(__dirname, '..', 'packages', 'shared', 'src', 'params', 'definitions.ts');
const HELP_FILE = path.join(__dirname, '..', 'docs', 'params', 'llama-server-help-out.txt');

const defsText = fs.readFileSync(DEFS_FILE, 'utf8');
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

// Parse supported params from the doc — 中英两份对照表都要对拍（成对生成，缺一或单边漂移即 fail）
const DOC_PARAM_TABLES = [
  { file: 'docs/zh/params/LLAMA_SERVER_PARAMS.md', mark: '✅ 已支持' },
  { file: 'docs/en/params/LLAMA_SERVER_PARAMS.md', mark: '✅ supported' },
];

function parseSupportedFlagsFromDoc(docText, mark) {
  const rows = [];
  for (const line of docText.split(/\r?\n/)) {
    if (!line.includes(mark)) continue;
    const cellMatch = line.match(/^\|\s*([^|]+)\|/);
    if (!cellMatch) continue;
    const flags = [...cellMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
    if (flags.length) rows.push(flags);
  }
  return rows;
}

// Compare by parameter (not by individual flag)
const codeSupportedSet = new Set();
for (const p of helpParams) {
  if (p.flags.some(f => codeFlags.has(f))) {
    for (const f of p.flags) codeSupportedSet.add(f);
  }
}

console.log('=== 参数清单一致性检查（按参数维度，中英双表） ===\n');
console.log(`代码中参数 flag 数: ${codeFlags.size}`);

// 两类漂移从「只打印」升级为硬门禁（2026-09-21 硬编码审计收尾）：本脚本已接入
// pnpm lint，只打印等于没有——漂移会一直躺着没人管（历史上 flag 数与文档就是靠
// 人工对表订正过一轮）。今天实测两类皆空，故转 fail 不会立刻炸 CI。
const syncDrift = [];
for (const { file, mark } of DOC_PARAM_TABLES) {
  const docText = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const docSupportedParams = parseSupportedFlagsFromDoc(docText, mark);
  const docSupportedSet = new Set();
  for (const flags of docSupportedParams) for (const f of flags) docSupportedSet.add(f);

  const onlyInCode = [...codeFlags].filter((f) => !docSupportedSet.has(f));
  const both = [...codeFlags].filter((f) => docSupportedSet.has(f));
  console.log(`${file} 已支持 flag 数: ${docSupportedSet.size}，一致 ${both.length}`);

  if (!docSupportedParams.length) {
    syncDrift.push(`${file}: 没解析到任何「${mark}」行——状态标记文案被改动却没同步本表`);
    continue;
  }
  const docParamsNotInCode = docSupportedParams.filter((flags) => !flags.some((f) => codeFlags.has(f)));
  if (docParamsNotInCode.length) {
    syncDrift.push(`${file}: 清单标为已支持，但代码中没有任何对应 flag 的参数：`);
    for (const flags of docParamsNotInCode) syncDrift.push('  ' + flags.join(', '));
  }
  if (onlyInCode.length) {
    syncDrift.push(`${file}: 代码中有 flag，但清单未把这些参数标为已支持：`);
    for (const f of onlyInCode.sort()) syncDrift.push('  ' + f);
  }
}
console.log('');

if (syncDrift.length) {
  console.error('[verify-params-sync] ❌ 参数定义 ↔ 文档清单 ↔ help 三方对拍有出入：');
  for (const line of syncDrift) console.error('  ' + line);
  console.error(
    '修复二选一：① 代码侧补/改 flag（packages/shared/src/params/definitions.ts）；' +
      '② 文档侧改标注或重新生成对照表（node scripts/generate-params-doc.cjs，一次产出中英两份）。' +
      '二进制升级导致的漂移见 scripts/verify-help-drift.cjs 与 docs/zh/params-system.md §5.5。',
  );
  process.exit(1);
}
console.log('✅ 中英两份对照表与代码 flag 完全一致，无出入。\n');

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
  // README 自 2026-09-24 起为英文着陆页（约定见 AGENTS.md 的 README 条目），故按英文句式取数：
  // 命中的是 Highlights 里的 "**60** `llama-server` parameters grouped into 13 sections"。
  { file: 'README.md', re: /\*\*(\d+)\*\*\s*`llama-server` parameters/, want: [PARAM_TOTAL] },
  // 中文着陆页与 README.md 成对，同一条数字必须两树相等（只查英文侧的话，
  // 中文版漂移不会有人发现）。
  { file: 'README.zh-CN.md', re: /\*\*(\d+) 个\*\*\s*`llama-server` 参数/, want: [PARAM_TOTAL] },
  { file: 'docs/zh/architecture.md', re: /参数表（(\d+) 组 \/ (\d+) 个参数）/, want: [Object.keys(GROUP_COUNTS).length, PARAM_TOTAL] },
  { file: 'docs/zh/core-modules.md', re: /`PARAMS`（(\d+)：basic (\d+) \/ advanced (\d+) \/ server (\d+)）/, want: [PARAM_TOTAL, GROUP_COUNTS.basic, GROUP_COUNTS.advanced, GROUP_COUNTS.server] },
  { file: 'docs/zh/params-system.md', re: /共 (\d+) 个参数/, want: [PARAM_TOTAL] },
  { file: 'docs/zh/frontend.md', re: /；(\d+) 参数经/, want: [PARAM_TOTAL] },
  { file: 'docs/zh/testing.md', re: /全部 (\d+) 参数/, want: [PARAM_TOTAL] },
  // 英文镜像树同数：docs/en/** 与 docs/zh/** 必须报同一个总数与分组数
  { file: 'docs/en/architecture.md', re: /Param table \((\d+) groups \/ (\d+) params\)/, want: [Object.keys(GROUP_COUNTS).length, PARAM_TOTAL] },
  { file: 'docs/en/core-modules.md', re: /`PARAMS` \((\d+): basic (\d+) \/ advanced (\d+) \/ server (\d+)\)/, want: [PARAM_TOTAL, GROUP_COUNTS.basic, GROUP_COUNTS.advanced, GROUP_COUNTS.server] },
  { file: 'docs/en/params-system.md', re: /(\d+) parameters in total/, want: [PARAM_TOTAL] },
  { file: 'docs/en/frontend.md', re: /;?\s*(\d+) parameters are rendered/, want: [PARAM_TOTAL] },
  { file: 'docs/en/testing.md', re: /all (\d+) parameters/, want: [PARAM_TOTAL] },
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

// ============================================================
// 参数标签/帮助字典（i18n/labels.ts）与 PARAMS 表必须键集完全相等。
// 两个方向都会出事：
//   · 表里有、字典无 → paramLabel() 回退渲染裸 key（`spec_draft_n_max` 直接上界面）；
//   · 字典有、表里无 → 死条目（参数删了字典没删，读代码的人以为该参数还在）。
// 2026-09-21 实测：60 个参数标签/帮助齐全，但字典里躺着 6 条孤儿
// （repeat_last_n / typical_p / mirostat / mirostat_lr / mirostat_ent / model，
// 前 5 个是已删参数，model 行的标签实际走 t('lbl_model_path') 不经 paramLabel）。
// ============================================================
const LABELS_FILE = path.join(__dirname, '..', 'packages', 'shared', 'src', 'i18n', 'labels.ts');
const labelsText = fs.readFileSync(LABELS_FILE, 'utf8');
// 参数 key 必须按「key: 'x', group: 'y'」相邻来取：只按 `key:` 会把 PARAM_GROUPS 的
// { key: 'basic', labelKey: … } 也算进来（实测 63 ≠ 60）
const paramsBody = defsText.slice(defsText.indexOf('export const PARAMS'));
const paramKeys = new Set(
  [...paramsBody.matchAll(/key:\s*'([a-z0-9_]+)'\s*,\s*group:\s*'/g)].map((m) => m[1]),
);
if (paramKeys.size !== PARAM_TOTAL) {
  console.error(`[verify-params-sync] ❌ 参数 key 解析数 ${paramKeys.size} ≠ 条目数 ${PARAM_TOTAL}（definitions.ts 结构变了？解析规则需同步）`);
  process.exit(1);
}

function labelKeysOf(mapName) {
  const start = labelsText.indexOf(`export const ${mapName}`);
  if (start < 0) {
    console.error(`【labels.ts 解析失败】找不到 export const ${mapName}`);
    process.exit(1);
  }
  const end = labelsText.indexOf('\n};', start);
  const body = labelsText.slice(start, end);
  const out = new Map();
  for (const m of body.matchAll(/^ {2}([a-z0-9_]+):\s*\{\s*zh:\s*(.+?),\s*en:\s*(.+?),?\s*\},?$/gm)) {
    out.set(m[1], { zh: m[2], en: m[3] });
  }
  return out;
}

const labelErrors = [];
for (const mapName of ['PARAM_LABELS', 'PARAM_HELP']) {
  const entries = labelKeysOf(mapName);
  for (const key of paramKeys) {
    const e = entries.get(key);
    if (!e) { labelErrors.push(`${mapName} 缺 '${key}'（界面会渲染裸 key）`); continue; }
    for (const lang of ['zh', 'en']) {
      const v = (e[lang] ?? '').trim().replace(/^['"]|['"]$/g, '');
      if (!v) labelErrors.push(`${mapName}.'${key}'.${lang} 为空`);
    }
  }
  for (const key of entries.keys()) {
    if (!paramKeys.has(key)) labelErrors.push(`${mapName} 有孤儿条目 '${key}'（PARAMS 已无此参数）`);
  }
  console.log(`[verify-params-sync] ${mapName} 条目 ${entries.size} / PARAMS ${paramKeys.size}`);
}
if (labelErrors.length) {
  console.error(`[verify-params-sync] ❌ 参数字典与参数表不同步（${labelErrors.length} 项）：`);
  for (const e of labelErrors) console.error('  - ' + e);
  console.error('修复：在 packages/shared/src/i18n/labels.ts 补齐或删掉对应条目（参数表唯一来源仍是 definitions.ts）。');
  process.exit(1);
}
console.log('[verify-params-sync] ✅ 参数标签/帮助字典与 PARAMS 键集完全相等，zh/en 均非空。');
