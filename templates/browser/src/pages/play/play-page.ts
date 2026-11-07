import {
  GameCanvas,
  RouterService,
  defineActions,
  definePage,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  GameCanvasComponentOptions,
  GameCanvasHandle,
  GameRenderContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { AppServicesDef } from '../../app/services.js';
import { GameStore } from '../../game/session/game-store.js';
import { LEVELS, findLevel } from '../../game/session/levels.js';
import { ProgressStore } from '../../game/session/save.js';
import { PlayHud } from './hud/hud.js';
import {
  ArcadeCoin,
  ArcadePlayer,
  PLAY_HEIGHT,
  PLAY_WIDTH,
  PlayScene,
  type PlaySceneProps,
} from './play-scene.js';

export const PlayPage = definePage({
  selector: 'play-page',
  components: [GameCanvas, PlayHud],
  setup(context) {
    const store = context.useStore(GameStore);
    const router = context.useService(RouterService);
    const services = context.useService(AppServicesDef);
    const levelId = context.route?.params.levelId ?? LEVELS[0]!.id;
    const level = findLevel(levelId) ?? LEVELS[0]!;
    const score = context.signal(0);
    const time = context.signal(level.duration);
    const paused = context.signal(false);
    const started = context.signal(false);
    const loading = context.signal(true);
    const error = context.signal('');
    let handle: GameCanvasHandle<PlaySceneProps> | undefined;
    let coinImage: CanvasImageSource | undefined;
    let coinFrame: { x: number; y: number; width: number; height: number } | undefined;
    let lease: { release(): void } | undefined;
    let closed = false;
    let finished = false;
    let loadGeneration = 0;
    context.own(() => {
      closed = true;
      lease?.release();
    });

    const report = (reason: unknown): void => {
      error.set(reason instanceof Error ? reason.message : String(reason));
    };
    const loadTheme = async (): Promise<void> => {
      const generation = ++loadGeneration;
      loading.set(true);
      error.set('');
      try {
        const next = await services.theme.loadImage('game.coin');
        if (closed || generation !== loadGeneration) {
          next.release();
          return;
        }
        lease?.release();
        lease = next;
        coinImage = next.image as CanvasImageSource;
        coinFrame = next.frame ? { ...next.frame } : undefined;
        loading.set(false);
      } catch (reason) {
        if (!closed && generation === loadGeneration) {
          report(reason);
          loading.set(false);
        }
      }
    };
    void loadTheme();

    const props: PlaySceneProps = {
      levelId,
      seed: level.seed,
      duration: level.duration,
      coinCount: level.coinCount,
      onScore(value) {
        score.set(value);
      },
      onTime(seconds) {
        time.set(seconds);
      },
      onCoin() {
        void services.audio.playEffect('coin');
      },
      onComplete(finalScore) {
        if (finished) return;
        finished = true;
        store.actions.recordResult(levelId, finalScore);
        void ProgressStore.save({
          nickname: store.state.nickname(),
          highScore: store.state.highScore(),
          unlocked: store.state.unlocked(),
          completed: store.state.completed(),
        }).then((result) => {
          if (result.status !== 'saved') error.set('进度保存失败，可在结算页重试。');
        });
        queueMicrotask(() => {
          void router.push({ name: 'result' });
        });
      },
    };

    const render = ({ engine, canvas, viewport }: GameRenderContext): void => {
      const drawing = canvas.getContext('2d');
      if (!drawing) return;
      drawing.setTransform(viewport.pixelRatio, 0, 0, viewport.pixelRatio, 0, 0);
      drawing.clearRect(0, 0, PLAY_WIDTH, PLAY_HEIGHT);
      drawing.fillStyle = String(services.theme.token('background'));
      drawing.fillRect(0, 0, PLAY_WIDTH, PLAY_HEIGHT);
      drawing.strokeStyle = 'rgba(23, 107, 88, 0.14)';
      drawing.lineWidth = 1;
      for (let x = 24; x < PLAY_WIDTH; x += 32) {
        drawing.beginPath();
        drawing.moveTo(x, 0);
        drawing.lineTo(x, PLAY_HEIGHT);
        drawing.stroke();
      }

      const image = coinImage as HTMLImageElement | undefined;
      const frame = coinFrame ?? { x: 0, y: 0, width: 16, height: 16 };
      for (const coin of engine.world.query(Position2D, ArcadeCoin)) {
        const position = engine.world.require(coin, Position2D);
        if (image?.complete)
          drawing.drawImage(
            image,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            position.x - 8,
            position.y - 8,
            16,
            16,
          );
        else {
          drawing.beginPath();
          drawing.fillStyle = '#f2c14e';
          drawing.arc(position.x, position.y, 6, 0, Math.PI * 2);
          drawing.fill();
        }
      }
      for (const player of engine.world.query(ArcadePlayer, Position2D)) {
        const position = engine.world.require(player, Position2D);
        drawing.beginPath();
        drawing.fillStyle = String(services.theme.token('accent'));
        drawing.arc(position.x, position.y, 7, 0, Math.PI * 2);
        drawing.fill();
        drawing.strokeStyle = '#ffffff';
        drawing.lineWidth = 2;
        drawing.stroke();
      }
    };

    const canvasOptions: GameCanvasComponentOptions<PlaySceneProps> = {
      width: PLAY_WIDTH,
      height: PLAY_HEIGHT,
      tickRate: 60,
      props,
      actions: defineActions({
        axes: {
          moveX: { negative: ['ArrowLeft', 'KeyA'], positive: ['ArrowRight', 'KeyD'] },
          moveY: { negative: ['ArrowUp', 'KeyW'], positive: ['ArrowDown', 'KeyS'] },
        },
      }),
      render,
      onError: report,
    };

    const startGame = (): void => {
      if (loading()) return;
      started.set(true);
      paused.set(false);
      handle?.resume();
      void services.audio.unlock().then((ready) => {
        if (!ready) return;
        void services.audio.playMusic('theme');
        void services.audio.playEffect('click');
      });
    };
    const togglePause = (): void => {
      if (!started() || !handle) return;
      const next = !paused();
      paused.set(next);
      if (next) handle.pause();
      else handle.resume();
      void services.audio.playEffect('click');
    };
    const restart = (): void => {
      finished = false;
      score.set(0);
      time.set(level.duration);
      paused.set(false);
      started.set(true);
      void handle?.restart().then(() => {
        if (!paused()) handle?.resume();
      });
      void services.audio.playEffect('click');
    };
    const onReady = (event: Event): void => {
      handle = (event as CustomEvent).detail as GameCanvasHandle<PlaySceneProps>;
      handle.pause();
      paused.set(true);
    };
    const onStatus = (event: Event): void => {
      const status = (event as CustomEvent).detail;
      if (status === 'paused') paused.set(true);
      else if (status === 'running') paused.set(false);
      else if (status === 'failed') error.set('游戏运行失败，请重试。');
    };

    return {
      levelTitle: level.title,
      coinTarget: level.coinCount,
      scene: PlayScene,
      canvasOptions,
      score,
      time,
      paused,
      started,
      loading,
      error,
      pauseUrl: services.theme.url('ui.pause'),
      startGame,
      togglePause,
      restart,
      retry: () => void loadTheme(),
      onReady,
      onStatus,
    };
  },
});
