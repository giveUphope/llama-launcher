/**
 * 校验 Electron preload 的 IPC 常量与 shared 包保持一致（生成物未过期）。
 *
 * 过去 shared 与 preload 双写常量、此处事后比对；现在 preload 常量由
 * scripts/generate-preload.cjs 从 shared/src/types/ipc.ts 生成（唯一事实源），
 * 因此本脚本退化为两项结构性检查：
 *   1. 生成物 apps/desktop/src/preload/ipc-constants.cjs 未过期（与 ipc.ts 一致）；
 *   2. preload/index.cjs 确实 require 了生成物（防止有人把常量又内联回去）。
 * 在 pnpm lint 阶段运行。
 */
const fs = require('node:fs');
const path = require('node:path');

const preloadPath = path.resolve(__dirname, '../apps/desktop/src/preload/index.cjs');
const generatedPath = path.resolve(__dirname, '../apps/desktop/src/preload/ipc-constants.cjs');

// 复用生成器的 --check 模式（进程内执行，避免子进程）
const { execFileSync } = require('node:child_process');
try {
  execFileSync(process.execPath, [path.resolve(__dirname, 'generate-preload.cjs'), '--check'], {
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}

const preloadText = fs.readFileSync(preloadPath, 'utf8');
if (!preloadText.includes("require('./ipc-constants.cjs')")) {
  console.error('preload/index.cjs does not require ./ipc-constants.cjs — IPC constants must not be inlined back.');
  process.exit(1);
}

// 汇报通道数（从生成物读取）
const generated = fs.readFileSync(generatedPath, 'utf8');
const channelNames = [...generated.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
const count = channelNames.length;
console.log(`IPC constants in sync (${count} channels, generated from shared).`);

// 通道 → preload API 包装覆盖检查：每个通道常量必须在 preload/index.cjs 中被引用
// （invoke/on/removeListener 任一使用）。防止"通道与主进程处理器已加、但 API 包装方法漏写"
// 的漂移（实测 MODELS_REMOVE 曾漏绑，UI 调用 window.api.models.remove 运行时 TypeError）。
const missingRef = channelNames.filter((name) => !preloadText.includes(`IPC.${name}`));
if (missingRef.length) {
  console.error(`preload/index.cjs 缺少以下 IPC 通道的 API 包装引用: ${missingRef.join(', ')}`);
  console.error('请在 preload/index.cjs 的对应 API 分组中补充 invoke/on 包装。');
  process.exit(1);
}

/**
 * 文档里的「N 个通道 / N IPC 通道」裸数字必须等于实测通道数。
 * 这些数字此前无任何门禁，通道增删后会长期挂着错值（2026-09-21 硬编码审计补）。
 * 历史陈述不比对：docs/CHANGELOG.md 与 docs/archive/** 记的是当时的事实。
 */
const DOC_CHANNEL_RE = /(\d+)\s*个?\s*(?:IPC\s*)?通道/g;
function docFilesWithChannelClaims() {
  const docsDir = path.resolve(__dirname, '../docs');
  const files = ['AGENTS.md', 'README.md'];
  for (const e of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md') && e.name !== 'CHANGELOG.md') files.push(`docs/${e.name}`);
  }
  return files;
}

const claimDrift = [];
for (const rel of docFilesWithChannelClaims()) {
  const lines = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(DOC_CHANNEL_RE)) {
      if (Number(m[1]) !== count) {
        claimDrift.push(`  - ${rel}:${idx + 1} 声明 ${m[1]}，实际 ${count}：${line.trim().slice(0, 70)}`);
      }
    }
  });
}
if (claimDrift.length) {
  console.error(`[verify-ipc-sync] ❌ 文档通道数与实测(${count})不符：`);
  for (const e of claimDrift) console.error(e);
  console.error('修复：改文档数字，或确认通道数本身是否符合预期（改通道须走 shared/src/types/ipc.ts + pnpm generate:ipc）。');
  process.exit(1);
}
console.log(`[verify-ipc-sync] 文档通道数声明与实测一致（${count}）。`);

