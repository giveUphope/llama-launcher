#!/usr/bin/env node
/**
 * style-audit.cjs — UI 风格一致性审计脚本（一键复跑）
 *
 * 固化 docs/zh/style/STYLE_TODO.md「审计方法」的 10 条检查，输出 ✅/❌ 清单；
 * 有任何不一致项时以非零码退出（便于接入 CI / pre-commit）。
 *
 * 用法：node scripts/style-audit.cjs   （或 pnpm style:audit）
 *
 * 规范依据：docs/zh/frontend.md §7.5（设计 token / 行高 / 字重 / 间距刻度 / 动效）
 * 与规范不一致处 → 登记 STYLE_TODO「🔴 修复项」后修复。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// styles/ 是 token 本体层（第 1/2/3/9/10 条对它按定义放行，见 isTokenLayer），
// 但第 12 条「禁止覆写 Arco 内部态类」对它照常执行——theme.scss 里的状态栏钉色是
// STYLE_TODO #59 登记过的**有据例外**，走下面的 allowList 显式登记，不再是门禁盲区。
const SCAN_DIRS = [
  'packages/ui/src/components',
  'packages/ui/src/pages',
  'packages/ui/src/styles',
];
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

/** 读取文件为行数组
 *
 *  先把块注释（斜杠星到星斜杠之间）的正文抹成空格，保留行数与列位。不这么做时，块注释的
 *  **续行**不会被 isComment 认出来（它只看行首的 //、* 与 /*），于是注释里引用的短语
 *  ——实测：Sidebar.vue 的焦点说明写了 “box-shadow: none、outline-style: none”——
 *  会被当成代码命中第 6 条。尺子把喂给它的注释当成被测对象，报出来的就是假案。 */
function readLines(p) {
  const raw = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  let inBlock = false;
  return raw.map((ln) => {
    if (inBlock) {
      const end = ln.indexOf('*/');
      if (end < 0) return ' '.repeat(ln.length);
      inBlock = false;
      return ' '.repeat(end + 2) + ln.slice(end + 2);
    }
    const start = ln.indexOf('/*');
    if (start < 0) return ln;
    const close = ln.indexOf('*/', start + 2);
    if (close < 0) {
      inBlock = true;
      return ln.slice(0, start) + ' '.repeat(ln.length - start);
    }
    return ln.slice(0, start) + ' '.repeat(close + 2 - start) + ln.slice(close + 2);
  });
}

/** 是否注释行（scss/vue style 内以 // 或 * 开头） */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** 是否 token 本体层（styles/ 下的主题文件）：色板、字号、行高在此定义，不在此处禁止 */
function isTokenLayer(p) {
  return path.relative(path.join(ROOT, 'packages/ui/src'), p).split(path.sep)[0] === 'styles';
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (BTN_CLS.test(ln)) a5.add(f, i + 1, ln);
  });
}

// 6) 组件内裸 box-shadow / 遮罩（应 var(--shadow-*) / var(--overlay)）
const a6 = new Audit();
for (const f of files) {
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
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
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    for (const m of ln.matchAll(FW_RE)) {
      if (!ALLOW_FW.has(m[1])) a10.add(f, i + 1, ln);
    }
  });
}

// 11) 非 scoped 样式块：顶层选择器必须含至少一个组件私有类，禁止只由 Arco 全局类名构成
//     （作用域范式：ParamsPage .target-menu / GeneralPanel .exe-help-panel / DownloadCard .url-history-*，§7.5.6）
const a11 = new Audit();
const STATE_SUFFIX = ['-checked', '-active', '-selected', '-disabled', '-current', '-dragging', '-expanded'];
function classesOf(sel) {
  const out = [];
  for (let i = 0; i < sel.length; i++) {
    if (sel.charAt(i) !== '.') continue;
    let j = i + 1;
    let name = '';
    while (j < sel.length && /[A-Za-z0-9_-]/.test(sel.charAt(j))) { name += sel.charAt(j); j++; }
    if (name) out.push(name);
    i = j - 1;
  }
  return out;
}
for (const f of files) {
  let inNonScoped = false;
  readLines(f).forEach((ln, i) => {
    if (ln.indexOf('<style') >= 0) { inNonScoped = ln.indexOf('scoped') < 0; return; }
    if (ln.indexOf('</style>') >= 0) { inNonScoped = false; return; }
    if (!inNonScoped) return;
    const t = ln.trim();
    if (!t || isComment(ln) || t.charAt(0) === '@') return;
    if (t !== ln || t.charAt(t.length - 1) !== '{') return; // 仅顶层选择器（顶格且以 { 结尾）
    const cls = classesOf(t);
    if (cls.length === 0) return;
    if (!cls.some((c) => c.indexOf('arco-') !== 0)) a11.add(f, i + 1, ln);
  });
}

