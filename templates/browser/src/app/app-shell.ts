import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppServicesDef } from './services.js';
import { GameStore } from '../game/session/game-store.js';
import { ProgressStore, SettingsStore } from '../game/session/save.js';

export const AppShell = defineComponent({
  selector: 'game-app',
  setup(context) {
    const store = context.useStore(GameStore);
    return {
      nickname: store.state.nickname,
      best: store.state.highScore,
    };
  },
  onMount(context) {
    const store = context.useStore(GameStore);
    const services = context.useService(AppServicesDef);
    let active = true;
    context.own(() => {
      active = false;
    });
    void ProgressStore.load().then((result) => {
      if (!active || result.status !== 'ok') return;
      store.actions.hydrate(result.data);
    });
    void SettingsStore.load().then((result) => {
      if (!active || result.status !== 'ok') return;
      services.audio.setVolume('master', result.data.volume);
      services.audio.setMuted(result.data.muted);
    });
  },
});
