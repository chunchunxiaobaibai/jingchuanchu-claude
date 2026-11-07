import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  defineComponent,
  mountComponent,
  input,
  model,
  output,
  nextTick,
  Owner,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ComponentEnvironment } from '@xiaobaibaifqy/jingchuanchu-app/application';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function dom() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  return { document, host };
}

function environment(errors: unknown[] = []): ComponentEnvironment {
  return { owner: new Owner(), onError: (error) => errors.push(error) };
}

test('component instances isolate inputs, models and local state while merging updates', async () => {
  const { document } = dom();
  const firstHost = document.createElement('div');
  const secondHost = document.createElement('div');
  document.body.append(firstHost, secondHost);
  const members: Array<{
    local: { (): number; update(reduce: (value: number) => number): void };
    value: { (): number; set(value: number): void };
  }> = [];
  const changes: unknown[] = [];
  const Counter = defineComponent({
    selector: 'test-counter',
    inputs: {
      label: input<string>({ default: 'none' }),
      amount: input<number>({ default: 0 }),
    },
    models: { value: model<number>({ default: 0 }) },
    setup(context) {
      const local = context.signal(0);
      members.push({ local, value: context.models.value });
      return { local, value: context.models.value };
    },
    onInputsChanged(context, change) {
      changes.push({
        label: context.inputs.label(),
        amount: context.inputs.amount(),
        previous: change.previous,
        current: change.current,
      });
    },
    $template: '<span></span>',
  });
  const env = environment();
  const first = mountComponent(firstHost, Counter, env, { label: 'a', amount: 1 });
  const second = mountComponent(secondHost, Counter, env, { label: 'b', amount: 2 });
  assert.equal(members.length, 2);
  assert.equal(members[0]!.local(), 0);
  members[0]!.local.update((value) => value + 1);
  members[0]!.value.set(5);
  assert.equal(members[0]!.local(), 1);
  assert.equal(members[1]!.local(), 0);
  assert.equal(members[1]!.value(), 0);

  first.setInputs({ label: 'a', amount: 3 });
  first.setInputs({ label: 'a', amount: 4 });
  await settle();
  assert.deepEqual(changes, [
    {
      label: 'a',
      amount: 4,
      previous: { label: 'a', amount: 1 },
      current: { label: 'a', amount: 4 },
    },
  ]);
  second.setInputs({ label: 'b', amount: 9 });
  await settle();
  assert.equal(changes.length, 2);
  first.dispose();
  second.dispose();
});

test('parent setup and init precede children; children mount and destroy around the parent', () => {
  const calls: string[] = [];
  const { document } = dom();
  const host = document.createElement('div');
  document.body.append(host);
  const Child = defineComponent({
    selector: 'test-child',
    setup() {
      calls.push('child:setup');
      return {};
    },
    onInit() {
      calls.push('child:init');
    },
    onMount() {
      calls.push('child:mount');
    },
    onDeactivate() {
      calls.push('child:deactivate');
    },
    onActivate() {
      calls.push('child:activate');
    },
    onDestroy() {
      calls.push('child:destroy');
    },
    $template: '<i></i>',
  });
  const Parent = defineComponent({
    selector: 'test-parent',
    components: [Child],
    setup() {
      calls.push('parent:setup');
      return {};
    },
    onInit() {
      calls.push('parent:init');
    },
    onMount() {
      calls.push('parent:mount');
    },
    onDeactivate() {
      calls.push('parent:deactivate');
    },
    onActivate() {
      calls.push('parent:activate');
    },
    onDestroy() {
      calls.push('parent:destroy');
    },
    $template: '<test-child></test-child>',
  });
  const instance = mountComponent(host, Parent, environment());
  assert.deepEqual(calls, [
    'parent:setup',
    'parent:init',
    'child:setup',
    'child:init',
    'child:mount',
    'parent:mount',
  ]);
  calls.length = 0;
  instance.deactivate();
  instance.activate();
  assert.deepEqual(calls, [
    'child:deactivate',
    'parent:deactivate',
    'child:activate',
    'parent:activate',
  ]);
  calls.length = 0;
  instance.dispose();
  assert.deepEqual(calls, ['child:destroy', 'parent:destroy']);
  assert.equal(host.childNodes.length, 0);
});

