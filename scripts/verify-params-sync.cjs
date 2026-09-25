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
  // 两份着陆页成对且必须同数：README.md 是中文（GitHub 进仓库默认展示的那份），
  // README.en.md 是英文。各写一条句式，缺任一侧或数字不等都 fail。
  { file: 'README.md', re: /\*\*(\d+) 个\*\*\s*`llama-server` 参数/, want: [PARAM_TOTAL] },
  { file: 'README.en.md', re: /\*\*(\d+)\*\*\s*`llama-server` parameters/, want: [PARAM_TOTAL] },
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

// ============================================================
// 引擎缺省基线（params/engine-baseline.ts）对拍。
//
// 背景（2026-09-25）：发射规则原为「值 == ParamDef.default ⇒ 不写进命令行」，
// 而 default 同时是界面初值，里面装着启动器的**基线推荐**（-ctk/-ctv q8_0、
// --load-mode none、--fit off）。于是这些推荐值永远不进命令行，引擎按自己的缺省跑
// （f16 / auto / on），界面却显示 q8_0 / none / off —— 用户以为那是后端或模型的默认行为。
// 规则改成按 engineDefault 判定后，本段就是防止 engineDefault 再漂或再被随手填成 UI 值：
//   ① 键集与 PARAMS 双向相等（漏登记、留孤儿都 fail；解析不出条目也 fail，杜绝空转）；
//   ② help 里能解析出简单标量默认的，engineDefault 必须等于它；
//   ③ help 默认是条件式/描述式的（如 kv_unified「slots auto 时启用」），必须写 note 说明取舍；
//   ④ default ≠ engineDefault 且不在 sentinel 里的（= 有意覆盖引擎缺省），note 必填。
// ============================================================
const BASELINE_FILE = path.join(__dirname, '..', 'packages', 'shared', 'src', 'params', 'engine-baseline.ts');
const baselineText = fs.readFileSync(BASELINE_FILE, 'utf8');

/** 从 PARAMS 源码按「key + group 相邻」切出每个参数块（避开 dependsOn 里嵌套的 key:） */
const paramAnchors = [...paramsBody.matchAll(/key:\s*'([a-z0-9_]+)'\s*,\s*group:/g)];
const paramEntries = paramAnchors.map((m, i) => {
  const start = m.index;
  const end = i + 1 < paramAnchors.length ? paramAnchors[i + 1].index : paramsBody.length;
  const chunk = paramsBody.slice(start, end);
  const flag = (chunk.match(/flag:\s*'([^']+)'/) || [])[1];
  const invert = (chunk.match(/invert_flag:\s*'([^']+)'/) || [])[1];
  const dm = chunk.match(/default:\s*('[^']*'|-?[\d.]+|true|false)/);
  return { key: m[1], flag, invert_flag: invert, rawDefault: dm ? dm[1].replace(/^'|'$/g, '') : undefined };
});

/** 逐行扫描 engine-baseline.ts，按括号深度切出每个参数条目 */
const baselineEntries = new Map();
{
  const lines = baselineText.split(/\r?\n/);
  let cur = null;
  let depth = 0;
  for (const ln of lines) {
    if (!cur) {
      const m = ln.match(/^ {2}([a-z0-9_]+): \{/);
      if (!m) continue;
      cur = { key: m[1], body: ln };
      depth = (ln.match(/[{[]/g) || []).length - (ln.match(/[}\]]/g) || []).length;
      // 单行条目（`host: { engineDefault: '127.0.0.1' },`）在同一行就闭合，直接提交
      if (depth <= 0) { baselineEntries.set(cur.key, cur.body); cur = null; }
      continue;
    }
    cur.body += '\n' + ln;
    depth += (ln.match(/[{[]/g) || []).length - (ln.match(/[}\]]/g) || []).length;
    if (depth <= 0) { baselineEntries.set(cur.key, cur.body); cur = null; }
  }
}

const baselineErrors = [];
if (baselineEntries.size !== PARAM_TOTAL) {
  console.error(`[verify-params-sync] ❌ engine-baseline.ts 解析到 ${baselineEntries.size} 条，PARAMS 有 ${PARAM_TOTAL} 条（结构变了？解析规则需同步）`);
  process.exit(1);
}

/**
 * help 里的 (default: X) → 取首段并归一；非简单标量返回 { complex } 以强制 note。
 *
 * 逗号有两种完全不同的含义，必须分开（b11178 收录 --cors-methods 时撞出来的）：
 *  - 解释式「0, 0 = loaded from model」/「-1, use random seed for -1」→ 首段才是默认值，取首段对；
 *  - 取值列表「GET, POST, DELETE, OPTIONS」→ 取首段会得到 "GET"，随后拿这个假默认值
 *    去判 engineDefault 不符（门禁把自己的解析错误当成了数据的错）。
 * 判据：逗号后的各段**都是无空格单词**时是列表，否则是解释式。实测本基线 10 条含逗号的
 * 条目里 9 条为解释式、仅 cors_methods 为列表，故该判据不会凭空给既有条目加 note 义务。
 */
function helpDefault(flagName) {
  const hp = helpParams.find((h) => h.flags.includes(flagName));
  if (!hp) return { missing: true };
  const m = hp.description.match(/default:\s*([^)]*)/i);
  if (!m) return { missingDefault: true };
  const raw = m[1].trim().replace(/[.)\s]+$/, '');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const looksLikeList =
    parts.length > 1 && parts.every((s) => /^[A-Za-z0-9_.-]+$/.test(s));
  if (looksLikeList) return { complex: raw };
  const first = parts[0].replace(/^'|'$/g, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(first)) return { complex: raw };
  const low = first.toLowerCase();
  if (low === 'enabled' || low === 'true') return { value: 'true' };
  if (low === 'disabled' || low === 'false') return { value: 'false' };
  const n = Number(first);
  return { value: Number.isNaN(n) ? low : String(n) };
}
function canon(v) {
  if (typeof v === 'boolean') return String(v);
  const s = String(v).trim().replace(/^'|'$/g, '').toLowerCase();
  const n = Number(s);
  return Number.isNaN(n) ? s : String(n);
}

