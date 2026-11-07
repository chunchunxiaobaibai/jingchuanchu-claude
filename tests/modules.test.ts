import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource } from '@xiaobaibaifqy/jingchuanchu-ecs';
import {
  browserModule,
  createFrameLoop,
  type BrowserDriver,
} from '@xiaobaibaifqy/jingchuanchu-browser';
import { assetModule } from '@xiaobaibaifqy/jingchuanchu-assets/module';
import { keyboardModule, Keyboard } from '@xiaobaibaifqy/jingchuanchu-input/module';
import { networkModule } from '@xiaobaibaifqy/jingchuanchu-net/module';

test('modules install in batches, enforce dependencies and roll back provided services', () => {
  const engine = new Engine();
  const Service = resource<number>('Service');
  const Broken = resource<number>('Broken');
  engine.install([
    {
      id: 'base',
      setup(instance, scope) {
        instance.provide(Service, 42, scope);
      },
    },
  ]);
  engine.install([{ id: 'consumer', dependencies: ['base'], setup() {} }]);
  assert.equal(engine.hasModule('base'), true);
  assert.equal(engine.world.getResource(Service), 42);
  assert.throws(() => engine.install([{ id: 'base', setup() {} }]));
  assert.throws(() =>
    engine.install([
      {
        id: 'broken',
        setup(instance, scope) {
          instance.provide(Broken, 1, scope);
          throw new Error('failure');
        },
      },
    ]),
  );
  assert.equal(engine.hasModule('broken'), false);
  assert.equal(engine.world.hasResource(Broken), false);
  assert.equal(engine.world.getResource(Service), 42);
  engine.start();
  assert.throws(() => engine.install([]));
  engine.pause();
  engine.install([{ id: 'extra', setup() {} }]);
  engine.dispose();
});

