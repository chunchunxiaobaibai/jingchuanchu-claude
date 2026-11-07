import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  GameCanvas,
  Owner,
  createGameCanvas,
  defineActions,
  defineGameScene,
  mountComponent,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  GameCanvasHandle,
  GameSceneContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { BrowserDriver } from '@xiaobaibaifqy/jingchuanchu-browser';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function dom() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  return { window, document, host };
}

function frameDriver() {
  const frames = new Map<number, (time: number) => void>();
  const visibility = new Set<() => void>();
  let nextId = 0;
  let hidden = false;
  const driver: BrowserDriver = {
    requestFrame(callback) {
      frames.set(++nextId, callback);
      return nextId;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    isHidden: () => hidden,
    subscribeVisibility(callback) {
      visibility.add(callback);
      return () => visibility.delete(callback);
    },
  };
  return {
    driver,
    get frames() {
      return frames.size;
    },
    step(time: number) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
    setHidden(value: boolean) {
      hidden = value;
      for (const callback of [...visibility]) callback();
    },
  };
}

const viewportDriver = {
  read: () => ({ width: 320, height: 240, pixelRatio: 1 }),
  subscribe: () => () => {},
};

test('game canvas owns one loop, scene systems, clock and render activity', async () => {
  const { window, document, host } = dom();
  const frames = frameDriver();
  let ticks = 0;
  let clockFired = 0;
  let renders = 0;
  let setups = 0;
  let cleanups = 0;
  let lastAxis = 0;
  const scene = defineGameScene<{ level: string }>({
    async prepare(_signal, props) {
      assert.equal(props.level, 'one');
    },
    setup(context: GameSceneContext<{ level: string }>) {
      setups += 1;
      context.create();
      context.addSystem({
        id: 'count',
        update() {
          ticks += 1;
          lastAxis = context.actions.axes.moveX ?? 0;
        },
      });
      context.scope.own(() => {
        cleanups += 1;
      });
      context.clock.after(0.1, () => {
        clockFired += 1;
      });
    },
  });
  const handle = createGameCanvas(host, {
    scene,
    props: { level: 'one' },
    width: 160,
    height: 120,
    tickRate: 10,
    maxSteps: 20,
    driver: frames.driver,
    viewportDriver,
    actions: defineActions({
      axes: { moveX: { negative: ['ArrowLeft'], positive: ['ArrowRight'] } },
    }),
    render: () => {
      renders += 1;
    },
  });
  assert.equal(handle.status, 'initializing');
  await handle.ready;
  assert.equal(handle.status, 'running');
  assert.equal(handle.stats.entities, 1);
  assert.ok(handle.stats.systems >= 3);
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      code: 'ArrowRight',
      bubbles: true,
    }) as unknown as Event,
  );
  frames.step(0);
  frames.step(1000);
  assert.ok(ticks >= 10);
  assert.ok(clockFired >= 1);
  assert.ok(renders >= 1);
  assert.equal(lastAxis, 1);

  handle.pause();
  assert.equal(handle.status, 'paused');
  const pausedTicks = ticks;
  frames.step(2000);
  assert.equal(ticks, pausedTicks);
  handle.resume();
  frames.step(3000);
  assert.ok(ticks > pausedTicks);

  frames.setHidden(true);
  assert.equal(handle.status, 'paused');
  const hiddenTicks = ticks;
  frames.step(4000);
  assert.equal(ticks, hiddenTicks);
  frames.setHidden(false);
  assert.equal(handle.status, 'running');

  handle.pause();
  frames.setHidden(true);
  frames.setHidden(false);
  assert.equal(handle.status, 'paused');
  handle.resume();

  await handle.restart();
  frames.step(5000);
  assert.equal(setups, 2);
  assert.equal(cleanups, 1);
  assert.equal(handle.stats.entities, 1);
  assert.ok(handle.stats.systems < 6);

  handle.dispose();
  assert.equal(handle.status, 'disposed');
  assert.equal(frames.frames, 0);
  assert.equal(handle.stats.systems, 0);
  assert.equal(handle.stats.entities, 0);
  assert.equal(cleanups, 2);
});

