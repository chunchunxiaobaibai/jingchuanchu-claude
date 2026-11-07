import { defineRoutes } from '@xiaobaibaifqy/jingchuanchu-app/application';

export const routes = defineRoutes(
  [
    {
      name: 'home',
      path: '/',
      loadPage: () => import('../pages/home/home-page.js').then((module) => module.HomePage),
    },
    {
      name: 'levels',
      path: '/levels',
      loadPage: () => import('../pages/levels/levels-page.js').then((module) => module.LevelsPage),
    },
    {
      name: 'play',
      path: '/play/:levelId',
      loadPage: () => import('../pages/play/play-page.js').then((module) => module.PlayPage),
      prepare: ({ params }) => ({ levelId: params.levelId }),
    },
    {
      name: 'settings',
      path: '/settings',
      loadPage: () =>
        import('../pages/settings/settings-page.js').then((module) => module.SettingsPage),
    },
    {
      name: 'result',
      path: '/result',
      loadPage: () => import('../pages/result/result-page.js').then((module) => module.ResultPage),
    },
  ],
  { fallback: '/' },
);
