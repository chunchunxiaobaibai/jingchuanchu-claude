import html from './GameView.html?raw';
import styles from './GameView.module.css';
import type { GameCommand } from '../../../contracts/game.js';
import { createGameHud } from '../GameHud/GameHud.js';
import { createTemplate, element } from '../../template.js';

export function createGameView(host: HTMLElement, dispatch: (command: GameCommand) => void) {
  const root = createTemplate(html, styles.root!);
  const hud = createGameHud(dispatch);
  element(root, '[data-ref="hud"]', HTMLElement).append(hud.root);
  host.append(root);
  return {
    canvas: element(root, '[data-ref="canvas"]', HTMLCanvasElement),
    render: hud.render,
    dispose(): void {
      hud.dispose();
      root.remove();
    },
  };
}
