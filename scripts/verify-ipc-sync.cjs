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