// 12) 禁止覆写 Arco 内部态类（.arco-*-checked/-active/-selected/-disabled 等，随版本升级易碎）
const a12 = new Audit();
for (const f of files) {
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    const hit = classesOf(ln).some(
      (c) => c.indexOf('arco-') === 0 && STATE_SUFFIX.some((s) => c.endsWith(s)),
    );
    if (hit) a12.add(f, i + 1, ln);
  });
}

// ---------- 13. a-progress 的 percent 必须是 0–1 比值 ----------
// Arco line.js 用 `width: percent * 100 %` 渲染，按百分数（0–100）传值会把进度条钉满，
// 表现为「下载进度条与实际进度完全不一致」（STYLE_TODO #71）。
const a13 = new Audit();
for (const f of files) {
  if (isTokenLayer(f)) continue; // token 本体层放行（色板/字号/行高/圆角正是在此定义）
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    const m = ln.match(/:percent\s*=\s*"([^"]*)"/);
    if (!m) return;
    const expr = m[1];
    if (/100/.test(expr) || /Pct\b/.test(expr)) a13.add(f, i + 1, ln);
  });
}

// ---------- 14. 动效声明必须走 --dur-* token ----------
// 第 8 条只在「transition 碰到布局属性」时才要求 var(--dur-*)，于是 opacity/color 的
// 字面时长一直无人守（实测漏出 Card.vue 的 0.15s 与 LogsPage 的 2s infinite）。
const a14 = new Audit();
const LITERAL_DUR = /\b(transition|animation)\b[^;]*?\b\d+(?:\.\d+)?m?s\b/;
for (const f of files) {
  if (isTokenLayer(f)) continue; // token 本体层放行 reset.scss 的 reduced-motion 兜底必须写字面值
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (!LITERAL_DUR.test(ln)) return;
    if (/var\(--dur/.test(ln)) return;
    a14.add(f, i + 1, ln);
  });
}

// ---------- 15. 层级必须走 --z-* token（0/1/auto 这类元素内相对层除外） ----------
const a15 = new Audit();
const ALLOW_Z = new Set(['0', '1', 'auto', '-1']);
for (const f of files) {
  if (isTokenLayer(f)) continue; // token 本体层定义层级刻度，不在此禁裸值
  readLines(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    const m = ln.match(/\bz-index\s*:\s*([^;]+)/);
    if (!m) return;
    const v = m[1].trim();
    if (ALLOW_Z.has(v) || /var\(--z-/.test(v)) return;
    a15.add(f, i + 1, ln);
  });
}

