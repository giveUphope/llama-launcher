import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

// 注意：不要用 __dirname——vite 8 的 configLoader 将默认 native（原生 ESM 执行 config），
// CJS 全局 __dirname 在 ESM 语境下不存在；import.meta.dirname 需 Node 20.11+（项目要求 20.19+/22.12+）。
const here = import.meta.dirname;

// 把 Vite 实际监听的端口写到 packages/ui/.vite-dev-port，
// 供 Electron 主进程（dev:vite / turbo dev）读取，避免端口被占用后
// 前端顺延到别的端口、而 Electron 仍连 5173 导致白屏/连不上。
function writeDevPortPlugin() {
  return {
    name: 'write-dev-port',
    configureServer(server: any) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 5173;
        writeFileSync(resolve(here, '.vite-dev-port'), String(port));
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), writeDevPortPlugin()],
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
      '@llama-launcher/shared': resolve(here, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    // 显式绑定 IPv4 回环：默认 host=localhost 在 Node 20/Windows 会被解析成 ::1（IPv6-only 监听）。
    // HTTP 走浏览器的 localhost 双栈回退能打开页面，但 HMR 的 WebSocket 连 IPv4 失败 → 表现为
    // 「能打开内容但永远不热重载」。固定 127.0.0.1 后 HTTP + HMR WS 同栈监听，双端连通。
    host: '127.0.0.1',
    // 不强制占用固定端口：端口被占用（如其他项目占用 5173）时自动顺延到下一个可用端口，
    // 实际端口通过 .vite-dev-port 文件传给 Electron，整条链路跟随。
    strictPort: false,
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
  },
});
