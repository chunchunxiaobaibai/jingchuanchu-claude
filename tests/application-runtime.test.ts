import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { Owner } from '../packages/app/runtime/component-owner.js';
import { Scheduler, flushSync } from '../packages/app/runtime/scheduler.js';
import { signal, effect } from '../packages/app/runtime/reactivity.js';
import {
  ApplicationError,
  bootstrapApplication,
  defineApplication,
  defineComponent,
  defineRoutes,
  defineService,
  input,
  mountApplication,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

function dom() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const container = document.createElement('div');
  document.body.append(container);
  return { window, document, container };
}

test('mounts the root component with application services and restores the host', async () => {
  const { document, container } = dom();
  container.innerHTML = '<i>original</i>';
  let created = 0;
  const Format = defineService({
    name: 'format',
    factory() {
      created += 1;
      return { text: (value: string) => `[${value}]` };
    },
  });
  const Root = defineComponent({
    selector: 'application-root',
    setup(context) {
      const format = context.useService(Format);
      return { text: format.text('hello') };
    },
    $template: '<span data-jcc-text-0></span>',
    $bindings: [
      {
        kind: 'text',
        id: 0,
        textIndex: 0,
        read: (scope) => String(scope.text),
      },
    ],
  });
  const definition = defineApplication({ root: Root, providers: [{ service: Format }] });
  const instance = await mountApplication(container, definition);
  assert.equal(instance.status, 'running');
  assert.equal(container.textContent, '[hello]');
  assert.equal(created, 1);
  instance.dispose();
  assert.equal(instance.status, 'disposed');
  assert.equal(container.innerHTML, '<i>original</i>');
});

test('each mount creates isolated services and duplicate hosts are rejected', async () => {
  const { document } = dom();
  let created = 0;
  const Counter = defineService({
    name: 'counter',
    factory() {
      created += 1;
      return { id: created };
    },
  });
  let serviceId = 0;
  const Root = defineComponent({
    selector: 'isolated-root',
    setup(context) {
      serviceId = context.useService(Counter).id;
      return {};
    },
    $template: '<span></span>',
  });
  const definition = defineApplication({ root: Root, providers: [{ service: Counter }] });
  const firstContainer = document.createElement('div');
  const secondContainer = document.createElement('div');
  document.body.append(firstContainer, secondContainer);
  const first = await mountApplication(firstContainer, definition);
  const firstId = serviceId;
  const second = await mountApplication(secondContainer, definition);
  assert.notEqual(firstId, serviceId);
  await assert.rejects(mountApplication(firstContainer, definition), /already mounted/);
  first.dispose();
  const remounted = await mountApplication(firstContainer, definition);
  assert.equal(remounted.status, 'running');
  second.dispose();
  remounted.dispose();
});

test('startup failures clean the owner and allow the host to be mounted again', async () => {
  const { container } = dom();
  container.innerHTML = '<b>keep</b>';
  let cleaned = 0;
  const Failing = defineComponent({
    selector: 'failing-root',
    setup(context) {
      context.own(() => {
        cleaned += 1;
      });
      throw new Error('setup failed');
    },
    $template: '<span></span>',
  });
  await assert.rejects(
    mountApplication(container, defineApplication({ root: Failing })),
    (error) => error instanceof ApplicationError && /setup failed/.test(error.message),
  );
  assert.equal(cleaned, 1);
  assert.equal(container.innerHTML, '<b>keep</b>');
  const Good = defineComponent({
    selector: 'good-root',
    setup() {
      return {};
    },
    $template: '<span>ok</span>',
  });
  const instance = await mountApplication(container, defineApplication({ root: Good }));
  assert.equal(container.textContent, 'ok');
  instance.dispose();
  assert.equal(container.innerHTML, '<b>keep</b>');
});

