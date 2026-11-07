import type { Cleanup, Engine, EngineModule, Scope } from '@xiaobaibaifqy/jingchuanchu-core';

/** Injectable host boundary allows the clock to be tested without a DOM. */
export interface BrowserDriver {
  requestFrame(callback: (milliseconds: number) => void): number;
  cancelFrame(id: number): void;
  isHidden(): boolean;
  subscribeVisibility(callback: () => void): Cleanup;
}
export function createBrowserDriver(): BrowserDriver {
  return defaultDriver();
}
function defaultDriver(): BrowserDriver {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    isHidden: () => document.hidden,
    subscribeVisibility(callback) {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}
/** Schedules frames and measures elapsed seconds; callers decide when it runs. */
export interface FrameLoop {
  readonly running: boolean;
  /** Requests frames until stopped; the first frame reports 0 seconds. */
  start(): void;
  /** Cancels the pending frame and forgets the previous frame time. */
  stop(): void;
  /** Makes the next frame report 0 seconds, e.g. after the page was hidden. */
  resetTime(): void;
}
export function createFrameLoop(
  driver: BrowserDriver,
  onFrame: (seconds: number) => void,
  options: { maxDelta?: number } = {},
): FrameLoop {
  const maxDelta = options.maxDelta ?? Infinity;
  if (!(maxDelta > 0)) throw new Error('Invalid frame delta limit');
  let frame: number | undefined;
  let previous: number | undefined;
  let running = false;
  const tick = (time: number): void => {
    frame = undefined;
    if (!running) return;
    const seconds =
      previous === undefined ? 0 : Math.min(maxDelta, Math.max(0, (time - previous) / 1000));
    previous = time;
    try {
      onFrame(seconds);
    } catch (error) {
      loop.stop();
      throw error;
    }
    if (running && frame === undefined) frame = driver.requestFrame(tick);
  };
  const loop: FrameLoop = {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      previous = undefined;
      frame = driver.requestFrame(tick);
    },
    stop() {
      running = false;
      previous = undefined;
      if (frame !== undefined) driver.cancelFrame(frame);
      frame = undefined;
    },
    resetTime() {
      previous = undefined;
    },
  };
  return loop;
}
export function runBrowser(
  engine: Engine,
  onError: (error: unknown) => void,
  options: { driver?: BrowserDriver; scope?: Scope; autoStart?: boolean } = {},
): Cleanup {
  const driver = options.driver ?? defaultDriver();
  const scope = options.scope ?? engine.scope;
  let closed = false;
  let pausedForVisibility = false;
  const handleError = (error: unknown): void => {
    loop.stop();
    if (engine.status !== 'disposed') engine.stop();
    onError(error);
  };
  // Render systems receive the raw elapsed time; fixed steps are capped by Engine maxSteps.
  const loop = createFrameLoop(driver, (seconds) => {
    if (closed || engine.status !== 'running') {
      loop.stop();
      return;
    }
    try {
      engine.advance(seconds);
    } catch (error) {
      handleError(error);
    }
  });
  const suspend = (): void => loop.stop();
  const begin = (): void => {
    if (closed || engine.status !== 'running') return;
    if (driver.isHidden()) {
      pausedForVisibility = true;
      engine.pause();
      return;
    }
    loop.start();
  };
  const visibility = (): void => {
    if (driver.isHidden()) {
      if (engine.status === 'running') {
        pausedForVisibility = true;
        engine.pause();
      }
    } else if (pausedForVisibility) {
      pausedForVisibility = false;
      if (engine.status === 'paused') engine.resume();
    }
  };
  const offVisibility = driver.subscribeVisibility(visibility);
  const stop = (): void => {
    closed = true;
    suspend();
    offVisibility();
  };
  engine.events.on('started', begin, scope);
  engine.events.on('resumed', begin, scope);
  engine.events.on('paused', suspend, scope);
  engine.events.on(
    'stopped',
    () => {
      pausedForVisibility = false;
      suspend();
    },
    scope,
  );
  scope.own(stop);
  if (options.autoStart !== false && engine.status === 'stopped') engine.start();
  else begin();
  return stop;
}
export function browserModule(
  options: { driver?: BrowserDriver; onError?: (error: unknown) => void } = {},
): EngineModule {
  return {
    id: 'browser-runtime',
    setup(engine, scope) {
      runBrowser(engine, options.onError ?? ((error) => console.error(error)), {
        ...options,
        scope,
        autoStart: false,
      });
    },
  };
}
