import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

// UI 包测试配置：与 vite.config.ts 保持一致的路由别名（@ → src、shared → 源码目录）。
// 默认 node 环境跑 store/composable 纯逻辑；.vue 组件渲染类测试用 @vitest-environment happy-dom
// （vitest 4 的 configLoader native 下不可用 __dirname，用 import.meta.dirname）。
const here = import.meta.dirname;

export default defineConfig({
  plugins: [vue()], // 允许对 .vue 组件做 SFC 转换（组件渲染测试需要）
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
