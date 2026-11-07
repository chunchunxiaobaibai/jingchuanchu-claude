import { Cancellation, type CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AnyComponentDefinition } from '../component-types.js';
import { createMatcher, RouteError, type RouterMatcher } from './matcher.js';
import { createRouteLoader } from './loader.js';
import type {
  GuardResult,
  HistoryDriver,
  HistoryLocation,
  RouteLocation,
  RouteMatch,
  RouteNavigationResult,
  RouteRecord,
  RouteTable,
  RouteTarget,
} from './types.js';

export interface RouterCommitContext {
  readonly match: RouteMatch;
  readonly page: AnyComponentDefinition;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly signal: CancellationSignal;
  readonly mode: 'push' | 'replace' | 'pop' | 'initial';
}

export type RouterCommit = (context: RouterCommitContext) => void | Promise<void>;

export interface RouterOptions {
  readonly routes: RouteTable;
  readonly history: HistoryDriver;
  readonly commit?: RouterCommit;
  readonly fallback?: RouteTarget;
  readonly onError?: (error: unknown) => void;
}

export type PreloadTrigger = 'manual' | 'intent' | 'idle';

export interface PreloadOptions {
  readonly strategy?: PreloadTrigger;
}

export interface Router {
  readonly current: RouteMatch | undefined;
  readonly pending: RouteTarget | undefined;
  readonly error: unknown;
  readonly mode: 'hash' | 'history';
  start(): Promise<RouteNavigationResult>;
  push(target: RouteTarget): Promise<RouteNavigationResult>;
  replace(target: RouteTarget): Promise<RouteNavigationResult>;
  back(): Promise<RouteNavigationResult>;
  preload(target: RouteTarget, options?: PreloadOptions): Promise<void>;
  preloadIdle(): Promise<void>;
  resolve(target: RouteTarget): string;
  dispose(): void;
}

type NavigationMode = RouterCommitContext['mode'];

function historyPath(location: HistoryLocation): string {
  const query = new URLSearchParams(location.query).toString();
  return `${location.path}${query ? `?${query}` : ''}${location.hash ? `#${location.hash}` : ''}`;
}

function matchPath(location: RouteLocation): string {
  const query = new URLSearchParams(location.query).toString();
  return `${location.path}${query ? `?${query}` : ''}${location.hash ? `#${location.hash}` : ''}`;
}

function validateInputs(
  page: AnyComponentDefinition,
  inputs: Readonly<Record<string, unknown>>,
): void {
  for (const [name, descriptor] of Object.entries(page.inputs)) {
    if (descriptor.required && !Object.hasOwn(inputs, name))
      throw new RouteError(page.selector, `Missing required page input: ${name}`);
  }
}

