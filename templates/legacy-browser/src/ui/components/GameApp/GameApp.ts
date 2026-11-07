import { defineView } from '@xiaobaibaifqy/jingchuanchu-app';
import type { AppState, AppCommands } from '../../../contracts/application.js';
import { GameControls } from '../GameControls/GameControls.js';

export const GameApp = defineView<AppState, AppCommands>({
  selector: 'game-app',
  components: [GameControls],
});
