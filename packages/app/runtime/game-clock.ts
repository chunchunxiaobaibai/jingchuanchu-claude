import type { Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';

export class GameClockError extends Error {
  constructor(
    readonly taskId: number,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Game clock task ${taskId} failed${detail}`, { cause });
    this.name = 'GameClockError';
  }
}

export interface GameClockOptions {
  readonly scope?: Scope;
  readonly onError?: (error: unknown) => void;
}

export interface GameClock {
  after(seconds: number, callback: () => void): Cleanup;
  every(seconds: number, callback: () => void): Cleanup;
  cancel(handle: Cleanup): void;
  advance(delta: number): void;
  readonly pending: number;
  dispose(): void;
}

interface ClockTask {
  readonly id: number;
  readonly seconds: number;
  readonly callback: () => void;
  readonly repeat: boolean;
  elapsed: number;
  active: boolean;
}

export function createGameClock(options: GameClockOptions = {}): GameClock {
  let nextId = 0;
  let disposed = false;
  const tasks: ClockTask[] = [];
  let pending: ClockTask[] = [];
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };

  const schedule = (seconds: number, callback: () => void, repeat: boolean): Cleanup => {
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw new Error('Clock duration must be a positive finite number');
    if (disposed) return () => {};
    const task: ClockTask = {
      id: ++nextId,
      seconds,
      callback,
      repeat,
      elapsed: 0,
      active: true,
    };
    pending.push(task);
    return () => {
      task.active = false;
      const index = pending.indexOf(task);
      if (index >= 0) pending.splice(index, 1);
      const activeIndex = tasks.indexOf(task);
      if (activeIndex >= 0) tasks.splice(activeIndex, 1);
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
      if (!task.repeat) {
        if (task.elapsed >= task.seconds) {
          task.active = false;
          const index = tasks.indexOf(task);
          if (index >= 0) tasks.splice(index, 1);
          try {
            task.callback();
          } catch (error) {
            report(new GameClockError(task.id, error));
          }
        }
        continue;
      }
      while (task.active && task.elapsed >= task.seconds) {
        task.elapsed -= task.seconds;
        try {
          task.callback();
        } catch (error) {
          report(new GameClockError(task.id, error));
        }
      }
    }
  };

  const clock: GameClock = {
    after: (seconds, callback) => schedule(seconds, callback, false),
    every: (seconds, callback) => schedule(seconds, callback, true),
    cancel(handle) {
      handle();
    },
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
  options.scope?.own(() => clock.dispose());
  return clock;
}
