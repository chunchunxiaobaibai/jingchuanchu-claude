import { World, type Token } from '@xiaobaibaifqy/jingchuanchu-ecs';

export type Cleanup = () => void;
export class Scope {
  private cleanups: Cleanup[] = [];
  private closed = false;
  private _owner: unknown;

  /**
   * Associates an owner with this scope. Used by reactive-core to route errors.
   * Type is `unknown` to avoid core depending on app package.
   */
  setOwner(owner: unknown): void {
    if (this._owner !== undefined) throw new Error('Scope owner already set');
    this._owner = owner;
  }

  /**
   * Gets the owner associated with this scope, if any.
   * Type is `unknown`; caller must cast to the expected type.
   */
  getOwner(): unknown {
    return this._owner;
  }

  own(cleanup: Cleanup): Cleanup {
    if (this.closed) {
      cleanup();
      return cleanup;
    }
    this.cleanups.push(cleanup);
    return cleanup;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse())
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'Scope cleanup failed');
  }
}

export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  subscribe(listener: () => void): Cleanup;
  throwIfAborted(): void;
}
export class Cancellation implements CancellationSignal {
  private listeners = new Set<Cleanup>();
  private cancelled = false;
  private cause: unknown;
  get aborted(): boolean {
    return this.cancelled;
  }
  get reason(): unknown {
    return this.cause;
  }
  subscribe(listener: Cleanup): Cleanup {
    if (this.aborted) {
      listener();
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }
  cancel(reason: unknown = new Error('Cancelled')): void {
    if (this.aborted) return;
    this.cancelled = true;
    this.cause = reason;
    const listeners = [...this.listeners];
    this.listeners.clear();
    const errors: unknown[] = [];
    for (const listener of listeners)
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'Cancellation listener failed');
  }
}

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();
  on<K extends keyof Events>(
    name: K,
    listener: (payload: Events[K]) => void,
    scope?: Scope,
  ): Cleanup {
    let bucket = this.listeners.get(name);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(name, bucket);
    }
    const wrapped = (payload: unknown): void => listener(payload as Events[K]);
    bucket.add(wrapped);
    const off = (): void => {
      bucket.delete(wrapped);
      if (!bucket.size && this.listeners.get(name) === bucket) this.listeners.delete(name);
    };
    scope?.own(off);
    return off;
  }
  emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    const errors: unknown[] = [];
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, `Event handler failed: ${String(name)}`);
  }
  clear(): void {
    this.listeners.clear();
  }
}

export interface UpdateContext {
  world: World;
  delta: number;
  tick: number;
  alpha: number;
}
export interface System {
  id: string;
  phase?: 'fixed' | 'render';
  order?: number;
  before?: readonly string[];
  after?: readonly string[];
  update(context: UpdateContext): void;
}
export interface EngineModule {
  id: string;
  dependencies?: readonly string[];
  setup(engine: Engine, scope: Scope): void;
}
export interface SystemTiming {
  id: string;
  milliseconds: number;
}
export type EngineStatus = 'stopped' | 'running' | 'paused' | 'disposed';
export interface EngineEvents {
  started: undefined;
  paused: undefined;
  resumed: undefined;
  stopped: undefined;
  disposed: undefined;
}

export class SystemError extends Error {
  constructor(
    readonly systemId: string,
    readonly phase: 'fixed' | 'render',
    readonly tick: number,
    cause: unknown,
  ) {
    super(`System failed: ${systemId}`, { cause });
    this.name = 'SystemError';
  }
}