// ① 键集双向相等
for (const p of paramEntries) {
  if (!baselineEntries.has(p.key)) baselineErrors.push(`${p.key}: engine-baseline.ts 未登记（发射判定无基准可用）`);
}
for (const key of baselineEntries.keys()) {
  if (!paramKeys.has(key)) baselineErrors.push(`engine-baseline.ts 有孤儿条目 '${key}'（PARAMS 已无此参数）`);
}

let checked = 0;
let complexTagged = 0;
let overrides = [];
for (const p of paramEntries) {
  const body = baselineEntries.get(p.key);
  if (body === undefined) continue;
  const em = body.match(/engineDefault:\s*('[^']*'|-?[\d.]+|true|false)/);
  if (!em) { baselineErrors.push(`${p.key}: 缺 engineDefault`); continue; }
  const engineDefault = em[1].replace(/^'|'$/g, '');
  const sentinelRaw = (body.match(/sentinel:\s*\[([^\]]*)\]/) || [])[1] || '';
  const sentinel = sentinelRaw.split(',').map((s) => canon(s.trim().replace(/^'|'$/g, ''))).filter((s) => s !== '');
  const hasNote = /\bnote:\s*'/.test(body);

  // ② / ③ 对拍 help（优先用 flag 找条目，找不到再试 invert_flag）
  const byFlag = (f) => (f ? helpDefault(f) : { missing: true });
  const hd0 = byFlag(p.flag);
  const hd = hd0.missing ? byFlag(p.invert_flag) : hd0;
  if (!hd.missing) {
    if (hd.value !== undefined) {
      checked++;
      if (canon(engineDefault) !== hd.value) {
        baselineErrors.push(`${p.key} (${p.flag}): engineDefault=${JSON.stringify(engineDefault)} 与 help 默认 ${JSON.stringify(hd.value)} 不符`);
      }
    } else if (hd.complex) {
      complexTagged++;
      if (!hasNote) baselineErrors.push(`${p.key} (${p.flag}): help 默认是条件式「${hd.complex.slice(0, 48)}」，engine-baseline 必须写 note 说明取舍`);
    }
  }

  // ④ 有意覆盖引擎缺省必须留痕
  if (p.rawDefault !== undefined && canon(p.rawDefault) !== canon(engineDefault) && !sentinel.includes(canon(p.rawDefault))) {
    overrides.push(p.key);
    if (!hasNote) baselineErrors.push(`${p.key}: UI 默认 ${JSON.stringify(p.rawDefault)} ≠ 引擎默认 ${JSON.stringify(engineDefault)}，必须写 note 说明为什么覆盖`);
  }
}

if (baselineErrors.length) {
  console.error(`[verify-params-sync] ❌ 引擎缺省基线对拍不通过（${baselineErrors.length} 项）：`);
  for (const e of baselineErrors) console.error('  - ' + e);
  console.error('修复：engine-baseline.ts 的 engineDefault 一律以 docs/params/llama-server-help-out.txt 为准；');
  console.error('      换引擎版本先跑 node scripts/verify-help-drift.cjs <新help> 再同步本表（见 docs/zh/params-system.md §5.5）。');
  process.exit(1);
}
console.log(`[verify-params-sync] ✅ 引擎缺省基线 ${baselineEntries.size} 条与 PARAMS 键集相等；help 可对拍的 ${checked} 项 engineDefault 全等，条件式默认 ${complexTagged} 项均已注明，启动器有意覆盖引擎默认 ${overrides.length} 项均有 note：${overrides.join(', ')}`);

