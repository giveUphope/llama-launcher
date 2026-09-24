/**
 * docs 引用完整性检查（常规维护，已接入 pnpm lint）：
 * - 扫描 docs/**\/*.md 与仓库根 AGENTS.md / README.md / README.en.md 的 markdown 相对链接
 * - 校验目标文件存在 + GitHub 风格锚点（#section）存在
 * - 另校验「以纯文本写死的 docs/**.md 路径」是否真实存在：markdown 链接解析器看不见
 *   行内代码、目录树代码块和 CI 注释里的路径，2026-09-24 文档分双树后就是这样漏了
 *   15 处（19 个路径串，已用修复前的 HEAD 机械重算）——`docs/params/LLAMA_SERVER_PARAMS.md`
 *   这类路径当场已不存在，`pnpm lint` 却全绿
 * - 历史陈述按文件跳过：docs/CHANGELOG.md 与 docs/archive/** 描述的是当时的路径形状，
 *   改写等于篡改历史（与 verify-ipc-sync / verify-params-sync 的跳过规则同口径）
 * - 发现断链/失效锚点/死路径时退出码 1（lint 拦截），修复后重跑归零
 *
 * 用法：node scripts/check-docs-links.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const EXTRA_FILES = ['AGENTS.md', 'README.md', 'README.en.md'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
// CI 注释里也写死过 docs 路径（`见 docs/ci-cd.md §2.3`），同样纳入文本路径检查
const CI_DIR = path.join(ROOT, '.github', 'workflows');
const CI_FILES = fs.existsSync(CI_DIR)
  ? fs.readdirSync(CI_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).map((f) => path.join(CI_DIR, f))
  : [];

/** 文本路径检查的豁免文件：历史陈述，不是现行引用 */
function isHistorical(rel) {
  return rel === 'docs/CHANGELOG.md' || rel.startsWith('docs/archive/');
}

/** 形如 docs/zh/packaging.md 的仓库根相对路径。只认 .md：
 *  本次要防的死引用（双树搬家后残留的 8 处）全是 .md，而 `docs/params/llama-server-help-*.txt`
 *  是 re-pin 流程里命令**要生成的临时产物**（见 params-system.md §5.5 步骤 1），按 .txt 一起判会
 *  误伤 4 行、逼人绕开门禁；基线 help 文件名真正的守护是 verify-params-sync.cjs 里的硬编码路径。
 *  字符集刻意不含 {} 与 *，因此 `docs/{zh,en}/...`、`docs/zh/*` 这类示意写法自动跳过。 */
const TEXT_PATH_RE = /docs\/[A-Za-z0-9_.\-/]*\.md/g;

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
  const files = [...walk(DOCS), ...EXTRA_FILES, ...CI_FILES];
  const problems = [];
  let total = 0;
  let textTotal = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
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
            problems.push(`${rel}:${i + 1} 锚点不存在: ${target}`);
          }
          continue;
        }
        const [p, anchor] = target.split('#');
        const resolved = path.resolve(path.dirname(file), decodeURIComponent(p));
        if (!fs.existsSync(resolved)) {
          problems.push(`${rel}:${i + 1} 目标不存在: ${target}`);
          continue;
        }
        if (anchor && fs.statSync(resolved).isFile()) {
          const slug = slugify(decodeURIComponent(anchor));
          if (!headings(resolved).has(slug)) {
            problems.push(`${rel}:${i + 1} 锚点不存在: ${target}`);
          }
        }
      }
      if (isHistorical(rel)) return;
      TEXT_PATH_RE.lastIndex = 0;
      let t;
      while ((t = TEXT_PATH_RE.exec(line)) !== null) {
        textTotal++;
        if (!fs.existsSync(path.join(ROOT, t[0]))) {
          problems.push(`${rel}:${i + 1} 正文写死的 docs 路径不存在: ${t[0]}`);
        }
      }
    });
  }

  console.log(`[check-docs-links] 检查 ${files.length} 个文件，共 ${total} 个相对链接 + ${textTotal} 处写死的 docs 路径`);
  if (problems.length) {
    console.error(`[check-docs-links] ❌ ${problems.length} 个断链/失效锚点/死路径:`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('[check-docs-links] ✅ 全部链接、锚点与写死的 docs 路径有效');
}

main();
