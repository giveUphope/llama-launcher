import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.css';
import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import { createDemoApi } from './dev/demo-mock';
import './styles/reset.scss';
import './styles/theme.scss';

// 浏览器预览环境（无 Electron preload）：注入演示数据（demo-mock），
// 呈现完整业务状态供目测 UI 布局与交互；Electron/打包环境有真实 preload api，此分支不生效。
if (typeof window !== 'undefined' && !(window as any).api) {
  (window as any).api = createDemoApi();
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ArcoVue, {
  size: 'medium',
});

// 启动顺序：先加载设置并恢复上次页签（last_tab），再挂载应用。
const settings = useSettingsStore();
void (async () => {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  try {
    await Promise.race([
      (async () => {
        await settings.load();
        const last = settings.settings?.last_tab;
        if (last && last !== '/' && last !== router.currentRoute.value.fullPath) {
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
