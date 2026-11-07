import { definePage } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppServicesDef } from '../../app/services.js';
import { GameStore } from '../../game/session/game-store.js';
import { ProgressStore, SettingsStore } from '../../game/session/save.js';

export const SettingsPage = definePage({
  selector: 'settings-page',
  setup(context) {
    const store = context.useStore(GameStore);
    const services = context.useService(AppServicesDef);
    const nickname = context.signal(store.state.nickname());
    const volume = context.signal(services.audio.volumes.master);
    const muted = context.signal(services.audio.muted);
    const status = context.signal('');
    let active = true;
    context.own(() => {
      active = false;
    });
    void SettingsStore.load().then((result) => {
      if (!active || result.status !== 'ok') return;
      nickname.set(result.data.nickname);
      volume.set(result.data.volume);
      muted.set(result.data.muted);
      services.audio.setVolume('master', result.data.volume);
      services.audio.setMuted(result.data.muted);
    });

    const save = async (): Promise<void> => {
      store.actions.setNickname(nickname());
      const next = store.state.nickname();
      nickname.set(next);
      services.audio.setVolume('master', volume());
      services.audio.setMuted(muted());
      const result = await SettingsStore.save({
        nickname: next,
        volume: volume(),
        muted: muted(),
      });
      status.set(result.status === 'saved' ? '已保存' : `保存失败（${result.status}）`);
      void services.audio.playEffect('click');
    };
    const resetProgress = async (): Promise<void> => {
      store.actions.resetProgress();
      const result = await ProgressStore.save({
        nickname: store.state.nickname(),
        highScore: store.state.highScore(),
        unlocked: store.state.unlocked(),
        completed: store.state.completed(),
      });
      status.set(result.status === 'saved' ? '进度已清除' : `清除失败（${result.status}）`);
    };
    return {
      nickname,
      volume,
      muted,
      status,
      best: store.state.highScore,
      save,
      resetProgress,
    };
  },
});
