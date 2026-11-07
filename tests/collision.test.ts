import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Transform2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
import {
  Collider2D,
  detectCollisions,
  collisionModule,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
test('circle/AABB detection, masks, enter/stay/exit and recycled handles', () => {
  const engine = new Engine(),
    a = engine.world.create(),
    b = engine.world.create();
  engine.world.set(a, Position2D, { x: 0, y: 0 });
  engine.world.set(a, Collider2D, { kind: 'rect', width: 10, height: 10 });
  engine.world.set(b, Position2D, { x: 15, y: 5 });
  engine.world.set(b, Collider2D, { kind: 'circle', radius: 5 });
  assert.equal(detectCollisions(engine.world).length, 1);
  const events: string[] = [];
  engine.install([
    collisionModule({
      onEnter: () => events.push('enter'),
      onStay: () => events.push('stay'),
      onExit: () => events.push('exit'),
    }),
  ]);
  engine.start();
  engine.advance(engine.step);
  engine.advance(engine.step);
  engine.world.require(b, Position2D).x = 20;
  engine.advance(engine.step);
  assert.deepEqual(events, ['enter', 'stay', 'exit']);
  engine.world.require(b, Collider2D).mask = 0;
  engine.world.require(b, Position2D).x = 5;
  assert.equal(detectCollisions(engine.world).length, 0);
  engine.world.require(b, Collider2D).mask = -1;
  engine.advance(engine.step);
  engine.world.destroy(b);
  engine.advance(engine.step);
  const recycled = engine.world.create();
  assert.equal(recycled.index, b.index);
  engine.world.set(recycled, Position2D, { x: 5, y: 5 });
  engine.world.set(recycled, Collider2D, { kind: 'circle', radius: 5 });
  engine.advance(engine.step);
  assert.equal(events.at(-1), 'enter');
  engine.dispose();
});

test('transformed collider bounds follow rotation, offset and scale', () => {
  const world = new Engine().world;
  const target = world.create();
  // Rotating a 20×10 rect at offset (5,0) by 90° yields world AABB x∈[90,100], y∈[105,125].
  world.set(target, Transform2D, { x: 100, y: 100, rotation: Math.PI / 2 });
  world.set(target, Collider2D, { kind: 'rect', width: 20, height: 10, offsetX: 5 });
  const round = world.create();
  // Non-uniform scale encloses the circle with its larger axis: radius 5 × 2.
  world.set(round, Transform2D, { x: 300, y: 300, scaleX: 2 });
  world.set(round, Collider2D, { kind: 'circle', radius: 5 });
  const hits = (x: number, y: number): number => {
    const probe = world.create();
    world.set(probe, Position2D, { x, y });
    world.set(probe, Collider2D, { kind: 'circle', radius: 1 });
    const pairs = detectCollisions(world);
    for (const pair of pairs) assert.ok(pair.a.index < pair.b.index);
    world.destroy(probe);
    return pairs.length;
  };
  assert.equal(hits(95, 115), 1);
  assert.equal(hits(100.5, 115), 1);
  assert.equal(hits(101.5, 115), 0);
  assert.equal(hits(95, 103), 0);
  assert.equal(hits(310.5, 300), 1);
  assert.equal(hits(311.5, 300), 0);
});

test('an index recycled within one step reports enter for the new pair and exit for the old', () => {
  const engine = new Engine();
  const world = engine.world;
  const events: string[] = [];
  engine.install([
    collisionModule({
      onEnter: ({ b }) => events.push(`enter:${b.generation}`),
      onStay: ({ b }) => events.push(`stay:${b.generation}`),
      onExit: ({ b }) => events.push(`exit:${b.generation}`),
    }),
  ]);
  const a = world.create();
  world.set(a, Position2D, { x: 0, y: 0 });
  world.set(a, Collider2D, { kind: 'circle', radius: 5 });
  const b = world.create();
  world.set(b, Position2D, { x: 1, y: 0 });
  world.set(b, Collider2D, { kind: 'circle', radius: 5 });
  engine.start();
  engine.advance(engine.step);
  world.destroy(b);
  const recycled = world.create();
  assert.equal(recycled.index, b.index);
  world.set(recycled, Position2D, { x: 1, y: 0 });
  world.set(recycled, Collider2D, { kind: 'circle', radius: 5 });
  engine.advance(engine.step);
  engine.advance(engine.step);
  assert.deepEqual(events, ['enter:0', 'enter:1', 'exit:0', 'stay:1']);
  engine.dispose();
});

interface Probe {
  index: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  radius?: number;
  group: number;
  mask: number;
}
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}
/** Brute-force reference: stable minX order, every later item, inclusive AABB then exact shape. */
function bruteForce(probes: Probe[]): Array<[number, number]> {
  const sorted = [...probes].sort((a, b) => a.minX - b.minX);
  const touching = (a: Probe, b: Probe): boolean => {
    if (a.radius === undefined && b.radius === undefined) return true;
    if (a.radius !== undefined && b.radius !== undefined)
      return Math.hypot(a.cx - b.cx, a.cy - b.cy) ** 2 <= (a.radius + b.radius) ** 2;
    const circle = a.radius === undefined ? b : a,
      rect = a.radius === undefined ? a : b;
    const dx = circle.cx - Math.max(rect.minX, Math.min(rect.maxX, circle.cx)),
      dy = circle.cy - Math.max(rect.minY, Math.min(rect.maxY, circle.cy));
    return dx * dx + dy * dy <= circle.radius! ** 2;
  };
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!,
        b = sorted[j]!;
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
      if (!(a.group & b.mask) || !(b.group & a.mask) || !touching(a, b)) continue;
      pairs.push(a.index < b.index ? [a.index, b.index] : [b.index, a.index]);
    }
  return pairs;
}
function randomScene(seed: number, count: number): { world: Engine['world']; probes: Probe[] } {
  const world = new Engine().world;
  const next = seeded(seed);
  const probes: Probe[] = [];
  for (let i = 0; i < count; i++) {
    const entity = world.create();
    // A few stacked duplicates, occasional huge or zero-size colliders, negative coordinates.
    const x = i % 17 === 0 ? 0 : next() * 1000 - 500,
      y = i % 17 === 0 ? 0 : next() * 1000 - 500;
    const roll = next();
    const size = roll < 0.05 ? 200 + next() * 400 : roll < 0.1 ? 0 : 2 + next() * 28;
    const group = 1 + Math.floor(next() * 3),
      mask = next() < 0.8 ? -1 : group;
    if (next() < 0.5) {
      world.set(entity, Position2D, { x, y });
      world.set(entity, Collider2D, { kind: 'circle', radius: size / 2, group, mask });
      probes.push({
        index: entity.index,
        minX: x - size / 2,
        maxX: x + size / 2,
        minY: y - size / 2,
        maxY: y + size / 2,
        cx: x,
        cy: y,
        radius: size / 2,
        group,
        mask,
      });
    } else {
      const rotation = next() < 0.3 ? next() * Math.PI : 0,
        height = size * (0.3 + next());
      world.set(entity, Transform2D, { x, y, rotation });
      world.set(entity, Collider2D, { kind: 'rect', width: size, height, group, mask });
      const c = Math.cos(rotation),
        s = Math.sin(rotation);
      const xs = [0, size * c, -height * s, size * c - height * s].map((v) => x + v),
        ys = [0, size * s, height * c, size * s + height * c].map((v) => y + v);
      probes.push({
        index: entity.index,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        cx: x,
        cy: y,
        group,
        mask,
      });
    }
  }
  return { world, probes };
}

