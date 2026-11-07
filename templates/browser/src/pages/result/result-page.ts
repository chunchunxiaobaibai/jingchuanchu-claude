import { RouterService, definePage } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore } from '../../game/session/game-store.js';
import { findLevel } from '../../game/session/levels.js';

export const ResultPage = definePage({
  selector: 'result-page',
  setup(context) {
    const store = context.useStore(GameStore);
    const router = context.useService(RouterService);
    const levelId = store.state.lastLevel();
    const level = findLevel(levelId);
    return {
      score: store.state.lastScore,
      best: store.state.highScore,
      levelTitle: level?.title ?? '未知关卡',
      retry: () => void router.push({ name: 'play', params: { levelId } }),
      levels: () => void router.push({ name: 'levels' }),
      home: () => void router.push({ name: 'home' }),
    };
  },
});
