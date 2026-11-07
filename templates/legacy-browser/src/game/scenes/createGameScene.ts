import type { Scene } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import { Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import type { GameCommand, MovementInput } from '../../contracts/game.js';
import type { GameState } from '../components/GameState.js';
import { movementSystem } from '../systems/movement.js';

export function createGameScene(readInput: () => MovementInput) {
  const state: GameState = { target: null };
  const scene: Scene = {
    id: 'play',
    setup(context) {
      const player = context.create();
      context.engine.world.set(player, Position2D, { x: 480, y: 300 });
      context.engine.world.set(player, Shape2D, {
        kind: 'circle',
        color: '#176b58',
        width: 32,
        height: 32,
        layer: 1,
      });
      context.addSystem(movementSystem(player, state, readInput));
      context.scope.own(() => {
        state.target = null;
      });
    },
  };
  return {
    scene,
    dispatch(command: Extract<GameCommand, { type: 'move-to' }>): void {
      state.target = { x: command.x, y: command.y };
    },
  };
}
