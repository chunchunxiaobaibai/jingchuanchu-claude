import { defineScene } from '@xiaobaibaifqy/jingchuanchu-app';
import type { AppState, AppCommands, AppInput } from '../../contracts/application.js';
import { createGameScene } from './createGameScene.js';

export const PlayScene = defineScene<AppState, AppCommands, AppInput>({
  setup(context) {
    const game = createGameScene(() => context.input);
    game.scene.setup(context);
    context.commands.handle('moveTo', (point) => game.dispatch({ type: 'move-to', ...point }));
  },
});
