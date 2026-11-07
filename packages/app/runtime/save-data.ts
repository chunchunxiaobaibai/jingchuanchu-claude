export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createLocalStorageAdapter(storage?: StorageLike): StorageAdapter {
  const target = storage ?? (globalThis as { localStorage?: StorageLike }).localStorage;
  const requireStorage = () => {
    if (!target) throw new Error('localStorage is unavailable');
    return target;
  };
  return {
    async get(key) {
      return requireStorage().getItem(key);
    },
    async set(key, value) {
      requireStorage().setItem(key, value);
    },
    async remove(key) {
      requireStorage().removeItem(key);
    },
  };
}

export interface SaveDefinition<S, T> {
  readonly key: string;
  readonly version: number;
  readonly userScoped: boolean;
  select(state: S): T;
  parse(value: unknown): T;
  migrate?(value: unknown, fromVersion: number): T;
  restore?(value: T): void;
}

export function defineSave<S, T>(options: {
  key: string;
  version: number;
  userScoped?: boolean;
  select(state: S): T;
  parse(value: unknown): T;
  migrate?(value: unknown, fromVersion: number): T;
  restore?(value: T): void;
}): SaveDefinition<S, T> {
  if (!options.key) throw new Error('Save definition requires a key');
  if (!Number.isInteger(options.version) || options.version < 1)
    throw new Error('Save version must be a positive integer');
  return Object.freeze({ ...options, userScoped: options.userScoped === true });
}

export type SaveLoadResult<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'empty' }
  | { readonly status: 'corrupt'; readonly error: unknown }
  | {
      readonly status: 'incompatible';
      readonly version: number | undefined;
      readonly error: unknown;
    }
  | { readonly status: 'unavailable'; readonly error: unknown };

export type SaveWriteResult =
  | { readonly status: 'saved' }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'unavailable'; readonly error: unknown };

export type SaveResetResult =
  { readonly status: 'reset' } | { readonly status: 'unavailable'; readonly error: unknown };

export interface SaveServiceOptions {
  readonly storage: StorageAdapter;
  readonly namespace?: string;
  readonly onError?: (error: unknown) => void;
}

export interface SaveService<S, T> {
  readonly storageKey: string;
  readonly definition: SaveDefinition<S, T>;
  save(state: S): Promise<SaveWriteResult>;
  load(): Promise<SaveLoadResult<T>>;
  reset(): Promise<SaveResetResult>;
}

interface StoredRecord {
  readonly schemaVersion: number;
  readonly data: unknown;
}

export function createSaveService<S, T>(
  definition: SaveDefinition<S, T>,
  options: SaveServiceOptions,
): SaveService<S, T> {
  const storageKey = options.namespace ? `${options.namespace}:${definition.key}` : definition.key;
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };

  return {
    storageKey,
    definition,
    async save(state) {
      let data: T;
      try {
        data = definition.select(state);
      } catch (error) {
        report(error);
        return { status: 'failed', error };
      }
      try {
        const value = JSON.stringify({
          schemaVersion: definition.version,
          data,
        } satisfies StoredRecord);
        try {
          await options.storage.set(storageKey, value);
          return { status: 'saved' };
        } catch (error) {
          report(error);
          return { status: 'unavailable', error };
        }
      } catch (error) {
        report(error);
        return { status: 'failed', error };
      }
    },
    async load() {
      let raw: string | null;
      try {
        raw = await options.storage.get(storageKey);
      } catch (error) {
        report(error);
        return { status: 'unavailable', error };
      }
      if (raw === null || raw === '') return { status: 'empty' };
      let record: unknown;
      try {
        record = JSON.parse(raw);
      } catch (error) {
        report(error);
        return { status: 'corrupt', error };
      }
      if (
        !record ||
        typeof record !== 'object' ||
        !Number.isInteger((record as StoredRecord).schemaVersion) ||
        !Object.hasOwn(record, 'data')
      ) {
        const error = new Error('Saved record has an invalid shape');
        report(error);
        return { status: 'corrupt', error };
      }
      const stored = record as StoredRecord;
      if (stored.schemaVersion === definition.version) {
        try {
          return { status: 'ok', data: definition.parse(stored.data) };
        } catch (error) {
          report(error);
          return { status: 'corrupt', error };
        }
      }
      if (!definition.migrate) {
        const error = new Error(`Unsupported save version ${stored.schemaVersion}`);
        report(error);
        return { status: 'incompatible', version: stored.schemaVersion, error };
      }
      try {
        const migrated = definition.migrate(stored.data, stored.schemaVersion);
        return { status: 'ok', data: definition.parse(migrated) };
      } catch (error) {
        report(error);
        return { status: 'incompatible', version: stored.schemaVersion, error };
      }
    },
    async reset() {
      try {
        await options.storage.remove(storageKey);
        return { status: 'reset' };
      } catch (error) {
        report(error);
        return { status: 'unavailable', error };
      }
    },
  };
}

export function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}
