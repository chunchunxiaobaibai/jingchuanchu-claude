import type { AnyComponentDefinition } from '../component-types.js';
import type { RouteRecord } from './types.js';

export interface RouteLoader {
  load(record: RouteRecord): Promise<AnyComponentDefinition>;
  pending(record: RouteRecord): boolean;
}

export function createRouteLoader(): RouteLoader {
  const cached = new Map<RouteRecord, Promise<AnyComponentDefinition>>();
  return {
    load(record) {
      if (record.page) return Promise.resolve(record.page);
      if (!record.loadPage)
        return Promise.reject(new Error(`Route ${record.name} has no page or loadPage`));
      const existing = cached.get(record);
      if (existing) return existing;
      const promise = Promise.resolve()
        .then(() => record.loadPage!())
        .then((page) => {
          if (!page) throw new Error(`Route ${record.name} loader returned no page`);
          return page;
        })
        .catch((error) => {
          cached.delete(record);
          throw error;
        });
      cached.set(record, promise);
      return promise;
    },
    pending(record) {
      return cached.has(record);
    },
  };
}