test('application errors report once and a failing onError does not recurse', async () => {
  const { window, document, container } = dom();
  const seen: unknown[] = [];
  const Root = defineComponent({
    selector: 'error-root',
    setup() {
      return {};
    },
    $template: '<button data-jcc-on-0></button>',
    $bindings: [
      {
        kind: 'event',
        id: 0,
        name: 'click',
        run() {
          throw new Error('event failure');
        },
      },
    ],
  });
  const instance = await mountApplication(
    container,
    defineApplication({ root: Root, onError: (error) => seen.push(error) }),
  );
  container.querySelector('button')!.dispatchEvent(new window.Event('click') as unknown as Event);
  assert.equal(seen.length, 1);
  instance.dispose();

  const secondContainer = document.createElement('div');
  document.body.append(secondContainer);
  let calls = 0;
  const logged: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const second = await mountApplication(
      secondContainer,
      defineApplication({
        root: Root,
        onError() {
          calls += 1;
          throw new Error('handler failure');
        },
      }),
    );
    secondContainer
      .querySelector('button')!
      .dispatchEvent(new window.Event('click') as unknown as Event);
    assert.equal(calls, 1);
    assert.equal(logged.length, 1);
    second.dispose();
  } finally {
    console.error = originalError;
  }
});

test('bootstrapApplication requires exactly one root host', async () => {
  const { document } = dom();
  const Root = defineComponent({
    selector: 'bootstrap-root',
    setup() {
      return {};
    },
    $template: '<span>bootstrap</span>',
  });
  const definition = defineApplication({ root: Root });
  const first = document.createElement('bootstrap-root');
  const second = document.createElement('bootstrap-root');
  document.body.append(first, second);
  await assert.rejects(bootstrapApplication(definition, { document }), /found 2/);
  second.remove();
  const instance = await bootstrapApplication(definition, { document });
  assert.equal(first.textContent, 'bootstrap');
  instance.dispose();
});

test('dispose aggregates cleanup failures and stays idempotent', async () => {
  const { container } = dom();
  const Root = defineComponent({
    selector: 'cleanup-root',
    setup() {
      return {};
    },
    onDestroy() {
      throw new Error('destroy failure');
    },
    $template: '<span></span>',
  });
  const instance = await mountApplication(container, defineApplication({ root: Root }));
  assert.throws(() => instance.dispose(), AggregateError);
  instance.dispose();
  assert.equal(instance.status, 'disposed');
  assert.equal(container.childNodes.length, 0);
});

test('applications with routes mount the initial page and expose the router', async () => {
  const { container } = dom();
  let homeCleanups = 0;
  const Home = defineComponent({
    selector: 'routed-home',
    setup(context) {
      context.own(() => {
        homeCleanups += 1;
      });
      return { text: 'home' };
    },
    $template: '<span data-jcc-text-0></span>',
    $bindings: [{ kind: 'text', id: 0, textIndex: 0, read: (scope) => String(scope.text) }],
  });
  const Play = defineComponent({
    selector: 'routed-play',
    inputs: { levelId: input<string>({ default: '' }) },
    setup(context) {
      return {
        level: context.inputs.levelId,
        routeLevel: context.route!.params.levelId,
      };
    },
    $template: '<span data-jcc-text-0></span><i data-jcc-text-1></i>',
    $bindings: [
      {
        kind: 'text',
        id: 0,
        textIndex: 0,
        read: (scope) => String((scope.level as () => string)()),
      },
      {
        kind: 'text',
        id: 1,
        textIndex: 0,
        read: (scope) => String(scope.routeLevel),
      },
    ],
  });
  const Root = defineComponent({
    selector: 'routed-root',
    setup() {
      return {};
    },
    $template: '<div><router-outlet></router-outlet></div>',
  });
  const definition = defineApplication({
    root: Root,
    routes: defineRoutes([
      { name: 'home', path: '/', page: Home },
      {
        name: 'play',
        path: '/play/:levelId',
        page: Play,
        prepare: ({ params }) => ({ levelId: params.levelId }),
      },
    ]),
  });
  const application = await mountApplication(container, definition);
  assert.ok(application.router);
  assert.equal(application.router!.current!.record.name, 'home');
  assert.equal(container.textContent, 'home');
  const result = await application.router!.push('/play/two');
  assert.equal(result.status, 'committed');
  assert.equal(container.querySelector('span')!.textContent, 'two');
  assert.equal(container.querySelector('i')!.textContent, 'two');
  assert.equal(homeCleanups, 1);
  application.dispose();
  assert.equal(container.childNodes.length, 0);
  assert.equal(application.status, 'disposed');
});