test('failed scene switches keep the committed scene and two canvases stay isolated', async () => {
  const { document } = dom();
  const firstFrames = frameDriver();
  const secondFrames = frameDriver();
  const firstHost = document.createElement('div');
  const secondHost = document.createElement('div');
  document.body.append(firstHost, secondHost);
  let firstTicks = 0;
  let secondTicks = 0;
  const firstScene = defineGameScene({
    setup(context) {
      context.addSystem({
        id: 'first',
        update() {
          firstTicks += 1;
        },
      });
    },
  });
  const secondScene = defineGameScene({
    setup(context) {
      context.addSystem({
        id: 'second',
        update() {
          secondTicks += 1;
        },
      });
    },
  });
  const failing = defineGameScene({
    async prepare() {
      throw new Error('prepare failed');
    },
    setup() {},
  });
  const first = createGameCanvas(firstHost, {
    scene: firstScene,
    driver: firstFrames.driver,
    viewportDriver,
    tickRate: 10,
  });
  const second = createGameCanvas(secondHost, {
    scene: secondScene,
    driver: secondFrames.driver,
    viewportDriver,
    tickRate: 10,
  });
  await Promise.all([first.ready, second.ready]);
  firstFrames.step(0);
  firstFrames.step(1000);
  assert.ok(firstTicks > 0);
  assert.equal(secondTicks, 0);
  await assert.rejects(first.switchScene(failing), /prepare failed/);
  assert.equal(first.currentScene, firstScene);
  const systems = first.stats.systems;
  const before = firstTicks;
  firstFrames.step(2000);
  assert.ok(firstTicks > before);
  assert.equal(first.stats.systems, systems);
  first.dispose();
  second.dispose();
});

test('async exit before prepare resolves cannot start an old loop', async () => {
  const { document, host } = dom();
  const frames = frameDriver();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let starts = 0;
  const scene = defineGameScene({
    async prepare() {
      await gate;
    },
    setup(context) {
      starts += 1;
      context.addSystem({ id: 'count', update() {} });
    },
  });
  const handle = createGameCanvas(host, {
    scene,
    driver: frames.driver,
    viewportDriver,
  });
  handle.dispose();
  release();
  await settle();
  assert.equal(handle.status, 'disposed');
  assert.equal(starts, 0);
  assert.equal(frames.frames, 0);
  assert.equal(handle.stats.systems, 0);
});

test('GameCanvas component creates and disposes its host canvas', async () => {
  const { document, host } = dom();
  const frames = frameDriver();
  let ticks = 0;
  const scene = defineGameScene({
    setup(context) {
      context.addSystem({
        id: 'ticks',
        update() {
          ticks += 1;
        },
      });
    },
  });
  const outputs: GameCanvasHandle[] = [];
  const errors: unknown[] = [];
  const instance = mountComponent(
    host,
    GameCanvas,
    { owner: new Owner(), onError: (error) => errors.push(error) },
    {
      scene,
      options: {
        driver: frames.driver,
        viewportDriver,
        tickRate: 10,
      },
    },
  );
  instance.subscribeOutput('ready', (handle) => outputs.push(handle as GameCanvasHandle));
  instance.subscribeOutput('error', (error) => errors.push(error));
  await settle();
  assert.equal(host.querySelectorAll('canvas').length, 1);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]!.status, 'running');
  frames.step(0);
  frames.step(1000);
  assert.ok(ticks > 0);
  instance.dispose();
  assert.deepEqual(errors, []);
  assert.equal(host.childNodes.length, 0);
  assert.equal(frames.frames, 0);
});

test('game canvas caps frame deltas, resets timing when shown and stops after a failure', async () => {
  const { host } = dom();
  const frames = frameDriver();
  const deltas: number[] = [];
  let fail = false;
  const errors: unknown[] = [];
  const handle = createGameCanvas(host, {
    scene: defineGameScene({ setup() {} }),
    driver: frames.driver,
    viewportDriver,
    onError: (error) => errors.push(error),
    render: ({ delta }) => {
      deltas.push(+delta.toFixed(6));
      if (fail) throw new Error('render failed');
    },
  });
  await handle.ready;
  frames.step(1000);
  frames.step(1100);
  frames.step(5100);
  // While paused the loop keeps tracking time, so resuming continues with a frame delta.
  handle.pause();
  frames.step(5200);
  handle.resume();
  frames.step(5250);
  frames.setHidden(true);
  frames.step(6000);
  frames.setHidden(false);
  frames.step(9000);
  frames.step(9020);
  assert.deepEqual(deltas, [0, 0.1, 1, 0.05, 0, 0.02]);
  fail = true;
  frames.step(9040);
  assert.equal(handle.status, 'failed');
  assert.equal(errors.length, 1);
  assert.equal(frames.frames, 0);
  handle.dispose();
});

test('disposing a game canvas cancels a frame requested by its default driver', async () => {
  const { window, host } = dom();
  const pending = new Set<number>();
  let next = 0;
  Object.assign(window, {
    requestAnimationFrame: () => {
      pending.add(++next);
      return next;
    },
    cancelAnimationFrame: (id: number) => {
      pending.delete(id);
    },
  });
  const original = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const originalDocument = globalThis.document;
  // The default driver uses the global frame and visibility APIs.
  Object.assign(globalThis, {
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    document: host.ownerDocument,
  });
  try {
    const handle = createGameCanvas(host, {
      scene: defineGameScene({ setup() {} }),
      viewportDriver,
    });
    await handle.ready;
    assert.equal(pending.size, 1);
    handle.dispose();
    assert.equal(pending.size, 0);
  } finally {
    Object.assign(globalThis, {
      requestAnimationFrame: original,
      cancelAnimationFrame: originalCancel,
      document: originalDocument,
    });
  }
});