export function createRouter(options: RouterOptions): Router {
  const matcher: RouterMatcher = createMatcher(options.routes);
  const loader = createRouteLoader();
  const fallback = options.fallback ?? options.routes.fallback;
  let current: RouteMatch | undefined;
  let pending: RouteTarget | undefined;
  let lastError: unknown;
  let generation = 0;
  let cancellation: Cancellation | undefined;
  let disposed = false;
  const popResolvers: Array<(result: RouteNavigationResult) => void> = [];

  const report = (error: unknown): void => {
    lastError = error;
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };

  const resolveTarget = (
    target: RouteTarget,
  ): { match: RouteMatch; usedFallback: boolean } | undefined => {
    const direct = matcher.matchTarget(target);
    if (direct) return { match: direct, usedFallback: false };
    if (fallback === undefined) return undefined;
    const matched = matcher.matchTarget(fallback);
    return matched ? { match: matched, usedFallback: true } : undefined;
  };

  async function runGuard(
    guard: (context: {
      from: RouteLocation | undefined;
      to: RouteLocation;
      params: Readonly<Record<string, string>>;
      query: Readonly<Record<string, string>>;
      metas: readonly Readonly<Record<string, unknown>>[];
      signal: CancellationSignal;
    }) => GuardResult | Promise<GuardResult>,
    match: RouteMatch,
    signal: CancellationSignal,
  ): Promise<GuardResult> {
    return guard({
      from: current?.location,
      to: match.location,
      params: match.location.params,
      query: match.location.query,
      metas: match.chain.map((record) => record.meta),
      signal,
    });
  }

  async function navigate(
    original: RouteTarget,
    mode: NavigationMode,
  ): Promise<RouteNavigationResult> {
    if (disposed)
      return { status: 'failed', reason: new RouteError('router', 'Router is disposed') };
    const id = ++generation;
    cancellation?.cancel(new RouteError('router', 'Navigation superseded'));
    const local = new Cancellation();
    cancellation = local;
    pending = original;
    const from = current?.location;
    const seen = new Set<string>();
    let target = original;
    let redirected = false;
    let usedFallback = false;

    const superseded = (): boolean => id !== generation || local.aborted;
    const cancelled = (): RouteNavigationResult => ({
      status: 'cancelled',
      ...(from ? { from } : {}),
      reason: local.reason,
    });

    try {
      for (;;) {
        const resolved = resolveTarget(target);
        if (!resolved)
          throw new RouteError(
            typeof target === 'string' ? target : target.name,
            `No route matches ${typeof target === 'string' ? target : target.name}`,
          );
        const match = resolved.match;
        usedFallback = usedFallback || resolved.usedFallback;
        const key = `${match.record.name}:${matchPath(match.location)}`;
        if (seen.has(key)) throw new RouteError(match.record.name, 'Redirect loop detected');
        seen.add(key);

        if (match.record.redirect) {
          redirected = true;
          target = match.record.redirect;
          continue;
        }

        let redirectTarget: RouteTarget | undefined;
        for (const record of [...(current?.chain ?? [])].reverse()) {
          for (const guard of record.beforeLeave) {
            const result = await runGuard(guard, match, local);
            if (superseded()) return cancelled();
            if (result.type === 'deny')
              return { status: 'denied', ...(from ? { from } : {}), reason: result.reason };
            if (result.type === 'redirect') {
              redirectTarget = result.target;
              break;
            }
          }
          if (redirectTarget !== undefined) break;
        }
        if (redirectTarget !== undefined) {
          redirected = true;
          target = redirectTarget;
          continue;
        }

        for (const record of match.chain) {
          for (const guard of record.guards) {
            const result = await runGuard(guard, match, local);
            if (superseded()) return cancelled();
            if (result.type === 'deny')
              return { status: 'denied', ...(from ? { from } : {}), reason: result.reason };
            if (result.type === 'redirect') {
              redirectTarget = result.target;
              break;
            }
          }
          if (redirectTarget !== undefined) break;
        }
        if (redirectTarget !== undefined) {
          redirected = true;
          target = redirectTarget;
          continue;
        }

        const page = await loader.load(match.record);
        if (superseded()) return cancelled();
        if (!page) throw new RouteError(match.record.name, 'Route has no page');
        const prepared = match.record.prepare
          ? await match.record.prepare({
              location: match.location,
              params: match.location.params,
              query: match.location.query,
              hash: match.location.hash,
            })
          : {};
        if (superseded()) return cancelled();
        const inputs = prepared ?? {};
        validateInputs(page, inputs);
        await options.commit?.({ match, page, inputs, signal: local, mode });
        if (superseded()) return cancelled();
        current = match;
        pending = undefined;
        const path = matchPath(match.location);
        if (mode === 'push' && (redirected || usedFallback)) options.history.replace(path);
        else if (mode === 'push') options.history.push(path);
        else if (mode === 'replace' || mode === 'initial') options.history.replace(path);
        else if (mode === 'pop' && redirected) options.history.replace(path);
        return {
          status: redirected ? 'redirected' : 'committed',
          ...(from ? { from } : {}),
          to: match.location,
        };
      }
    } catch (error) {
      if (superseded()) return cancelled();
      const failure = error instanceof Error ? error : new Error(String(error));
      report(failure);
      return {
        status: 'failed',
        ...(from ? { from } : {}),
        reason: failure,
      };
    } finally {
      if (id === generation) pending = undefined;
    }
  }

  const restoreUrl = (): void => {
    if (!current) return;
    try {
      options.history.replace(matchPath(current.location));
    } catch (error) {
      report(error);
    }
  };

  const unsubscribe = options.history.subscribe((location, kind) => {
    if (kind !== 'pop') return;
    void navigate(historyPath(location), 'pop').then((result) => {
      if (result.status !== 'committed' && result.status !== 'redirected') restoreUrl();
      for (const resolve of popResolvers.splice(0)) resolve(result);
    });
  });

  const finish = (result: RouteNavigationResult): RouteNavigationResult => {
    for (const resolve of popResolvers.splice(0)) resolve(result);
    return result;
  };

  return {
    get current() {
      return current;
    },
    get pending() {
      return pending;
    },
    get error() {
      return lastError;
    },
    get mode() {
      return options.history.mode ?? 'hash';
    },
    resolve(target) {
      return matcher.resolve(target);
    },
    start() {
      return navigate(historyPath(options.history.location), 'initial');
    },
    async push(target) {
      return finish(await navigate(target, 'push'));
    },
    async replace(target) {
      return finish(await navigate(target, 'replace'));
    },
    back() {
      if (disposed) return Promise.resolve({ status: 'failed' as const, reason: 'disposed' });
      return new Promise<RouteNavigationResult>((resolve) => {
        popResolvers.push(resolve);
        try {
          options.history.back();
        } catch (error) {
          const index = popResolvers.indexOf(resolve);
          if (index >= 0) popResolvers.splice(index, 1);
          report(error);
          resolve({ status: 'failed', reason: error });
        }
      });
    },
    async preload(target, preloadOptions = {}) {
      if (disposed) throw new RouteError('router', 'Router is disposed');
      let currentTarget = target;
      const seen = new Set<string>();
      for (;;) {
        const match = matcher.matchTarget(currentTarget);
        if (!match)
          throw new RouteError(
            typeof target === 'string' ? target : target.name,
            `No route matches preload target: ${typeof target === 'string' ? target : target.name}`,
          );
        const key = `${match.record.name}:${matchPath(match.location)}`;
        if (seen.has(key)) throw new RouteError(match.record.name, 'Redirect loop detected');
        seen.add(key);
        if (match.record.redirect) {
          currentTarget = match.record.redirect;
          continue;
        }
        const strategy = preloadOptions.strategy ?? 'manual';
        if (strategy !== 'manual' && match.record.preload !== strategy) return;
        if (!match.record.page && !match.record.loadPage)
          throw new RouteError(match.record.name, 'Route has no page');
        await loader.load(match.record);
        return;
      }
    },
    async preloadIdle() {
      if (disposed) return;
      const records: RouteRecord[] = [];
      const walk = (record: RouteRecord): void => {
        if (record.preload === 'idle' && (record.page || record.loadPage)) records.push(record);
        record.children.forEach(walk);
      };
      options.routes.routes.forEach(walk);
      await Promise.all(records.map((record) => loader.load(record)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancellation?.cancel(new RouteError('router', 'Router disposed'));
      cancellation = undefined;
      unsubscribe();
      for (const resolve of popResolvers.splice(0))
        resolve({ status: 'cancelled', reason: new RouteError('router', 'Router disposed') });
    },
  };
}