test('detected pairs and their order match a brute-force reference', () => {
  for (const [seed, count] of [
    [1, 0],
    [2, 1],
    [3, 12],
    [4, 60],
    [5, 150],
    [6, 400],
    [7, 900],
  ] as const) {
    const { world, probes } = randomScene(seed, count);
    const actual = detectCollisions(world).map(({ a, b }) => [a.index, b.index]);
    assert.deepEqual(actual, bruteForce(probes), `seed ${seed}, ${count} colliders`);
  }
});

test('explicit grid cell sizes keep the same pairs and order', () => {
  for (const [seed, count] of [
    [11, 3],
    [12, 80],
    [13, 300],
  ] as const) {
    const { world, probes } = randomScene(seed, count);
    const expected = bruteForce(probes);
    for (const cellSize of [0.5, 7.5, 40, 5000]) {
      const actual = detectCollisions(world, { cellSize }).map(({ a, b }) => [a.index, b.index]);
      assert.deepEqual(actual, expected, `seed ${seed}, cellSize ${cellSize}`);
    }
  }
  const { world } = randomScene(14, 5);
  for (const cellSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => detectCollisions(world, { cellSize }), /cell size/);
  assert.throws(() => collisionModule({ cellSize: 0 }), /cell size/);
});

test('collisionModule forwards cellSize and reports the same pairs', () => {
  const engine = new Engine();
  const scene = randomScene(15, 200);
  // Rebuild the same seeded scene inside the engine world so the module sees it.
  for (const entity of scene.world.query(Collider2D)) {
    const copy = engine.world.create();
    assert.equal(copy.index, entity.index);
    engine.world.set(copy, Collider2D, scene.world.require(entity, Collider2D));
    const transform = scene.world.get(entity, Transform2D);
    if (transform) engine.world.set(copy, Transform2D, transform);
    const position = scene.world.get(entity, Position2D);
    if (position) engine.world.set(copy, Position2D, position);
  }
  const entered: number[][] = [];
  engine.install([
    collisionModule({ cellSize: 25, onEnter: ({ a, b }) => entered.push([a.index, b.index]) }),
  ]);
  engine.start();
  engine.advance(engine.step);
  assert.deepEqual(entered, bruteForce(scene.probes));
  engine.dispose();
});
