#!/usr/bin/env node
/**
 * style-audit.cjs — UI 风格一致性审计脚本（一键复跑）
 *
 * 固化 docs/zh/style/STYLE_TODO.md「审计方法」的各条检查（条数以输出清单为准，避免声明与
 * 实现两处维护），输出 ✅/❌ 清单；有任何不一致项时以非零码退出（便于接入 CI / pre-commit）。
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

// 8) 动画只动 transform/opacity（禁布局属性过渡；实测当前零例外——侧边栏折叠与进度条
//    填充的宽度过渡都已收进 Arco 组件自己的动效，业务侧不再写布局属性 transition）
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

// ---------- 18. a-button 的配色只能由 type/status 决定（禁 scoped 覆写 color/background/border） ----------
// 成因（2026-10-07 实测）：Arco 的描边状态按钮 `.arco-btn-outline.arco-btn-status-danger` 把
// color 与 border-color 用**同一族变量**（基色 -6、hover -5、active -7），而组件 scoped 规则因带
// [data-v-] 属性特异度高于库的 0,3,0，覆写 color 会把文字**冻在基色**上——实测 hover 时描边
// rgb(161,21,30)、文字仍是 rgb(203,39,45)，两个方向分叉，状态反馈就此失真。
// 浅色达标不再靠改库的取值（那会连带重绘所有读这几档的组件，2026-10-07 按用户要求回退），
// 所以这里也没有「换档」的余地：命中要么删掉，要么带理由登记进 BTN_COLOR_ALLOW。
// 一行声明都不必多写；所以这里的命中要么删掉，要么带理由登记进 BTN_COLOR_ALLOW。
const BTN_COLOR_ALLOW = [
  { file: 'packages/ui/src/components/layout/TopBar.vue', marker: '.win-btn', expect: 2,
    why: '窗口铬：无边框窗口的贴边按钮取中性字色与 fill-3 悬停底（AGENTS.md 允许 win-btn 专属覆盖）' },
  { file: 'packages/ui/src/components/layout/TopBar.vue', marker: '.win-close', expect: 1,
    why: '窗口铬：关闭钮红色实底 + 白字是平台约定，Arco 无窗口控制组件' },
  { file: 'packages/ui/src/components/common/ConsolePanel.vue', marker: '.new-logs-bar', expect: 2,
    why: '恒深控制台底上的胶囊：Arco 色阶在深色主题会翻档，这里必须钉 --console-accent 字面三元组（§7.5.1）' },
  { file: 'packages/ui/src/components/layout/StatusBar.vue', marker: '.pill-copy', expect: 2,
    why: '状态栏铬：color 交回 inherit 以继承业务语义条的白字，否则 Arco 会涂强调蓝' },
  { file: 'packages/ui/src/components/settings/GeneralPanel.vue', marker: '.card-help-icon', expect: 1,
    why: '帮助图标是弱化辅助 affordance，取 text-3 而非强调色（同族图标色，不是状态色）' },
];
const CSS_COLOR_PROP = /^(color|background|background-color|border|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|border|box-shadow|fill)$/;

/** 模板里挂在 <a-button> 上的 class 集合（这些 class 的选择器若声明配色即命中本条） */
function buttonClasses(text) {
  const set = new Set();
  const start = text.indexOf('<template>');
  if (start < 0) return set;
  const tpl = text.slice(start);
  for (const m of tpl.matchAll(/<a-button\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/g)) {
    const cm = m[1].match(/\s(?:::?class|class)="([^"]*)"/);
    if (!cm) continue;
    for (const raw of cm[1].split(/[\s'`"{}[\]():,.]+/)) {
      if (/^[a-z][\w-]*$/i.test(raw)) set.add(raw);
    }
  }
  return set;
}

/** 把 style 块展平成 {selector, line, props:[配色属性]}，支持单行规则与 SCSS 嵌套。
 *  readLines 已抹掉块注释并把 CRLF 归一，这里只管结构与声明。 */
function colorRules(cssLines, baseLine) {
  const rules = [];
  const stack = []; // {sel, line, props}
  let pending = null; // 跨行声明累积
  for (let i = 0; i < cssLines.length; i++) {
    const ln = cssLines[i].replace(/\/\/.*$/, '');
    if (!ln.trim()) continue;
    const single = ln.match(/^\s*([^{};]+)\{([^{}]*)\}\s*$/);
    if (single) {
      const props = single[2].split(';').map((s) => s.match(/^\s*([a-z-]+)\s*:/)).filter(Boolean)
        .map((m) => m[1]).filter((p) => CSS_COLOR_PROP.test(p));
      if (props.length) rules.push({ selector: single[1].trim(), line: baseLine + i, props });
      continue;
    }
    if (/\{\s*$/.test(ln)) {
      stack.push({ sel: ln.replace(/\{[\s\S]*$/, '').trim(), line: baseLine + i, props: [] });
      continue;
    }
    if (/^\s*\}/.test(ln)) {
      const frame = stack.pop();
      if (frame && frame.props.length) {
        const sel = stack.map((s) => s.sel).concat(frame.sel).join(' ').replace(/&/g, '').replace(/\s+:/, ':').trim();
        rules.push({ selector: sel, line: frame.line, props: frame.props });
      }
      continue;
    }
    const dm = ln.match(/^\s*([a-z-]+)\s*:\s*(.*)$/);
    if (dm) {
      const top = stack[stack.length - 1];
      const done = /;\s*$/.test(ln);
      if (done && top && CSS_COLOR_PROP.test(dm[1])) top.props.push(dm[1]);
      pending = done ? null : { prop: dm[1] };
      continue;
    }
    if (pending && /;\s*$/.test(ln)) pending = null;
  }
  return rules;
}

const a18 = new Audit();
{
  const counted = new Map();
  for (const f of files) {
    if (!f.endsWith('.vue') && !f.endsWith('.scss')) continue;
    const relFile = path.relative(ROOT, f).split(path.sep).join('/');
    const lines = readLines(f);
    const text = lines.join('\n');
    const btnClasses = buttonClasses(text);
    // 逐个 style 块扫描（非 scoped 块同样要扫：弹层样式也挂在 a-button 上覆写配色）
    let cursor = 0;
    while (cursor < lines.length) {
      const openIdx = lines.findIndex((ln, i) => i >= cursor && /^\s*<style\b/.test(ln));
      if (openIdx < 0) break;
      let closeIdx = openIdx + 1;
      while (closeIdx < lines.length && !/^\s*<\/style>/.test(lines[closeIdx])) closeIdx++;
      for (const r of colorRules(lines.slice(openIdx + 1, closeIdx), openIdx + 1)) {
        const hitsBtn = /\.arco-btn[\w-]*/.test(r.selector) ||
          [...btnClasses].some((c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r.selector));
        if (!hitsBtn) continue;
        const allow = BTN_COLOR_ALLOW.find((a) => a.file === relFile && r.selector.includes(a.marker));
        if (allow) {
          counted.set(allow, (counted.get(allow) || 0) + 1);
          continue;
        }
        a18.add(f, r.line, `${r.selector} { ${r.props.join('; ')} }`);
      }
      cursor = closeIdx + 1;
    }
  }
  // 登记表自证：登记数与实际命中数必须相等（同 16a / 17 的纪律）
  for (const a of BTN_COLOR_ALLOW) {
    const got = counted.get(a) || 0;
    if (got !== a.expect) {
      a18.add(path.join(ROOT, a.file), 0, `例外登记数不符：「${a.marker}」期望 ${a.expect} 处，实测 ${got} 处（理由：${a.why}）`);
    }
  }
}

// ---------- 19. 浅色不得换 Arco 的状态色阶（body 块内禁赋值） ----------
// 成因（2026-10-07 实测）：Arco 的状态色是间接层（--danger-6: var(--red-6)），组件读的就是
// -6 槽。在 body 上换档会连带重绘 alert / 表单校验 / tag / badge / progress / switch 等一切
// 读它的组件（浅色 125 个元素受影响），而深色下 Arco 的 body[arco-theme='dark']（0,1,1）
// 特异度更高、我们的 body（0,0,1）根本压不住它——于是变成「浅色被改、深色是原档」的不对称。
// 深色允许（用户明确「还可以接受」），所以判据只看**顶层选择器恰为 body** 的那一层。
const LIGHT_STATE_RE = /^\s*(--(?:danger|warning|success|red|orange|green|gold|lime|cyan|blue|purple|pinkPurple|magenta)\s*-\d+)\s*:\s*\d/;
const a19 = new Audit();
{
  for (const f of files) {
    if (!isTokenLayer(f)) continue;
    const relFile = path.relative(ROOT, f).split(path.sep).join('/');
    let topSelector = '';
    let depth = 0;
    readLines(f).forEach((ln, i) => {
      if (isComment(ln)) return;
      const opens = (ln.match(/\{/g) || []).length;
      const closes = (ln.match(/\}/g) || []).length;
      if (depth === 0 && opens) topSelector = ln.replace(/\{[\s\S]*$/, '').trim();
      const m = ln.match(LIGHT_STATE_RE);
      if (m && topSelector === 'body') {
        a19.add(f, i + 1, `${relFile} 的 body（浅色）块里给状态色阶赋值：${m[1]} —— 会连带重绘所有读该档的 Arco 组件，深色下又因特异度不生效`);
      }
      depth += opens - closes;
      if (depth < 0) depth = 0;
    });
  }
}

// ---------- 20. 给 Arco 内部节点写配色必须逐条登记（按钮侧归第 18 条） ----------
// 第 18 条管住了按钮，但「改 Arco 组件的颜色」还有另一条路：直接选中库的内部节点
// （`.arco-tag` / `.arco-table-th` / `.arco-descriptions-item-label` …）写 color / background。
// 这类声明每一条都是「我们比库更懂这个节点该什么颜色」，所以要么用库的 prop / 变量表达，
// 要么在这里带理由登记。判据与 17/18 同构：marker + expect 条数，多一条少一条都红。
const ARCO_TEXT_TAGS = ['a-tag', 'a-doption', 'a-textarea', 'a-input', 'a-input-number', 'a-radio',
  'a-radio-group', 'a-select', 'a-pagination', 'a-statistic', 'a-descriptions', 'a-typography',
  'a-menu-item', 'a-table', 'a-list', 'a-dropdown', 'a-typography-text', 'a-typography-title'];
const ARCO_COLOR_ALLOW = [
  { file: 'packages/ui/src/components/common/DownloadCard.vue', marker: '.dl-pager', expect: 1,
    why: '分页取次级字色：库的 simple 分页容器继承 text-1，比同行说明文字重一档' },
  { file: 'packages/ui/src/components/common/DownloadCard.vue', marker: '.rec-badge', expect: 1,
    why: '推荐徽标是实底强调芯片（白字压 primary-6），a-tag 的 color 预设里没有「实底蓝 + 白字」这一档' },
  { file: 'packages/ui/src/components/common/DownloadCard.vue', marker: '.source-badge', expect: 1,
    why: '来源族中性化（§7.5.7：来源不占色相），库预设没有中性灰实底档' },
  { file: 'packages/ui/src/components/common/DownloadCard.vue', marker: 'url-history', expect: 2,
    why: 'URL 历史下拉的分组标题与条目图标取次级/装饰档，库对 dropdown 分组不提供层级 prop' },
  { file: 'packages/ui/src/components/layout/Sidebar.vue', marker: '.arco-menu-item:focus-visible', expect: 1,
    why: '库的 a-menu-item 无 tabindex、不自带焦点环，键盘可见性只能我方补（#84）' },
  { file: 'packages/ui/src/components/layout/StatusBar.vue', marker: '.arco-typography', expect: 1,
    why: '状态栏是恒定品牌蓝铬面，库的 typography 取 text-1（浅色为深字）压蓝底只有 3.58，这里交回 inherit' },
  // （TopBar .dd-manage 斜体灰登记已随 #108 删除：管理模型动作项回归普通 option 形态，
  //   与同面板模型条目及全站下拉一致——「层级区分」由分隔线承担，不再用异形文字）
  { file: 'packages/ui/src/components/layout/TopBar.vue', marker: '.dd-item.active', expect: 1,
    why: '标记「当前已加载的模型」——库的下拉没有「当前项」状态（selected 只在多选模式出现）' },
  { file: 'packages/ui/src/components/models/LocalModelsPanel.vue', marker: 'row-selected', expect: 2,
    why: '选中行底色 --row-selected-bg 是业务语义（当前模型所在行），库的 hover/斑马纹不是这个意思' },
  { file: 'packages/ui/src/components/models/LocalModelsPanel.vue', marker: '.arco-table-th', expect: 1,
    why: '表头取 text-2 次级档：库的 th 是 gray-10（比正文更重），与本页「数据为主、表头为辅」的层级相反' },
  { file: 'packages/ui/src/components/service/CommandPreviewCard.vue', marker: '.cmd-preview', expect: 4,
    why: '命令预览是恒定深底控制台面（§7.5.2 业务例外），库的 textarea 表面/文字/占位/聚焦都按主题取档，必须钉住' },
  { file: 'packages/ui/src/components/service/ServiceStatusCard.vue', marker: '.status-desc', expect: 1,
    why: 'descriptions 标签库内取 text-3（实测压卡片底 3.24 不达标），提到 text-2 达标' },
  { file: 'packages/ui/src/components/settings/AboutPanel.vue', marker: '.about-desc', expect: 1,
    why: '同上：descriptions 标签从 text-3 提到角色档 --fg-hint 才达 4.5' },
  { file: 'packages/ui/src/components/settings/AppearancePanel.vue', marker: '.theme-radio-on', expect: 1,
    why: '选中主题的字色：库给 checked 单选按钮铺 primary-1 底 + primary-6 字，深色下 4.2 不达标；换 --primary-6 会连带改圆点填充，故只改文字' },
  // （ParamsPage 的 .stat / .subcat-changed 两条登记已随 #105 范式纯化删除：
  //   统计值色覆写与 tag 文字角色色移除，回归官方预设对——「跟随库官方观感」豁免延伸）
  { file: 'packages/ui/src/pages/ParamsPage.vue', marker: '.target-item.active', expect: 1,
    why: '性能目标当前项的强调字色，库的 option 无「当前项」状态' },
];
const a20 = new Audit();
{
  const counted = new Map();
  for (const f of files) {
    const relFile = path.relative(ROOT, f).split(path.sep).join('/');
    if (isTokenLayer(f)) continue; // token 本体层由第 17 条按行登记
    const lines = readLines(f);
    const text = lines.join('\n');
    const btnClasses = buttonClasses(text);
    const compClasses = new Set();
    const tplText = text.indexOf('<template>') >= 0 ? text.slice(text.indexOf('<template>')) : '';
    for (const m of tplText.matchAll(/<(a-[a-z-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g)) {
      if (!ARCO_TEXT_TAGS.includes(m[1])) continue;
      const cm = m[2].match(/\s(?:::?class|class)="([^"]*)"/);
      if (!cm) continue;
      for (const raw of cm[1].split(/[\s'`"{}[\]():,.]+/)) if (/^[a-z][\w-]*$/i.test(raw)) compClasses.add(raw);
    }
    let cursor = 0;
    while (cursor < lines.length) {
      const openIdx = lines.findIndex((ln, i) => i >= cursor && /^\s*<style\b/.test(ln));
      if (openIdx < 0) break;
      let closeIdx = openIdx + 1;
      while (closeIdx < lines.length && !/^\s*<\/style>/.test(lines[closeIdx])) closeIdx++;
      for (const r of colorRules(lines.slice(openIdx + 1, closeIdx), openIdx + 1)) {
        const isButtonSide = /\.arco-btn[\w-]*/.test(r.selector) ||
          [...btnClasses].some((c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r.selector));
        if (isButtonSide) continue; // 第 18 条已管
        const hitsArco = /\.arco-[a-z-]+/.test(r.selector) ||
          [...compClasses].some((c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r.selector));
        if (!hitsArco) continue;
        const allow = ARCO_COLOR_ALLOW.find((a) => a.file === relFile && r.selector.includes(a.marker));
        if (allow) counted.set(allow, (counted.get(allow) || 0) + 1);
        else a20.add(f, r.line, `${r.selector} { ${r.props.join('; ')} }`);
      }
      cursor = closeIdx + 1;
    }
  }
  for (const a of ARCO_COLOR_ALLOW) {
    const got = counted.get(a) || 0;
    if (got !== a.expect) {
      a20.add(path.join(ROOT, a.file), 0, `例外登记数不符：「${a.marker}」期望 ${a.expect} 处，实测 ${got} 处（理由：${a.why}）`);
    }
  }
}

// ---------- 21. 图标语义表必须一对一且有读者（Icon.vue 自己写的规则，交给门禁守） ----------
// 成因（2026-10-07 用户批注）：`folder` 与 `folder_open` 都映射到 Arco 的 IconFolder，
// 于是文件浏览器的「上一级」和「打开目录」长得一模一样——语义名骗人，字形没有区分它。
// 同一条路上还有零读者的名字（clock 被 bench 取代后仍留着，连带一个进包的字形）。
// 两条判据都不该靠人记：① 一个字形只准挂一个语义名；② 每个语义名必须在 ui/src 里有读者。
const a21 = new Audit();
{
  const iconFile = path.join(ROOT, 'packages/ui/src/components/common/icon-map.ts');
  if (!fs.existsSync(iconFile)) {
    a21.add(path.join(ROOT, 'scripts/style-audit.cjs'), 0, '读不到 icon-map.ts：本条会空转，必须先修脚本');
  } else {
    const src = fs.readFileSync(iconFile, 'utf8');
    // 一行里常写好几条映射，不能用 ^\s* 锚定；先把对象字面量切出来再全局匹配
    const body = src.slice(src.indexOf('export const icons'), src.indexOf('} as const'));
    const entries = [...body.matchAll(/([a-z_]+):\s*(Icon[A-Za-z]+),/g)].map((m) => ({ name: m[1], glyph: m[2] }));
    if (entries.length < 20) {
      a21.add(iconFile, 0, `只解析到 ${entries.length} 条映射（实际约 40 条）：解析器与文件形状脱节，本条判据不可信`);
    }
    // 读者扫描的作用域必须是整个 ui/src（含 features/ 的导航表、composables/ 等），
    // 不能复用本脚本的 SCAN_DIRS——那三个目录不含 features/，会把 dashboard 误判成零读者。
    const readers = [];
    (function walkUi(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walkUi(p);
        else if (/\.(vue|ts)$/.test(ent.name) && p !== iconFile) readers.push(p);
      }
    })(path.join(ROOT, 'packages/ui/src'));
    const others = readers.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const byGlyph = new Map();
    for (const e of entries) byGlyph.set(e.glyph, [...(byGlyph.get(e.glyph) || []), e.name]);
    for (const [glyph, names] of byGlyph) {
      if (names.length > 1) {
        a21.add(iconFile, 0, `一个字形挂了 ${names.length} 个语义名：${glyph} = ${names.join(' + ')}（同形即同义，用户看不出差别）`);
      }
    }
    for (const e of entries) {
      if (!others.includes(`'${e.name}'`) && !others.includes(`"${e.name}"`)) {
        a21.add(iconFile, 0, `语义名「${e.name}」零读者：ui/src 里没有任何调用点，名字与 ${e.glyph} 的 import 都应删除`);
      }
    }
  }
}

// ---------- 22. 控制台 token 家族必须有定义且有读者（var(--x) 无定义会静默回退继承色） ----------
// 实案（2026-10-07）：1e73a17 把 theme.scss 里四个 --log-kind-* 字面量定义当属性覆写误删，
// 消费端（ConsolePanel / DashboardPage / LogsPage）全数回退 console-fg——级别着色静默失效，
// 而既有各条测的都是「颜色写对没有」，测不到「token 还在不在」。本条对控制台专属家族
// （--log-kind-* / --console-*，非 Arco 词汇表）做双向核对：消费必有定义、定义必有读者。
const a22 = new Audit();
{
  const defRe = /--((?:log-kind|console)-[a-z0-9-]+)\s*:/;
  const useRe = /var\(\s*--((?:log-kind|console)-[a-z0-9-]+)/;
  const defs = new Map();
  const used = new Map();
  for (const f of files) {
    const lines = readLines(f);
    for (const [i, ln] of lines.entries()) {
      const def = !isComment(ln) && ln.match(defRe);
      if (def && isTokenLayer(f)) defs.set(def[1], f);
      const use = !isComment(ln) && ln.match(useRe);
      if (use && !used.has(use[1])) used.set(use[1], { file: f, line: i + 1 });
    }
  }
  // 自证解析规模：家族当前 7 条定义（log-kind 4 + console 3），解析到更少说明尺子或文件变形
  if (defs.size < 6) {
    a22.add(path.join(ROOT, 'scripts/style-audit.cjs'), 0, `styles/ 只解析到 ${defs.size} 条控制台家族定义（实际 7 条）：解析器与文件形状脱节，本条判据不可信`);
  }
  for (const [name, at] of used) {
    if (!defs.has(name)) {
      a22.add(at.file, at.line, `var(--${name}) 有消费无定义：颜色会静默回退继承色（1e73a17 着色失效的实案形态）`);
    }
  }
  for (const name of defs.keys()) {
    if (!used.has(name)) {
      a22.add(path.join(ROOT, 'packages/ui/src/styles'), 0, `--${name} 有定义零读者：token 与其注释应一并删除`);
    }
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
  render('18. a-button 配色不覆写（type/status + 色阶变量，例外带理由登记）', a18.items),
  render('19. 浅色（body 块）不换 Arco 状态色阶，避免连带重绘组件', a19.items),
  render('20. 给 Arco 内部节点写配色必须逐条登记（按钮侧归第 18 条）', a20.items),
  render('21. 图标语义表一对一且有读者（icon-map.ts）', a21.items),
  render('22. 控制台 token 家族（--log-kind-* / --console-*）有定义且有读者', a22.items),
  `\n扫描 ${files.length} 个文件 · 规范依据 docs/zh/frontend.md §7.5`,
];

console.log(out.join('\n'));

const failed =
  [a1, a2, a3, a4, a5, a6, a8, a9, a10, a11, a12, a13, a14, a15, a16a, a16b, a16c, a18, a19, a20, a21, a22]
    .some((a) => a.items.length > 0) || STATE_UNREG.length > 0;
process.exit(failed ? 1 : 0);