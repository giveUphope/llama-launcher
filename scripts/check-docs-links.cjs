/**
 * docs 引用完整性检查（常规维护，已接入 pnpm lint）：
 * - 扫描 docs/**\/*.md 与仓库根 AGENTS.md / README.md 的 markdown 相对链接
 * - 校验目标文件存在 + GitHub 风格锚点（#section）存在
 * - 发现断链/失效锚点时退出码 1（lint 拦截），修复后重跑归零
 *
 * 用法：node scripts/check-docs-links.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const EXTRA_FILES = ['AGENTS.md', 'README.md'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));

/** 递归收集 md 文件 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** GitHub 风格锚点 slug：小写、去标点、空格转连字符（保留 CJK/字母/数字/_/-） */
function slugify(h) {
  return h.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/ +/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 文件全部标题的 slug 集合 */
function headings(file) {
  const set = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) set.add(slugify(m[1]));
  }
  return set;
}

function main() {
  const files = [...walk(DOCS), ...EXTRA_FILES];
  const problems = [];
  let total = 0;

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const re = /\[[^\]]*\]\(([^)]+)\)/g;
    lines.forEach((line, i) => {
      let m;
      while ((m = re.exec(line)) !== null) {
        total++;
        let target = m[1].trim().replace(/\s+"[^"]*"$/, ''); // 去掉链接标题 "title"
        if (/^(https?:|mailto:)/i.test(target)) continue;
        const fileSlugs = headings(file);
        if (target.startsWith('#')) {
          // 纯锚点：当前文件内
          const anchor = slugify(decodeURIComponent(target.slice(1)));
          if (anchor && !fileSlugs.has(anchor)) {
            problems.push(`${path.relative(ROOT, file)}:${i + 1} 锚点不存在: ${target}`);
          }
          continue;
        }
        const [p, anchor] = target.split('#');
        const resolved = path.resolve(path.dirname(file), decodeURIComponent(p));
        if (!fs.existsSync(resolved)) {
          problems.push(`${path.relative(ROOT, file)}:${i + 1} 目标不存在: ${target}`);
          continue;
        }
        if (anchor && fs.statSync(resolved).isFile()) {
          const slug = slugify(decodeURIComponent(anchor));
          if (!headings(resolved).has(slug)) {
            problems.push(`${path.relative(ROOT, file)}:${i + 1} 锚点不存在: ${target}`);
          }
        }
      }
    });
  }

  console.log(`[check-docs-links] 检查 ${files.length} 个 md 文件，共 ${total} 个相对链接`);
  if (problems.length) {
    console.error(`[check-docs-links] ❌ ${problems.length} 个断链/失效锚点:`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('[check-docs-links] ✅ 全部链接与锚点有效');
}

main();