function fakeDriver() {
  const frames = new Map<number, (time: number) => void>();
  let next = 0;
  let hidden = false;
  let visibility: (() => void) | undefined;
  const driver: BrowserDriver = {
    requestFrame(callback) {
      frames.set(++next, callback);
      return next;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    isHidden: () => hidden,
    subscribeVisibility(callback) {
      visibility = callback;
      return () => {
        visibility = undefined;
      };
    },
  };
  return {
    driver,
    frames,
    frame(time: number) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
    visibility(value: boolean) {
      hidden = value;
      visibility?.();
    },
    subscribed: () => !!visibility,
  };
}
test('browser module owns frame lifetime and preserves a manual pause across visibility changes', () => {
  const engine = new Engine();
  const host = fakeDriver();
  let ticks = 0;
  engine.addSystem({
    id: 'counter',
    update() {
      ticks++;
    },
  });
  engine.install([browserModule({ driver: host.driver })]);
  assert.equal(host.frames.size, 0);
  engine.start();
  engine.start();
  assert.equal(host.frames.size, 1);
  host.frame(0);
  host.frame(100);
  assert.equal(ticks, 3);
  engine.pause();
  assert.equal(host.frames.size, 0);
  host.visibility(true);
  host.visibility(false);
  assert.equal(engine.status, 'paused');
  engine.resume();
  host.visibility(true);
  assert.equal(engine.status, 'paused');
  host.visibility(false);
  assert.equal(engine.status, 'running');
  engine.stop();
  assert.equal(host.frames.size, 0);
  engine.start();
  assert.equal(host.frames.size, 1);
  engine.dispose();
  assert.equal(host.frames.size, 0);
  assert.equal(host.subscribed(), false);
});
test('input and asset modules release state and resources with the engine', async () => {
  const engine = new Engine();
  const target = new EventTarget();
  const released: string[] = [];
  const assets = assetModule({
    load: async (url: string) => url,
    release: (value) => {
      released.push(value);
    },
  });
  engine.install([keyboardModule({ target }), assets]);
  const input = engine.world.getResource(Keyboard);
  const cache = engine.world.getResource(assets.cache);
  const key = () => Object.assign(new Event('keydown'), { code: 'ArrowRight' });
  target.dispatchEvent(key());
  assert.equal(input.isDown('ArrowRight'), true);
  engine.start();
  engine.pause();
  assert.equal(input.isDown('ArrowRight'), false);
  await cache.get('sprite');
  engine.dispose();
  await Promise.resolve();
  target.dispatchEvent(key());
  assert.equal(input.isDown('ArrowRight'), false);
  assert.deepEqual(released, ['sprite']);
  await assert.rejects(cache.get('other'));
});

test('optional network module connects on start, survives pause and closes on stop or disposal', () => {
  const original = globalThis.WebSocket;
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    bufferedAmount = 0;
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      Socket.instances.push(this);
    }
    send() {}
    close() {
      this.closed = true;
      this.readyState = 3;
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const engine = new Engine();
  try {
    const network = networkModule<string, unknown>({
      url: 'ws://example.invalid/ws',
      decoder: { parse: (value) => value },
      onMessage() {},
    });
    engine.install([network]);
    assert.equal(Socket.instances.length, 0);
    engine.start();
    const first = Socket.instances[0]!;
    assert.equal(first.url, 'ws://example.invalid/ws');
    engine.pause();
    engine.resume();
    assert.equal(Socket.instances.length, 1);
    assert.equal(first.closed, false);
    engine.stop();
    assert.equal(first.closed, true);
    assert.equal(first.onmessage, null);
    engine.start();
    assert.equal(Socket.instances.length, 2);
    engine.dispose();
    assert.equal(Socket.instances[1]!.closed, true);
    const paused = new Engine();
    paused.start();
    paused.pause();
    try {
      paused.install([network]);
      assert.equal(Socket.instances.length, 2);
      paused.resume();
      assert.equal(Socket.instances.length, 3);
    } finally {
      paused.dispose();
    }
  } finally {
    engine.dispose();
    globalThis.WebSocket = original;
  }
});
test('browser loop passes raw render deltas, restarts timing on resume and stops on errors', () => {
  const engine = new Engine({ tickRate: 10 });
  const host = fakeDriver();
  const deltas: number[] = [];
  const errors: unknown[] = [];
  let fail = false;
  engine.addSystem({
    id: 'render',
    phase: 'render',
    update({ delta }) {
      deltas.push(+delta.toFixed(6));
      if (fail) throw new Error('boom');
    },
  });
  engine.install([browserModule({ driver: host.driver, onError: (error) => errors.push(error) })]);
  engine.start();
  host.frame(1000);
  host.frame(1100);
  // Long stalls reach render systems unclamped; only fixed steps are capped by maxSteps.
  host.frame(11100);
  engine.pause();
  engine.resume();
  host.frame(20000);
  host.frame(20050);
  assert.deepEqual(deltas, [0, 0.1, 10, 0, 0.05]);
  fail = true;
  host.frame(20100);
  assert.equal(errors.length, 1);
  assert.equal(engine.status, 'stopped');
  assert.equal(host.frames.size, 0);
  engine.dispose();
});

test('a pause raised by a system still restarts frame timing on resume', () => {
  const engine = new Engine({ tickRate: 10 });
  const host = fakeDriver();
  const deltas: number[] = [];
  let pauseNext = false;
  engine.addSystem({
    id: 'render',
    phase: 'render',
    update({ delta }) {
      deltas.push(+delta.toFixed(6));
      if (pauseNext) {
        pauseNext = false;
        engine.pause();
      }
    },
  });
  engine.install([browserModule({ driver: host.driver })]);
  engine.start();
  host.frame(0);
  pauseNext = true;
  host.frame(100);
  assert.equal(host.frames.size, 0);
  engine.resume();
  host.frame(60_000);
  assert.deepEqual(deltas, [0, 0.1, 0]);
  engine.dispose();
});

test('frame loops cap deltas, reset timing and stop when the callback throws', () => {
  const host = fakeDriver();
  const seen: number[] = [];
  let fail = false;
  const loop = createFrameLoop(
    host.driver,
    (seconds) => {
      seen.push(seconds);
      if (fail) throw new Error('frame failed');
    },
    { maxDelta: 0.25 },
  );
  loop.start();
  loop.start();
  assert.equal(host.frames.size, 1);
  host.frame(0);
  host.frame(100);
  host.frame(5000);
  loop.resetTime();
  host.frame(6000);
  assert.deepEqual(seen, [0, 0.1, 0.25, 0]);
  fail = true;
  assert.throws(() => host.frame(6100), /frame failed/);
  assert.equal(loop.running, false);
  assert.equal(host.frames.size, 0);
  assert.throws(() => createFrameLoop(host.driver, () => {}, { maxDelta: 0 }), /delta limit/);
});
