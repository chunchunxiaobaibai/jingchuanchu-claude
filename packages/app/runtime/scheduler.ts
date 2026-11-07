import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';

export class ReactivityError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = 'ReactivityError';
  }
}

export interface EffectTask {
  readonly source: string;
  runEffect(): void;
}

export interface SchedulerStats {
  effects: number;
  renders: number;
}

type RenderTask = () => void;

const MAX_EFFECT_TURNS = 100;

/** Synchronous throw — keeps global flushSync() and existing tests working. */
function defaultErrorHandler(error: unknown): void {
  throw error;
}

/** Handles unhandled errors from the default scheduler's microtask queue. */
function reportUnhandledError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error);
    return;
  }
  queueMicrotask(() => {
    throw error;
  });
}

/** Scheduler manages effect and render queues for one application or test scope. */
export class Scheduler {
  private batchDepth = 0;
  private flushQueued = false;
  private readonly effectQueue = new Set<EffectTask>();
  private readonly renderQueue = new Set<RenderTask>();

  constructor(private readonly onError: (error: unknown) => void = defaultErrorHandler) {}

  isBatching(): boolean {
    return this.batchDepth > 0;
  }

  batch<T>(run: () => T): T {
    this.batchDepth += 1;
    try {
      return run();
    } finally {
      this.batchDepth -= 1;
    }
  }

  scheduleEffect(task: EffectTask): void {
    this.effectQueue.add(task);
    this.queueFlush();
  }

  scheduleRender(task: RenderTask): void {
    this.renderQueue.add(task);
    this.queueFlush();
  }

  pendingUpdates(): SchedulerStats {
    return { effects: this.effectQueue.size, renders: this.renderQueue.size };
  }

  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      try {
        this.flushSync();
      } catch (error) {
        // For the default scheduler, flushSync() re-throws via defaultErrorHandler.
        // Catch it here and route to globalThis.reportError / microtask rethrow.
        reportUnhandledError(error);
      }
    });
  }

  /** Runs queued effects and renders now; also used by deterministic tests. */
  flushSync(): void {
    this.flushQueued = false;
    const errors: unknown[] = [];
    const turns = new Map<EffectTask, number>();
    while (this.effectQueue.size) {
      const tasks = [...this.effectQueue];
      this.effectQueue.clear();
      for (const task of tasks) {
        const turn = (turns.get(task) ?? 0) + 1;
        turns.set(task, turn);
        if (turn > MAX_EFFECT_TURNS) {
          this.effectQueue.clear();
          this.renderQueue.clear();
          this.onError(
            new ReactivityError(
              task.source,
              `Effect update loop detected after ${MAX_EFFECT_TURNS} runs`,
            ),
          );
          return;
        }
        try {
          task.runEffect();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (this.renderQueue.size) {
      const tasks = [...this.renderQueue];
      this.renderQueue.clear();
      for (const task of tasks) {
        try {
          task();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length === 1) this.onError(errors[0]);
    else if (errors.length > 1) this.onError(new AggregateError(errors, 'Scheduled update failed'));
  }

  /** Resolves after effects and renders queued before this call have run. */
  nextTick(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = (): void => {
        try {
          this.flushSync();
        } catch (error) {
          // Should not throw for owned schedulers; catch for default scheduler edge cases
          reportUnhandledError(error);
        }
        if (this.effectQueue.size || this.renderQueue.size) {
          queueMicrotask(check);
          return;
        }
        resolve();
      };
      queueMicrotask(check);
    });
  }
}

// Default global scheduler for backward compatibility
const defaultScheduler = new Scheduler(defaultErrorHandler);

// Legacy global functions delegate to default scheduler
export function isBatching(): boolean {
  return defaultScheduler.isBatching();
}

export function batch<T>(run: () => T): T {
  return defaultScheduler.batch(run);
}

export function scheduleEffect(task: EffectTask): void {
  defaultScheduler.scheduleEffect(task);
}

export function scheduleRender(task: RenderTask): void {
  defaultScheduler.scheduleRender(task);
}

export function pendingUpdates(): SchedulerStats {
  return defaultScheduler.pendingUpdates();
}

export function flushSync(): void {
  defaultScheduler.flushSync();
}

export function nextTick(): Promise<void> {
  return defaultScheduler.nextTick();
}

export type { Cleanup };
