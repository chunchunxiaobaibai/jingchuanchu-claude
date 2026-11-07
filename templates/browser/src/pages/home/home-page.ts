import { definePage } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore } from '../../game/session/game-store.js';

export const HomePage = definePage({
  selector: 'home-page',
  setup(context) {
    const store = context.useStore(GameStore);
    return {
      nickname: store.state.nickname,
      best: store.state.highScore,
    };
  },
});
