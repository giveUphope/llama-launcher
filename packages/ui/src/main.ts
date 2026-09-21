import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@arco-design/web-vue/es/style/index.css';
import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import './styles/reset.scss';
import './styles/theme.scss';

const app = createApp(App);
app.use(createPinia());
app.use(router);

// 启动顺序：先注入 mock（仅预览）→ 加载设置并恢复上次页签（last_tab）→ 挂载应用。
const settings = useSettingsStore();
void (async () => {
  // 浏览器预览环境（无 Electron preload）：注入演示数据（demo-mock）呈现完整业务状态，
  // 供目测 UI 布局与交互；Electron/打包环境有真实 preload api，此分支不生效。
  // 必须动态 import：静态引入会把演示数据压进入口 chunk（实测入口 244 kB），
  // Electron 每次启动都白读白求值一份永不使用的代码。
  if (typeof window !== 'undefined' && !(window as any).api) {
    const { createDemoApi } = await import('./dev/demo-mock');
    (window as any).api = createDemoApi();
  }
  // 设置加载兜底超时：主进程 IPC 无应答时也必须让应用挂载（否则白屏无提示）
  const SETTINGS_LOAD_TIMEOUT_MS = 3000;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SETTINGS_LOAD_TIMEOUT_MS));
  try {
    await Promise.race([
      (async () => {
        await settings.load();
        const last = settings.settings?.last_tab;
        // URL 已带显式路由（#/logs、#/params?tab=custom）时不恢复 last_tab——否则深链打开的页面
        // 会被弹回上次页签（Electron 走 loadFile 无 hash，此判断不影响生产启动行为）
        const explicitRoute = /^#\/.+/.test(window.location.hash);
        if (!explicitRoute && last && last !== '/' && last !== router.currentRoute.value.fullPath) {
          await router.replace(last).catch(() => {});
        }
      })(),
      timeout,
    ]);
  } catch (e) {
    console.error('[boot] settings load failed:', e);
  }
  app.mount('#app');
})();
