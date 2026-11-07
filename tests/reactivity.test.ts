import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { signal, computed, effect, batch } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ReadSignal } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { flushSync, scheduleRender } from '../packages/app/runtime/scheduler.js';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('same-value writes do not invalidate derived state', () => {
  const count = signal(1);
  let runs = 0;
  const doubled = computed(() => {
    runs += 1;
    return count() * 2;
  });
  assert.equal(doubled(), 2);
  assert.equal(runs, 1);
  count.set(1);
  assert.equal(doubled(), 2);
  assert.equal(runs, 1);
  count.set(2);
  assert.equal(doubled(), 4);
  assert.equal(runs, 2);
});

test('computed caches and follows dynamic dependency branches', () => {
  const useLeft = signal(true);
  const left = signal(1);
  const right = signal(10);
  let runs = 0;
  const selected = computed(() => {
    runs += 1;
    return useLeft() ? left() : right();
  });
  assert.equal(selected(), 1);
  assert.equal(selected(), 1);
  assert.equal(runs, 1);
  right.set(11);
  assert.equal(selected(), 1);
  assert.equal(runs, 1);
  useLeft.set(false);
  assert.equal(selected(), 11);
  assert.equal(runs, 2);
  left.set(2);
  assert.equal(selected(), 11);
  assert.equal(runs, 2);
});

test('signals expose independent frozen snapshots and ignore in-place mutation', () => {
  const original = { nested: { value: 1 } };
  const state = signal(original);
  const first = state();
  original.nested.value = 2;
  assert.equal(state().nested.value, 1);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.nested));
  state.set(original);
  assert.equal(state(), first);
  const replacement = { nested: { value: 3 } };
  state.set(replacement);
  assert.notStrictEqual(state(), first);
  assert.equal(state().nested.value, 3);
  state.update((previous) => ({ nested: { value: previous.nested.value + 1 } }));
  assert.equal(state().nested.value, 4);
  assert.equal(replacement.nested.value, 3);
});

test('computed rejects circular dependencies and writes during calculation', () => {
  let second: ReadSignal<number>;
  const first = computed(() => second() + 1);
  second = computed(() => first() + 1);
  assert.throws(() => first(), /Circular computed dependency/);

  const count = signal(0);
  const writer = computed(() => {
    count.set(1);
    return count();
  });
  assert.throws(() => writer(), /Cannot write a signal while/);
  assert.equal(count(), 0);
});

test('a failed computation can recover on the next read', () => {
  const ready = signal(false);
  const risky = computed(() => {
    if (!ready()) throw new Error('not ready');
    return 1;
  });
  assert.throws(() => risky(), /not ready/);
  ready.set(true);
  assert.equal(risky(), 1);
});

test('effects rerun after a batch, clean up once before each run and stop with their scope', async () => {
  const count = signal(0);
  const scope = new Scope();
  const seen: number[] = [];
  const cleanups: number[] = [];
  effect((onCleanup) => {
    const value = count();
    seen.push(value);
    onCleanup(() => cleanups.push(value));
  }, scope);
  assert.deepEqual(seen, [0]);
  count.set(1);
  count.set(2);
  assert.deepEqual(seen, [0]);
  await settle();
  assert.deepEqual(seen, [0, 2]);
  assert.deepEqual(cleanups, [0]);
  scope.dispose();
  count.set(3);
  await settle();
  assert.deepEqual(seen, [0, 2]);
  assert.deepEqual(cleanups, [0, 2]);
});

test('effects follow dynamic dependencies and can dispose themselves', async () => {
  const useLeft = signal(true);
  const left = signal(1);
  const right = signal(2);
  const scope = new Scope();
  const seen: number[] = [];
  const dispose = effect(() => {
    seen.push(useLeft() ? left() : right());
  }, scope);
  left.set(3);
  await settle();
  useLeft.set(false);
  await settle();
  left.set(4);
  await settle();
  right.set(5);
  await settle();
  assert.deepEqual(seen, [1, 3, 2, 5]);
  dispose();
  right.set(6);
  await settle();
  assert.deepEqual(seen, [1, 3, 2, 5]);
});

test('effect writes enter a later run within the same flush', async () => {
  const source = signal(0);
  const derived = signal(0);
  const scope = new Scope();
  const seen: number[] = [];
  effect(() => derived.set(source() * 2), scope);
  effect(() => {
    seen.push(derived());
  }, scope);
  source.set(2);
  await settle();
  assert.deepEqual(seen, [0, 4]);
});

test('batch keeps reads consistent and merges effect notifications', async () => {
  const value = signal(0);
  const doubled = computed(() => value() * 2);
  const scope = new Scope();
  let runs = 0;
  effect(() => {
    runs += 1;
    value();
  }, scope);
  const result = batch(() => {
    value.set(1);
    assert.equal(value(), 1);
    assert.equal(doubled(), 2);
    value.set(2);
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(doubled(), 4);
  assert.equal(runs, 1);
  await settle();
  assert.equal(runs, 2);
  batch(() => {
    value.set(3);
    value.set(3);
  });
  await settle();
  assert.equal(runs, 3);
});

test('effect write-back loops are diagnosed and do not hang the queue', () => {
  const scope = new Scope();
  const count = signal(0);
  effect(() => {
    count.set(count() + 1);
  }, scope);
  assert.throws(() => flushSync(), /Effect update loop detected/);
  scope.dispose();
});

test('render tasks share the flush protocol and failing tasks keep others running', () => {
  const order: string[] = [];
  scheduleRender(() => order.push('first'));
  scheduleRender(() => order.push('second'));
  flushSync();
  assert.deepEqual(order, ['first', 'second']);

  const source = signal(0);
  const scope = new Scope();
  const seen: number[] = [];
  let first = true;
  effect(() => {
    source();
    if (!first) throw new Error('boom');
    first = false;
  }, scope);
  effect(() => {
    seen.push(source());
  }, scope);
  source.set(1);
  assert.throws(() => flushSync(), /boom/);
  assert.deepEqual(seen, [0, 1]);
  scope.dispose();
});
