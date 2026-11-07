import {
  Engine,
  Scope,
  type EngineModule,
  type CancellationSignal,
} from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager, type SceneContext } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import { runBrowser, type BrowserDriver } from '@xiaobaibaifqy/jingchuanchu-browser';
import { KeyboardInput } from '@xiaobaibaifqy/jingchuanchu-input';
import {
  Commands,
  StateStore,
  snapshot,
  type CommandRegistry,
  type CommandSender,
  type ReadonlyData,
} from './state.js';
import { mountView, type ViewDefinition, type ViewInstance } from './view.js';

export interface InputDefinition<I, C extends object> {
  initial(): I;
  read?(keyboard: Pick<KeyboardInput, 'isDown'>, previous: ReadonlyData<I>): I;
  preventDefault?: readonly string[];
  setup?(context: {
    host: Element;
    scope: Scope;
    commands: CommandSender<C>;
    enabled(): boolean;
  }): void;
}
/** @deprecated 改用 application 入口的 `defineActions` 与 `createInputActions`。 见 docs/development/migrating-to-application.md。 */
export function defineInput<I, C extends object>(
  definition: InputDefinition<I, C>,
): InputDefinition<I, C> {
  return Object.freeze(definition);
}
export interface GameSceneContext<S, C extends object, I> extends SceneContext {
  readonly state: StateStore<S>;
  readonly commands: CommandRegistry<C>;
  readonly input: ReadonlyData<I>;
}
export interface SceneDefinition<S, C extends object, I = Record<string, never>> {
  prepare?(signal: CancellationSignal): Promise<void>;
  setup(context: GameSceneContext<S, C, I>): void;
  onPause?(): void;
  onResume?(): void;
}
/** @deprecated 改用 application 入口的 `defineGameScene`，由页面内 `GameCanvas` 承载。 见 docs/development/migrating-to-application.md。 */
export function defineScene<S, C extends object, I = Record<string, never>>(
  definition: SceneDefinition<S, C, I>,
): SceneDefinition<S, C, I> {
  return Object.freeze(definition);
}
export interface ApplicationContext<S, C extends object, I> {
  readonly engine: Engine;
  readonly host: Element;
  readonly scope: Scope;
  readonly state: StateStore<S>;
  readonly commands: CommandRegistry<C>;
  switchTo(scene: SceneDefinition<S, C, I>): Promise<void>;
}
export interface GameDefinition<S, C extends object, I = Record<string, never>> {
  state(): S;
  readonly scenes?: readonly SceneDefinition<S, C, I>[];
  readonly initialScene?: SceneDefinition<S, C, I>;
  readonly input?: InputDefinition<I, C>;
  readonly clock?: { tickRate?: number; maxSteps?: number; diagnostics?: boolean };
  modules?(context: ApplicationContext<S, C, I>): readonly EngineModule[];
  setup?(context: ApplicationContext<S, C, I>): void;
  onError?(error: unknown): void;
}
/** @deprecated 改用 application 入口的 `defineApplication`、`definePage` 与 `GameCanvas`；旧行为不变，移除时间由发布任务决定。 见 docs/development/migrating-to-application.md。 */
export function defineGame<S, C extends object, I = Record<string, never>>(
  definition: GameDefinition<S, C, I>,
): GameDefinition<S, C, I> {
  return Object.freeze(definition);
}
export interface GameApplication<S, C extends object, I, P> {
  readonly engine: Engine;
  readonly view: ViewInstance<P>;
  readonly state: StateStore<S>;
  readonly commands: CommandSender<C>;
  switchTo(scene: SceneDefinition<S, C, I>): Promise<void>;
  dispose(): void;
}
const applications = new WeakSet<Element>();
/** @deprecated 改用 application 入口的 `mountApplication`。 见 docs/development/migrating-to-application.md。 */
export async function mountGame<S, C extends object, I, P, L>(
  host: Element,
  root: ViewDefinition<S, C, P, L>,
  game: GameDefinition<S, C, I>,
  options: { inputs?: P; driver?: BrowserDriver; autoStart?: boolean } = {},
): Promise<GameApplication<S, C, I, P>> {
  if (applications.has(host)) throw new Error('Application host is already mounted');
  const engine = new Engine(game.clock),
    state = new StateStore(game.state());
  applications.add(host);
  const scenes = new SceneManager(engine),
    commands = new Commands<C>();
  let current: Commands<C> | undefined;
  const input = game.input;
  let inputState = snapshot({} as I);
  const onError = game.onError ?? ((error: unknown) => console.error(error));
  const sender: CommandSender<C> = {
    send(name, payload) {
      if (engine.status === 'disposed') throw new Error('Application is disposed');
      if (commands.has(name)) commands.send(name, payload);
      else if (engine.status === 'running') {
        if (!current?.has(name)) throw new Error(`Missing scene command: ${String(name)}`);
        current.send(name, payload);
      }
      // Scene commands are intentionally dropped while paused; app controls remain active.
    },
  };
  let transition = 0;
  const switchTo = async (definition: SceneDefinition<S, C, I>): Promise<void> => {
    if (!game.scenes?.includes(definition))
      throw new Error('Scene is not declared in defineGame.scenes');
    const generation = ++transition,
      handlers = new Commands<C>(commands);
    try {
      await scenes.switchTo({
        id: `application-${generation}`,
        ...(definition.prepare ? { prepare: (signal) => definition.prepare!(signal) } : {}),
        setup(context) {
          context.scope.own(() => handlers.clear());
          definition.setup({
            ...context,
            state,
            commands: handlers,
            get input() {
              return inputState;
            },
          });
        },
        ...(definition.onPause ? { onPause: () => definition.onPause!() } : {}),
        ...(definition.onResume ? { onResume: () => definition.onResume!() } : {}),
      });
    } finally {
      // Core commits the new scene before reporting an old scene's cleanup failure.
      if (generation === transition && scenes.id === `application-${generation}`) {
        current = handlers;
        if (engine.status === 'paused') scenes.pause();
      }
    }
  };
  const appCommands: CommandRegistry<C> = {
    send: (name, payload) => sender.send(name, payload),
    handle(name, handler) {
      if (current?.has(name)) throw new Error(`Duplicate command handler: ${String(name)}`);
      commands.handle(name, handler);
    },
  };
  const context: ApplicationContext<S, C, I> = {
    engine,
    host,
    scope: engine.scope,
    state,
    commands: appCommands,
    switchTo,
  };
  let view: ViewInstance<P> | undefined;
  engine.scope.own(() => {
    applications.delete(host);
  });
  engine.scope.own(() => commands.clear());
  try {
    inputState = snapshot(input?.initial() ?? ({} as I));
    engine.events.on('paused', () => scenes.pause(), engine.scope);
    engine.events.on('resumed', () => scenes.resume(), engine.scope);
    engine.events.on('started', () => scenes.resume(), engine.scope);
    view = mountView(host, root, { state, commands: sender, onError }, options.inputs);
    engine.scope.own(() => view!.dispose());
    if (input) {
      const keyboard = new KeyboardInput(host, input.preventDefault);
      engine.scope.own(() => keyboard.dispose());
      const clearInput = () => {
        keyboard.clear();
        inputState = snapshot(input.initial());
      };
      const window = host.ownerDocument.defaultView;
      window?.addEventListener('blur', clearInput);
      const focusOut = (event: Event): void => {
        const next = (event as FocusEvent).relatedTarget;
        if (!next || !host.contains(next as Node)) clearInput();
      };
      host.addEventListener('focusout', focusOut);
      engine.scope.own(() => {
        window?.removeEventListener('blur', clearInput);
        host.removeEventListener('focusout', focusOut);
      });
      engine.events.on('paused', clearInput, engine.scope);
      engine.events.on('stopped', clearInput, engine.scope);
      engine.addSystem({
        id: 'application:input',
        order: -1000,
        update() {
          inputState = snapshot(input.read?.(keyboard, inputState) ?? input.initial());
        },
      });
      input.setup?.({
        host,
        scope: engine.scope,
        commands: sender,
        enabled: () => engine.status === 'running',
      });
    }
    engine.install(game.modules?.(context) ?? []);
    game.setup?.(context);
    if (game.initialScene) await switchTo(game.initialScene);
    runBrowser(engine, onError, {
      ...(options.driver ? { driver: options.driver } : {}),
      autoStart: options.autoStart !== false,
    });
    const window = host.ownerDocument.defaultView;
    if (window) {
      let pausedForPage = false;
      const hide = (event: PageTransitionEvent) => {
        if (event.persisted) {
          pausedForPage = engine.status === 'running';
          if (pausedForPage) engine.pause();
        } else engine.dispose();
      };
      const show = (event: PageTransitionEvent) => {
        if (event.persisted && pausedForPage && engine.status === 'paused') engine.resume();
        pausedForPage = false;
      };
      window.addEventListener('pagehide', hide);
      window.addEventListener('pageshow', show);
      engine.scope.own(() => {
        window.removeEventListener('pagehide', hide);
        window.removeEventListener('pageshow', show);
      });
    }
    return { engine, view, state, commands: sender, switchTo, dispose: () => engine.dispose() };
  } catch (error) {
    try {
      engine.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Application startup failed');
    }
    throw error;
  }
}
/** @deprecated 改用 application 入口的 `bootstrapApplication`。 见 docs/development/migrating-to-application.md。 */
export async function bootstrapGame<S, C extends object, I, P, L>(
  root: ViewDefinition<S, C, P, L>,
  game: GameDefinition<S, C, I>,
  options: { document?: Document; inputs?: P; driver?: BrowserDriver; autoStart?: boolean } = {},
): Promise<GameApplication<S, C, I, P>> {
  const document = options.document ?? globalThis.document;
  const hosts = document.querySelectorAll(root.selector);
  if (hosts.length !== 1)
    throw new Error(`Expected one ${root.selector} root, found ${hosts.length}`);
  return mountGame(hosts[0]!, root, game, options);
}
