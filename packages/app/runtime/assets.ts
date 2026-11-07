import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import { AssetCache } from '@xiaobaibaifqy/jingchuanchu-assets';
import type {
  AssetAdapters,
  AssetContext,
  AssetContextOptions,
  AssetEntry,
  AssetGroupDefinition,
  AssetGroupLease,
  AssetLoadOptions,
  AssetLoadStatus,
  AssetProgress,
} from './asset-types.js';

export class AssetError extends Error {
  constructor(
    readonly group: string,
    readonly key: string | undefined,
    readonly url: string | undefined,
    cause: unknown,
  ) {
    const detail =
      cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : '';
    super(`Asset group ${group}${key ? `:${key}` : ''}${url ? ` (${url})` : ''} failed${detail}`, {
      cause,
    });
    this.name = 'AssetError';
  }
}

export function defineAssetGroup<const E extends readonly AssetEntry[]>(options: {
  name: string;
  entries: E;
}): AssetGroupDefinition<E> {
  if (!options.name) throw new Error('Asset group requires a name');
  const keys = new Set<string>();
  for (const entry of options.entries) {
    if (!entry.key) throw new Error(`Asset group ${options.name}: every entry requires a key`);
    if (keys.has(entry.key))
      throw new Error(`Asset group ${options.name}: duplicate asset key ${entry.key}`);
    keys.add(entry.key);
  }
  return Object.freeze({ name: options.name, entries: options.entries });
}

const decoderIds = new WeakMap<Function, number>();
let nextDecoder = 0;

function decoderId(decoder: Function): number {
  let id = decoderIds.get(decoder);
  if (id === undefined) {
    id = ++nextDecoder;
    decoderIds.set(decoder, id);
  }
  return id;
}

function cacheGroupKey(entry: AssetEntry): string {
  return entry.kind === 'json' ? `${entry.kind}#${decoderId(entry.decoder)}` : entry.kind;
}

function progressOf(
  status: AssetLoadStatus,
  total: number,
  completed: number,
  failed: number,
): AssetProgress {
  return Object.freeze({
    status,
    total,
    completed,
    failed,
    pending: Math.max(0, total - completed),
  });
}

export function createAssetContext(options: AssetContextOptions): AssetContext {
  const adapters: AssetAdapters = options.adapters;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const caches = new Map<string, AssetCache<unknown>>();
  let disposed = false;

  const adapterFor = (kind: AssetEntry['kind']) => {
    if (kind === 'image') return adapters.image;
    if (kind === 'atlas') return adapters.atlas;
    if (kind === 'audio') return adapters.audio;
    return adapters.json;
  };

  const cacheFor = (entry: AssetEntry): AssetCache<unknown> => {
    const group = cacheGroupKey(entry);
    let cache = caches.get(group);
    if (!cache) {
      cache = new AssetCache<unknown>((url, signal) => adapterFor(entry.kind)(url, signal));
      caches.set(group, cache);
    }
    return cache;
  };

  return {
    async load<E extends readonly AssetEntry[]>(
      group: AssetGroupDefinition<E>,
      loadOptions: AssetLoadOptions = {},
    ): Promise<AssetGroupLease<E>> {
      if (disposed)
        return Promise.reject(new AssetError(group.name, undefined, undefined, 'Context disposed'));
      const total = group.entries.length;
      const signal = loadOptions.signal;
      let completed = 0;
      let failed = 0;
      let aborted = signal?.aborted === true;
      let status: AssetLoadStatus = signal?.aborted ? 'cancelled' : 'loading';
      const report = (): void =>
        loadOptions.onProgress?.(progressOf(status, total, completed, failed));
      report();
      const unsubscribe = signal?.subscribe(() => {
        if (aborted) return;
        aborted = true;
        status = 'cancelled';
        report();
      });
      const results = new Map<string, unknown>();
      const failures: Record<string, Error> = {};
      const holds: Array<{ release(): void }> = [];
      let requiredError: AssetError | undefined;
      const queue = [...group.entries];

      const run = async (entry: AssetEntry): Promise<void> => {
        if (aborted) return;
        const hold = cacheFor(entry).retain(entry.src);
        holds.push(hold);
        try {
          const raw = await hold.promise;
          if (aborted) return;
          const value = entry.kind === 'json' ? entry.decoder(raw) : raw;
          results.set(entry.key, value);
          completed += 1;
        } catch (error) {
          if (aborted) return;
          completed += 1;
          failed += 1;
          const failure = new AssetError(group.name, entry.key, entry.src, error);
          failures[entry.key] = failure;
          if (!entry.optional && !requiredError) requiredError = failure;
        } finally {
          report();
        }
      };
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (;;) {
          const entry = queue.shift();
          if (!entry || aborted) return;
          await run(entry);
        }
      });
      await Promise.all(workers);
      unsubscribe?.();
      if (aborted || signal?.aborted) {
        for (const hold of holds.splice(0).reverse()) hold.release();
        status = 'cancelled';
        report();
        throw new AssetError(group.name, undefined, undefined, 'Asset group load cancelled');
      }
      if (requiredError) {
        for (const hold of holds.splice(0).reverse()) hold.release();
        status = 'failed';
        report();
        throw requiredError;
      }
      status = 'ready';
      report();
      let released = false;
      const lease: AssetGroupLease<E> = {
        status: 'ready',
        get progress() {
          return progressOf(status, total, completed, failed);
        },
        failures: Object.freeze({ ...failures }),
        get(key) {
          if (!results.has(key))
            throw new AssetError(
              group.name,
              String(key),
              undefined,
              failures[String(key)] ?? 'Asset was not loaded',
            );
          return results.get(key);
        },
        has(key) {
          return results.has(key);
        },
        release() {
          if (released) return;
          released = true;
          for (const hold of holds.splice(0).reverse()) hold.release();
        },
      };
      loadOptions.scope?.own(() => lease.release());
      return lease;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cache of caches.values()) cache.dispose();
      caches.clear();
    },
  };
}
