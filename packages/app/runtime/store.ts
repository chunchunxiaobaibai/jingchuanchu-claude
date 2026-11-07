import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { Cancellation, Scope, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import { markReadSignal, signal, type ReadSignal, type WritableSignal } from './reactivity.js';
import { batch } from './scheduler.js';

export type StoreSignalMap = Readonly<Record<string, ReadSignal<unknown>>>;
export type StoreActionMap = Readonly<Record<string, (...args: any[]) => any>>;

type SignalValue<T> = T extends (...args: never[]) => infer V ? V : never;

export type StoreState<S extends StoreSignalMap> = {
  readonly [K in keyof S]: ReadSignal<SignalValue<S[K]>>;
};
export type StoreGetters<G extends StoreSignalMap> = {
  readonly [K in keyof G]: ReadSignal<SignalValue<G[K]>>;
};
export type StoreActions<A extends StoreActionMap> = {
  readonly [K in keyof A]: A[K];
};

export interface StoreSetupResult<
  S extends StoreSignalMap,
  G extends StoreSignalMap,
  A extends StoreActionMap,
> {
  readonly state: S;
  readonly getters?: G;
  readonly actions?: A;
}

export interface StoreTaskContext {
  readonly signal: CancellationSignal;
  commit(run: () => void): boolean;
}

export interface StoreTaskOptions {
  readonly key?: string;
}

export interface StoreContext {
  readonly name: string;
  readonly scope: Scope;
  signal<T>(initial: T): WritableSignal<T>;
  own(cleanup: Cleanup): Cleanup;
  onReset(cleanup: Cleanup): Cleanup;
  runTask(
    task: (context: StoreTaskContext) => void | Promise<void>,
    options?: StoreTaskOptions,
  ): Promise<void>;
  useStore<D extends AnyStoreDefinition>(definition: D): StoreInstanceOf<D>;
}

export interface StoreDefinition<
  S extends StoreSignalMap = StoreSignalMap,
  G extends StoreSignalMap = StoreSignalMap,
  A extends StoreActionMap = StoreActionMap,
> {
  readonly name: string;
  readonly userScoped: boolean;
  readonly setup: (context: StoreContext) => StoreSetupResult<S, G, A>;
}

export type AnyStoreDefinition = StoreDefinition<any, any, any>;

export interface StoreInstance<
  S extends StoreSignalMap = StoreSignalMap,
  G extends StoreSignalMap = StoreSignalMap,
  A extends StoreActionMap = StoreActionMap,
> {
  readonly state: StoreState<S>;
  readonly getters: StoreGetters<G>;
  readonly actions: StoreActions<A>;
  readonly userScoped: boolean;
  reset(): void;
  dispose(): void;
}

export type StoreInstanceOf<D> =
  D extends StoreDefinition<infer S, infer G, infer A> ? StoreInstance<S, G, A> : never;

export class StoreError extends Error {
  constructor(
    readonly store: string,
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Store ${store}: ${operation} failed${detail}`, { cause });
    this.name = 'StoreError';
  }
}

export function defineStore<
  S extends StoreSignalMap,
  G extends StoreSignalMap = Record<never, never>,
  A extends StoreActionMap = Record<never, never>,
>(options: {
  name: string;
  userScoped?: boolean;
  setup(context: StoreContext): StoreSetupResult<S, G, A>;
}): StoreDefinition<S, G, A> {
  if (!options.name) throw new Error('Store requires a name');
  return Object.freeze({
    name: options.name,
    userScoped: options.userScoped === true,
    setup: options.setup,
  });
}

export interface StoreHost {
  readonly scope: Scope;
  own(cleanup: Cleanup): Cleanup;
  useStore<D extends AnyStoreDefinition>(definition: D): StoreInstanceOf<D>;
  assertActive(source: string): void;
}

const creating: AnyStoreDefinition[] = [];

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

export function instantiateStore(
  definition: AnyStoreDefinition,
  host: StoreHost,
): StoreInstance<any, any, any> {
  if (creating.includes(definition)) {
    const chain = [...creating, definition].map((item) => item.name).join(' -> ');
    throw new StoreError(
      definition.name,
      'setup',
      new Error(`Circular store dependency: ${chain}`),
    );
  }
  creating.push(definition);
  const scope = new Scope();
  const resetCleanups: Cleanup[] = [];
  const keyGenerations = new Map<string, number>();
  const activeTasks = new Map<string, Cancellation>();
  const initialValues = new Map<string, unknown>();
  const stateSignals: Record<string, WritableSignal<unknown>> = {};
  let epoch = 0;
  let disposed = false;

  function runTask(
    task: (context: StoreTaskContext) => void | Promise<void>,
    options: StoreTaskOptions = {},
  ): Promise<void> {
    if (disposed)
      return Promise.reject(
        new StoreError(definition.name, 'task', new Error('Store is disposed')),
      );
    const key = options.key;
    const startedAt = epoch;
    let generation = 0;
    if (key !== undefined) {
      generation = (keyGenerations.get(key) ?? 0) + 1;
      keyGenerations.set(key, generation);
      activeTasks.get(key)?.cancel();
    }
    const cancellation = new Cancellation();
    if (key !== undefined) activeTasks.set(key, cancellation);
    const ownedCleanup = scope.own(() => cancellation.cancel());
    const valid = (): boolean =>
      !disposed &&
      epoch === startedAt &&
      (key === undefined || keyGenerations.get(key) === generation) &&
      !cancellation.aborted;
    const context: StoreTaskContext = {
      signal: cancellation,
      commit(run) {
        if (!valid()) return false;
        batch(run);
        return true;
      },
    };
    const settle = (): void => {
      if (key !== undefined && activeTasks.get(key) === cancellation) activeTasks.delete(key);
      ownedCleanup();
    };
    try {
      const value = task(context);
      return Promise.resolve(value)
        .catch((error) => {
          throw error instanceof StoreError
            ? error
            : new StoreError(definition.name, 'task', error);
        })
        .finally(settle);
    } catch (error) {
      settle();
      return Promise.reject(
        error instanceof StoreError ? error : new StoreError(definition.name, 'task', error),
      );
    }
  }

  try {
    const result = definition.setup({
      name: definition.name,
      scope,
      signal,
      own: (cleanup) => scope.own(cleanup),
      onReset(cleanup) {
        resetCleanups.push(cleanup);
        return () => {
          const index = resetCleanups.indexOf(cleanup);
          if (index >= 0) resetCleanups.splice(index, 1);
        };
      },
      runTask,
      useStore: (store) => host.useStore(store),
    });
    if (!result || typeof result !== 'object' || !result.state)
      throw new Error('Store setup must return a state object');
    const state: Record<string, ReadSignal<unknown>> = {};
    for (const [name, item] of Object.entries(result.state)) {
      if (typeof item !== 'function') throw new Error(`Store state ${name} must be a signal`);
      stateSignals[name] = item as WritableSignal<unknown>;
      initialValues.set(name, item());
      const read = markReadSignal(() => item());
      Object.defineProperty(state, name, { enumerable: true, value: read });
    }
    Object.freeze(state);
    const getters: Record<string, ReadSignal<unknown>> = {};
    for (const [name, item] of Object.entries(result.getters ?? {})) {
      if (typeof item !== 'function') throw new Error(`Store getter ${name} must be a read signal`);
      Object.defineProperty(getters, name, { enumerable: true, value: item });
    }
    Object.freeze(getters);
    const actions: Record<string, (...args: any[]) => unknown> = {};
    for (const [name, action] of Object.entries(result.actions ?? {})) {
      if (typeof action !== 'function') throw new Error(`Store action ${name} must be a function`);
      actions[name] = (...args: any[]) => {
        try {
          const value = action(...args);
          if (isThenable(value))
            return Promise.resolve(value).catch((error) => {
              throw new StoreError(definition.name, `action:${name}`, error);
            });
          return value;
        } catch (error) {
          throw new StoreError(definition.name, `action:${name}`, error);
        }
      };
    }
    Object.freeze(actions);

    function dispose(): void {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      const errors: unknown[] = [];
      for (const cancellation of activeTasks.values()) {
        try {
          cancellation.cancel();
        } catch (error) {
          errors.push(error);
        }
      }
      activeTasks.clear();
      keyGenerations.clear();
      try {
        scope.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, `Store ${definition.name}: cleanup failed`);
    }

    function reset(): void {
      if (disposed) return;
      epoch += 1;
      for (const cancellation of activeTasks.values()) cancellation.cancel();
      activeTasks.clear();
      keyGenerations.clear();
      const errors: unknown[] = [];
      batch(() => {
        for (const cleanup of [...resetCleanups]) {
          try {
            cleanup();
          } catch (error) {
            errors.push(error);
          }
        }
        for (const [name, signalItem] of Object.entries(stateSignals)) {
          try {
            signalItem.set(initialValues.get(name));
          } catch (error) {
            errors.push(error);
          }
        }
      });
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, `Store ${definition.name}: reset failed`);
    }

    host.own(dispose);
    return {
      state: state as StoreState<any>,
      getters: getters as StoreGetters<any>,
      actions: actions as StoreActions<any>,
      userScoped: definition.userScoped,
      reset,
      dispose,
    } as StoreInstance<any, any, any>;
  } catch (error) {
    try {
      scope.dispose();
    } catch (cleanupError) {
      throw new StoreError(
        definition.name,
        'setup',
        new AggregateError([error, cleanupError], 'Store setup and cleanup failed'),
      );
    }
    throw error instanceof StoreError ? error : new StoreError(definition.name, 'setup', error);
  } finally {
    creating.pop();
  }
}
