import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// UI 包测试配置：与 vite.config.ts 保持一致的路由别名（@ → src、shared → 源码目录）。
// 仅测试 store 等纯逻辑（node 环境），不加载 Vue 组件（组件测试需另行配置）。
// 与 vite.config.ts 一致：不用 __dirname（vitest 4 的 configLoader native 下不可用）。
const here = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
      '@llama-launcher/shared': resolve(here, '../shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Windows 退出竞态兜底，见 vitest.global-setup.mjs 头注释
    globalSetup: ['./vitest.global-setup.mjs'],
  },
});
