import { Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';

export type ReadonlyData<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
    : T;

/** Display state is structured-cloneable plain data, never live ECS objects. */
export function snapshot<T>(value: T): ReadonlyData<T> {
  const copy = structuredClone(value);
  const seen = new WeakSet<object>();
  function freeze(item: unknown): void {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    if (Object.getPrototypeOf(item) !== Object.prototype && !Array.isArray(item))
      throw new Error('Application snapshots support plain objects and arrays only');
    seen.add(item);
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  }
  freeze(copy);
  return copy as ReadonlyData<T>;
}

export interface StateReader<S> {
  readonly value: ReadonlyData<S>;
  subscribe(listener: () => void, scope?: Scope): Cleanup;
}
/** @deprecated 业务状态改用 application 入口的 `defineStore`，局部状态用 `signal`。 见 docs/development/migrating-to-application.md。 */
export class StateStore<S> implements StateReader<S> {
  private current: ReadonlyData<S>;
  private listeners = new Set<() => void>();
  constructor(initial: S) {
    this.current = snapshot(initial);
  }
  get value(): ReadonlyData<S> {
    return this.current;
  }
  update(reduce: (previous: ReadonlyData<S>) => S): void {
    const next = reduce(this.current);
    if (Object.is(next, this.current)) return;
    this.current = snapshot(next);
    const errors: unknown[] = [];
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'State notification failed');
  }
  subscribe(listener: () => void, scope?: Scope): Cleanup {
    this.listeners.add(listener);
    const off = () => {
      this.listeners.delete(listener);
    };
    scope?.own(off);
    return off;
  }
}

export interface CommandSender<C extends object> {
  send<K extends keyof C>(name: K, payload: C[K]): void;
}
export interface CommandRegistry<C extends object> extends CommandSender<C> {
  handle<K extends keyof C>(name: K, handler: (payload: C[K]) => void): void;
}
export class Commands<C extends object> implements CommandRegistry<C> {
  private handlers = new Map<keyof C, (payload: never) => void>();
  constructor(private readonly parent?: Commands<C>) {}
  has(name: keyof C): boolean {
    return this.handlers.has(name) || !!this.parent?.has(name);
  }
  handle<K extends keyof C>(name: K, handler: (payload: C[K]) => void): void {
    if (this.has(name)) throw new Error(`Duplicate command handler: ${String(name)}`);
    this.handlers.set(name, handler as (payload: never) => void);
  }
  send<K extends keyof C>(name: K, payload: C[K]): void {
    const handler = this.handlers.get(name);
    if (handler) handler(payload as never);
    else if (this.parent?.has(name)) this.parent.send(name, payload);
    else throw new Error(`Missing command handler: ${String(name)}`);
  }
  clear(): void {
    this.handlers.clear();
  }
}
