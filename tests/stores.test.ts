import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  Owner,
  OwnerError,
  batch,
  computed,
  defineComponent,
  defineStore,
  effect,
  mountComponent,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  ComponentEnvironment,
  StoreInstanceOf,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const GameStore = defineStore({
  name: 'game-session',
  setup(context) {
    const score = context.signal(0);
    const doubled = computed(() => score() * 2);
    return {
      state: { score },
      getters: { doubled },
      actions: {
        addScore: (amount: number) => score.update((value) => value + amount),
      },
    };
  },
});

test('one store instance is shared across owners of the same application', () => {
  const application = new Owner();
  const firstPage = application.createChild();
  const secondPage = application.createChild();
  const store = firstPage.useStore(GameStore);
  assert.strictEqual(secondPage.useStore(GameStore), store);
  store.actions.addScore(3);
  assert.equal(store.state.score(), 3);
  assert.equal(store.getters.doubled(), 6);
  const separate = new Owner().useStore(GameStore);
  assert.notStrictEqual(separate, store);
  assert.equal(separate.state.score(), 0);
});

test('read-only state drives effects and batches notifications', async () => {
  const application = new Owner();
  const store = application.useStore(GameStore);
  const seen: number[] = [];
  const scope = application.createChild();
  effect(() => {
    seen.push(store.state.score());
  }, scope.scope);
  assert.deepEqual(seen, [0]);
  batch(() => {
    store.actions.addScore(1);
    store.actions.addScore(2);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [0, 3]);
  assert.throws(() => {
    (store.state as unknown as { score: number }).score = 5;
  }, TypeError);
});

test('page-provided stores are private and release their effects with the page', async () => {
  const application = new Owner();
  const page = application.createChild();
  let cleanups = 0;
  const PrivateStore = defineStore({
    name: 'private-page',
    setup(context) {
      const value = context.signal(0);
      effect((onCleanup) => {
        value();
        onCleanup(() => {
          cleanups += 1;
        });
      }, context.scope);
      return {
        state: { value },
        actions: { setValue: (next: number) => value.set(next) },
      };
    },
  });
  const shared = application.useStore(PrivateStore);
  const local = page.provideStore(PrivateStore);
  assert.notStrictEqual(local, shared);
  local.actions.setValue(2);
  assert.equal(shared.state.value(), 0);
  page.dispose();
  assert.equal(cleanups, 1);
  assert.throws(() => page.useStore(PrivateStore), OwnerError);
});

test('reset restores initial snapshots, keeps read handles and notifies business cleanups', () => {
  const application = new Owner();
  const store = application.useStore(GameStore);
  let resets = 0;
  const Resettable = defineStore({
    name: 'resettable',
    setup(context) {
      const value = context.signal(1);
      context.onReset(() => {
        resets += 1;
      });
      return {
        state: { value },
        actions: { set: (next: number) => value.set(next) },
      };
    },
  });
  const resettable = application.useStore(Resettable);
  const handle = resettable.state.value;
  store.actions.addScore(5);
  resettable.actions.set(9);
  assert.equal(handle(), 9);
  resettable.reset();
  store.reset();
  assert.equal(handle(), 1);
  assert.strictEqual(resettable.state.value, handle);
  assert.equal(store.state.score(), 0);
  assert.equal(store.getters.doubled(), 0);
  assert.equal(resets, 1);
});

test('async tasks are invalidated by newer keys, reset and dispose', async () => {
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const commits: boolean[] = [];
  const AsyncStore = defineStore({
    name: 'async-store',
    setup(context) {
      const value = context.signal(0);
      return {
        state: { value },
        actions: {
          load(next: number, wait: Promise<void>) {
            return context.runTask(
              async ({ commit }) => {
                await wait;
                commits.push(commit(() => value.set(next)));
              },
              { key: 'load' },
            );
          },
          loadIndependent(next: number, wait: Promise<void>) {
            return context.runTask(async ({ commit }) => {
              await wait;
              commits.push(commit(() => value.set(next)));
            });
          },
        },
      };
    },
  });
  const store = new Owner().useStore(AsyncStore);
  const first = gate();
  const second = gate();
  const firstTask = store.actions.load(1, first.promise);
  const secondTask = store.actions.load(2, second.promise);
  first.resolve();
  await firstTask;
  second.resolve();
  await secondTask;
  assert.equal(store.state.value(), 2);
  assert.deepEqual(commits, [false, true]);

  commits.length = 0;
  const resetGate = gate();
  const resetTask = store.actions.load(3, resetGate.promise);
  store.reset();
  resetGate.resolve();
  await resetTask;
  assert.equal(store.state.value(), 0);
  assert.deepEqual(commits, [false]);

  commits.length = 0;
  const left = gate();
  const right = gate();
  const leftTask = store.actions.loadIndependent(4, left.promise);
  const rightTask = store.actions.loadIndependent(5, right.promise);
  right.resolve();
  await rightTask;
  left.resolve();
  await leftTask;
  assert.deepEqual(commits, [true, true]);
  assert.equal(store.state.value(), 4);
});

test('circular store dependencies and user-scoped markers are explicit', () => {
  let A: ReturnType<typeof defineStore>;
  let B: ReturnType<typeof defineStore>;
  A = defineStore({
    name: 'store-a',
    setup(context) {
      context.useStore(B);
      return { state: {} };
    },
  });
  B = defineStore({
    name: 'store-b',
    setup(context) {
      context.useStore(A);
      return { state: {} };
    },
  });
  assert.throws(
    () => new Owner().useStore(A),
    /Circular store dependency: store-a -> store-b -> store-a/,
  );

  const Scoped = defineStore({
    name: 'user-scoped',
    userScoped: true,
    setup(context) {
      return { state: { value: context.signal(0) } };
    },
  });
  const store = new Owner().useStore(Scoped);
  assert.equal(Scoped.userScoped, true);
  assert.equal(store.userScoped, true);
});

test('components in the same application resolve the same store through their owner', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const application = new Owner();
  const environment: ComponentEnvironment = {
    owner: application,
    onError(error) {
      throw error;
    },
  };
  const stores: StoreInstanceOf<typeof GameStore>[] = [];
  const View = defineComponent({
    selector: 'store-view',
    setup(context) {
      const store = context.useStore(GameStore);
      stores.push(store);
      return { score: store.state.score, add: store.actions.addScore };
    },
    $template: '<span data-jcc-text-0></span>',
    $bindings: [
      {
        kind: 'text',
        id: 0,
        textIndex: 0,
        read: (scope) => String((scope.score as () => number)()),
      },
    ],
  });
  const firstHost = document.createElement('div');
  const secondHost = document.createElement('div');
  document.body.append(firstHost, secondHost);
  const first = mountComponent(firstHost, View, environment);
  const second = mountComponent(secondHost, View, environment);
  assert.strictEqual(stores[0], stores[1]);
  stores[0]!.actions.addScore(4);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(firstHost.textContent, '4');
  assert.equal(secondHost.textContent, '4');
  first.dispose();
  second.dispose();
});
