import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  defineComponent,
  mountComponent,
  model,
  input,
  Owner,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  ComponentEnvironment,
  TemplateBinding,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function dom() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('div');
  document.body.append(host);
  return { window, document, host };
}

function environment(errors: unknown[] = []): ComponentEnvironment {
  return { owner: new Owner(), onError: (error) => errors.push(error) };
}

function nativeModel(
  id: number,
  read: (scope: Record<string, unknown>) => unknown,
  write: (scope: Record<string, unknown>, value: unknown) => void,
  config?: (
    scope: Record<string, unknown>,
  ) => { native?: 'text' | 'number' | 'boolean' | 'multiple' } | undefined,
): TemplateBinding {
  return config
    ? { kind: 'native-model', id, name: 'value', read, write, config }
    : { kind: 'native-model', id, name: 'value', read, write };
}

test('native text models update both directions without echoing user events', async () => {
  const { window, document, host } = dom();
  let value: { (): string; set(next: string): void } | undefined;
  const Editor = defineComponent({
    selector: 'test-text-model',
    setup(context) {
      value = context.signal('start');
      return { value };
    },
    $template: '<input data-jcc-model-0 /><span data-jcc-text-0></span>',
    $bindings: [
      nativeModel(
        0,
        (current) => (current.value as () => string)(),
        (current, next) => (current.value as { set(next: string): void }).set(String(next)),
      ),
      {
        kind: 'text',
        id: 0,
        textIndex: 0,
        read: (current) => String((current.value as () => string)()),
      },
    ],
  });
  const instance = mountComponent(host, Editor, environment());
  const field = host.querySelector('input')!;
  const display = host.querySelector('span')!;
  assert.equal(field.value, 'start');
  assert.equal(display.textContent, 'start');
  let events = 0;
  field.addEventListener('input', () => events++);
  field.value = 'typed';
  field.dispatchEvent(new window.Event('input') as unknown as Event);
  await settle();
  assert.equal(value!(), 'typed');
  assert.equal(display.textContent, 'typed');
  assert.equal(events, 1);
  value!.set('reset');
  await settle();
  assert.equal(field.value, 'reset');
  assert.equal(events, 1);
  field.value = 'reset';
  value!.set('reset');
  await settle();
  assert.equal(field.value, 'reset');
  instance.dispose();
});

test('number models keep invalid drafts instead of writing zero', async () => {
  const { window, document, host } = dom();
  let score: { (): number; set(next: number): void } | undefined;
  const Score = defineComponent({
    selector: 'test-number-model',
    models: { score: model<number>({ default: 0, native: 'number' }) },
    setup(context) {
      score = context.models.score;
      return { score: context.models.score };
    },
    $template: '<input data-jcc-model-0 />',
    $bindings: [
      nativeModel(
        0,
        (current) => (current.score as () => number)(),
        (current, next) => (current.score as { set(next: number): void }).set(Number(next)),
        (current) => (current.score as { __jccModel?: { native?: 'number' } }).__jccModel,
      ),
    ],
  });
  const instance = mountComponent(host, Score, environment());
  const field = host.querySelector('input')!;
  field.value = '42';
  field.dispatchEvent(new window.Event('input') as unknown as Event);
  await settle();
  assert.equal(score!(), 42);
  field.value = '';
  field.dispatchEvent(new window.Event('input') as unknown as Event);
  await settle();
  assert.equal(score!(), 42);
  assert.equal(field.value, '');
  field.value = 'not-a-number';
  field.dispatchEvent(new window.Event('input') as unknown as Event);
  await settle();
  assert.equal(score!(), 42);
  assert.equal(field.value, 'not-a-number');
  instance.dispose();
});

