#!/usr/bin/env node
// i18n 键使用一致性检查：防止「字典删键、代码留引用」导致界面渲染出原始 key
// （历史事故：b8c1d59 移除 msg_autoscroll_* 后，Arco 迁移拉取又把引用带回，
// 控制台直接显示 "msg_autoscroll_on"）。
//
// 检查六件事：
//  1. 悬空引用：源码中字面量 t('key') / i18n.t('key') 的键必须同时存在于
//     zh.ts 与 en.ts（动态拼接 t('x' + v) 由检查 6 覆盖；模板字符串不检查——无法静态判定）。
//  2. 中英键集差异：zh 与 en 的键集合必须完全一致。
//  3. 裸 CJK 字面量：注释之外出现中文串字面量即视为绕开 i18n（硬编码文案）。
//     纯开发日志等确不进界面的串，在该行加 `// i18n-ignore` 显式豁免——
//     豁免必须写在现场，避免「以后谁都能再加一条」。
//     此检查是 2026-09-21 硬编码审计后补的：此前 core/主进程把中文字面量拼好后
//     经 IPC 直出（target-recommend 的理由、探测错误），英文界面显示中文而门禁全绿。
//  4. 手工插值：`.replace('{0}', x)` 与 t(key, args) 并行的第二套填参机制（只填首个
//     占位符、槽序易错），出现即 fail。
//  5. 实参匹配：t('key', [..]) 的实参个数须等于该键 zh/en 文案里的占位符槽数
//     （少一个渲染出裸 {1}，多一个是白传；两语言槽数不一致也会在这里暴露）。
//     间接引用键（labelKey / reasonKey 等 xxxKey 字段）同样校验双字典存在。
//  6. 动态拼接键族：`t('dl_err_' + 变量)` 这类键名由代码拼出来，检查 1 看不见。
//     改为按枚举成员逐个校验双语键存在（缺键与字典孤儿都 fail）；
//     新增同类前缀往 DYNAMIC_KEY_FAMILIES 表里加一行即可。
//
// 用法：node scripts/verify-i18n-usage.cjs（已接入 pnpm lint）
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'packages', 'shared', 'src', 'i18n');
const SCAN_DIRS = [
  path.join(ROOT, 'packages', 'ui', 'src'),
  path.join(ROOT, 'packages', 'core', 'src'),
  path.join(ROOT, 'packages', 'shared', 'src'),
  path.join(ROOT, 'apps', 'desktop', 'src'),
];

/** 递归收集 .vue / .ts 文件（跳过 node_modules、dist、测试文件与 dev 演示数据）。 */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else if (/\.(vue|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** 该文件是否属于「中文即内容」的白名单：i18n 字典本体 + 浏览器预览演示数据 + 引擎缺省基线表。 */
function skippedForLiteralScan(absFile) {
  const rel = path.relative(ROOT, absFile).replace(/\\/g, '/');
  // engine-baseline.ts 的 note 字段是给开发者读的「为什么这个参数的界面初值故意不等于引擎默认」
  // 说明（与 definitions.ts 的中文注释同性质），永不进界面；改成英文反而与全仓中文注释放逐相悖。
  if (rel === 'packages/shared/src/params/engine-baseline.ts') return true;
  return rel.startsWith('packages/shared/src/i18n/') || rel.endsWith('packages/ui/src/dev/demo-mock.ts');
}

/** 解析扁平 i18n 字典（两空格缩进的 `key:` 行）的键集合。 */
function dictKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/^ {2}([a-z0-9_]+)\s*:/gm)) keys.add(m[1]);
  return keys;
}

const CJK_RE = /[㐀-䶿一-鿿]/;

/**
 * 找出注释之外的中文串字面量（检查 3）。
 * 逐字符走状态机：// 行注释、块注释、Vue 模板的 <!-- --> 均跳过；
 * 模板串（反引号）可跨行，普通引号串不跨行（遇换行即复位，避免一处失配级联误判）。
 */
function findCjkLiterals(src) {
  const hits = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === '<' && src.startsWith('<!--', i)) {
      i += 4;
      while (i < n && !src.startsWith('-->', i)) { if (src[i] === '\n') line++; i++; }
      i += 3;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      let body = '';
      while (j < n) {
        const d = src[j];
        if (d === '\\') { body += src[j + 1] === 'n' ? ' ' : src[j + 1]; j += 2; continue; }
        if (d === quote) break;
        if (d === '\n') {
          line++;
          if (quote !== '`') break;
          j++;
          continue;
        }
        body += d;
        j++;
      }
      if (CJK_RE.test(body)) hits.push({ line, text: body.replace(/\s+/g, ' ').trim().slice(0, 50) });
      i = j + 1;
      continue;
    }
    i++;
  }
  return hits;
}

