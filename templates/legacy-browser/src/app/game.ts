import { defineGame, defineInput } from '@xiaobaibaifqy/jingchuanchu-app';
import { canvas2DModule } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/module';
import type { AppState, AppCommands, AppInput } from '../contracts/application.js';
import { PlayScene } from '../game/scenes/PlayScene.js';

export const gameDefinition = defineGame<AppState, AppCommands, AppInput>({
  state: () => ({ status: 'stopped', error: null }),
  scenes: [PlayScene],
  initialScene: PlayScene,
  input: defineInput<AppInput, AppCommands>({
    initial: () => ({ x: 0, y: 0 }),
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    read: (keyboard) => ({
      x:
        Number(keyboard.isDown('ArrowRight') || keyboard.isDown('KeyD')) -
        Number(keyboard.isDown('ArrowLeft') || keyboard.isDown('KeyA')),
      y:
        Number(keyboard.isDown('ArrowDown') || keyboard.isDown('KeyS')) -
        Number(keyboard.isDown('ArrowUp') || keyboard.isDown('KeyW')),
    }),
    setup(context) {
      const canvas = context.host.querySelector('canvas');
      if (!canvas) throw new Error('Missing game canvas');
      const down = (event: PointerEvent): void => {
        if (!context.enabled() || event.button !== 0) return;
        canvas.focus();
        const rect = canvas.getBoundingClientRect();
        context.commands.send('moveTo', {
          x: Math.max(0, Math.min(960, ((event.clientX - rect.left) * 960) / rect.width)),
          y: Math.max(0, Math.min(600, ((event.clientY - rect.top) * 600) / rect.height)),
        });
      };
      canvas.addEventListener('pointerdown', down);
      context.scope.own(() => canvas.removeEventListener('pointerdown', down));
    },
  }),
  modules(context) {
    const canvas = context.host.querySelector('canvas');
    if (!canvas) throw new Error('Missing game canvas');
    return [canvas2DModule({ canvas, width: 960, height: 600, background: '#fbfcf8' })];
  },
  setup(context) {
    context.commands.handle('togglePause', () => {
      if (context.engine.status === 'paused') context.engine.resume();
      else if (context.engine.status === 'running') context.engine.pause();
    });
    for (const event of ['started', 'paused', 'resumed', 'stopped', 'disposed'] as const)
      context.engine.events.on(
        event,
        () => context.state.update((state) => ({ ...state, status: context.engine.status })),
        context.scope,
      );
  },
});