test('input updates wait while deactivated and render once on activation', async () => {
  const { document } = dom();
  const host = document.createElement('div');
  document.body.append(host);
  const changes: unknown[] = [];
  const Counter = defineComponent({
    selector: 'test-deferred',
    inputs: { label: input<string>({ default: 'initial' }) },
    setup() {
      return {};
    },
    onInputsChanged(_context, change) {
      changes.push(change);
    },
    $template: '<span></span>',
  });
  const instance = mountComponent(host, Counter, environment(), { label: 'initial' });
  instance.deactivate();
  instance.setInputs({ label: 'later' });
  await settle();
  assert.deepEqual(changes, []);
  instance.activate();
  await settle();
  assert.deepEqual(changes, [{ previous: { label: 'initial' }, current: { label: 'later' } }]);
  instance.dispose();
});

test('failed mounts clean candidates and allow the host to be reused', () => {
  const { document, host } = dom();
  host.innerHTML = '<p>original</p>';
  let cleaned = 0;
  const failing = defineComponent({
    selector: 'test-failing',
    setup(context) {
      context.own(() => {
        cleaned += 1;
      });
      return {};
    },
    onMount() {
      throw new Error('mount boom');
    },
    $template: '<span>temporary</span>',
  });
  assert.throws(() => mountComponent(host, failing, environment()), /onMount/);
  assert.equal(cleaned, 1);
  assert.equal(host.innerHTML, '<p>original</p>');

  const required = defineComponent({
    selector: 'test-required',
    inputs: { value: input<number>({ required: true }) },
    setup() {
      return {};
    },
  });
  assert.throws(() => mountComponent(host, required, environment()), /input failed/);
  assert.equal(host.innerHTML, '<p>original</p>');

  const good = defineComponent({
    selector: 'test-good',
    setup() {
      return {};
    },
    $template: '<b>ok</b>',
  });
  const instance = mountComponent(host, good, environment());
  assert.equal(host.innerHTML, '<b>ok</b>');
  instance.dispose();
  assert.equal(host.innerHTML, '<p>original</p>');
});

test('cleanup failures are aggregated while remaining cleanup continues', () => {
  const { document, host } = dom();
  const calls: string[] = [];
  const Child = defineComponent({
    selector: 'test-cleanup-child',
    setup() {
      return {};
    },
    onDestroy() {
      calls.push('child');
      throw new Error('child cleanup');
    },
    $template: '<i></i>',
  });
  const Parent = defineComponent({
    selector: 'test-cleanup-parent',
    components: [Child],
    setup() {
      return {};
    },
    onDestroy() {
      calls.push('parent');
    },
    $template: '<test-cleanup-child></test-cleanup-child>',
  });
  const instance = mountComponent(host, Parent, environment());
  calls.length = 0;
  assert.throws(() => instance.dispose(), AggregateError);
  assert.deepEqual(calls, ['child', 'parent']);
  assert.equal(host.childNodes.length, 0);
  instance.dispose();
});

test('outputs validate their names and notify subscribed bindings', () => {
  const { document, host } = dom();
  document.body.append(host);
  let send: ((value: string) => void) | undefined;
  let bad: (() => void) | undefined;
  const Emitter = defineComponent({
    selector: 'test-emitter',
    outputs: { save: output<string>() },
    setup(context) {
      send = (value) => context.emit('save', value);
      bad = () =>
        (context.emit as unknown as (name: string, payload: unknown) => void)('missing', 1);
      return {};
    },
    $template: '<span></span>',
  });
  const instance = mountComponent(host, Emitter, environment());
  const seen: unknown[] = [];
  instance.subscribeOutput('save', (payload) => seen.push(payload));
  send!('done');
  assert.deepEqual(seen, ['done']);
  assert.throws(() => bad!(), /Unknown output/);
  instance.dispose();
});

test('parent templates provide child inputs and receive child outputs as events', async () => {
  const { document, host } = dom();
  let childLabel: { (): string } | undefined;
  let save: (() => void) | undefined;
  const Child = defineComponent({
    selector: 'test-io-child',
    inputs: { label: input<string>({ required: true }) },
    outputs: { save: output<string>() },
    setup(context) {
      childLabel = context.inputs.label;
      save = () => context.emit('save', context.inputs.label());
      return {};
    },
    $template: '<span></span>',
  });
  let label: { (): string; set(next: string): void } | undefined;
  const received: unknown[] = [];
  const Parent = defineComponent({
    selector: 'test-io-parent',
    components: [Child],
    setup(context) {
      label = context.signal('one');
      return { label };
    },
    $template: '<test-io-child data-jcc-input-0 data-jcc-on-0></test-io-child>',
    $bindings: [
      {
        kind: 'component-input',
        id: 0,
        name: 'label',
        read: (scope) => String((scope.label as () => string)()),
      },
      {
        kind: 'event',
        id: 0,
        name: 'save',
        run: (_scope, event) => received.push((event as CustomEvent).detail),
      },
    ],
  });
  const instance = mountComponent(host, Parent, environment());
  await settle();
  assert.equal(childLabel!(), 'one');
  label!.set('two');
  await settle();
  assert.equal(childLabel!(), 'two');
  save!();
  assert.deepEqual(received, ['two']);
  instance.dispose();
});