export class Engine {
  readonly world = new World();
  readonly scope = new Scope();
  readonly events = new EventBus<EngineEvents>();
  readonly timings: SystemTiming[] = [];
  readonly step: number;
  private systems: System[] = [];
  private scheduled: System[] | undefined;
  private accumulator = 0;
  private tick = 0;
  private state: EngineStatus = 'stopped';
  private readonly installed = new Set<string>();
  private installing = false;
  constructor(
    readonly options: { tickRate?: number; maxSteps?: number; diagnostics?: boolean } = {},
  ) {
    const rate = options.tickRate ?? 30;
    const maxSteps = options.maxSteps ?? 5;
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1)
      throw new Error('Invalid clock options');
    this.step = 1 / rate;
  }
  get status(): EngineStatus {
    return this.state;
  }
  hasModule(id: string): boolean {
    return this.installed.has(id);
  }
  getModules(): readonly string[] {
    return [...this.installed];
  }
  getSystems(): readonly { id: string; phase: 'fixed' | 'render'; order: number }[] {
    return this.orderedSystems().map((system) => ({
      id: system.id,
      phase: system.phase ?? 'fixed',
      order: system.order ?? 0,
    }));
  }
  private orderedSystems(): System[] {
    if (this.scheduled) return this.scheduled;
    const remaining = [...this.systems];
    if (!remaining.some((system) => system.before?.length || system.after?.length))
      return (this.scheduled = this.systems);
    const byId = new Map(remaining.map((system) => [system.id, system]));
    const edges = new Map(remaining.map((system) => [system.id, new Set<string>()]));
    const incoming = new Map(remaining.map((system) => [system.id, 0]));
    const edge = (from: string, to: string): void => {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) throw new Error(`Missing system: ${!a ? from : to}`);
      if ((a.phase ?? 'fixed') !== (b.phase ?? 'fixed'))
        throw new Error('System dependency crosses phases');
      if (!edges.get(from)!.has(to)) {
        edges.get(from)!.add(to);
        incoming.set(to, incoming.get(to)! + 1);
      }
    };
    for (const system of remaining) {
      for (const id of system.before ?? []) edge(system.id, id);
      for (const id of system.after ?? []) edge(id, system.id);
    }
    const result: System[] = [];
    while (remaining.length) {
      const index = remaining.findIndex((system) => incoming.get(system.id) === 0);
      if (index < 0) throw new Error('System dependency cycle');
      const system = remaining.splice(index, 1)[0]!;
      result.push(system);
      for (const id of edges.get(system.id)!) incoming.set(id, incoming.get(id)! - 1);
    }
    return (this.scheduled = result);
  }
  /** Services registered by modules are removed on rollback and engine disposal. */
  provide<T>(token: Token<T>, value: NoInfer<T>, scope: Scope): void {
    this.assertOpen();
    if (this.world.hasResource(token)) throw new Error(`Resource already provided: ${token.name}`);
    this.world.setResource(token, value);
    scope.own(() => {
      if (this.status === 'disposed') return; // The world is cleared after all module cleanups.
      if (this.world.hasResource(token) && Object.is(this.world.getResource(token), value))
        this.world.removeResource(token);
    });
  }
  addSystem(system: System, scope = this.scope): void {
    this.assertOpen();
    if (this.systems.some((item) => item.id === system.id))
      throw new Error(`Duplicate system: ${system.id}`);
    this.scheduled = undefined;
    this.systems = [...this.systems, system];
    this.systems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    scope.own(() => {
      const index = this.systems.indexOf(system);
      if (index >= 0) {
        this.systems = this.systems.filter((item) => item !== system);
        this.scheduled = undefined;
      }
    });
  }
  install(modules: readonly EngineModule[]): void {
    this.assertOpen();
    if (this.state === 'running')
      throw new Error('Stop or pause the engine before installing modules');
    if (this.installing) throw new Error('Module installation is already in progress');
    const byId = new Map(modules.map((module) => [module.id, module]));
    if (byId.size !== modules.length) throw new Error('Duplicate module ID');
    for (const id of byId.keys())
      if (this.installed.has(id)) throw new Error(`Module already installed: ${id}`);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: EngineModule[] = [];
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (this.installed.has(id)) return;
      if (visiting.has(id)) throw new Error(`Module dependency cycle: ${id}`);
      const module = byId.get(id);
      if (!module) throw new Error(`Missing module: ${id}`);
      visiting.add(id);
      for (const dependency of module.dependencies ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(module);
    };
    for (const module of modules) visit(module.id);
    const scopes: Scope[] = [];
    this.installing = true;
    try {
      for (const module of ordered) {
        const scope = new Scope();
        scopes.push(scope);
        module.setup(this, scope);
        this.assertOpen();
      }
    } catch (error) {
      const errors: unknown[] = [error];
      for (const scope of scopes.reverse())
        try {
          scope.dispose();
        } catch (cleanupError) {
          errors.push(cleanupError);
        }
      throw new AggregateError(errors, 'Module setup failed');
    } finally {
      this.installing = false;
    }
    for (const scope of scopes) this.scope.own(() => scope.dispose());
    for (const module of ordered) this.installed.add(module.id);
  }
  start(): void {
    this.assertOpen();
    if (this.installing) throw new Error('Cannot start during module installation');
    if (this.state === 'running') return;
    this.orderedSystems();
    this.accumulator = 0;
    this.begin('started');
  }
  pause(): void {
    this.assertOpen();
    if (this.state === 'running') {
      this.state = 'paused';
      this.events.emit('paused', undefined);
    }
  }
  resume(): void {
    this.assertOpen();
    if (this.state === 'paused') {
      this.orderedSystems();
      this.accumulator = 0;
      this.begin('resumed');
    }
  }
  stop(): void {
    this.assertOpen();
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    this.accumulator = 0;
    this.events.emit('stopped', undefined);
  }
  advance(seconds: number): void {
    this.assertOpen();
    if (this.state !== 'running') return;
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
    this.timings.length = 0;
    this.accumulator += Math.min(seconds, this.step * (this.options.maxSteps ?? 5));
    while (this.state === 'running' && this.accumulator + 1e-10 >= this.step) {
      this.tick++;
      this.run('fixed', this.step, 0);
      if (this.state !== 'running') return;
      try {
        this.world.flush();
      } catch (cause) {
        const cleanupErrors: unknown[] = [];
        if (this.status !== 'disposed')
          try {
            this.stop();
          } catch (error) {
            cleanupErrors.push(error);
          }
        throw new Error('Deferred command failed', {
          cause: cleanupErrors.length ? new AggregateError([cause, ...cleanupErrors]) : cause,
        });
      }
      if (this.state !== 'running') return;
      this.accumulator = Math.max(0, this.accumulator - this.step);
    }
    this.run('render', seconds, this.accumulator / this.step);
  }
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    const errors: unknown[] = [];
    try {
      this.events.emit('disposed', undefined);
    } catch (error) {
      errors.push(error);
    }
    try {
      this.scope.dispose();
    } catch (error) {
      errors.push(error);
    } finally {
      this.world.dispose();
      this.events.clear();
      this.installed.clear();
      this.systems = [];
      this.scheduled = [];
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Engine cleanup failed');
  }
  private run(phase: 'fixed' | 'render', delta: number, alpha: number): void {
    let systems: System[];
    try {
      systems = this.orderedSystems();
    } catch (cause) {
      const errors = [cause];
      if (this.status !== 'disposed')
        try {
          this.stop();
        } catch (error) {
          errors.push(error);
        }
      throw new SystemError(
        'scheduler',
        phase,
        this.tick,
        errors.length === 1 ? cause : new AggregateError(errors),
      );
    }
    for (const system of systems) {
      if (this.state !== 'running') break;
      if ((system.phase ?? 'fixed') !== phase) continue;
      const started = this.options.diagnostics === false ? 0 : performance.now();
      try {
        system.update({ world: this.world, delta, tick: this.tick, alpha });
      } catch (cause) {
        const errors = [cause];
        if (this.status !== 'disposed')
          try {
            this.stop();
          } catch (error) {
            errors.push(error);
          }
        throw new SystemError(
          system.id,
          phase,
          this.tick,
          errors.length === 1 ? cause : new AggregateError(errors),
        );
      }
      if (this.options.diagnostics !== false)
        this.timings.push({ id: system.id, milliseconds: performance.now() - started });
    }
  }
  private begin(event: 'started' | 'resumed'): void {
    this.state = 'running';
    try {
      this.events.emit(event, undefined);
    } catch (cause) {
      const errors = [cause];
      if (this.status !== 'disposed') {
        this.state = 'stopped';
        this.accumulator = 0;
        try {
          this.events.emit('stopped', undefined);
        } catch (error) {
          errors.push(error);
        }
      }
      throw new AggregateError(errors, `Engine ${event} failed`);
    }
  }
  private assertOpen(): void {
    if (this.state === 'disposed') throw new Error('Engine is disposed');
  }
}
