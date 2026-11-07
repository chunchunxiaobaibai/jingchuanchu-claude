import type { Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export class TweenError extends Error {
  constructor(
    readonly tweenId: number,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Tween ${tweenId} failed${detail}`, { cause });
    this.name = 'TweenError';
  }
}

export interface TweenOptions<T extends number | Readonly<Record<string, number>>> {
  readonly from: T;
  readonly to: T;
  readonly duration: number;
  readonly easing?: Easing;
  onUpdate(
    value: T extends number ? number : Readonly<Record<string, number>>,
    progress: number,
  ): void;
  onComplete?(): void;
}

export interface TweenRunnerOptions {
  readonly scope?: Scope;
  readonly onError?: (error: unknown) => void;
}

export interface TweenRunner {
  tween<T extends number | Readonly<Record<string, number>>>(options: TweenOptions<T>): Cleanup;
  advance(delta: number): void;
  readonly pending: number;
  dispose(): void;
}

const easings: Record<Easing, (value: number) => number> = {
  linear: (value) => value,
  'ease-in': (value) => value * value,
  'ease-out': (value) => 1 - (1 - value) * (1 - value),
  'ease-in-out': (value) => (value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2),
};

interface TweenTask {
  readonly id: number;
  readonly from: number | Readonly<Record<string, number>>;
  readonly to: number | Readonly<Record<string, number>>;
  readonly duration: number;
  readonly easing: Easing;
  readonly onUpdate: (value: never, progress: number) => void;
  readonly onComplete: (() => void) | undefined;
  elapsed: number;
  active: boolean;
}

function objectValue(
  from: Readonly<Record<string, number>>,
  to: Readonly<Record<string, number>>,
  progress: number,
): Record<string, number> {
  const value: Record<string, number> = {};
  for (const key of Object.keys(from)) value[key] = from[key]! + (to[key]! - from[key]!) * progress;
  return value;
}

export function createTweenRunner(options: TweenRunnerOptions = {}): TweenRunner {
  let nextId = 0;
  let disposed = false;
  const tasks: TweenTask[] = [];
  let pending: TweenTask[] = [];
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };

  const tween: TweenRunner['tween'] = (tweenOptions) => {
    if (!Number.isFinite(tweenOptions.duration) || tweenOptions.duration <= 0)
      throw new Error('Tween duration must be a positive finite number');
    const from = tweenOptions.from;
    const to = tweenOptions.to;
    if (typeof from === 'number' && typeof to === 'number') {
      if (!Number.isFinite(from) || !Number.isFinite(to))
        throw new Error('Tween bounds must be finite numbers');
    } else if (
      typeof from === 'object' &&
      typeof to === 'object' &&
      from !== null &&
      to !== null &&
      !Array.isArray(from) &&
      !Array.isArray(to)
    ) {
      const fromKeys = Object.keys(from).sort();
      const toKeys = Object.keys(to).sort();
      if (fromKeys.length !== toKeys.length || fromKeys.some((key, index) => key !== toKeys[index]))
        throw new Error('Tween object bounds must use the same keys');
      for (const key of fromKeys)
        if (!Number.isFinite(from[key]) || !Number.isFinite(to[key]))
          throw new Error('Tween object bounds must be finite numbers');
    } else {
      throw new Error('Tween bounds must both be numbers or matching objects');
    }
    const task: TweenTask = {
      id: ++nextId,
      from,
      to,
      duration: tweenOptions.duration,
      easing: tweenOptions.easing ?? 'linear',
      onUpdate: tweenOptions.onUpdate as TweenTask['onUpdate'],
      onComplete: tweenOptions.onComplete,
      elapsed: 0,
      active: !disposed,
    };
    if (!disposed) pending.push(task);
    return () => {
      task.active = false;
      const index = pending.indexOf(task);
      if (index >= 0) pending.splice(index, 1);
    };
  };

  const advance = (delta: number): void => {
    if (disposed || !Number.isFinite(delta) || delta <= 0) return;
    if (pending.length) {
      tasks.push(...pending);
      pending = [];
    }
    for (const task of [...tasks]) {
      if (!task.active) continue;
      task.elapsed += delta;
      const linear = Math.min(1, task.elapsed / task.duration);
      const progress = easings[task.easing](linear);
      const value =
        typeof task.from === 'number'
          ? task.from + ((task.to as number) - task.from) * progress
          : objectValue(
              task.from as Readonly<Record<string, number>>,
              task.to as Readonly<Record<string, number>>,
              progress,
            );
      try {
        (task.onUpdate as (value: unknown, progress: number) => void)(value, linear);
        if (linear >= 1 && task.active) {
          task.active = false;
          const index = tasks.indexOf(task);
          if (index >= 0) tasks.splice(index, 1);
          task.onComplete?.();
        }
      } catch (error) {
        task.active = false;
        const index = tasks.indexOf(task);
        if (index >= 0) tasks.splice(index, 1);
        report(new TweenError(task.id, error));
      }
    }
  };

  const runner: TweenRunner = {
    tween,
    advance,
    get pending() {
      return tasks.filter((task) => task.active).length + pending.length;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const task of tasks) task.active = false;
      tasks.length = 0;
      pending = [];
    },
  };
  options.scope?.own(() => runner.dispose());
  return runner;
}

export { easings };