test('when templates create and release their branch and nested components', async () => {
  const { document, host } = dom();
  const calls: string[] = [];
  let visible: { (): boolean; set(next: boolean): void } | undefined;
  const Branch = defineComponent({
    selector: 'test-branch-child',
    setup() {
      calls.push('child:setup');
      return {};
    },
    onDestroy() {
      calls.push('child:destroy');
    },
    $template: '<i></i>',
  });
  const App = defineComponent({
    selector: 'test-when-app',
    components: [Branch],
    setup(context) {
      visible = context.signal(true);
      return { visible };
    },
    $template:
      '<template data-jcc-when-0><section><test-branch-child></test-branch-child><span data-jcc-text-0></span></section></template>',
    $bindings: [
      { kind: 'when', id: 0, condition: (scope) => (scope.visible as () => boolean)() },
      {
        kind: 'text',
        id: 0,
        block: 0,
        textIndex: 0,
        read: (scope) => String((scope.visible as () => boolean)()),
      },
    ],
  });
  const instance = mountComponent(host, App, environment());
  assert.deepEqual(calls, ['child:setup']);
  assert.equal(host.querySelector('span')!.textContent, 'true');
  visible!.set(false);
  await settle();
  assert.equal(host.querySelector('span'), null);
  assert.deepEqual(calls, ['child:setup', 'child:destroy']);
  visible!.set(true);
  await settle();
  assert.equal(host.querySelector('span')!.textContent, 'true');
  assert.deepEqual(calls, ['child:setup', 'child:destroy', 'child:setup']);
  instance.dispose();
  assert.deepEqual(calls, ['child:setup', 'child:destroy', 'child:setup', 'child:destroy']);
});

test('keyed each templates reuse, reorder and remove item instances', async () => {
  const { document, host } = dom();
  let items:
    | {
        (): readonly { id: number; name: string }[];
        set(next: { id: number; name: string }[]): void;
      }
    | undefined;
  const List = defineComponent({
    selector: 'test-each-app',
    setup(context) {
      items = context.signal([
        { id: 1, name: 'one' },
        { id: 2, name: 'two' },
      ]);
      return { items };
    },
    $template: '<div><template data-jcc-each-0><span data-jcc-text-1></span></template></div>',
    $bindings: [
      {
        kind: 'each',
        id: 0,
        item: 'item',
        source: (scope) => (scope.items as () => readonly { id: number; name: string }[])(),
        key: (scope) => (scope.item as { id: number }).id,
      },
      {
        kind: 'text',
        id: 1,
        block: 0,
        textIndex: 0,
        read: (scope) => String((scope.item as { name: string }).name),
      },
    ],
  });
  const instance = mountComponent(host, List, environment());
  const names = () => [...host.querySelectorAll('span')].map((node) => node.textContent);
  assert.deepEqual(names(), ['one', 'two']);
  items!.set([
    { id: 2, name: 'two' },
    { id: 1, name: 'one' },
  ]);
  await settle();
  assert.deepEqual(names(), ['two', 'one']);
  items!.set([
    { id: 2, name: 'second' },
    { id: 3, name: 'three' },
  ]);
  await settle();
  assert.deepEqual(names(), ['second', 'three']);
  instance.dispose();
});

test('slots project parent content evaluated in the parent scope', async () => {
  const { document, host } = dom();
  let label: { (): string; set(next: string): void } | undefined;
  const presses: string[] = [];
  const Child = defineComponent({
    selector: 'test-slot-child',
    setup() {
      return {};
    },
    $template: '<div><slot name="actions"><b>fallback</b></slot></div>',
  });
  const Parent = defineComponent({
    selector: 'test-slot-parent',
    components: [Child],
    setup(context) {
      label = context.signal('outer');
      return { label };
    },
    $template:
      '<test-slot-child><template data-jcc-slot-content-0 slot="actions"><button data-jcc-text-0 data-jcc-on-0></button></template></test-slot-child>',
    $bindings: [
      { kind: 'slot', id: 0, name: 'actions' },
      {
        kind: 'text',
        id: 0,
        block: 0,
        textIndex: 0,
        read: (scope) => String((scope.label as () => string)()),
      },
      {
        kind: 'event',
        id: 0,
        block: 0,
        name: 'click',
        run: (scope) => presses.push(String((scope.label as () => string)())),
      },
    ],
  });
  const instance = mountComponent(host, Parent, environment());
  const button = host.querySelector('button')!;
  assert.equal(button.textContent, 'outer');
  assert.equal(host.querySelector('b'), null);
  label!.set('updated');
  await settle();
  assert.equal(button.textContent, 'updated');
  button.dispatchEvent(new document.defaultView!.Event('click'));
  assert.deepEqual(presses, ['updated']);
  instance.dispose();
});

