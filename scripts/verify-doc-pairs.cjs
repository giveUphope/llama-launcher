#!/usr/bin/env node
/**
 * 中英双树结构配对门禁（2026-09-24 加）。
 *
 * 为什么需要它：docs/en/** 是独立文件，**不是** docs/zh/** 的自动产物——改中文不会改写英文，
 * git 也不会提示"另一侧没跟"。已有的三个门禁只兜得住数字声明与链接（56 通道 / 60 参数 /
 * 版本号两树不等即 fail），兜不住"中文新加一节、英文整段没有"这种漏同步。
 * 本脚本按文件对做机械对账，把最常见的四类漏同步变成 fail：
 *   ① 配对缺失（只建了一侧）
 *   ② 语言行缺失或指错（英文读者进不来 / 中文读者切不过去）
 *   ③ 结构漂移（标题数、层级序列、`N.x` 编号、表格行数、代码围栏数、列表项数不等）
 *   ④ 版本串漂移（`x.y.z` 形态两树不等）
 *
 * **有意不做的检查**：整篇数字多重集比对。跨语言写数字的方式本就不同——中文「收尾二批」对应
 * 英文 "batch 2"、「退出码非 0」对应 "exits non-zero"、中文裸写 140 而英文写 140px——
 * 这类差异不是内容漂移，硬判 fail 只会逼人把门禁调松或绕过（本仓库对"只打印不拦"和
 * "静默空转"都记过账）。真正的实测数字改由三个**声明门禁**按语言句式精确兜：
 * `verify-ipc-sync`（通道数）、`verify-params-sync`（参数总数与分组数）、`verify-version-sync`（版本号），
 * 三者都已递归覆盖 docs/zh 与 docs/en。
 *
 * 明确不检查的：散文语义是否等价——机器判不了，靠 AGENTS.md「文档双语规则」的同步纪律。
 * 不比对的历史内容：docs/CHANGELOG.md、docs/archive/**、docs/badges/（见 AGENTS.md 不译清单）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ZH_DIR = path.join(ROOT, 'docs', 'zh');
const EN_DIR = path.join(ROOT, 'docs', 'en');

function listMd(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listMd(p, base));
    else if (e.name.endsWith('.md')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** 结构形状：用于两树对账的机械指标 */
function shape(text) {
  const headings = [...text.matchAll(/^(#+)\s+(.*)$/gm)];
  return {
    headingCount: headings.length,
    headingLevels: headings.map((h) => h[1].length).join(','),
    // 章节编号序列（`## 7.5 xxx` → `7.5`）；两树必须一致，跨文档「文档名 §N.x」引用才成立
    headingNumbers: headings
      .map((h) => (h[2].match(/^(\d+(?:\.\d+)*)\.?\s/) || [])[1] || '')
      .join('|'),
    tableRows: (text.match(/^\|/gm) || []).length,
    fences: (text.match(/^```/gm) || []).length,
    bullets: (text.match(/^- /gm) || []).length,
    numbered: (text.match(/^\d+\. /gm) || []).length,
  };
}

/** 版本串集合：x.y.z 形态在两树必须一致（实测数字本身由三个声明门禁分别兜） */
function versionTokens(text) {
  const map = new Map();
  for (const m of text.matchAll(/\d+\.\d+\.\d+/g)) map.set(m[0], (map.get(m[0]) || 0) + 1);
  return map;
}

function diffMultiset(a, b) {
  const only = [];
  for (const [k, v] of a) {
    const w = b.get(k) || 0;
    if (v > w) only.push(`${k}×${v - w}`);
  }
  return only;
}

const problems = [];
const zhFiles = fs.existsSync(ZH_DIR) ? listMd(ZH_DIR) : [];
const enFiles = fs.existsSync(EN_DIR) ? listMd(EN_DIR) : [];

if (!zhFiles.length || !enFiles.length) {
  console.error('[verify-doc-pairs] ❌ docs/zh 或 docs/en 不存在/为空，双树结构被破坏');
  process.exit(1);
}

// ① 配对存在性（双向）
for (const rel of zhFiles) {
  if (!enFiles.includes(rel)) problems.push(`docs/en/${rel} 缺失：中文侧有、英文侧无（两树必须同名成对）`);
}
for (const rel of enFiles) {
  if (!zhFiles.includes(rel)) problems.push(`docs/zh/${rel} 缺失：英文侧有、中文侧无（中文是权威版，不得只有英文）`);
}

// ②③④ 逐对对账
for (const rel of zhFiles) {
  if (!enFiles.includes(rel)) continue;
  const zhPath = path.join(ZH_DIR, rel);
  const enPath = path.join(EN_DIR, rel);
  const zh = fs.readFileSync(zhPath, 'utf8');
  const en = fs.readFileSync(enPath, 'utf8');

  // ② 语言行：必须在标题后前几行内，且指向对侧真实文件
  const head = (s) => s.split(/\r?\n/).slice(0, 8).join('\n');
  const zhLine = head(zh).match(/^>\s*语言：中文\s*·\s*\[English\]\(([^)]+)\)/m);
  const enLine = head(en).match(/^>\s*Language:\s*English\s*·\s*\[中文\]\(([^)]+)\)/m);
  if (!zhLine) problems.push(`docs/zh/${rel}: 缺语言行（「语言：中文 · [English](…)」，须在第 6 行内）`);
  else if (!fs.existsSync(path.resolve(path.dirname(zhPath), zhLine[1])))
    problems.push(`docs/zh/${rel}: 语言行指向不存在的文件 ${zhLine[1]}`);
  if (!enLine) problems.push(`docs/en/${rel}: 缺语言行（「Language: English · [中文](…)」，须在第 6 行内）`);
  else if (!fs.existsSync(path.resolve(path.dirname(enPath), enLine[1])))
    problems.push(`docs/en/${rel}: 语言行指向不存在的文件 ${enLine[1]}`);

  // ③ 结构形状
  const a = shape(zh);
  const b = shape(en);
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) problems.push(`docs/en/${rel}: ${key} 与中文侧不等（zh ${a[key]} / en ${b[key]}）`);
  }

  // ④ 版本串
  const na = versionTokens(zh);
  const nb = versionTokens(en);
  const missInEn = diffMultiset(na, nb);
  const missInZh = diffMultiset(nb, na);
  if (missInEn.length || missInZh.length) {
    problems.push(
      `docs/en/${rel}: 版本串与中文侧不等 —— 英文缺 [${missInEn.slice(0, 8).join(', ')}]，中文缺 [${missInZh.slice(0, 8).join(', ')}]`
    );
  }
}

if (problems.length) {
  console.error(`[verify-doc-pairs] ❌ 中英双树配对有 ${problems.length} 处出入：`);
  for (const p of problems) console.error('  - ' + p);
  console.error(
    '修复：先改 docs/zh/，再把 docs/en/ 同名文件同步到相同结构（标题数与 §N.x 编号、表格行数、围栏数、列表项数、版本串必须一致）；' +
      '参数对照表两侧都由 node scripts/generate-params-doc.cjs 生成，勿手改。' +
      '散文语义是否等价仍需人工核对（见 AGENTS.md「文档双语规则」）。'
  );
  process.exit(1);
}
console.log(`[verify-doc-pairs] ✅ ${zhFiles.length} 篇中英成对：语言行双向齐备，结构与版本串一致。`);
