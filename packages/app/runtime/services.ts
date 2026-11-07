import { Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { signal, type WritableSignal } from './reactivity.js';

declare const serviceBrand: unique symbol;

export interface ServiceDefinition<T> {
  readonly name: string;
  readonly factory: (context: ServiceContext) => T;
  readonly [serviceBrand]: T;
}

export type AnyServiceDefinition = ServiceDefinition<any>;
export type ServiceOf<D> = D extends ServiceDefinition<infer T> ? T : never;

export interface ServiceContext {
  readonly name: string;
  readonly scope: Scope;
  signal<T>(initial: T): WritableSignal<T>;
  own(cleanup: Cleanup): Cleanup;
  useService<D extends AnyServiceDefinition>(definition: D): ServiceOf<D>;
}

export class ServiceError extends Error {
  constructor(
    readonly service: string,
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Service ${service}: ${operation} failed${detail}`, { cause });
    this.name = 'ServiceError';
  }
}

export function defineService<T>(options: {
  name: string;
  factory(context: ServiceContext): T;
}): ServiceDefinition<T> {
  if (!options.name) throw new Error('Service requires a name');
  return Object.freeze({ name: options.name, factory: options.factory }) as ServiceDefinition<T>;
}

export interface ServiceRegistration {
  readonly definition: AnyServiceDefinition;
  factory: (context: ServiceContext) => unknown;
  scope: Scope | undefined;
  value: unknown;
  hasValue: boolean;
}

export interface ServiceHost {
  assertActive(source: string): void;
  useService<D extends AnyServiceDefinition>(definition: D): ServiceOf<D>;
}

const creating: AnyServiceDefinition[] = [];

export function createService(
  definition: AnyServiceDefinition,
  factory: (context: ServiceContext) => unknown,
  host: ServiceHost,
): { value: unknown; scope: Scope } {
  if (creating.includes(definition)) {
    const chain = [...creating, definition].map((item) => item.name).join(' -> ');
    throw new ServiceError(
      definition.name,
      'resolve',
      new Error(`Circular service dependency: ${chain}`),
    );
  }
  creating.push(definition);
  const scope = new Scope();
  try {
    const value = factory({
      name: definition.name,
      scope,
      signal,
      own: (cleanup) => scope.own(cleanup),
      useService: (dependency) => host.useService(dependency),
    });
    return { value, scope };
  } catch (error) {
    try {
      scope.dispose();
    } catch (cleanupError) {
      throw new ServiceError(
        definition.name,
        'factory',
        new AggregateError([error, cleanupError], 'Service factory and cleanup failed'),
      );
    }
    throw error instanceof ServiceError
      ? error
      : new ServiceError(definition.name, 'factory', error);
  } finally {
    creating.pop();
  }
}
