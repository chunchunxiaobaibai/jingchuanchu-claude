import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cancellation, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  AssetError,
  createAssetContext,
  defineAssetGroup,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { AssetAdapters } from '@xiaobaibaifqy/jingchuanchu-app/application';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

function adapters(overrides: Partial<AssetAdapters> = {}) {
  const calls: string[] = [];
  const base: AssetAdapters = {
    async image(url: string) {
      calls.push(`image:${url}`);
      await tick();
      return { url };
    },
    async atlas(url: string) {
      calls.push(`atlas:${url}`);
      await tick();
      return { url, frames: {} };
    },
    async audio(url: string) {
      calls.push(`audio:${url}`);
      await tick();
      return { url, bytes: new Uint8Array() };
    },
    async json(url: string) {
      calls.push(`json:${url}`);
      await tick();
      return JSON.parse(url);
    },
  };
  return { calls, adapters: { ...base, ...overrides } };
}

test('asset groups respect concurrency, dedupe keys and report fixed entry progress', async () => {
  let active = 0;
  let peak = 0;
  const created = adapters({
    async image(url: string) {
      created.calls.push(`image:${url}`);
      active += 1;
      peak = Math.max(peak, active);
      await tick();
      active -= 1;
      return { url };
    },
  });
  const context = createAssetContext({ adapters: created.adapters, concurrency: 4 });
  const group = defineAssetGroup({
    name: 'ui',
    entries: [
      { key: 'a', kind: 'image', src: '/a.png' },
      { key: 'b', kind: 'image', src: '/b.png' },
      { key: 'c', kind: 'image', src: '/c.png' },
      { key: 'd', kind: 'image', src: '/d.png' },
      { key: 'e', kind: 'image', src: '/e.png' },
      { key: 'f', kind: 'image', src: '/f.png' },
    ],
  });
  const progress: Array<{ total: number; completed: number; pending: number }> = [];
  const first = await context.load(group, {
    onProgress: (value) =>
      progress.push({ total: value.total, completed: value.completed, pending: value.pending }),
  });
  assert.equal(peak, 4);
  assert.equal(progress[0]!.total, 6);
  assert.equal(progress.at(-1)!.completed, 6);
  assert.equal(progress.at(-1)!.pending, 0);
  assert.equal((first.get('a') as { url: string }).url, '/a.png');
  assert.equal(first.has('missing'), false);
  assert.throws(() => first.get('missing'), AssetError);

  const secondGroup = defineAssetGroup({
    name: 'shared',
    entries: [{ key: 'a', kind: 'image', src: '/a.png' }],
  });
  const second = await context.load(secondGroup);
  assert.equal(created.calls.filter((call) => call === 'image:/a.png').length, 1);
  assert.equal((second.get('a') as { url: string }).url, '/a.png');
  first.release();
  second.release();
  context.dispose();
});

test('one owner cancelling does not break another holder; failures retry only failed entries', async () => {
  let attempts = 0;
  let badJsonAttempts = 0;
  const context = createAssetContext({
    adapters: {
      image: async (url) => {
        attempts += 1;
        await tick();
        return { url };
      },
      atlas: async (url) => ({ url }),
      audio: async (url) => ({ url }),
      json: async (url) => {
        if (url === '/bad.json') {
          badJsonAttempts += 1;
          if (badJsonAttempts === 1) throw new Error('bad json');
        }
        return { ok: true };
      },
    },
  });
  const shared = defineAssetGroup({
    name: 'shared',
    entries: [{ key: 'logo', kind: 'image', src: '/logo.png' }],
  });
  const scope = new Scope();
  const ownerOne = new Cancellation();
  const firstLoad = context.load(shared, { signal: ownerOne, scope });
  const first = await firstLoad;
  const second = await context.load(shared);
  ownerOne.cancel();
  first.release();
  assert.equal((second.get('logo') as { url: string }).url, '/logo.png');
  const scopeTwo = new Scope();
  second.release();
  scope.dispose();
  scopeTwo.dispose();
  assert.equal(attempts, 1);

  const retryGroup = defineAssetGroup({
    name: 'retry',
    entries: [
      {
        key: 'good',
        kind: 'json',
        src: '/good.json',
        decoder: (value) => value,
      },
      {
        key: 'bad',
        kind: 'json',
        src: '/bad.json',
        decoder: (value) => value,
      },
    ],
  });
  const failed = await context.load(retryGroup).catch((error) => error);
  assert.ok(failed instanceof AssetError);
  assert.equal(failed.key, 'bad');
  assert.equal(failed.url, '/bad.json');
  const retried = await context.load(retryGroup);
  assert.deepEqual(retried.get('bad'), { ok: true });
  assert.deepEqual(retried.get('good'), { ok: true });
  retried.release();
  context.dispose();
});

test('cancelled groups release their holds and required failures report their source', async () => {
  const scope = new Scope();
  const cancellation = new Cancellation();
  let calls = 0;
  const context = createAssetContext({
    adapters: {
      image: async (url) => {
        calls += 1;
        await tick();
        return { url };
      },
      atlas: async (url) => ({ url }),
      audio: async (url) => ({ url }),
      json: async () => {
        throw new Error('invalid json');
      },
    },
  });
  const group = defineAssetGroup({
    name: 'cancel',
    entries: [{ key: 'hero', kind: 'image', src: '/hero.png' }],
  });
  const loading = context.load(group, { signal: cancellation, scope });
  cancellation.cancel();
  await assert.rejects(loading, /cancelled/);
  const after = await context.load(group);
  assert.equal(calls, 2);
  after.release();
  scope.dispose();

  const broken = defineAssetGroup({
    name: 'broken',
    entries: [{ key: 'data', kind: 'json', src: '/data.json', decoder: (value) => value }],
  });
  await assert.rejects(context.load(broken), (error) => {
    assert.ok(error instanceof AssetError);
    assert.equal(error.group, 'broken');
    assert.equal(error.key, 'data');
    assert.match(String((error.cause as Error).message), /invalid json/);
    return true;
  });
  context.dispose();
});
