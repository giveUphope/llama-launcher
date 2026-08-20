import { createRouter, createWebHashHistory } from 'vue-router';
import { featureRoutes } from '@/features';

const router = createRouter({
  history: createWebHashHistory(),
  routes: featureRoutes,
});

export { router };
