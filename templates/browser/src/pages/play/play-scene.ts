import { component } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { defineGameScene } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';

export const ArcadePlayer = component<Record<string, never>>('ReferencePlayer');
export const ArcadeCoin = component<{ value: number }>('ReferenceCoin');

export const PLAY_WIDTH = 480;
export const PLAY_HEIGHT = 270;

export interface PlaySceneProps {
  readonly levelId: string;
  readonly seed: number;
  readonly duration: number;
  readonly coinCount: number;
  onScore(score: number): void;
  onTime(seconds: number): void;
  onCoin(): void;
  onComplete(score: number): void;
}

export const PlayScene = defineGameScene<PlaySceneProps>({
  setup(context) {
    const props = context.props;
    const player = context.create();
    context.world.set(player, Position2D, { x: PLAY_WIDTH / 2, y: PLAY_HEIGHT / 2 });
    context.world.set(player, ArcadePlayer, {});

    for (let index = 0; index < props.coinCount; index++) {
      const coin = context.create();
      context.world.set(coin, Position2D, {
        x: 48 + ((props.seed * 37 + index * 89) % (PLAY_WIDTH - 96)),
        y: 42 + ((props.seed * 53 + index * 61) % (PLAY_HEIGHT - 84)),
      });
      context.world.set(coin, ArcadeCoin, { value: 10 });
    }

    let score = 0;
    let remaining = props.duration;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      props.onComplete(score);
    };
    props.onTime(remaining);

    context.addSystem({
      id: 'movement',
      order: 10,
      update({ delta }) {
        const position = context.world.require(player, Position2D);
        const speed = 125;
        position.x = Math.max(
          8,
          Math.min(PLAY_WIDTH - 8, position.x + (context.actions.axes.moveX ?? 0) * speed * delta),
        );
        position.y = Math.max(
          8,
          Math.min(PLAY_HEIGHT - 8, position.y + (context.actions.axes.moveY ?? 0) * speed * delta),
        );
      },
    });
    context.addSystem({
      id: 'collect',
      order: 20,
      update() {
        const playerPosition = context.world.require(player, Position2D);
        for (const coin of context.world.query(Position2D, ArcadeCoin)) {
          if (!context.world.isAlive(coin) || coin === player) continue;
          const position = context.world.require(coin, Position2D);
          if (Math.hypot(position.x - playerPosition.x, position.y - playerPosition.y) > 12)
            continue;
          const value = context.world.require(coin, ArcadeCoin).value;
          context.world.destroy(coin);
          score += value;
          props.onScore(score);
          props.onCoin();
        }
      },
    });
    context.clock.every(0.1, () => {
      if (finished) return;
      remaining = Math.max(0, Math.round((remaining - 0.1) * 10) / 10);
      props.onTime(remaining);
      if (remaining <= 0) finish();
    });
  },
});
