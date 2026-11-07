import { Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { snapshot, type ReadonlyData } from '../state.js';
import {
  ReactivityError,
  scheduleEffect as legacyScheduleEffect,
  type EffectTask,
  type Scheduler,
} from './scheduler.js';
import type { Owner } from './component-owner.js';

export interface ReadSignal<T> {
  (): ReadonlyData<T>;
}

export interface WritableSignal<T> extends ReadSignal<T> {
  set(value: T): void;
  update(reduce: (previous: ReadonlyData<T>) => T): void;
}

export { ReactivityError } from './scheduler.js';

interface Dependency {
  addSubscriber(subscriber: Subscriber): void;
  removeSubscriber(subscriber: Subscriber): void;
}

interface Subscriber {
  notifyDirty(): void;
  trackDependency(dependency: Dependency): void;
}

let activeSubscriber: Subscriber | undefined;
const computing: Computed<unknown>[] = [];
let computedCount = 0;

function track(dependency: Dependency): void {
  activeSubscriber?.trackDependency(dependency);
}

const signalMarker = '__jccSignal';

export function markReadSignal<T extends (...args: never[]) => unknown>(read: T): T {
  Object.defineProperty(read, signalMarker, { value: true });
  return read;
}

function toReadonly<T>(value: T): ReadonlyData<T> {
  if (value !== null && typeof value === 'object')
    return snapshot(value as object) as ReadonlyData<T>;
  return value as ReadonlyData<T>;
}

function cycleMessage(source: string): string {
  const chain = [...computing.map((item) => item.source), source];
  return `Circular computed dependency: ${chain.join(' -> ')}`;
}

class Computed<T> implements Dependency, Subscriber {
  private cached!: ReadonlyData<T>;
  private dirty = true;
  private computing = false;
  private readonly subscribers = new Set<Subscriber>();
  private dependencies = new Set<Dependency>();
  private collecting: Set<Dependency> | undefined;
  readonly source: string;

  constructor(private readonly derive: () => T) {
    computedCount += 1;
    this.source = derive.name ? `computed(${derive.name})` : `computed#${computedCount}`;
  }

  read(): ReadonlyData<T> {
    if (this.computing) throw new ReactivityError(this.source, cycleMessage(this.source));
    track(this);
    if (this.dirty) this.recompute();
    return this.cached;
  }

  addSubscriber(subscriber: Subscriber): void {
    this.subscribers.add(subscriber);
  }

  removeSubscriber(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
  }

  notifyDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    for (const subscriber of [...this.subscribers]) subscriber.notifyDirty();
  }

  trackDependency(dependency: Dependency): void {
    if (!this.collecting)
      throw new ReactivityError(this.source, 'Dependency read outside computation');
    this.collecting.add(dependency);
  }

  private recompute(): void {
    if (this.computing) throw new ReactivityError(this.source, cycleMessage(this.source));
    const previous = activeSubscriber;
    const next = new Set<Dependency>();
    this.computing = true;
    this.collecting = next;
    activeSubscriber = this;
    computing.push(this as Computed<unknown>);
    let value: T;
    try {
      value = this.derive();
    } finally {
      computing.pop();
      activeSubscriber = previous;
      this.computing = false;
      this.collecting = undefined;
    }
    for (const dependency of this.dependencies)
      if (!next.has(dependency)) dependency.removeSubscriber(this);
    for (const dependency of next)
      if (!this.dependencies.has(dependency)) dependency.addSubscriber(this);
    this.dependencies = next;
    this.cached = toReadonly(value);
    this.dirty = false;
  }
}

class Signal<T> implements Dependency {
  private current: ReadonlyData<T>;
  private raw: T;
  private readonly subscribers = new Set<Subscriber>();
  private readonly read: ReadSignal<T>;

