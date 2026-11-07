import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Canvas2D, Position2D, Shape2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { Sprite2D, Transform2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
import {
  Collider2D,
  collisionModule,
  detectCollisions,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
import { StateStore } from '@xiaobaibaifqy/jingchuanchu-app';
import {
  computed,
  defineComponent,
  effect,
  mountComponent,
  Owner,
  signal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { Window as HappyWindow } from 'happy-dom';
// Internal: lets each batch include the scheduled effect/render work synchronously.
import { flushSync } from '../packages/app/runtime/scheduler.js';
const results: Array<{ name: string; medianMs: number; minMs: number; maxMs: number }> = [];
// Work counts that explain timings (effect runs, DOM moves); recorded once outside measurement.
const counters: Record<string, number> = {};
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function measure(name: string, run: () => void) {
  for (let i = 0; i < 5; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < 15; i++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  results.push({ name, medianMs: samples[7]!, minMs: samples[0]!, maxMs: samples[14]! });
}
let checksum = 0;
for (const size of [100, 1000, 10000]) {
  const world = new World();
  const tokens = Array.from({ length: 4 }, (_, i) => component<number>(String(i)));
  for (let i = 0; i < size; i++) {
    const entity = world.create();
    for (const token of tokens) world.set(entity, token, i);
  }
  for (const count of [1, 2, 4])
    measure(`query:${size}:${count}`, () => {
      for (let j = 0; j < 20; j++)
        for (const entity of world.query(...tokens.slice(0, count))) checksum += entity.index;
    });
  world.dispose();
}
for (const diagnostics of [true, false]) {
  const engine = new Engine({ tickRate: 60, diagnostics });
  for (let i = 0; i < 1000; i++)
    engine.addSystem({
      id: String(i),
      phase: i % 2 ? 'render' : 'fixed',
      update() {
        checksum++;
      },
    });
  engine.start();
  measure(`systems:1000:diagnostics=${diagnostics}`, () => {
    for (let i = 0; i < 100; i++) engine.advance(engine.step);
  });
  engine.dispose();
}
// Mock Canvas isolates JS traversal/sorting cost; it does not measure browser GPU/Canvas rendering.
const original = globalThis.window;
globalThis.window = { devicePixelRatio: 1 } as Window & typeof globalThis;
const context = { setTransform() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {} };
const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
const renderer = new Canvas2D(canvas);
for (const size of [100, 1000]) {
  const world = new World();
  for (let i = 0; i < size; i++) {
    const e = world.create();
    world.set(e, Position2D, { x: i % 960, y: i % 600 });
    world.set(e, Shape2D, { kind: 'rect', color: '#fff', width: 10, height: 10, layer: i % 7 });
  }
  measure(`draw-js:${size}`, () => {
    for (let j = 0; j < 20; j++) renderer.drawWorld(world);
  });
  world.dispose();
}
// Transformed sprites take the save/transform/restore path and allocate a matrix per item.
Object.assign(context, {
  save() {},
  restore() {},
  transform() {},
  scale() {},
  drawImage() {
    checksum++;
  },
});
const image = {} as CanvasImageSource;
for (const size of [1000, 5000]) {
  const world = new World();
  const next = random(size);
  for (let i = 0; i < size; i++) {
    const e = world.create();
    world.set(e, Transform2D, { x: next() * 960, y: next() * 600, rotation: next() * Math.PI });
    world.set(e, Sprite2D, { image, width: 16, height: 16, anchorX: 0.5, layer: i % 7 });
  }
  measure(`draw-sprites-js:${size}`, () => {
    for (let j = 0; j < 20; j++) renderer.drawWorld(world);
  });
  world.dispose();
}
globalThis.window = original;

// Collision: mixed rect/circle colliders; 20 frames per batch. Layouts stress different
// broad phases: uniform density, one dense cluster, a few huge colliders, a narrow column.
type Layout = 'uniform' | 'dense' | 'large' | 'strip';
function addColliders(world: World, size: number, layout: Layout): void {
  const next = random(size);
  const extent = layout === 'dense' ? 150 : Math.sqrt(size) * 45;
  for (let i = 0; i < size; i++) {
    const e = world.create();
    const x = layout === 'strip' ? next() * 40 : next() * extent;
    const y = layout === 'strip' ? next() * size * 20 : next() * extent;
    world.set(e, Transform2D, { x, y, rotation: next() });
    const huge = layout === 'large' && i % 20 === 0;
    world.set(
      e,
      Collider2D,
      huge
        ? { kind: 'rect', width: 400, height: 300 }
        : i % 2
          ? { kind: 'rect', width: 20, height: 12 }
          : { kind: 'circle', radius: 8 },
    );
  }
}
for (const [layout, size] of [
  ['uniform', 50],
  ['uniform', 500],
  ['uniform', 2000],
  ['dense', 500],
  ['large', 500],
  ['strip', 1000],
] as const) {
  const name = layout === 'uniform' ? String(size) : `${layout}-${size}`;
  const world = new World();
  addColliders(world, size, layout);
  counters[`collision-pairs:${name}`] = detectCollisions(world).length;
  measure(`collision-detect:${name}`, () => {
    for (let j = 0; j < 20; j++) checksum += detectCollisions(world).length;
  });
  // Opt-in grid with cells about twice the typical collider extent.
  if (layout === 'strip' || size === 2000)
    measure(`collision-detect:${name}:grid40`, () => {
      for (let j = 0; j < 20; j++) checksum += detectCollisions(world, { cellSize: 40 }).length;
    });
  world.dispose();
  // Through the module: adds pair keys and enter/stay/exit bookkeeping.
  const engine = new Engine({ tickRate: 60, diagnostics: false });
  engine.install([collisionModule({ onStay: () => checksum++ })]);
  addColliders(engine.world, size, layout);
  engine.start();
  measure(`collision-system:${name}`, () => {
    for (let j = 0; j < 20; j++) engine.advance(engine.step);
  });
  engine.dispose();
}

// Many small queries per frame: 30 queries over 1,000 entities, 60 frames per batch.
{
  const world = new World();
  const common = component<number>('common');
  const tagged = component<number>('tagged');
  for (let i = 0; i < 1000; i++) {
    const e = world.create();
    world.set(e, common, i);
    if (i % 100 === 0) world.set(e, tagged, i);
  }
  measure('query-frame:1000x30:rare', () => {
    for (let frame = 0; frame < 60; frame++)
      for (let q = 0; q < 30; q++)
        for (const entity of world.query(tagged, common)) checksum += entity.index;
  });
  measure('query-frame:1000x30:all', () => {
    for (let frame = 0; frame < 60; frame++)
      for (let q = 0; q < 30; q++)
        for (const entity of world.query(common)) checksum += entity.index;
  });
  world.dispose();
}

// Reactive writes: object state replaced per frame as Store/HUD code does; 60 frames per batch.
interface Enemy {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}
for (const enemies of [10, 200]) {
  const list = (): readonly Enemy[] =>
    Array.from({ length: enemies }, (_, i) => ({ id: i, x: i, y: i }));
  const state = signal<{
    score: number;
    player: { readonly x: number; readonly y: number };
    enemies: readonly Enemy[];
  }>({ score: 0, player: { x: 0, y: 0 }, enemies: list() });
  measure(`signal-object-write:enemies=${enemies}`, () => {
    for (let frame = 0; frame < 60; frame++)
      state.update((previous) => ({ ...previous, score: previous.score + 1 }));
  });
  const legacy = new StateStore<{ score: number; enemies: readonly Enemy[] }>({
    score: 0,
    enemies: list(),
  });
  measure(`legacy-state-update:enemies=${enemies}`, () => {
    for (let frame = 0; frame < 60; frame++)
      legacy.update((previous) => ({ ...previous, score: previous.score + 1 }));
  });
}
{
  // Mirrors the legacy mountGame input system, which snapshots input on every fixed tick.
  const input = new StateStore({ left: false, right: false, jump: false, pointer: { x: 0, y: 0 } });
  measure('legacy-input-snapshot:600-ticks', () => {
    for (let tick = 0; tick < 600; tick++) input.update((previous) => ({ ...previous }));
  });
}

// Computed whose output rarely changes, feeding 50 effects; 60 frames per batch.
{
  const scope = new Scope();
  const tick = signal(0);
  const level = computed(() => Math.floor(tick() / 1_000_000));
  let runs = 0;
  for (let i = 0; i < 50; i++)
    effect(() => {
      checksum += level();
      runs++;
    }, scope);
  flushSync();
  const before = runs;
  const frame = (): void => {
    tick.update((value) => value + 1);
    flushSync();
  };
  frame();
  counters['computed-unchanged:effect-runs-per-frame'] = runs - before;
  measure('computed-unchanged:50-effects', () => {
    for (let f = 0; f < 60; f++) frame();
  });
  scope.dispose();
}

// Keyed each over 200 rows in happy-dom; 20 updates per batch.
{
  type Row = { id: number; name: string };
  const window = new HappyWindow();
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  let rows!: { (): readonly Row[]; set(next: Row[]): void };
  const initial = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row ${i}` }));
  const List = defineComponent({
    selector: 'bench-each-list',
    setup(context) {
      rows = context.signal<Row[]>(initial);
      return { rows };
    },
    $template: '<ul><template data-jcc-each-0><li data-jcc-text-1></li></template></ul>',
    $bindings: [
      {
        kind: 'each',
        id: 0,
        item: 'item',
        source: (scope) => (scope.rows as () => readonly Row[])(),
        key: (scope) => (scope.item as Row).id,
      },
      {
        kind: 'text',
        id: 1,
        block: 0,
        textIndex: 0,
        read: (scope) => (scope.item as Row).name,
      },
    ],
  });
  const instance = mountComponent(host, List, { owner: new Owner(), onError: console.error });
  flushSync();
  const swapped = (list: readonly Row[]): Row[] => {
    const copy = [...list];
    [copy[10], copy[190]] = [copy[190]!, copy[10]!];
    return copy;
  };
  const renamed = (list: readonly Row[]): Row[] =>
    list.map((row, i) => (i === 50 ? { ...row, name: `${row.name}!` } : row));
  const scenarios: Array<[string, (list: readonly Row[]) => Row[]]> = [
    ['swap-two', swapped],
    ['reverse', (list) => [...list].reverse()],
    ['rename-one', renamed],
  ];
  const observer = new window.MutationObserver(() => {});
  observer.observe(host as unknown as Parameters<typeof observer.observe>[0], {
    childList: true,
    subtree: true,
  });
  for (const [name, change] of scenarios) {
    observer.takeRecords();
    rows.set(change(rows()));
    flushSync();
    counters[`each-200:${name}:dom-insertions`] = observer
      .takeRecords()
      .reduce((total, record) => total + record.addedNodes.length, 0);
    measure(`each-200:${name}`, () => {
      for (let i = 0; i < 20; i++) {
        rows.set(change(rows()));
        flushSync();
      }
    });
  }
  observer.disconnect();
  instance.dispose();
  await window.happyDOM.close();
}
const output = {
  node: process.version,
  platform: process.platform,
  units: 'milliseconds per batch',
  samples: 15,
  checksum,
  counters,
  results,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
