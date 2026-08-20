// 把 packages/ui/dist/ 复制到 apps/desktop/dist/ui/
// electron-builder 的 files 配置不能引用项目根之外的路径，
// 因此打包前需将 UI 产物复制到 apps/desktop/dist/ui/ 下，
// 这样 app.asar 内会包含 dist/ui/index.html，window.ts 可通过
// join(__dirname, '..', 'ui', 'index.html') 加载。
const { cpSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const src = join(root, 'packages', 'ui', 'dist');
const dst = join(root, 'apps', 'desktop', 'dist', 'ui');

try {
  if (!existsSync(src)) {
    console.error('[copy-ui] UI dist not found:', src);
    console.error('[copy-ui] 请先执行 pnpm --filter @llama-launcher/ui build');
    process.exit(1);
  }
  // 清理旧的产物目录，避免残留旧文件
  if (existsSync(dst)) {
    rmSync(dst, { recursive: true, force: true });
  }
  mkdirSync(dst, { recursive: true });
  // 递归复制，保留目录结构
  cpSync(src, dst, { recursive: true });
  console.log('[copy-ui] OK:', dst);
} catch (e) {
  console.error('[copy-ui] Failed:', e);
  process.exit(1);
}