test('checkbox and multi-select models convert values through change events', async () => {
  const { window, document, host } = dom();
  let checked: { (): boolean; set(next: boolean): void } | undefined;
  let selected: { (): readonly string[]; set(next: string[]): void } | undefined;
  const Toggle = defineComponent({
    selector: 'test-choice-model',
    setup(context) {
      checked = context.signal(false);
      selected = context.signal<string[]>([]);
      return { checked, selected };
    },
    $template:
      '<input type="checkbox" data-jcc-model-0 /><select multiple data-jcc-model-1><option value="a">a</option><option value="b">b</option></select>',
    $bindings: [
      nativeModel(
        0,
        (current) => (current.checked as () => boolean)(),
        (current, next) => (current.checked as { set(next: boolean): void }).set(Boolean(next)),
      ),
      nativeModel(
        1,
        (current) => (current.selected as () => string[])(),
        (current, next) =>
          (current.selected as { set(next: string[]): void }).set(next as string[]),
      ),
    ],
  });
  const instance = mountComponent(host, Toggle, environment());
  const checkbox = host.querySelector('input')!;
  const select = host.querySelector('select')!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event('change') as unknown as Event);
  await settle();
  assert.equal(checked!(), true);
  for (const option of select.options) option.selected = true;
  select.dispatchEvent(new window.Event('change') as unknown as Event);
  await settle();
  assert.deepEqual(selected!(), ['a', 'b']);
  select.options[0]!.selected = false;
  select.dispatchEvent(new window.Event('change') as unknown as Event);
  await settle();
  assert.deepEqual(selected!(), ['b']);
  instance.dispose();
});

test('custom component models request parent writes and follow parent decisions', async () => {
  const { document, host } = dom();
  let childScope: { value: { (): string; set(value: string): void } } | undefined;
  const Child = defineComponent({
    selector: 'test-model-child',
    models: { value: model<string>({ default: 'child-default' }) },
    setup(context) {
      childScope = { value: context.models.value };
      return { value: context.models.value };
    },
    $template: '<span></span>',
  });
  let parentScope: { value: { (): string; set(value: string): void } } | undefined;
  const Parent = defineComponent({
    selector: 'test-model-parent',
    components: [Child],
    setup(context) {
      const value = context.signal('parent-start');
      parentScope = { value };
      return { value };
    },
    $template: '<test-model-child data-jcc-model-0></test-model-child>',
    $bindings: [
      {
        kind: 'component-model',
        id: 0,
        model: 'value',
        read: (current) => (current.value as () => string)(),
        write: (current, value) =>
          (current.value as { set(value: string): void }).set(String(value)),
      },
    ],
  });
  const instance = mountComponent(host, Parent, environment());
  assert.equal(childScope!.value(), 'parent-start');
  childScope!.value.set('from-child');
  assert.equal(parentScope!.value(), 'from-child');
  await settle();
  assert.equal(childScope!.value(), 'from-child');
  parentScope!.value.set('from-parent');
  await settle();
  assert.equal(childScope!.value(), 'from-parent');
  instance.dispose();
});

test('composition input is not overwritten and commits on composition end', async () => {
  const { window, document, host } = dom();
  let value: { (): string; set(next: string): void } | undefined;
  const Editor = defineComponent({
    selector: 'test-ime-model',
    setup(context) {
      value = context.signal('base');
      return { value };
    },
    $template: '<input data-jcc-model-0 />',
    $bindings: [
      nativeModel(
        0,
        (current) => (current.value as () => string)(),
        (current, next) => (current.value as { set(next: string): void }).set(String(next)),
      ),
    ],
  });
  const instance = mountComponent(host, Editor, environment());
  const field = host.querySelector('input')!;
  field.dispatchEvent(new window.Event('compositionstart') as unknown as Event);
  field.value = 'zhong';
  field.dispatchEvent(new window.Event('input') as unknown as Event);
  await settle();
  assert.equal(value!(), 'base');
  value!.set('programmatic');
  await settle();
  assert.equal(field.value, 'zhong');
  field.value = '中文';
  field.dispatchEvent(new window.Event('compositionend') as unknown as Event);
  await settle();
  assert.equal(value!(), '中文');
  instance.dispose();
});
