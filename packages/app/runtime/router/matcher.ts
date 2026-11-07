import type {
  RouteDefinition,
  RouteMatch,
  RouteRecord,
  RouteTable,
  RouteTarget,
  RouteTargetObject,
} from './types.js';

export class RouteError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = 'RouteError';
  }
}

interface CompiledSegment {
  readonly type: 'static' | 'param' | 'catchall';
  readonly value?: string;
  readonly name?: string;
}

interface CompiledRoute {
  readonly record: RouteRecord;
  readonly segments: readonly CompiledSegment[];
  readonly score: number;
}

function externalScheme(path: string): boolean {
  return /^[a-zA-Z][\w+.-]*:/.test(path) || path.startsWith('//');
}

export function parsePath(value: string): {
  path: string;
  query: Readonly<Record<string, string>>;
  hash: string;
} {
  let rest = value;
  let hash = '';
  const hashIndex = rest.indexOf('#');
  if (hashIndex >= 0) {
    hash = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
  }
  let queryText = '';
  const queryIndex = rest.indexOf('?');
  if (queryIndex >= 0) {
    queryText = rest.slice(queryIndex + 1);
    rest = rest.slice(0, queryIndex);
  }
  const query: Record<string, string> = {};
  for (const [name, item] of new URLSearchParams(queryText)) query[name] = item;
  return { path: normalizePath(rest), query, hash };
}

function normalizePath(path: string): string {
  let value = path || '/';
  if (!value.startsWith('/')) value = '/' + value;
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

function joinPath(parent: string, child: string): string {
  if (!child) return parent;
  if (child.startsWith('/')) return normalizePath(child);
  const base = parent === '/' ? '' : parent;
  return normalizePath(`${base}/${child}`);
}

function compilePath(path: string, source: string): CompiledSegment[] {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments.map((segment, index) => {
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!/^[A-Za-z_$][\w$]*$/.test(name))
        throw new RouteError(source, `Invalid route parameter ${segment}`);
      return { type: 'param' as const, name };
    }
    if (segment.startsWith('*')) {
      if (index !== segments.length - 1)
        throw new RouteError(source, 'Catch-all segment must be last');
      return { type: 'catchall' as const, name: segment.slice(1) || 'path' };
    }
    if (segment.includes('*') || segment.includes(':'))
      throw new RouteError(source, `Unsupported route segment ${segment}`);
    return { type: 'static' as const, value: segment };
  });
}

function score(segments: readonly CompiledSegment[]): number {
  let value = 0;
  for (const segment of segments) {
    if (segment.type === 'static') value += 1000;
    else if (segment.type === 'param') value += 10;
    else value += 1;
  }
  return value;
}

function normalizeTarget(target: RouteTarget): RouteTargetObject | string {
  if (typeof target === 'string') {
    if (externalScheme(target))
      throw new RouteError('route target', `External route target is not allowed: ${target}`);
    if (!target.startsWith('/'))
      throw new RouteError('route target', `Route paths must start with /: ${target}`);
    return target;
  }
  if (!target.name) throw new RouteError('route target', 'Named route target requires a name');
  return target;
}

export function defineRoutes(
  definitions: readonly RouteDefinition[],
  options: { fallback?: RouteTarget } = {},
): RouteTable {
  const names = new Set<string>();
  const patterns = new Set<string>();

  function build(
    items: readonly RouteDefinition[],
    parent: RouteRecord | undefined,
    base: string,
  ): RouteRecord[] {
    return items.map((item) => {
      if (!item.name) throw new RouteError('routes', 'Every route requires a name');
      if (names.has(item.name)) throw new RouteError(item.name, 'Duplicate route name');
      names.add(item.name);
      if (!item.path && item.path !== '') throw new RouteError(item.name, 'Route requires a path');
      if (item.page && item.loadPage)
        throw new RouteError(item.name, 'Route cannot declare both page and loadPage');
      if (item.redirect && (item.page || item.loadPage))
        throw new RouteError(item.name, 'Redirect routes cannot declare a page');
      const fullPath = joinPath(base, item.path);
      const children: RouteRecord[] = [];
      const record: RouteRecord = {
        name: item.name,
        path: item.path,
        fullPath,
        ...(item.page ? { page: item.page } : {}),
        ...(item.loadPage ? { loadPage: item.loadPage } : {}),
        children,
        ...(item.redirect ? { redirect: item.redirect } : {}),
        guards: Object.freeze([...(item.guards ?? [])]),
        beforeLeave: Object.freeze([...(item.beforeLeave ?? [])]),
        ...(item.prepare ? { prepare: item.prepare } : {}),
        preload: item.preload ?? 'none',
        meta: Object.freeze({ ...(item.meta ?? {}) }),
        reuse: item.reuse === true,
        ...(parent ? { parent } : {}),
      };
      if (item.children?.length) {
        if (item.page || item.loadPage)
          throw new RouteError(
            item.name,
            'Routes with children cannot mount a page directly; add an index child',
          );
        children.push(...build(item.children, record, fullPath));
      }
      return record;
    });
  }

  const routes = Object.freeze(build(definitions, undefined, '/'));
  const compiled: CompiledRoute[] = [];
  const walk = (record: RouteRecord): void => {
    const leaf = !record.children.length;
    if (leaf) {
      const key = record.fullPath;
      if (patterns.has(key))
        throw new RouteError(record.name, `Route pattern conflicts with another route: ${key}`);
      patterns.add(key);
      const segments = compilePath(record.fullPath, record.name);
      compiled.push({ record, segments, score: score(segments) });
    }
    record.children.forEach(walk);
  };
  routes.forEach(walk);
  compiled.sort((a, b) => b.score - a.score);
  return Object.freeze({
    routes,
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    // Internal compiled data is attached for createMatcher without widening the public type.
    ...({ __compiled: Object.freeze(compiled) } as object),
  });
}

