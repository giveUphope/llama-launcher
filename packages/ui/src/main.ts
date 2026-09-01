import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import { createDemoApi } from './dev/demo-mock';
import './styles/reset.scss';
import './styles/variables.scss';
import './styles/theme.scss';
import './styles/buttons.scss';
import './styles/surface.scss';

// 浏览器预览环境（无 Electron preload）：注入演示数据（demo-mock），
// 呈现完整业务状态供目测 UI 布局与交互；Electron/打包环境有真实 preload api，此分支不生效。
if (typeof window !== 'undefined' && !(window as any).api) {
  (window as any).api = createDemoApi();
}

const app = createApp(App);
app.use(createPinia());
app.use(router);

// 启动顺序：先加载设置并恢复上次页签（last_tab），再挂载应用——
// 首帧即为目标页签，启动期不存在第二次导航，从根上消除「恢复页签的重定向
// 打断首屏进入」的竞态（该竞态曾表现为路由已切换而视图停留在旧页）。
// 3s 超时兜底：设置加载异常时按当前 URL 直接进入。
const settings = useSettingsStore();
void (async () => {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  try {
    await Promise.race([
      (async () => {
        await settings.load();
        const last = settings.settings?.last_tab;
        if (last && last !== '/' && last !== router.currentRoute.value.fullPath) {
          // 旧版本残留的无效路径（如已删除页面）：replace 失败则停留在当前 URL
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
