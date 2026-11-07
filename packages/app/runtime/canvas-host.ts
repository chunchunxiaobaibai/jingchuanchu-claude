import {
  Engine,
  Scope,
  type CancellationSignal,
  type Cleanup,
  type System,
} from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager, type SceneContext } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import type { Entity, Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { BrowserDriver, FrameLoop } from '@xiaobaibaifqy/jingchuanchu-browser';
import { createBrowserDriver, createFrameLoop } from '@xiaobaibaifqy/jingchuanchu-browser';
import { Owner } from './component-owner.js';
import { defineComponent, input, output } from './component.js';
import type { AnyServiceDefinition, ServiceOf } from './services.js';
import type { AnyStoreDefinition, StoreInstanceOf } from './store.js';
import type { AssetContext } from './asset-types.js';
import type { ThemeService } from './theme-types.js';
import { createInputActions, type ActionDefinition, type ActionSnapshot } from './input-actions.js';
import { createViewport, type GameViewport, type ViewportDriver } from './viewport.js';
import { createGameClock, type GameClock } from './game-clock.js';
import { createTweenRunner, type TweenRunner } from './tweens.js';

export type GameCanvasStatus =
  'initializing' | 'running' | 'paused' | 'stopped' | 'failed' | 'disposed';

export interface GameSceneContext<P> {
  readonly engine: Engine;
  readonly world: Engine['world'];
  readonly scope: Scope;
  readonly signal: CancellationSignal;
  readonly clock: GameClock;
  readonly tweens: TweenRunner;
  readonly actions: ActionSnapshot;
  readonly props: Readonly<P>;
  readonly assets: AssetContext | undefined;
  readonly theme: ThemeService | undefined;
  create(): Entity;
  addSystem(system: System): void;
  setResource<T>(token: Token<T>, value: NoInfer<T>): void;
  getResource<T>(token: Token<T>): T;
  useStore<D extends AnyStoreDefinition>(definition: D): StoreInstanceOf<D>;
  useService<D extends AnyServiceDefinition>(definition: D): ServiceOf<D>;
}

export interface GameSceneDefinition<P = Record<string, never>> {
  prepare?(signal: CancellationSignal, props: P): void | Promise<void>;
  setup(context: GameSceneContext<P>): void;
  onPause?(): void;
  onResume?(): void;
}

export function defineGameScene<P = Record<string, never>>(
  definition: GameSceneDefinition<P>,
): GameSceneDefinition<P> {
  return Object.freeze(definition);
}

export interface GameRenderContext {
  readonly engine: Engine;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: GameViewport;
  readonly delta: number;
  readonly alpha: number;
}

export interface GameCanvasOptions<P = Record<string, never>> {
  readonly scene: GameSceneDefinition<P>;
  readonly props?: P;
  readonly canvas?: HTMLCanvasElement;
  readonly width?: number;
  readonly height?: number;
  readonly maxPixelRatio?: number;
  readonly tickRate?: number;
  readonly maxSteps?: number;
  readonly actions?: ActionDefinition;
  readonly driver?: BrowserDriver;
  readonly viewportDriver?: ViewportDriver;
  readonly assets?: AssetContext;
  readonly theme?: ThemeService;
  readonly owner?: Owner;
  readonly render?: (context: GameRenderContext) => void;
  readonly onError?: (error: unknown) => void;
}

export interface GameCanvasStats {
  readonly systems: number;
  readonly entities: number;
}

export interface GameCanvasHandle<P = Record<string, never>> {
  readonly status: GameCanvasStatus;
  readonly error: unknown;
  readonly stats: GameCanvasStats;
  readonly viewport: GameViewport | undefined;
  readonly currentScene: GameSceneDefinition<P> | undefined;
  readonly ready: Promise<void>;
  pause(): void;
  resume(): void;
  setActive(active: boolean): void;
  restart(): Promise<void>;
  switchScene(scene: GameSceneDefinition<P>, props?: P): Promise<void>;
  subscribe(listener: (status: GameCanvasStatus) => void): Cleanup;
  dispose(): void;
}

const emptyActions: ActionSnapshot = Object.freeze({
  axes: Object.freeze({}),
  buttons: Object.freeze({}),
  pointer: undefined,
});

function aggregate(errors: unknown[], message: string): never {
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

export function createGameCanvas<P = Record<string, never>>(
  host: Element,
  options: GameCanvasOptions<P>,
): GameCanvasHandle<P> {
  const document = host.ownerDocument;
  const canvas =
    options.canvas ??
    (host.localName === 'canvas'
      ? (host as HTMLCanvasElement)
      : (document.createElement('canvas') as HTMLCanvasElement));
  if (canvas !== host && !canvas.parentNode) host.append(canvas);
  const canvasOwner = options.owner ? options.owner.createChild() : new Owner();
  const statusListeners = new Set<(status: GameCanvasStatus) => void>();
  let status: GameCanvasStatus = 'initializing';
  let lastError: unknown;
  let disposed = false;
  let manualPaused = false;
  let hostPaused = false;
  let hidden = false;
  let engine: Engine | undefined;
  let viewport: GameViewport | undefined;
  let actions: ReturnType<typeof createInputActions> | undefined;
  let sceneManager: SceneManager | undefined;
  let currentClock: GameClock | undefined;
  let currentTweens: TweenRunner | undefined;
  let currentScene: GameSceneDefinition<P> | undefined;
  let currentProps: P | undefined;
  let switchScope: Scope | undefined;
  let actionsSnapshot: ActionSnapshot = emptyActions;
  let loop: FrameLoop | undefined;
  let switchGeneration = 0;

  const report = (error: unknown): void => {
    lastError = error;
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };
  const setStatus = (next: GameCanvasStatus): void => {
    if (status === next) return;
    status = next;
    for (const listener of [...statusListeners]) listener(next);
  };
  const syncPause = (): void => {
    if (!engine) return;
    const shouldPause = manualPaused || hostPaused || hidden;
    actions?.setPaused(shouldPause);
    if (shouldPause && engine.status === 'running') {
      engine.pause();
      setStatus('paused');
    } else if (!shouldPause && engine.status === 'paused') {
      engine.resume();
      setStatus('running');
    }
  };

  const applyScene = async (scene: GameSceneDefinition<P>, props: P): Promise<void> => {
    if (!engine || !sceneManager || disposed) throw new Error('Game canvas is disposed');
    const generation = ++switchGeneration;
    const owned = new Scope();
    const clock = createGameClock({ scope: owned, onError: report });
    const tweens = createTweenRunner({ scope: owned, onError: report });
    try {
      await sceneManager.switchTo({
        id: `canvas:${generation}`,
        ...(scene.prepare
          ? {
              prepare: async (signal: CancellationSignal) => {
                await scene.prepare!(signal, props);
              },
            }
          : {}),
        setup(sceneContext: SceneContext) {
          const context: GameSceneContext<P> = {
            engine: sceneContext.engine,
            world: sceneContext.engine.world,
            scope: sceneContext.scope,
            signal: sceneContext.signal,
            clock,
            tweens,
            get actions() {
              return actionsSnapshot;
            },
            props: Object.freeze({ ...props }),
            assets: options.assets,
            theme: options.theme,
            create: sceneContext.create,
            addSystem: sceneContext.addSystem,
            setResource: sceneContext.setResource,
            getResource: sceneContext.getResource,
            useStore: (definition) => canvasOwner.useStore(definition),
            useService: (definition) => canvasOwner.useService(definition),
          };
          scene.setup(context);
        },
        ...(scene.onPause ? { onPause: () => scene.onPause!() } : {}),
        ...(scene.onResume ? { onResume: () => scene.onResume!() } : {}),
      });
      if (disposed || generation !== switchGeneration) {
        owned.dispose();
        return;
      }
      const previousScope = switchScope;
      switchScope = owned;
      currentClock = clock;
      currentTweens = tweens;
      currentScene = scene;
      currentProps = props;
      previousScope?.dispose();
      syncPause();
    } catch (error) {
      owned.dispose();
      if (disposed || generation !== switchGeneration) return;
      throw error;
    }
  };

  const startLoop = (driver: BrowserDriver): void => {
    // Keeps running while paused or hidden so time stays current; deltas are capped at 1 s.
    const current = createFrameLoop(
      driver,
      (seconds) => {
        if (disposed || !engine) {
          current.stop();
          return;
        }
        if (engine.status !== 'running' || hidden) return;
        try {
          engine.advance(seconds);
        } catch (error) {
          report(error);
          setStatus('failed');
          current.stop();
        }
      },
      { maxDelta: 1 },
    );
    loop = current;
    current.start();
  };

  const initialization = (async () => {
    if (disposed) return;
    try {
      viewport = createViewport({
        canvas,
        width: options.width ?? 960,
        height: options.height ?? 600,
        maxPixelRatio: options.maxPixelRatio ?? 2,
        ...(options.viewportDriver ? { driver: options.viewportDriver } : {}),
        scope: canvasOwner.scope,
      });
      engine = new Engine({ tickRate: options.tickRate ?? 60, maxSteps: options.maxSteps ?? 5 });
      sceneManager = new SceneManager(engine);
      if (options.actions)
        actions = createInputActions(options.actions, {
          keyboardTarget: document,
          pointerTarget: canvas,
          ownerDocument: document,
          scope: canvasOwner.scope,
        });
      engine.addSystem(
        {
          id: 'canvas:step',
          order: -1000,
          update({ delta }) {
            actionsSnapshot = actions?.read() ?? emptyActions;
            currentClock?.advance(delta);
            currentTweens?.advance(delta);
          },
        },
        canvasOwner.scope,
      );
      engine.addSystem(
        {
          id: 'canvas:render',
          phase: 'render',
          order: 1000,
          update({ delta, alpha }) {
            if (!viewport) return;
            options.render?.({ engine: engine!, canvas, viewport, delta, alpha });
          },
        },
        canvasOwner.scope,
      );
      const scene = options.scene;
      const props = (options.props ?? {}) as P;
      await applyScene(scene, props);
      if (disposed) {
        try {
          actions?.dispose();
          engine.dispose();
          viewport?.dispose();
          canvasOwner.dispose();
        } catch {
          // The handle was disposed while initialization was still pending.
        }
        return;
      }
      const driver =
        options.driver ??
        (host.ownerDocument.defaultView &&
        typeof host.ownerDocument.defaultView.requestAnimationFrame === 'function'
          ? createBrowserDriver()
          : undefined);
      engine.start();
      if (driver) {
        const visibility = driver.subscribeVisibility(() => {
          hidden = driver.isHidden();
          loop?.resetTime();
          syncPause();
        });
        canvasOwner.scope.own(() => visibility());
        hidden = driver.isHidden();
        startLoop(driver);
      }
      setStatus('running');
      syncPause();
    } catch (error) {
      if (disposed) return;
      report(error);
      setStatus('failed');
      throw error;
    }
  })();

  const handle: GameCanvasHandle<P> = {
    get status() {
      return status;
    },
    get error() {
      return lastError;
    },
    get stats() {
      return {
        systems: engine?.getSystems().length ?? 0,
        entities: engine?.world.size ?? 0,
      };
    },
    get viewport() {
      return viewport;
    },
    get currentScene() {
      return currentScene;
    },
    ready: initialization,
    pause() {
      manualPaused = true;
      syncPause();
    },
    resume() {
      manualPaused = false;
      syncPause();
    },
    setActive(active) {
      hostPaused = !active;
      syncPause();
    },
    async restart() {
      await initialization;
      if (disposed) return;
      if (!currentScene) throw new Error('No scene to restart');
      try {
        await applyScene(currentScene, currentProps ?? ({} as P));
      } catch (error) {
        report(error);
        throw error;
      }
    },
    async switchScene(scene, props) {
      await initialization;
      if (disposed) throw new Error('Game canvas is disposed');
      try {
        await applyScene(scene, (props ?? {}) as P);
      } catch (error) {
        report(error);
        throw error;
      }
    },
    subscribe(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      switchGeneration += 1;
      manualPaused = true;
      setStatus('disposed');
      const errors: unknown[] = [];
      try {
        loop?.stop();
      } catch (error) {
        errors.push(error);
      }
      try {
        actions?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        sceneManager?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        engine?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        viewport?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        switchScope?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        canvasOwner.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) aggregate(errors, 'Game canvas cleanup failed');
    },
  };
  return handle;
}

export type GameCanvasComponentOptions<P = Record<string, never>> = Omit<
  GameCanvasOptions<P>,
  'scene' | 'canvas' | 'owner'
>;

const mountedHandles = new WeakMap<object, GameCanvasHandle>();

export const GameCanvas = defineComponent({
  selector: 'game-canvas',
  inputs: {
    scene: input<GameSceneDefinition<any>>({ required: true }),
    options: input<GameCanvasComponentOptions<any>>({ default: () => ({}) }),
  },
  outputs: {
    ready: output<GameCanvasHandle<any>>(),
    error: output<unknown>(),
    statusChanged: output<GameCanvasStatus>(),
  },
  setup() {
    return {};
  },
  onMount(context) {
    const options = context.inputs.options();
    const scene = context.inputs.scene();
    const canvas = context.element<HTMLCanvasElement>('canvas');
    const handle = createGameCanvas(canvas, {
      ...options,
      scene,
      onError(error) {
        context.emit('error', error);
        options.onError?.(error);
      },
    });
    mountedHandles.set(context, handle);
    handle.subscribe((status) => context.emit('statusChanged', status));
    void handle.ready.then(
      () => context.emit('ready', handle),
      (error) => context.emit('error', error),
    );
  },
  onActivate(context) {
    mountedHandles.get(context)?.setActive(true);
  },
  onDeactivate(context) {
    mountedHandles.get(context)?.setActive(false);
  },
  onDestroy(context) {
    mountedHandles.get(context)?.dispose();
    mountedHandles.delete(context);
  },
  $template: '<canvas data-ref="canvas"></canvas>',
});