// ---- ⑤ 发射实现唯一性 ----
// 命令行 argv 只允许在 packages/shared/src/params/command.ts 里拼装。
// 为什么单独守这一条：发射规则一旦只对执行方（core）可达，展示方（服务页预览、浏览器 mock）
// 就只能各抄一份简化版，规则一改副本立刻静默失真——2026-09 的 engineDefault 修复、
// 2026-09-26 的 mock 预览失准都是同一个成因。把「第二处 push(p.flag)」判为失败，
// 是让这类副本没法再长出来，而不是靠人记得去同步。
const UNIQUE_EMITTER = ['packages', 'shared', 'src', 'params', 'command.ts'].join('/');
const EMIT_SCAN_ROOTS = ['packages', 'apps', 'e2e'].map((d) => path.join(__dirname, '..', d));
const EMIT_SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'release', 'coverage', 'frontendDist']);
const EMIT_RE = /\.(?:push|concat)\(\s*[A-Za-z_$][\w$]*(?:\.flag|\.invert_flag)\b/g;
const emitterFiles = new Set();
function scanEmitters(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!EMIT_SKIP_DIRS.has(ent.name)) scanEmitters(full);
      continue;
    }
    if (!/\.(ts|vue|cjs|js)$/.test(ent.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    EMIT_RE.lastIndex = 0;
    if (EMIT_RE.test(text)) emitterFiles.add(path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/'));
  }
}
EMIT_SCAN_ROOTS.forEach(scanEmitters);
const extraEmitters = [...emitterFiles].filter((f) => f !== UNIQUE_EMITTER).sort();
if (extraEmitters.length) {
  console.error('[verify-params-sync] ❌ 发现第二处命令行发射实现（拼装 argv 的代码只能有一份）：');
  for (const f of extraEmitters) console.error('  - ' + f);
  console.error(`修复：改为调用 ${UNIQUE_EMITTER} 的 buildArgv / argvFromPreviewOptions（浏览器侧没有 fs，`);
  console.error('      所以 core 的 buildCommand 只多一层 exe 存在性校验，规则本身在 shared）。');
  process.exit(1);
}
console.log(`[verify-params-sync] ✅ 命令行发射实现唯一：${UNIQUE_EMITTER}`);

// ---- ⑥ 参数基线构建号一致性 ----
// engine-baseline.ts 是某个引擎版本 --help 的快照；它的构建号在 6 处声明（常量本体 + 常量注释 +
// 生成器中英两行 + README 中英各一行 + params-system 中英「当前实测」段）。
// 只改常量不改别处，就会出现「代码说钉在 bN、文档说钉在 bM」——re-pin 时漏改一处即长期误导，
// 所以这里逐个解析并要求相等；**解析不到同样 fail**（声明改版式后检查不能静默空转）。
const ROOT_DIR = path.join(__dirname, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
const EB_REL = 'packages/shared/src/params/engine-baseline.ts';
const ebText = readRel(EB_REL);
const constM = ebText.match(/export const ENGINE_BASELINE_BUILD = '(b\d+)'/);
if (!constM) {
  console.error(`[verify-params-sync] ❌ ${EB_REL} 里解析不到 ENGINE_BASELINE_BUILD 常量（形态应为 export const ... = 'bNNNNN'）`);
  process.exit(1);
}
const baselineBuild = constM[1];
const BUILD_SITES = [
  [EB_REL, /当前固定 (b\d+)/, 'engine-baseline 头部注释'],
  ['scripts/generate-params-doc.cjs', /llama-(b\d+)-bin/g, '对照表来源行（中英）'],
  ['README.md', /基线对齐 llama\.cpp \*\*(b\d+)\*\*/, 'README 中文声明'],
  ['README.en.md', /baseline aligned to llama\.cpp \*\*(b\d+)\*\*/i, 'README 英文声明'],
  ['docs/zh/params-system.md', /当前实测（[^，]+，(b\d+) 基线/, '中文 params-system 当前实测段'],
  ['docs/en/params-system.md', /Current measurement \([^,]+, (b\d+) baseline/, '英文 params-system 当前实测段'],
];
const buildErrors = [];
for (const [rel, re, label] of BUILD_SITES) {
  const text = readRel(rel);
  const found = re.global ? [...text.matchAll(re)].map((m) => m[1]) : [(text.match(re) || [])[1]];
  const parsed = found.filter(Boolean);
  if (!parsed.length) {
    buildErrors.push(`${label}：在 ${rel} 里解析不到构建号（声明版式变了，检查已空转）`);
    continue;
  }
  for (const b of parsed) {
    if (b !== baselineBuild) buildErrors.push(`${label}：${rel} 写的是 ${b}，常量为 ${baselineBuild}`);
  }
}
if (buildErrors.length) {
  console.error(`[verify-params-sync] ❌ 参数基线构建号不一致（${buildErrors.length} 项）：`);
  for (const e of buildErrors) console.error('  - ' + e);
  console.error(`修复：re-pin 后把 ${baselineBuild} 同步到上述每一处（流程见 docs/zh/params-system.md §5.5）。`);
  process.exit(1);
}
console.log(`[verify-params-sync] ✅ 参数基线构建号 ${baselineBuild} 在 ${BUILD_SITES.length} 个声明处一致`);