test('schedulers isolate error routing between two applications', async () => {
  const { document } = dom();
  const errorsA: unknown[] = [];
  const errorsB: unknown[] = [];

  const Root = defineComponent({
    selector: 'isolation-root-a',
    setup() {
      return {};
    },
    $template: '<span></span>',
  });

  const defA = defineApplication({
    root: Root,
    onError: (error) => errorsA.push(error),
  });
  const defB = defineApplication({
    root: Root,
    onError: (error) => errorsB.push(error),
  });

  const hostA = document.createElement('div');
  const hostB = document.createElement('div');
  document.body.append(hostA, hostB);
  const appA = await mountApplication(hostA, defA);
  const appB = await mountApplication(hostB, defB);

  // Two applications have distinct schedulers
  assert.notEqual(appA.owner.scheduler, appB.owner.scheduler);

  // Trigger an effect error inside app A's scheduler
  appA.owner.scheduler.scheduleEffect({
    source: 'test-effect-A',
    runEffect() {
      throw new Error('effect A failed');
    },
  });
  appA.owner.scheduler.flushSync();

  // App A's onError received the error, app B's did not
  assert.equal(errorsA.length, 1, 'app A should receive its own error');
  assert.equal(errorsB.length, 0, 'app B should not receive app A error');

  // Trigger an effect error inside app B's scheduler
  appB.owner.scheduler.scheduleEffect({
    source: 'test-effect-B',
    runEffect() {
      throw new Error('effect B failed');
    },
  });
  appB.owner.scheduler.flushSync();

  assert.equal(errorsB.length, 1, 'app B should receive its own error');
  assert.equal(errorsA.length, 1, 'app A count unchanged');

  appA.dispose();
  appB.dispose();
});

test('effect errors route to the owning application onError', () => {
  const errorsA: unknown[] = [];
  const errorsB: unknown[] = [];

  const ownerA = new Owner(undefined, new Scheduler((e) => errorsA.push(e)));
  const ownerB = new Owner(undefined, new Scheduler((e) => errorsB.push(e)));

  // effect() reads scheduler from scope -> owner; initial run is synchronous
  const tick = signal(0);
  effect(() => {
    if (tick() > 0) throw new Error('effect A boom');
  }, ownerA.scope);
  effect(() => {
    void tick();
  }, ownerB.scope);

  // Trigger; flush only A's scheduler
  tick.set(1);
  ownerA.scheduler.flushSync();

  assert.equal(errorsA.length, 1, 'effect error routes to owning app A');
  assert.equal(errorsB.length, 0, 'app B does not receive app A effect error');

  ownerA.scope.dispose();
  ownerB.scope.dispose();
});

test('child owners inherit the parent scheduler', () => {
  const errors: unknown[] = [];
  const parent = new Owner(undefined, new Scheduler((e) => errors.push(e)));
  const child = parent.createChild();
  assert.equal(child.scheduler, parent.scheduler, 'child shares parent scheduler');

  const tick = signal(0);
  effect(() => {
    if (tick() > 0) throw new Error('child effect boom');
  }, child.scope);

  tick.set(1);
  child.scheduler.flushSync();

  assert.equal(errors.length, 1, 'child effect error routes through parent scheduler');
  parent.scope.dispose();
});

test('effect without an owner falls back to the global scheduler', async () => {
  // Bare scope with no owner set → scheduler is undefined → falls back to global scheduler
  const bare = new Scope();
  const tick = signal(0);
  let ran = 0;
  effect(() => {
    void tick();
    ran++;
  }, bare);
  // Initial run is synchronous; subsequent runs go via global flushSync
  tick.set(1);
  flushSync();
  assert.ok(ran >= 2, 'effect runs via global scheduler fallback');
  bare.dispose();
});
