import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import {
  Camera2D,
  Transform2D,
  Sprite2D,
  Animation2D,
  animationModule,
  createTransformResolver,
  transformPoint,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
test('parent transforms, camera roundtrips and invalid hierarchies', () => {
  const world = new World(),
    parent = world.create(),
    child = world.create();
  world.set(parent, Transform2D, { x: 10, y: 20, rotation: Math.PI / 2 });
  world.set(child, Transform2D, { x: 5, y: 0, parent });
  const result = transformPoint(createTransformResolver(world)(child), { x: 0, y: 0 });
  assert(Math.abs(result.x - 10) < 1e-10);
  assert(Math.abs(result.y - 25) < 1e-10);
  const camera = new Camera2D(10, 20, 2, 0.25),
    point = { x: 12, y: 24 };
  const roundtrip = camera.screenToWorld(camera.worldToScreen(point));
  assert(Math.abs(roundtrip.x - point.x) < 1e-10);
  assert(Math.abs(roundtrip.y - point.y) < 1e-10);
  world.require(parent, Transform2D).parent = child;
  assert.throws(() => createTransformResolver(world)(child), /cycle/);
  delete world.require(parent, Transform2D).parent;
  world.destroy(parent);
  assert.throws(() => createTransformResolver(world)(child), /Stale/);
  world.dispose();
});
test('animation uses fixed steps, pauses, and finishes non-looping clips', () => {
  const engine = new Engine({ tickRate: 2 }),
    entity = engine.world.create();
  const frames = [
    { x: 0, y: 0, width: 16, height: 16 },
    { x: 16, y: 0, width: 16, height: 16 },
  ];
  engine.world.set(entity, Sprite2D, { image: {} as CanvasImageSource, width: 16, height: 16 });
  engine.world.set(entity, Animation2D, { frames, fps: 2, loop: false });
  engine.install([animationModule()]);
  engine.start();
  engine.advance(0.5);
  assert.equal(engine.world.require(entity, Sprite2D).frame, frames[1]);
  engine.pause();
  engine.advance(10);
  assert.equal(engine.world.require(entity, Animation2D).elapsed, 0.5);
  engine.resume();
  engine.advance(0.5);
  assert.equal(engine.world.require(entity, Animation2D).playing, false);
  engine.dispose();
});

test('drawWorld issues layer-ordered draw calls with transforms, sprites and camera', () => {
  const original = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 } as Window & typeof globalThis;
  const log: string[] = [];
  const format = (values: unknown[]): string =>
    values
      .map((value) => (typeof value === 'number' ? +value.toFixed(6) : String(value)))
      .join(',');
  const record =
    (name: string) =>
    (...values: unknown[]): void => {
      log.push(`${name} ${format(values)}`);
    };
  const context = {
    setTransform() {},
    ...Object.fromEntries(
      ['save', 'restore', 'transform', 'scale', 'fillRect', 'beginPath', 'arc', 'fill'].map(
        (name) => [name, record(name)],
      ),
    ),
    drawImage: (image: unknown, ...values: unknown[]) =>
      log.push(`drawImage ${String(image)},${format(values)}`),
    set fillStyle(value: string) {
      log.push(`fillStyle ${value}`);
    },
    set globalAlpha(value: number) {
      log.push(`alpha ${value}`);
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const image = { toString: () => 'img' } as unknown as CanvasImageSource;
  try {
    const renderer = new Canvas2D(canvas);
    const world = new World();
    const e1 = world.create();
    world.set(e1, Position2D, { x: 1, y: 2 });
    world.set(e1, Shape2D, { kind: 'rect', color: 'red', width: 4, height: 3, layer: 1 });
    const e2 = world.create();
    world.set(e2, Position2D, { x: 5, y: 5 });
    world.set(e2, Shape2D, { kind: 'circle', color: 'blue', width: 2, height: 2, layer: 0 });
    const e3 = world.create();
    world.set(e3, Transform2D, { x: 10, y: 0 });
    world.set(e3, Shape2D, { kind: 'rect', color: 'green', width: 2, height: 2, layer: 1 });
    const e4 = world.create();
    world.set(e4, Transform2D, { x: 1, y: 1, scaleX: 2, parent: e3 });
    world.set(e4, Sprite2D, {
      image,
      width: 8,
      height: 4,
      anchorX: 0.5,
      anchorY: 1,
      flipX: true,
      opacity: 0.5,
      layer: 0,
    });
    const e5 = world.create();
    world.set(e5, Position2D, { x: 3, y: 3 });
    world.set(e5, Sprite2D, {
      image,
      width: 6,
      height: 6,
      frame: { x: 1, y: 2, width: 3, height: 4 },
      layer: 2,
    });
    const e6 = world.create();
    world.set(e6, Sprite2D, { image, width: 0, height: 5, layer: 2 });
    renderer.drawWorld(world);
    assert.deepEqual(log, [
      'fillStyle blue',
      'beginPath ',
      'arc 5,5,1,0,6.283185',
      'fill ',
      'save ',
      'transform 2,0,0,1,11,1',
      'alpha 0.5',
      'scale -1,1',
      'drawImage img,-4,-4,8,4',
      'restore ',
      'fillStyle red',
      'fillRect 1,2,4,3',
      'save ',
      'transform 1,0,0,1,10,0',
      'fillStyle green',
      'fillRect 0,0,2,2',
      'restore ',
      'save ',
      'transform 1,0,0,1,3,3',
      'alpha 1',
      'scale 1,1',
      'drawImage img,1,2,3,4,0,0,6,6',
      'restore ',
      'save ',
      'transform 1,0,0,1,0,0',
      'restore ',
    ]);
    log.length = 0;
    // With a camera every item is transformed, including position-only shapes.
    renderer.drawWorld(world, new Camera2D(5, 0, 2));
    assert.deepEqual(log.slice(0, 5), [
      'save ',
      'transform 2,0,0,2,0,10',
      'fillStyle blue',
      'beginPath ',
      'arc 0,0,1,0,6.283185',
    ]);
    assert.ok(log.includes('transform 4,0,0,2,12,2'));
    assert.equal(log.filter((line) => line === 'save ').length, 6);
    assert.equal(log.filter((line) => line === 'restore ').length, 6);
    world.dispose();
  } finally {
    globalThis.window = original;
  }
});
