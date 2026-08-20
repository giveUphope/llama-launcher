import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './styles/reset.scss';
import './styles/variables.scss';
import './styles/theme.scss';
import './styles/surface.scss';

// 浏览器预览环境容错:无 Electron preload 时 mock window.api,
// 使所有组件能安全挂载(事件订阅返回 no-op,IPC 调用返回 null Promise)
if (typeof window !== 'undefined' && !(window as any).api) {
  const handler: ProxyHandler<any> = {
    get() {
      return new Proxy(function noop() {}, handler);
    },
    apply(_t, _thisArg, args) {
      // onXxx(cb) 模式 → 返回取消订阅函数
      if (typeof args[0] === 'function') return () => {};
      // 普通 IPC 调用 → 返回已 resolve 的 Promise
      return Promise.resolve(null);
    },
  };
  (window as any).api = new Proxy(function noop() {}, handler);
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