  constructor(
    initial: T,
    private readonly source: string,
    private readonly cloneValue = true,
  ) {
    this.raw = initial;
    this.current = cloneValue ? toReadonly(initial) : (initial as ReadonlyData<T>);
    this.read = markReadSignal(() => {
      track(this);
      return this.current;
    });
  }

  addSubscriber(subscriber: Subscriber): void {
    this.subscribers.add(subscriber);
  }

  removeSubscriber(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
  }

  asSignal(): WritableSignal<T> {
    return Object.assign(this.read, { set: this.set, update: this.update });
  }

  set = (value: T): void => {
    if (computing.length)
      throw new ReactivityError(
        this.source,
        `Cannot write a signal while ${computing[computing.length - 1]!.source} is computing`,
      );
    if (Object.is(value, this.raw)) return;
    this.raw = value;
    this.current = this.cloneValue ? toReadonly(value) : (value as ReadonlyData<T>);
    for (const subscriber of [...this.subscribers]) subscriber.notifyDirty();
  };

  update = (reduce: (previous: ReadonlyData<T>) => T): void => {
    this.set(reduce(this.current));
  };
}

let signalCount = 0;

export function signal<T>(initial: T): WritableSignal<T> {
  signalCount += 1;
  return new Signal(initial, `signal#${signalCount}`).asSignal();
}

/** Configuration values may contain definitions or drivers; they are not structured-cloned. */
export function configSignal<T>(initial: T): WritableSignal<T> {
  signalCount += 1;
  return new Signal(initial, `config#${signalCount}`, false).asSignal();
}

export function computed<T>(derive: () => T): ReadSignal<T> {
  const item = new Computed(derive);
  return markReadSignal(() => item.read());
}

interface EffectSubscriber extends Subscriber, EffectTask {
  readonly source: string;
  runEffect(): void;
}

let effectCount = 0;

export function effect(
  run: (onCleanup: (cleanup: Cleanup) => void) => void,
  scope: Scope,
): Cleanup {
  effectCount += 1;
  const source = run.name ? `effect(${run.name})` : `effect#${effectCount}`;

  // Get scheduler from scope's owner, fallback to legacy global scheduler
  const owner = scope.getOwner() as Owner | undefined;
  const scheduler = owner?.scheduler;

  const dependencies = new Set<Dependency>();
  let cleanups: Cleanup[] = [];
  let collecting: Set<Dependency> | undefined;
  let scheduled = false;
  let disposed = false;

  const node: EffectSubscriber = {
    source,
    notifyDirty() {
      if (disposed || scheduled) return;
      scheduled = true;
      if (scheduler) {
        scheduler.scheduleEffect(node);
      } else {
        // Fallback to legacy global function for tests/code without Owner
        legacyScheduleEffect(node);
      }
    },
    trackDependency(dependency: Dependency) {
      collecting?.add(dependency);
      if (dependencies.has(dependency)) return;
      dependencies.add(dependency);
      dependency.addSubscriber(node);
    },
    runEffect() {
      execute();
    },
  };

  function execute(): void {
    if (disposed) return;
    scheduled = false;
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    const seen = new Set<Dependency>();
    const previous = activeSubscriber;
    collecting = seen;
    activeSubscriber = node;
    try {
      run((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        cleanups.push(cleanup);
      });
    } catch (error) {
      errors.push(error);
    } finally {
      activeSubscriber = previous;
      collecting = undefined;
      for (const dependency of dependencies)
        if (!seen.has(dependency)) {
          dependency.removeSubscriber(node);
          dependencies.delete(dependency);
        }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${source}: effect failed`);
  }

  const dispose: Cleanup = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    cleanups = [];
    for (const dependency of dependencies) dependency.removeSubscriber(node);
    dependencies.clear();
    if (errors.length) throw new AggregateError(errors, `${source}: cleanup failed`);
  };

  try {
    execute();
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `${source}: effect failed`);
    }
    throw error;
  }
  scope.own(dispose);
  return dispose;
}

export { batch, isBatching, nextTick } from './scheduler.js';