/**
 * 字典键 → 该键值里出现的占位符槽号集合。
 * 扁平字典按「两空格缩进的 key:」切块，块内所有 `{N}` 归该键（值可能是跨行字符串，
 * 用边界扫描而非单行正则才不会漏掉续行里的占位符）。
 */
function dictSlots(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const map = new Map();
  let cur = null;
  for (const line of lines) {
    const keyHit = /^ {2}([a-z0-9_]+)\s*:/.exec(line);
    if (keyHit) cur = keyHit[1];
    if (!cur) continue;
    const set = map.get(cur) ?? new Set();
    for (const m of line.matchAll(/\{(\d+)\}/g)) set.add(Number(m[1]));
    map.set(cur, set);
  }
  return map;
}

/** 顶层逗号切分实参（跳过嵌套括号与字符串），用于数出 t(key, [..]) 的实参个数 */
function countArrayArgs(src, openBracketIdx) {
  let depth = 0;
  let i = openBracketIdx + 1;
  let cur = '';
  const parts = [];
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { cur += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === q) { cur += src[i]; i++; break; }
        cur += src[i];
        i++;
      }
      continue;
    }
    if (c === '[' || c === '(' || c === '{') { depth++; i++; continue; }
    if (c === ']' || c === ')' || c === '}') {
      if (c === ']' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); return parts.length; }
      depth--; i++; continue;
    }
    if (c === ',' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c;
    i++;
  }
  return null; // 未闭合，跳过（不猜测）
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

  // 2b) 间接引用键：`xxxKey: 'yyy'`（camelCase 后缀 Key，如 reasonKey / labelKey）
  //     这类键由渲染端 t(key) 消费，字面量不含 t() 因而逃过检查 2（2026-09-21 引入
  //     TargetRecommendation.reasonKey 时补）。参数表的 `key:` 全小写，不在此列；
  //     EXCLUDED 里是「同后缀但是标识符」的字段（v-for key 等），误报时在此登记。
  const RE_KEY_FIELD = /([A-Za-z][A-Za-z0-9]*Key)\s*:\s*['"]([a-z0-9_]+)['"]/g;
  const EXCLUDED_KEY_FIELDS = new Set(['groupKey']);
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      src.split(/\r?\n/).forEach((line, idx) => {
        for (const m of line.matchAll(RE_KEY_FIELD)) {
          if (EXCLUDED_KEY_FIELDS.has(m[1])) continue;
          const key = m[2];
          if (!zh.has(key) || !en.has(key)) {
            errors.push(`悬空引用(${m[1]}): ${key}  ${rel}:${idx + 1}`);
          }
        }
      });
    }
  }

  // 3) 裸 CJK 字面量（注释外、未被 `// i18n-ignore` 豁免）
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      if (skippedForLiteralScan(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split(/\r?\n/);
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      for (const h of findCjkLiterals(src)) {
        if (lines[h.line - 1]?.includes('i18n-ignore')) continue;
        errors.push(`硬编码文案: ${rel}:${h.line}  「${h.text}」`);
      }
    }
  }

  // 4) 手工插值 `.replace('{0}', x)`：与 t(key, args) 并行的第二套填参机制，
  //    只能填首个占位符且槽序易错（2026-09-21 一次性收敛 48 处后立此门禁）。
  const RE_MANUAL_ARG = /\.replace\(\s*['"]\{\d+\}['"]\s*,/g;
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      if (skippedForLiteralScan(file)) continue;
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, idx) => {
        if (RE_MANUAL_ARG.test(line)) {
          errors.push(`手工插值: ${rel}:${idx + 1} 改用 t(key, [..]) —— ${line.trim().slice(0, 60)}`);
        }
        RE_MANUAL_ARG.lastIndex = 0;
      });
    }
  }

  // 5) 实参数与占位符数匹配：t('key', [a, b]) 的实参个数须等于键值里的占位符槽数。
  //    少一个就渲染出裸 {1}（t() 只替换存在的槽），多一个是白传；zh/en 槽数不一致也在此暴露。
  const zhSlots = dictSlots(path.join(I18N_DIR, 'zh.ts'));
  const enSlots = dictSlots(path.join(I18N_DIR, 'en.ts'));
  const RE_T_WITH_ARGS = /\bt\(\s*'([a-z0-9_]+)'\s*,\s*\[/g;
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      if (skippedForLiteralScan(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      let m;
      RE_T_WITH_ARGS.lastIndex = 0;
      while ((m = RE_T_WITH_ARGS.exec(src))) {
        const bracket = src.indexOf('[', m.index + m[0].length - 1);
        const n = countArrayArgs(src, bracket);
        if (n === null) continue;
        const line = src.slice(0, m.index).split(/\r?\n/).length;
        for (const [lang, map] of [['zh', zhSlots], ['en', enSlots]]) {
          const slots = map.get(m[1]);
          if (!slots || slots.size === 0) {
            if (n > 0) errors.push(`多余实参: ${rel}:${line} t('${m[1]}', [${n} 个]) 而 ${lang} 文案无占位符`);
            continue;
          }
          const need = Math.max(...slots) + 1;
          if (need !== n) errors.push(`实参不符: ${rel}:${line} t('${m[1]}', [${n} 个]) 而 ${lang} 需要 ${need} 个（槽 ${[...slots].sort().join(',')}）`);
        }
      }
    }
  }

  // 6) 动态拼接键族：源码写成 t('前缀' + 变量)，检查 2 的「字面量 t('k')」看不见，
  //    键名改名/新增成员不会有任何报警。改为按枚举成员逐个校验双语键存在，
  //    并反查字典里该前缀下的孤儿键。新增同类前缀只需往表里加一行。
  const DYNAMIC_KEY_FAMILIES = [
    { prefix: 'dl_err_', typeFile: 'packages/shared/src/types/download.ts', typeName: 'DownloadErrorType', listName: 'DOWNLOAD_ERROR_TYPES' },
  ];
  for (const fam of DYNAMIC_KEY_FAMILIES) {
    const src = fs.readFileSync(path.join(ROOT, fam.typeFile), 'utf8');
    // 优先读运行时数组（唯一列表）；数组写法不存在时回退解析联合类型的成员行
    let members = [];
    const decl = fam.listName ? src.indexOf(`export const ${fam.listName}`) : -1;
    if (decl >= 0) {
      const body = src.slice(decl, src.indexOf('] as const', decl));
      members = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    }
    if (members.length === 0) {
      const tDecl = src.indexOf(`export type ${fam.typeName}`);
      if (tDecl < 0) { errors.push(`动态键族解析失败: ${fam.typeFile} 找不到 ${fam.listName ?? fam.typeName}`); continue; }
      const block = src.slice(tDecl, src.indexOf(';', tDecl));
      members = [...block.matchAll(/^[ |\t]*'([a-z0-9_]+)'/gm)].map((m) => m[1]);
    }
    if (members.length === 0) {
      errors.push(`动态键族解析失败: ${fam.typeName} 未解析出任何成员（类型写法变了？规则需同步）`);
      continue;
    }
    for (const m of members) {
      const key = fam.prefix + m;
      if (!zh.has(key) || !en.has(key)) errors.push(`动态键缺失: ${key}（${fam.typeName} 成员 '${m}'）`);
    }
    for (const k of zh) {
      if (k.startsWith(fam.prefix) && !members.includes(k.slice(fam.prefix.length))) {
        errors.push(`动态键孤儿: zh.ts 的 ${k} 无对应 ${fam.typeName} 成员`);
      }
    }
    for (const k of en) {
      if (k.startsWith(fam.prefix) && !members.includes(k.slice(fam.prefix.length))) {
        errors.push(`动态键孤儿: en.ts 的 ${k} 无对应 ${fam.typeName} 成员`);
      }
    }
  }

  if (errors.length) {
    console.error(`[verify-i18n-usage] ❌ 发现 ${errors.length} 个问题：`);
    for (const e of errors) console.error('  - ' + e);
    console.error('修复：文案进 packages/shared/src/i18n/{zh,en}.ts 并用 t(key, args) 取用；');
    console.error('     确不进界面的（开发日志等）在该行加 `// i18n-ignore` 注明豁免理由。');
    process.exit(1);
  }
  console.log(
    `[verify-i18n-usage] ✅ zh/en 各 ${zh.size} 键一致，无悬空引用，注释外无未豁免中文串字面量，无手工插值且实参数与占位符匹配。`,
  );
}

main();
