import type { ComponentDefinition, ComponentEnvironment, MountedComponent } from './component.js';
import { mountComponent } from './component.js';
import { Owner } from './component-owner.js';
import type { AnyComponentDefinition } from './component-types.js';
import type { AnyServiceDefinition, ServiceContext, ServiceOf } from './services.js';
import { defineService } from './services.js';
import { createRouter, type Router } from './router/router.js';
import { createRouterOutlet, type RouterOutlet } from './router/components.js';
import { createBrowserHistoryDriver, type HistoryWindow } from './router/history.js';
import { Scheduler } from './scheduler.js';
import type { HistoryDriver, RouteTable, RouteTarget } from './router/types.js';

export class ApplicationError extends Error {
  constructor(
    readonly source: string,
    readonly module: string,
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Application ${module} ${source}: ${operation} failed${detail}`, { cause });
    this.name = 'ApplicationError';
  }
}

export const RouterService = defineService<Router>({
  name: 'application-router',
  factory() {
    throw new Error('Router service is only available inside a routed application');
  },
});

export interface ApplicationServiceProvider<D extends AnyServiceDefinition = AnyServiceDefinition> {
  readonly service: D;
  readonly factory?: (context: ServiceContext) => ServiceOf<D>;
}

export interface ApplicationOptions {
  readonly root: AnyComponentDefinition;
  readonly providers?: readonly ApplicationServiceProvider[];
  readonly onError?: (error: unknown) => void;
  readonly routes?: RouteTable;
  readonly history?: HistoryDriver;
  readonly fallback?: RouteTarget;
}

export interface ApplicationDefinition {
  readonly root: AnyComponentDefinition;
  readonly providers: readonly ApplicationServiceProvider[];
  readonly onError?: (error: unknown) => void;
  readonly routes?: RouteTable;
  readonly history?: HistoryDriver;
  readonly fallback?: RouteTarget;
}

export function defineApplication(options: ApplicationOptions): ApplicationDefinition {
  if (!options.root) throw new Error('Application requires a root component');
  return Object.freeze({
    root: options.root,
    providers: Object.freeze([...(options.providers ?? [])]),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.routes ? { routes: options.routes } : {}),
    ...(options.history ? { history: options.history } : {}),
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
  });
}

export interface ApplicationInstance {
  readonly status: 'running' | 'disposed';
  readonly owner: Owner;
  readonly router: Router | undefined;
  dispose(): void;
}

function disposeAll(errors: unknown[], action: () => void): void {
  try {
    action();
  } catch (error) {
    errors.push(error);
  }
}

export async function mountApplication(
  container: Element,
  definition: ApplicationDefinition,
): Promise<ApplicationInstance> {
  const report = (error: unknown): void => {
    const handler = definition.onError;
    if (!handler) {
      console.error(error);
      return;
    }
    try {
      handler(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };
  // Create scheduler with application's error handler
  const scheduler = new Scheduler(report);
  const owner = new Owner(undefined, scheduler);
  let component: MountedComponent<Record<string, unknown>> | undefined;
  let router: Router | undefined;
  let outlet: RouterOutlet | undefined;
  try {
    for (const provider of definition.providers)
      owner.provideService(provider.service, provider.factory);
    let history = definition.history;
    if (definition.routes) {
      if (!history) {
        const view = container.ownerDocument.defaultView;
        if (!view) throw new Error('Application routes require an injected history driver');
        history = createBrowserHistoryDriver(view as unknown as HistoryWindow, 'hash');
      }
      router = createRouter({
        routes: definition.routes,
        history,
        commit: (context) => {
          if (!outlet) throw new Error('Application router outlet is not mounted');
          outlet.commit(context);
        },
        onError: report,
        ...(definition.fallback !== undefined ? { fallback: definition.fallback } : {}),
      });
      owner.provideService(RouterService, () => router!);
    }
    const environment: ComponentEnvironment = { owner, onError: report };
    component = mountComponent(
      container,
      definition.root as unknown as ComponentDefinition,
      environment,
    );
    if (definition.routes && router) {
      const outletHost = container.querySelector('router-outlet');
      if (!outletHost)
        throw new Error('Application routes require a <router-outlet> in the root template');
      outlet = createRouterOutlet(outletHost, owner, { onError: report });
      await router.start();
      void router.preloadIdle().catch(report);
    }
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (router) disposeAll(cleanupErrors, () => router!.dispose());
    if (outlet) disposeAll(cleanupErrors, () => outlet!.dispose());
    if (component) disposeAll(cleanupErrors, () => component!.dispose());
    disposeAll(cleanupErrors, () => owner.dispose());
    if (cleanupErrors.length)
      throw new ApplicationError(
        definition.root.selector,
        'application',
        'mount',
        new AggregateError([error, ...cleanupErrors], 'Application mount and cleanup failed'),
      );
    throw new ApplicationError(definition.root.selector, 'application', 'mount', error);
  }

  let closed = false;
  return {
    get status() {
      return closed ? 'disposed' : 'running';
    },
    owner,
    get router() {
      return router;
    },
    dispose() {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      if (router) disposeAll(errors, () => router!.dispose());
      if (outlet) disposeAll(errors, () => outlet!.dispose());
      disposeAll(errors, () => component!.dispose());
      disposeAll(errors, () => owner.dispose());
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Application dispose failed');
    },
  };
}

export async function bootstrapApplication(
  definition: ApplicationDefinition,
  options: { document?: Document } = {},
): Promise<ApplicationInstance> {
  const document = options.document ?? (globalThis as { document?: Document }).document;
  if (!document)
    throw new ApplicationError(
      definition.root.selector,
      'application',
      'bootstrap',
      new Error('Document is unavailable'),
    );
  const hosts = Array.from(document.querySelectorAll(definition.root.selector));
  if (hosts.length !== 1)
    throw new ApplicationError(
      definition.root.selector,
      'application',
      'bootstrap',
      new Error(`Expected one host for ${definition.root.selector}, found ${hosts.length}`),
    );
  return mountApplication(hosts[0]!, definition);
}
