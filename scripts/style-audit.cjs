#!/usr/bin/env node
/**
 * style-audit.cjs — UI 风格一致性审计脚本（一键复跑）
 *
 * 固化 docs/style/STYLE_TODO.md「审计方法」的 10 条检查，输出 ✅/❌ 清单；
 * 有任何不一致项时以非零码退出（便于接入 CI / pre-commit）。
 *
 * 用法：node scripts/style-audit.cjs   （或 pnpm style:audit）
 *
 * 规范依据：docs/frontend.md §7.5（设计 token / 行高 / 字重 / 间距刻度 / 动效）
 * 与规范不一致处 → 登记 STYLE_TODO「🔴 修复项」后修复。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['packages/ui/src/components', 'packages/ui/src/pages'];
const GLOB = /\.(vue|scss)$/;

// ---------- 工具 ----------
/** 递归收集扫描目录内全部 .vue/.scss 文件（绝对路径） */
function collectFiles() {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (GLOB.test(ent.name)) files.push(p);
    }
  };
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return files.sort();
}

/** 读取文件为行数组 */
function readLines(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/);
}

/** 是否注释行（scss/vue style 内以 // 或 * 开头） */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** 收集扫描结果 */
class Audit {
  constructor() {
    this.items = []; // {file, line, text}
  }
  add(file, line, text) {
    this.items.push({ file: path.relative(ROOT, file), line, text: text.trim() });
  }
}

function render(name, items, allowListed = []) {
  const real = items.filter(
    (x) => !allowListed.some((a) => x.text.includes(a)),
  );
  if (real.length === 0) return `✅ ${name}`;
  const shown = real.slice(0, 5)
    .map((x) => `   ❌ ${x.file}:${x.line}  ${x.text}`)
    .join('\n');
  const more = real.length > 5 ? `\n   … 共 ${real.length} 处（files 已全量输出）` : '';
  return `❌ ${name}（${real.length} 处）\n${shown}${more}`;
}

// ---------- 各条检查 ----------
const files = collectFiles();

// 1) 组件内硬编码颜色（token 禁令；#fff/#1a1a1a 仅允许彩色按钮文字色）
const a1 = new Audit();
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;
const ALLOW_COLOR = new Set(['#fff', '#ffffff', '#1a1a1a']);
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    for (const m of ln.matchAll(COLOR_RE)) {
      if (!ALLOW_COLOR.has(m[0].toLowerCase())) a1.add(f, i + 1, ln);
    }
  });
}

// 2) 组件内裸字号（应走 var(--fs-*)）
const a2 = new Audit();
const FONT_SIZE_RE = /font-size\s*:\s*(?!var\()\s*\d/;
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (FONT_SIZE_RE.test(ln)) a2.add(f, i + 1, ln);
  });
}

// 3) 圆角体系（对照 §7.5.3；仅 2px 滑块轨道 / 50% 圆形 / 0 允许裸数值）
const a3 = new Audit();
const RADIUS_RE = /border-radius\s*:\s*([^;]*)/;
const ALLOW_RADIUS = new Set(['2px', '50%', '0']);
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    const m = ln.match(RADIUS_RE);
    if (!m || /var\(/.test(m[1])) return;
    m[1].split(/\s+/).filter(Boolean).forEach((v) => {
      if (!ALLOW_RADIUS.has(v)) a3.add(f, i + 1, ln);
    });
  });
}

// 4) 间距刻度（对照 §7.5.4：gap 只取 4/5/6/8/10/12/14，0 允许）
const a4 = new Audit();
const GAP_RE = /(?:column-gap|row-gap|gap)\s*:\s*(?!var\()([0-9.]+)px/g;
const ALLOW_GAP = new Set(['0', '4', '5', '6', '8', '10', '12', '14']);
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    for (const m of ln.matchAll(GAP_RE)) {
      if (!ALLOW_GAP.has(m[1])) a4.add(f, i + 1, ln);
    }
  });
}