export interface RouterMatcher {
  match(path: string): RouteMatch | undefined;
  matchTarget(target: RouteTarget): RouteMatch | undefined;
  resolve(target: RouteTarget): string;
  byName(name: string): RouteRecord | undefined;
  readonly table: RouteTable;
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function matchCompiled(
  compiled: CompiledRoute,
  path: string,
  query: Readonly<Record<string, string>>,
  hash: string,
): RouteMatch | undefined {
  const parts = normalizePath(path) === '/' ? [] : normalizePath(path).slice(1).split('/');
  const params: Record<string, string> = {};
  let index = 0;
  for (const segment of compiled.segments) {
    if (segment.type === 'catchall') {
      const rest = parts.slice(index).map((part) => decodeSegment(part));
      if (rest.some((part) => part === undefined)) return undefined;
      params[segment.name!] = rest.join('/');
      index = parts.length;
      break;
    }
    if (index >= parts.length) return undefined;
    const raw = parts[index++]!;
    const decoded = decodeSegment(raw);
    if (decoded === undefined) return undefined;
    if (segment.type === 'static') {
      if (decoded !== segment.value) return undefined;
    } else {
      params[segment.name!] = decoded;
    }
  }
  if (index !== parts.length) return undefined;
  const chain: RouteRecord[] = [];
  let current: RouteRecord | undefined = compiled.record;
  while (current) {
    chain.unshift(current);
    current = current.parent;
  }
  return {
    record: compiled.record,
    chain,
    location: {
      name: compiled.record.name,
      path: normalizePath(path),
      params: Object.freeze(params),
      query,
      hash,
    },
  };
}

export function createMatcher(table: RouteTable): RouterMatcher {
  const compiled = (table as unknown as { __compiled: readonly CompiledRoute[] }).__compiled;
  const names = new Map<string, RouteRecord>();
  const collect = (record: RouteRecord): void => {
    names.set(record.name, record);
    record.children.forEach(collect);
  };
  table.routes.forEach(collect);

  const resolve = (target: RouteTarget): string => {
    const value = normalizeTarget(target);
    if (typeof value === 'string') return value;
    const record = names.get(value.name);
    if (!record) throw new RouteError(value.name, `Unknown route name: ${value.name}`);
    const params = value.params ?? {};
    const path = normalizePath(
      record.fullPath
        .split('/')
        .map((segment) => {
          if (!segment.startsWith(':')) return segment;
          const name = segment.slice(1);
          if (!Object.hasOwn(params, name))
            throw new RouteError(record.name, `Missing route parameter: ${name}`);
          return encodeURIComponent(String(params[name]));
        })
        .join('/'),
    );
    const search = new URLSearchParams();
    for (const [name, item] of Object.entries(value.query ?? {}))
      if (item !== undefined) search.set(name, String(item));
    const query = search.toString();
    const hash = value.hash ? `#${value.hash.replace(/^#/, '')}` : '';
    return `${path}${query ? `?${query}` : ''}${hash}`;
  };

  const match = (path: string): RouteMatch | undefined => {
    if (externalScheme(path))
      throw new RouteError('route', `External route target is not allowed: ${path}`);
    const parsed = parsePath(path);
    for (const item of compiled) {
      const matched = matchCompiled(item, parsed.path, parsed.query, parsed.hash);
      if (matched) return matched;
    }
    return undefined;
  };

  return {
    table,
    match,
    matchTarget(target: RouteTarget): RouteMatch | undefined {
      return match(resolve(target));
    },
    resolve,
    byName: (name) => names.get(name),
  };
}
