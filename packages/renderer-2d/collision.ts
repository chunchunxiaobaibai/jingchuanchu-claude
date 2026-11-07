import { component, type Entity, type World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { createTransformResolver } from './features.js';
export type Collider = (
  { kind: 'rect'; width: number; height: number } | { kind: 'circle'; radius: number }
) & { offsetX?: number; offsetY?: number; group?: number; mask?: number };
export const Collider2D = component<Collider>('Collider2D');
export interface CollisionPair {
  a: Entity;
  b: Entity;
}
interface Bounds {
  entity: Entity;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  radius: number | undefined;
  group: number;
  mask: number;
}
function intersects(a: Bounds, b: Bounds): boolean {
  if (a.radius === undefined && b.radius === undefined) return true;
  if (a.radius !== undefined && b.radius !== undefined)
    return (
      (a.centerX - b.centerX) ** 2 + (a.centerY - b.centerY) ** 2 <= (a.radius + b.radius) ** 2
    );
  const circle = a.radius === undefined ? b : a,
    rect = a.radius === undefined ? a : b;
  const x = Math.max(rect.minX, Math.min(rect.maxX, circle.centerX)),
    y = Math.max(rect.minY, Math.min(rect.maxY, circle.centerY));
  return (circle.centerX - x) ** 2 + (circle.centerY - y) ** 2 <= circle.radius! ** 2;
}
export interface CollisionOptions {
  /**
   * Opt-in uniform grid with this cell edge in world units. Measured slower than the default
   * X-axis sweep for typical layouts; it helps when colliders crowd into narrow vertical bands.
   */
  cellSize?: number;
}
function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX &&
    b.minX <= a.maxX &&
    a.minY <= b.maxY &&
    b.minY <= a.maxY &&
    !!(a.group & b.mask) &&
    !!(b.group & a.mask) &&
    intersects(a, b)
  );
}
function toPair(a: Bounds, b: Bounds): CollisionPair {
  return a.entity.index < b.entity.index
    ? { a: a.entity, b: b.entity }
    : { a: b.entity, b: a.entity };
}
function validCellSize(cellSize: number | undefined): void {
  if (cellSize !== undefined && !(Number.isFinite(cellSize) && cellSize > 0))
    throw new Error('Invalid collision cell size');
}
// Colliders covering more cells than this are tested directly against the sorted list.
const largeCells = 16;
/** Rectangles use world-space AABBs; transformed circles use a conservative enclosing circle. */
export function detectCollisions(world: World, options: CollisionOptions = {}): CollisionPair[] {
  validCellSize(options.cellSize);
  const resolve = createTransformResolver(world);
  const bounds: Bounds[] = [];
  for (const entity of world.query(Collider2D)) {
    const collider = world.require(entity, Collider2D),
      [m0, m1, m2, m3, m4, m5] = resolve(entity),
      offsetX = collider.offsetX ?? 0,
      offsetY = collider.offsetY ?? 0;
    // Matrix terms are applied inline so per-frame bounds allocate no temporary points.
    const centerX = m0 * offsetX + m2 * offsetY + m4,
      centerY = m1 * offsetX + m3 * offsetY + m5;
    let radius: number | undefined, minX: number, maxX: number, minY: number, maxY: number;
    if (collider.kind === 'circle') {
      if (!Number.isFinite(collider.radius) || collider.radius < 0)
        throw new Error('Invalid collider radius');
      const a = m0 ** 2 + m1 ** 2,
        b = m2 ** 2 + m3 ** 2,
        c = m0 * m2 + m1 * m3;
      radius = collider.radius * Math.sqrt((a + b + Math.sqrt((a - b) ** 2 + 4 * c * c)) / 2);
      minX = centerX - radius;
      maxX = centerX + radius;
      minY = centerY - radius;
      maxY = centerY + radius;
    } else {
      const { width, height } = collider;
      if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0)
        throw new Error('Invalid collider dimensions');
      // Corners are the center plus the transformed width/height edge vectors.
      const wx = m0 * width,
        wy = m1 * width,
        hx = m2 * height,
        hy = m3 * height;
      minX = centerX + Math.min(0, wx) + Math.min(0, hx);
      maxX = centerX + Math.max(0, wx) + Math.max(0, hx);
      minY = centerY + Math.min(0, wy) + Math.min(0, hy);
      maxY = centerY + Math.max(0, wy) + Math.max(0, hy);
    }
    bounds.push({
      entity,
      minX,
      maxX,
      minY,
      maxY,
      centerX,
      centerY,
      radius,
      group: collider.group ?? 1,
      mask: collider.mask ?? -1,
    });
  }
  // Results always follow sweep order (stable minX rank, then partner rank), whichever
  // broad phase runs, so enter/stay/exit callbacks keep their order.
  bounds.sort((a, b) => a.minX - b.minX);
  if (options.cellSize === undefined) return sweep(bounds);
  return grid(bounds, options.cellSize) ?? sweep(bounds);
}
function sweep(bounds: readonly Bounds[]): CollisionPair[] {
  const pairs: CollisionPair[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const a = bounds[i]!;
    for (let j = i + 1; j < bounds.length; j++) {
      const b = bounds[j]!;
      if (b.minX > a.maxX) break;
      if (overlaps(a, b)) pairs.push(toPair(a, b));
    }
  }
  return pairs;
}
/** Uniform grid; returns undefined when the cell index range exceeds safe integers. */
function grid(bounds: readonly Bounds[], size: number): CollisionPair[] | undefined {
  const count = bounds.length;
  let originX = Infinity,
    originY = Infinity,
    endX = -Infinity,
    endY = -Infinity;
  for (const item of bounds) {
    originX = Math.min(originX, item.minX);
    originY = Math.min(originY, item.minY);
    endX = Math.max(endX, item.maxX);
    endY = Math.max(endY, item.maxY);
  }
  const columns = Math.floor((endX - originX) / size) + 1;
  const rows = Math.floor((endY - originY) / size) + 1;
  if (!(columns * rows <= Number.MAX_SAFE_INTEGER) || count * count > Number.MAX_SAFE_INTEGER)
    return undefined;
  // Cell members are ranks into the minX-sorted list, so each list is ascending.
  const cells = new Map<number, number[]>();
  const large: number[] = [];
  const isLarge = new Uint8Array(count);
  for (let rank = 0; rank < count; rank++) {
    const item = bounds[rank]!;
    const x0 = Math.floor((item.minX - originX) / size),
      x1 = Math.floor((item.maxX - originX) / size),
      y0 = Math.floor((item.minY - originY) / size),
      y1 = Math.floor((item.maxY - originY) / size);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > largeCells) {
      large.push(rank);
      isLarge[rank] = 1;
      continue;
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const key = y * columns + x;
        const members = cells.get(key);
        if (members) members.push(rank);
        else cells.set(key, [rank]);
      }
  }
  // Pair keys encode (lower rank, higher rank) so a numeric sort restores sweep order.
  const found: number[] = [];
  for (const [key, members] of cells) {
    if (members.length < 2) continue;
    const cellX = key % columns,
      cellY = (key - cellX) / columns;
    for (let i = 0; i < members.length; i++) {
      const lower = members[i]!,
        a = bounds[lower]!;
      for (let j = i + 1; j < members.length; j++) {
        const higher = members[j]!,
          b = bounds[higher]!;
        // Test a pair only in the cell holding its overlap's top-left corner; b.minX is the
        // larger minX because ranks follow minX order.
        if (
          Math.floor((b.minX - originX) / size) !== cellX ||
          Math.floor((Math.max(a.minY, b.minY) - originY) / size) !== cellY
        )
          continue;
        if (overlaps(a, b)) found.push(lower * count + higher);
      }
    }
  }
  for (const rank of large) {
    const item = bounds[rank]!;
    for (let other = 0; other < count; other++) {
      const candidate = bounds[other]!;
      if (candidate.minX > item.maxX) break;
      if (other === rank || (isLarge[other] && other < rank)) continue;
      if (overlaps(item, candidate))
        found.push(Math.min(rank, other) * count + Math.max(rank, other));
    }
  }
  const order = Float64Array.from(found).sort();
  const pairs: CollisionPair[] = new Array(order.length);
  for (let i = 0; i < order.length; i++) {
    const higher = order[i]! % count;
    pairs[i] = toPair(bounds[(order[i]! - higher) / count]!, bounds[higher]!);
  }
  return pairs;
}
// Pairs are ordered (a.index < b.index), so b.index below 2^26 keeps the packed key under 2^52.
const pairStride = 2 ** 26;
export function collisionModule(
  options: CollisionOptions & {
    onEnter?: (pair: CollisionPair) => void;
    onStay?: (pair: CollisionPair) => void;
    onExit?: (pair: CollisionPair) => void;
  } = {},
): EngineModule {
  validCellSize(options.cellSize);
  const detection: CollisionOptions =
    options.cellSize === undefined ? {} : { cellSize: options.cellSize };
  return {
    id: 'collision-2d',
    setup(engine, scope) {
      // Index pairs pack into one safe integer; handle identity distinguishes recycled
      // indices because a World keeps one frozen handle per entity lifetime.
      const key = (pair: CollisionPair): number | string =>
        pair.b.index < pairStride
          ? pair.a.index * pairStride + pair.b.index
          : `${pair.a.index}:${pair.b.index}`;
      const same = (left: CollisionPair | undefined, right: CollisionPair): boolean =>
        left !== undefined && left.a === right.a && left.b === right.b;
      let previous = new Map<number | string, CollisionPair>();
      scope.own(() => previous.clear());
      engine.addSystem(
        {
          id: 'collision-2d:detect',
          order: 50,
          update({ world }) {
            const current = new Map<number | string, CollisionPair>();
            for (const pair of detectCollisions(world, detection)) {
              const id = key(pair);
              current.set(id, pair);
              if (same(previous.get(id), pair)) options.onStay?.(pair);
              else options.onEnter?.(pair);
            }
            for (const [id, pair] of previous)
              if (!same(current.get(id), pair)) options.onExit?.(pair);
            previous = current;
          },
        },
        scope,
      );
    },
  };
}