// 5) 按钮类 scoped 重复定义（全局收敛的三类在 styles/buttons.scss，组件内禁止再次 .xxx {；
//    modal-btn / dl-btn / fb-btn / win-btn 为组件内专属类，允许 scoped，见 frontend.md §7.5.5。
//    ctrl-btn（图标工具按钮）已随「按钮文本内联」统一移除（2026-08-29））
const a5 = new Audit();
const BTN_CLS = /\.(action-btn|mini-btn|tab-btn)\s*\{/;
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (BTN_CLS.test(ln)) a5.add(f, i + 1, ln);
  });
}

// 6) 组件内裸 box-shadow / 遮罩（应 var(--shadow-*) / var(--overlay)）
const a6 = new Audit();
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (/box-shadow\s*:\s*(?!var\(|none)/.test(ln) || /rgba\(\s*0,\s*0,\s*0\s*,\s*0\.[0-9]/.test(ln)) {
      if (!/var\(--/.test(ln)) a6.add(f, i + 1, ln);
    }
  });
}

// 7) backdrop-filter 预算（报告使用点清单，佩戴人工复核行号）
const a7 = new Audit();
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (/backdrop-filter\s*:/.test(ln)) a7.add(f, i + 1, ln);
  });
}

// 8) 动画只动 transform/opacity（禁布局动画；宽/度等布局属性必须带 var(--dur-*)）
//    允许例外：侧边栏折叠宽度与进度条填充宽度（均 var(--dur-med) var(--ease-jelly)）
const a8 = new Audit();
const LAYOUT_PROPS = /width|height|margin|padding|top:|left:|right:|bottom:/;
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (!/transition\s*:/.test(ln)) return;
    if (!LAYOUT_PROPS.test(ln)) return;
    if (!/var\(--dur/.test(ln)) a8.add(f, i + 1, ln);
  });
}

// 9) 行高语义化（只允许 1 / 1.3 / 1.4 / 1.5 / 1.55 / 1.6，见 §7.5.1 文字系统）
//    仅精确校验数值成员；var()/normal 等非数值写法视为合规、不拦截
const a9 = new Audit();
const LH_VAL = /line-height\s*:\s*([0-9.]+)/g;
const ALLOW_LH = new Set(['1', '1.3', '1.4', '1.5', '1.55', '1.6', 'normal']);
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    for (const m of ln.matchAll(LH_VAL)) {
      if (!ALLOW_LH.has(m[1])) a9.add(f, i + 1, ln);
    }
  });
}

// 10) 字重（只允许 400 / 600 / 700；normal=400 / bold=700 等价）
const a10 = new Audit();
const FW_RE = /font-weight\s*:\s*([0-9]{3}|normal|bold)/g;
const ALLOW_FW = new Set(['400', '600', '700', 'normal', 'bold']);
for (const f of files) {
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    for (const m of ln.matchAll(FW_RE)) {
      if (!ALLOW_FW.has(m[1])) a10.add(f, i + 1, ln);
    }
  });
}

// ---------- 输出 ----------
const out = [
  render('1. 组件内裸颜色（token 禁令）', a1.items),
  render('2. 组件内裸字号（应走 --fs-*）', a2.items),
  render('3. 圆角走 token（2px / 50% / 0 例外）', a3.items),
  render('4. 间距刻度（gap ∈ 4/5/6/8/10/12/14）', a4.items),
  render('5. 按钮类无 scoped 重复定义（全局 buttons.scss）', a5.items),
  render('6. 阴影/遮罩走 --shadow-* / --overlay', a6.items),
  `7. backdrop-filter 使用点清单（对照 §7.5.6：应为 glass-layer / 弹窗背板；下拉/菜单已实底，见 STYLE_TODO #41）${a7.items.length ? '' : ' ✅ 无'}` +
    (a7.items.length ? '\n' + a7.items.map((x) => `   · ${x.file}:${x.line}`).join('\n') : ''),
  render('8. 动画只动 transform/opacity（布局属性走 var(--dur-*)）', a8.items),
  render('9. 行高语义化（1/1.3/1.4/1.5/1.55/1.6）', a9.items),
  render('10. 字重只取 400/600/700', a10.items),
  `\n扫描 ${files.length} 个文件 · 规范依据 docs/frontend.md §7.5`,
];

console.log(out.join('\n'));

const failed =
  [a1, a2, a3, a4, a5, a6, a8, a9, a10].some((a) => a.items.length > 0);
process.exit(failed ? 1 : 0);