import { component, type Entity, type World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { Position2D, type Point } from './components.js';
export type Matrix2D = readonly [number, number, number, number, number, number];
export interface Transform {
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  parent?: Entity;
}
export const Transform2D = component<Transform>('Transform2D');
export const identity: Matrix2D = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transformPoint(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}
export function inverse(matrix: Matrix2D): Matrix2D {
  const [a, b, c, d, x, y] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error('Transform is not invertible');
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * y - d * x) / determinant,
    (b * x - a * y) / determinant,
  ];
}
function local(value: Transform): Matrix2D {
  const rotation = value.rotation ?? 0,
    x = value.scaleX ?? 1,
    y = value.scaleY ?? 1;
  // Checked individually: this runs per entity per frame and should not allocate.
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(rotation) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    throw new Error('Invalid transform');
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  return [c * x, s * x, -s * y, c * y, value.x, value.y];
}
const origin: Point = Object.freeze({ x: 0, y: 0 });
/** Resolver cache lives for one drawing/collision traversal, so direct component edits remain visible next time. */
export function createTransformResolver(world: World): (entity: Entity) => Matrix2D {
  const cache = new Map<Entity, Matrix2D>();
  const visiting = new Set<Entity>();
  // Parent chains are cached and cycle-checked; parentless entities skip that bookkeeping.
  const chained = (entity: Entity): Matrix2D => {
    if (!world.isAlive(entity)) throw new Error('Stale transform parent');
    const found = cache.get(entity);
    if (found) return found;
    if (visiting.has(entity)) throw new Error('Transform parent cycle');
    visiting.add(entity);
    const value = world.get(entity, Transform2D);
    let matrix = local(value ?? world.get(entity, Position2D) ?? origin);
    if (value?.parent) matrix = multiply(chained(value.parent), matrix);
    visiting.delete(entity);
    cache.set(entity, matrix);
    return matrix;
  };
  const resolve = (entity: Entity): Matrix2D => {
    if (!world.isAlive(entity)) throw new Error('Stale transform parent');
    const value = world.get(entity, Transform2D);
    if (value?.parent) return chained(entity);
    return local(value ?? world.get(entity, Position2D) ?? origin);
  };
  return resolve;
}
export class Camera2D {
  constructor(
    public x = 0,
    public y = 0,
    public zoom = 1,
    public rotation = 0,
  ) {}
  get matrix(): Matrix2D {
    if (!Number.isFinite(this.zoom) || this.zoom <= 0) throw new Error('Invalid camera zoom');
    return inverse(
      local({
        x: this.x,
        y: this.y,
        rotation: this.rotation,
        scaleX: 1 / this.zoom,
        scaleY: 1 / this.zoom,
      }),
    );
  }
  worldToScreen(point: Point): Point {
    return transformPoint(this.matrix, point);
  }
  screenToWorld(point: Point): Point {
    return transformPoint(inverse(this.matrix), point);
  }
}
export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Sprite {
  image: CanvasImageSource;
  width: number;
  height: number;
  frame?: SpriteFrame;
  anchorX?: number;
  anchorY?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  layer?: number;
}
export const Sprite2D = component<Sprite>('Sprite2D');
export interface Animation {
  frames: readonly SpriteFrame[];
  fps: number;
  loop?: boolean;
  playing?: boolean;
  elapsed?: number;
  frame?: number;
}
export const Animation2D = component<Animation>('Animation2D');
export function animationModule(): EngineModule {
  return {
    id: 'animation-2d',
    setup(engine, scope) {
      engine.addSystem(
        {
          id: 'animation-2d:advance',
          order: -10,
          update({ world, delta }) {
            for (const entity of world.query(Animation2D, Sprite2D)) {
              const animation = world.require(entity, Animation2D);
              if (animation.playing === false) continue;
              if (!Number.isFinite(animation.fps) || animation.fps <= 0 || !animation.frames.length)
                throw new Error('Invalid sprite animation');
              animation.elapsed = (animation.elapsed ?? 0) + delta;
              const total = Math.floor((animation.elapsed + 1e-10) * animation.fps);
              const index =
                animation.loop === false
                  ? Math.min(total, animation.frames.length - 1)
                  : total % animation.frames.length;
              animation.frame = index;
              world.require(entity, Sprite2D).frame = animation.frames[index]!;
              if (animation.loop === false && total >= animation.frames.length)
                animation.playing = false;
            }
          },
        },
        scope,
      );
    },
  };
}
