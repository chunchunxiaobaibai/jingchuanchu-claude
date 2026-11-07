import { defineApplication } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppShell } from './app-shell.js';
import { routes } from './app-routes.js';
import { AppServicesDef } from './services.js';

export const app = defineApplication({
  root: AppShell,
  routes,
  providers: [{ service: AppServicesDef }],
  onError(error) {
    console.error(error);
  },
});
