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
  },
});
