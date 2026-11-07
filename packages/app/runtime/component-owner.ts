import { Cancellation, Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  instantiateStore,
  type AnyStoreDefinition,
  type StoreInstance,
  type StoreInstanceOf,
} from './store.js';
import {
  createService,
  ServiceError,
  type AnyServiceDefinition,
  type ServiceContext,
  type ServiceOf,
  type ServiceRegistration,
} from './services.js';
import { Scheduler } from './scheduler.js';

export class OwnerError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = 'OwnerError';
  }
}

/** Application, page or component scope that owns effects, services and stores. */
export class Owner {
  readonly scope = new Scope();
  readonly cancellation = new Cancellation();
  readonly scheduler: Scheduler;
  private readonly children: Owner[] = [];
  private readonly stores = new Map<AnyStoreDefinition, StoreInstance<any, any, any>>();
  private readonly services = new Map<AnyServiceDefinition, ServiceRegistration>();
  private closed = false;

  constructor(
    private readonly parent?: Owner,
    scheduler?: Scheduler,
  ) {
    // Child owner inherits parent's scheduler (same application)
    this.scheduler = scheduler ?? parent?.scheduler ?? new Scheduler();
    this.scope.setOwner(this);
    parent?.children.push(this);
  }

  get disposed(): boolean {
    return this.closed;
  }

  createChild(): Owner {
    this.assertActive('createChild');
    return new Owner(this);
  }

  own(cleanup: Cleanup): Cleanup {
    return this.scope.own(cleanup);
  }

  assertActive(source: string): void {
    if (this.closed) throw new OwnerError(source, 'Owner is disposed');
  }

  useStore<D extends AnyStoreDefinition>(definition: D): StoreInstanceOf<D> {
    this.assertActive(`useStore(${definition.name})`);
    const found = this.findStore(definition);
    if (found) return found as StoreInstanceOf<D>;
    let root: Owner = this;
    while (root.parent) root = root.parent;
    return root.provideStore(definition) as StoreInstanceOf<D>;
  }

  provideStore<D extends AnyStoreDefinition>(definition: D): StoreInstanceOf<D> {
    this.assertActive(`provideStore(${definition.name})`);
    const existing = this.stores.get(definition);
    if (existing) return existing as StoreInstanceOf<D>;
    const instance = instantiateStore(definition, this);
    this.stores.set(definition, instance);
    return instance as StoreInstanceOf<D>;
  }

  private findStore(definition: AnyStoreDefinition): StoreInstance<any, any, any> | undefined {
    let owner: Owner | undefined = this;
    while (owner) {
      const found = owner.stores.get(definition);
      if (found) return found;
      owner = owner.parent;
    }
    return undefined;
  }

  provideService<D extends AnyServiceDefinition>(
    definition: D,
    factory?: (context: ServiceContext) => ServiceOf<D>,
  ): void {
    this.assertActive(`provideService(${definition.name})`);
    const existing = this.services.get(definition);
    if (existing) {
      if (existing.hasValue)
        throw new ServiceError(
          definition.name,
          'provide',
          new Error('Service is already created in this owner'),
        );
      if (factory) existing.factory = factory as (context: ServiceContext) => unknown;
      return;
    }
    this.services.set(definition, {
      definition,
      factory: (factory ?? definition.factory) as (context: ServiceContext) => unknown,
      scope: undefined,
      value: undefined,
      hasValue: false,
    });
  }

  useService<D extends AnyServiceDefinition>(definition: D): ServiceOf<D> {
    this.assertActive(`useService(${definition.name})`);
    const found = this.findService(definition);
    if (!found)
      throw new ServiceError(
        definition.name,
        'resolve',
        new Error(`Service ${definition.name} is not provided`),
      );
    const [owner, registration] = found;
    if (registration.hasValue) return registration.value as ServiceOf<D>;
    const created = createService(definition, registration.factory, owner);
    registration.value = created.value;
    registration.scope = created.scope;
    registration.hasValue = true;
    owner.own(() => created.scope.dispose());
    return created.value as ServiceOf<D>;
  }

  private findService(definition: AnyServiceDefinition): [Owner, ServiceRegistration] | undefined {
    let owner: Owner | undefined = this;
    while (owner) {
      const found = owner.services.get(definition);
      if (found) return [owner, found];
      owner = owner.parent;
    }
    return undefined;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const child of this.children.splice(0).reverse()) {
      try {
        child.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.cancellation.cancel();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.scope.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
    }
    this.stores.clear();
    this.services.clear();
    if (errors.length) throw new AggregateError(errors, 'Owner cleanup failed');
  }
}