test('nextTick waits for scheduled rendering without timers', async () => {
  const { document, host } = dom();
  let label: { (): string; set(next: string): void } | undefined;
  const Label = defineComponent({
    selector: 'test-next-tick',
    setup(context) {
      label = context.signal('initial');
      return { label };
    },
    $template: '<span data-jcc-text-0></span>',
    $bindings: [
      {
        kind: 'text',
        id: 0,
        textIndex: 0,
        read: (scope) => String((scope.label as () => string)()),
      },
    ],
  });
  const instance = mountComponent(host, Label, environment());
  label!.set('next');
  await nextTick();
  assert.equal(host.textContent, 'next');
  instance.dispose();
});

test('keyed each moves only rows whose relative order changed', async () => {
  type Row = { id: number; name: string };
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  let rows: { (): readonly Row[]; set(next: Row[]): void } | undefined;
  const List = defineComponent({
    selector: 'test-each-moves',
    setup(context) {
      rows = context.signal(Array.from({ length: 20 }, (_, id) => ({ id, name: `r${id}` })));
      return { rows };
    },
    $template: '<ul><template data-jcc-each-0><li data-jcc-text-1></li></template></ul>',
    $bindings: [
      {
        kind: 'each',
        id: 0,
        item: 'item',
        source: (scope) => (scope.rows as () => readonly Row[])(),
        key: (scope) => (scope.item as Row).id,
      },
      {
        kind: 'text',
        id: 1,
        block: 0,
        textIndex: 0,
        read: (scope) => (scope.item as Row).name,
      },
    ],
  });
  const instance = mountComponent(host, List, environment());
  const nodes = () => new Map(rows!().map((row, i) => [row.id, host.querySelectorAll('li')[i]]));
  // Records reach the callback asynchronously, so collect them there.
  const records: Array<{ addedNodes: ArrayLike<unknown> }> = [];
  const observer = new window.MutationObserver((batch) => records.push(...batch));
  observer.observe(host as unknown as Parameters<typeof observer.observe>[0], {
    childList: true,
    subtree: true,
  });
  const change = async (next: (list: Row[]) => Row[]): Promise<number> => {
    await settle();
    records.length = 0;
    const before = nodes();
    rows!.set(next([...rows!()]));
    await settle();
    await settle();
    records.push(...observer.takeRecords());
    const after = nodes();
    assert.deepEqual(
      [...host.querySelectorAll('li')].map((node) => node.textContent),
      rows!().map((row) => row.name),
    );
    for (const [id, node] of after) if (before.has(id)) assert.equal(node, before.get(id));
    // Count re-inserted rows (jcc-item wrappers), not text updates inside them.
    return records
      .flatMap((record) => Array.from(record.addedNodes))
      .filter((node) => (node as Element).localName === 'jcc-item').length;
  };
  assert.equal(
    await change((list) => list.map((row) => (row.id === 5 ? { ...row, name: 'five' } : row))),
    0,
  );
  assert.equal(
    await change((list) => {
      [list[3], list[15]] = [list[15]!, list[3]!];
      return list;
    }),
    2,
  );
  assert.equal(await change((list) => [...list, { id: 100, name: 'tail' }]), 1);
  assert.equal(
    await change((list) => [...list.slice(0, 7), { id: 101, name: 'mid' }, ...list.slice(7)]),
    1,
  );
  assert.equal(await change((list) => list.filter((row) => row.id % 4 !== 0)), 0);
  const length = rows!().length;
  assert.equal(await change((list) => list.reverse()), length - 1);
  // Mixed shuffles with additions and removals keep content and node identity.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 10; round++)
    await change((list) => {
      const kept = list.filter(() => next() > 0.2);
      for (let i = 0; i < 3; i++) kept.push({ id: 200 + round * 3 + i, name: `n${round}${i}` });
      return kept.sort(() => next() - 0.5);
    });
  observer.disconnect();
  instance.dispose();
});
