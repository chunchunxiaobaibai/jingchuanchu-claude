import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalStorageAdapter,
  createMemoryStorage,
  createSaveService,
  defineSave,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

interface State {
  score: number;
  level: string;
  token: string;
}

let restores = 0;
const Progress = defineSave<State, { score: number; level: string }>({
  key: 'progress',
  version: 2,
  userScoped: true,
  select(state) {
    return { score: state.score, level: state.level };
  },
  parse(value) {
    const data = value as { score?: unknown; level?: unknown };
    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.score !== 'number' ||
      typeof data.level !== 'string'
    )
      throw new Error('invalid progress');
    return { score: data.score, level: data.level };
  },
  migrate(value, fromVersion) {
    if (fromVersion !== 1) throw new Error('unsupported version');
    const points = (value as { points?: unknown }).points;
    if (typeof points !== 'number') throw new Error('invalid old progress');
    return { score: points, level: 'one' };
  },
  restore() {
    restores += 1;
  },
});

test('save selects only whitelisted fields and load returns validated data without restoring', async () => {
  const storage = createMemoryStorage();
  const service = createSaveService(Progress, { storage });
  const result = await service.save({ score: 10, level: 'two', token: 'secret' });
  assert.deepEqual(result, { status: 'saved' });
  const raw = JSON.parse(storage.values.get('progress')!) as {
    schemaVersion: number;
    data: Record<string, unknown>;
  };
  assert.equal(raw.schemaVersion, 2);
  assert.deepEqual(raw.data, { score: 10, level: 'two' });
  assert.equal(restores, 0);
  assert.deepEqual(await service.load(), {
    status: 'ok',
    data: { score: 10, level: 'two' },
  });
  assert.equal(restores, 0);
  assert.equal(Progress.userScoped, true);
});

test('version migration is explicit and unknown versions are incompatible', async () => {
  const storage = createMemoryStorage({
    progress: JSON.stringify({ schemaVersion: 1, data: { points: 7 } }),
  });
  const service = createSaveService(Progress, { storage });
  const migrated = await service.load();
  assert.deepEqual(migrated, { status: 'ok', data: { score: 7, level: 'one' } });
  assert.equal(JSON.parse(storage.values.get('progress')!).schemaVersion, 1);

  storage.values.set(
    'progress',
    JSON.stringify({ schemaVersion: 3, data: { score: 1, level: 'x' } }),
  );
  const newer = await service.load();
  assert.equal(newer.status, 'incompatible');
  assert.equal(newer.status === 'incompatible' && newer.version, 3);

  storage.values.set('progress', JSON.stringify({ schemaVersion: 0, data: {} }));
  const older = await service.load();
  assert.equal(older.status, 'incompatible');
});

test('corrupt records stay untouched and storage failures are explicit', async () => {
  const storage = createMemoryStorage({ progress: 'not-json' });
  const service = createSaveService(Progress, { storage });
  const corrupt = await service.load();
  assert.equal(corrupt.status, 'corrupt');
  assert.equal(storage.values.get('progress'), 'not-json');

  storage.values.set(
    'progress',
    JSON.stringify({ schemaVersion: 2, data: { score: 'bad', level: 1 } }),
  );
  assert.equal((await service.load()).status, 'corrupt');
  assert.equal(storage.values.get('progress') !== undefined, true);

  const unavailable = createSaveService(Progress, {
    storage: {
      async get() {
        throw new Error('get denied');
      },
      async set() {
        throw new Error('set denied');
      },
      async remove() {
        throw new Error('remove denied');
      },
    },
  });
  assert.equal((await unavailable.load()).status, 'unavailable');
  assert.equal((await unavailable.save({ score: 1, level: 'x', token: '' })).status, 'unavailable');
  assert.equal((await unavailable.reset()).status, 'unavailable');

  const failed = createSaveService(
    defineSave<State, { score: number }>({
      key: 'failed',
      version: 1,
      select() {
        throw new Error('select failed');
      },
      parse: () => ({ score: 0 }),
    }),
    { storage },
  );
  assert.equal((await failed.save({ score: 1, level: 'x', token: '' })).status, 'failed');
});

test('namespaces isolate anonymous and per-user records and reset only their own key', async () => {
  const storage = createMemoryStorage();
  const anonymous = createSaveService(Progress, { storage, namespace: 'anonymous' });
  const alice = createSaveService(Progress, { storage, namespace: 'user:alice' });
  const bob = createSaveService(Progress, { storage, namespace: 'user:bob' });
  await anonymous.save({ score: 1, level: 'a', token: '' });
  await alice.save({ score: 2, level: 'b', token: '' });
  await bob.save({ score: 3, level: 'c', token: '' });
  assert.equal(alice.storageKey, 'user:alice:progress');
  assert.deepEqual(await alice.load(), { status: 'ok', data: { score: 2, level: 'b' } });
  assert.deepEqual(await bob.load(), { status: 'ok', data: { score: 3, level: 'c' } });
  assert.equal((await alice.reset()).status, 'reset');
  assert.equal((await alice.load()).status, 'empty');
  assert.deepEqual(await bob.load(), { status: 'ok', data: { score: 3, level: 'c' } });
  assert.deepEqual(await anonymous.load(), { status: 'ok', data: { score: 1, level: 'a' } });

  storage.values.set(
    'progress',
    JSON.stringify({ schemaVersion: 2, data: { score: 9, level: 'z' } }),
  );
  assert.deepEqual(await anonymous.load(), {
    status: 'ok',
    data: { score: 1, level: 'a' },
  });
});

test('localStorage adapter wraps a storage object and reports unavailability', async () => {
  const values = new Map<string, string>();
  const adapter = createLocalStorageAdapter({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  });
  await adapter.set('k', 'v');
  assert.equal(await adapter.get('k'), 'v');
  await adapter.remove('k');
  assert.equal(await adapter.get('k'), null);
  const missing = createLocalStorageAdapter(undefined);
  await assert.rejects(missing.get('k'), /localStorage is unavailable/);
});
