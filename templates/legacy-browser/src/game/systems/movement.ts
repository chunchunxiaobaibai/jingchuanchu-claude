import type { System } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Entity } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import type { MovementInput } from '../../contracts/game.js';
import type { GameState } from '../components/GameState.js';

export function movementSystem(
  player: Entity,
  state: GameState,
  readInput: () => MovementInput,
): System {
  return {
    id: 'move',
    update({ world, delta }) {
      const position = world.require(player, Position2D);
      let { x, y } = readInput();
      let distance = Math.hypot(x, y);
      let travel = 240 * delta;
      if (distance) state.target = null;
      else if (state.target) {
        x = state.target.x - position.x;
        y = state.target.y - position.y;
        distance = Math.hypot(x, y);
        travel = Math.min(travel, distance);
        if (distance < 1) state.target = null;
      }
      if (distance) {
        position.x += (x / distance) * travel;
        position.y += (y / distance) * travel;
      }
      position.x = Math.max(16, Math.min(944, position.x));
      position.y = Math.max(16, Math.min(584, position.y));
    },
  };
}
