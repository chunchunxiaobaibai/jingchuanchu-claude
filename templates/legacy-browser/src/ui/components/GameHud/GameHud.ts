import html from './GameHud.html?raw';
import styles from './GameHud.module.css';
import type { GameCommand, GameSnapshot } from '../../../contracts/game.js';
import { createTemplate, element } from '../../template.js';

export function createGameHud(dispatch: (command: GameCommand) => void) {
  const root = createTemplate(html, styles.root!);
  const pause = element(root, '[data-ref="pause"]', HTMLButtonElement);
  const status = element(root, '[data-ref="status"]', HTMLElement);
  const onPause = (): void => dispatch({ type: 'toggle-pause' });
  pause.addEventListener('click', onPause);
  return {
    root,
    render(snapshot: GameSnapshot): void {
      const label = snapshot.status === 'paused' ? '继续' : '暂停';
      const message =
        snapshot.error ??
        (snapshot.status === 'running'
          ? '运行中'
          : snapshot.status === 'paused'
            ? '已暂停'
            : '已停止');
      if (pause.textContent !== label) pause.textContent = label;
      if (status.textContent !== message) status.textContent = message;
      pause.disabled = snapshot.error !== null || !['running', 'paused'].includes(snapshot.status);
    },
    dispose(): void {
      pause.removeEventListener('click', onPause);
      root.remove();
    },
  };
}
