import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// electron 在 core 测试环境中不可用，使用 mocks/electron.mjs 占位实现
const electronMock = fileURLToPath(new URL('./tests/mocks/electron.mjs', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      electron: electronMock,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 多个用例（process-registry / process-terminate / e2e-cleanup / dev-session）会 spawn 真实
    // 子进程（Windows 用 ping）并同步终止：terminate() 的优雅阶段（taskkill 不带 /F）对无窗口的
    // 控制台进程无效，必然空等满 800ms 优雅超时再走强制 taskkill /F /T + 轮询，单进程约 1.2~1.9s、
    // 多进程用例累计可超过 vitest 默认 5s 而误报超时。统一放宽测试/钩子超时作为慢速 Windows 的兜底
    // 余量；Linux/CI 走 SIGKILL 进程组信号远快于此，不受影响。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