// ---------- 16. 键盘可达与命名（静态可判的三条） ----------
// 依据 2026-10-07 实测：Arco 2.58 的 a-menu-item 无 tabindex/role（40 次 Tab 零命中）、
// a-modal 无 aria-modal 与焦点管理、a-form-item 不写 label[for]，所以这三件事只能我方做，
// 也只能由门禁盯着——人工补一定漏。
const a16a = new Audit(); // 非 Arco 非原生交互元素上挂点击（绕过组件库的自绘控件）
const a16b = new Audit(); // 只有 #icon 插槽的 a-button 缺 aria-label
const a16c = new Audit(); // a-modal 缺 role="dialog" / aria-modal
const CLICK_RE = /@click|@dblclick|@keydown|@keyup|v-on:click/;
// 16a 的**有据例外**登记表：窗口铬的双击最大化是 Electron 无边框窗口协议（Arco 无对应物，
// 与 win-btn 同族豁免）。例外只在这里登记，多一处命中就必须显式改本清单——
// 「不报」和「为什么可以不报」必须是两件事。
const CLICK_ALLOW = [
  { file: 'packages/ui/src/components/layout/TopBar.vue', marker: '@dblclick', expect: 1 },
];
const clickSuppressed = new Map();
for (const f of files) {
  if (!f.endsWith('.vue')) continue;
  const relFile = path.relative(ROOT, f).split(path.sep).join('/');
  const lines = readLines(f);
  const text = lines.join('\n');
  const tpl = text.indexOf('<template>');
  if (tpl < 0) continue;
  const body = text.slice(tpl);
  const lineAt = (idx) => text.slice(0, tpl + idx).split('\n').length;
  // 16a 开始标签级：属性串允许跨行
  for (const m of body.matchAll(/<(div|span|p|li|td|tr|img|section|header|footer|article|nav|aside)\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/g)) {
    if (!CLICK_RE.test(m[2])) continue;
    const allow = CLICK_ALLOW.find((a) => a.file === relFile && m[2].includes(a.marker));
    if (allow) {
      clickSuppressed.set(allow, (clickSuppressed.get(allow) || 0) + 1);
      continue;
    }
    a16a.add(f, lineAt(m.index), `<${m[1]} ... ${(m[2].match(CLICK_RE) || [''])[0]}>`.trim());
  }
  // 16b 只有图标的按钮必须有可读名称（tooltip 不算名称：Arco 不把它写进无障碍名）
  for (const m of body.matchAll(/<a-button\b((?:[^>"']|"[^"]*"|'[^']*')*?)>([\s\S]*?)<\/a-button>/g)) {
    const attrs = m[1];
    const inner = m[2].replace(/<template\s+#icon\s*>[\s\S]*?<\/template>/g, '').trim();
    const named = /aria-label|:aria-label/.test(attrs);
    if (!/#icon/.test(attrs + m[2])) continue;
    if (inner.length > 0 || named) continue;
    a16b.add(f, lineAt(m.index), '<a-button> 仅 #icon 且无 aria-label');
  }
  // 16c 弹窗容器必须自带对话框语义（库不给）
  for (const m of body.matchAll(/<a-modal\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/g)) {
    const attrs = m[1];
    if (!/role="dialog"/.test(attrs) || !/aria-modal/.test(attrs)) {
      a16c.add(f, lineAt(m.index), '<a-modal> 缺 role="dialog" 或 aria-modal');
    }
  }
}
// 例外登记表要自证：登记数与实际命中数必须相等（登记表本身也会腐烂——
// 只写「允许」不核数量，代码变成两处命中时门禁照绿）
for (const a of CLICK_ALLOW) {
  const got = clickSuppressed.get(a) || 0;
  if (got !== a.expect) {
    a16a.add(path.join(ROOT, a.file), 0, `例外登记数不符：「${a.marker}」期望 ${a.expect} 处，实测 ${got} 处`);
  }
}

// ---------- 17. styles/ 层的 Arco 内部态类覆写必须逐条登记（第 12 条的补集） ----------
// 第 12 条不扫 token 本体层，于是 theme.scss 里那 5 行状态栏钉色成了「有据例外」而非盲区：
// 行数与文件都钉死在这里，多一行、少一行、换文件都要显式改本清单（STYLE_TODO #59 的成因）。
const ARCO_STATE_ALLOW = [
  { file: 'packages/ui/src/styles/theme.scss', marker: 'statusbar .arco-tag', expect: 5 },
  { file: 'packages/ui/src/styles/theme.scss', marker: 'arco-menu-selected', expect: 1 },
  // 预设色对的文字档：Arco 的规则是 .arco-tag.arco-tag-checked.arco-tag-<色>（三级类），
  // 不带 -checked 就压不过它——与上面状态栏钉色同一成因。
  { file: 'packages/ui/src/styles/theme.scss', marker: 'body .arco-tag.arco-tag-checked', expect: 2 },
];
const STATE_UNREG = [];
{
  const counted = new Map();
  for (const f of files) {
    if (!isTokenLayer(f)) continue;
    const relFile = path.relative(ROOT, f).split(path.sep).join('/');
    readLines(f).forEach((ln, i) => {
      if (isComment(ln)) return;
      const hit = (ln.match(/\.arco-[\w-]+/g) || []).some((c) =>
        /-(checked|active|selected|disabled|current|dragging|expanded)$/.test(c));
      if (!hit) return;
      const allow = ARCO_STATE_ALLOW.find((a) => a.file === relFile && ln.includes(a.marker));
      if (allow) {
        counted.set(allow, (counted.get(allow) || 0) + 1);
      } else {
        STATE_UNREG.push(`${relFile}:${i + 1}  ${ln.trim().slice(0, 70)}`);
      }
    });
  }
  for (const a of ARCO_STATE_ALLOW) {
    const got = counted.get(a) || 0;
    if (got !== a.expect) STATE_UNREG.push(`登记数不符：${a.file}「${a.marker}」期望 ${a.expect} 行，实测 ${got} 行`);
  }
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
  render('11. 非 scoped 样式块选择器含组件私有类（防 Arco 全局类名外泄）', a11.items),
  render('12. 不覆写 Arco 内部态类（.arco-*-checked/active/selected/disabled）', a12.items),
  render('13. a-progress :percent 传 0–1 比值（禁 ×100 / Pct 命名）', a13.items),
  render('14. 动效声明走 var(--dur-*)（字面时长/无限循环禁令）', a14.items),
  render('15. 层级走 var(--z-*)（0/1/auto 与元素内相对层除外）', a15.items),
  render('16a. 无自绘可点元素（点击只挂 Arco 组件）', a16a.items),
  render('16b. 仅图标的 a-button 必须有 aria-label', a16b.items),
  render('16c. a-modal 必须有 role="dialog" + aria-modal', a16c.items),
  render('17. token 层的 Arco 内部态类覆写逐条登记（含行数核对）', STATE_UNREG.map((t) => ({ file: '—', line: 0, text: t }))),
  `\n扫描 ${files.length} 个文件 · 规范依据 docs/zh/frontend.md §7.5`,
];

console.log(out.join('\n'));

const failed =
  [a1, a2, a3, a4, a5, a6, a8, a9, a10, a11, a12, a13, a14, a15, a16a, a16b, a16c]
    .some((a) => a.items.length > 0) || STATE_UNREG.length > 0;
process.exit(failed ? 1 : 0);