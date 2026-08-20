// 生成 preload IPC 常量（事实源 shared/src/types/ipc.ts），
// 然后把 src/preload/ 下的 index.cjs 与 ipc-constants.cjs 复制到 dist/preload/。
// preload 是 CommonJS 文件，不参与 tsc 编译，需手动复制到产物目录。
const { copyFileSync, mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
require('./generate-preload.cjs'); // 幂等：重新生成 ipc-constants.cjs

const srcDir = join(root, 'apps', 'desktop', 'src', 'preload');
const dstDir = join(root, 'apps', 'desktop', 'dist', 'preload');
const files = ['index.cjs', 'ipc-constants.cjs'];

/** 内容相同则跳过写入（幂等）。dev-watch 监视 dist/，无条件重写会自我触发重启循环。 */
function copyIfChanged(src, dst) {
  const srcBuf = readFileSync(src);
  let same = false;
  try {
    same = readFileSync(dst).equals(srcBuf);
  } catch { /* 目标不存在时必然复制 */ }
  if (same) {
    console.log('[copy-preload] up to date:', dst);
    return;
  }
  copyFileSync(src, dst);
  console.log('[copy-preload] OK:', dst);
}

try {
  mkdirSync(dstDir, { recursive: true });
  for (const f of files) {
    copyIfChanged(join(srcDir, f), join(dstDir, f));
  }
} catch (e) {
  console.error('[copy-preload] Failed:', e);
  process.exit(1);
}
