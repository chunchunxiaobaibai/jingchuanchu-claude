import { mountApplication } from '@xiaobaibaifqy/jingchuanchu-app/application';
import './styles/base.less';
import { app } from './app/app-config.js';
import { AppServicesDef } from './app/services.js';

const host = document.querySelector('game-app');
if (!host) throw new Error('Missing <game-app> host');

const instance = await mountApplication(host, app);
const services = instance.owner.useService(AppServicesDef);
instance.owner.own(services.theme.applyTokens(document.documentElement));

const onVisibility = (): void => {
  if (document.hidden) services.audio.pauseMusic();
  else services.audio.resumeMusic();
};
document.addEventListener('visibilitychange', onVisibility);
instance.owner.own(() => document.removeEventListener('visibilitychange', onVisibility));
