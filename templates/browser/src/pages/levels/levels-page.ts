import { computed, definePage } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { GameStore } from '../../game/session/game-store.js';
import { LEVELS } from '../../game/session/levels.js';

export const LevelsPage = definePage({
  selector: 'levels-page',
  setup(context) {
    const store = context.useStore(GameStore);
    const levels = computed(() =>
      LEVELS.map((level) => ({
        id: level.id,
        title: level.title,
        target: level.coinCount,
        unlocked: store.state.unlocked().includes(level.id),
      })),
    );
    return { levels };
  },
});
