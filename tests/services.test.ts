import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  Owner,
  OwnerError,
  ServiceError,
  defineComponent,
  defineService,
  mountComponent,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ComponentEnvironment } from '@xiaobaibaifqy/jingchuanchu-app/application';

test('services resolve once per owner and inherit to child owners', () => {
  let created = 0;
  const Logger = defineService({
    name: 'logger',
    factory(context) {
      created += 1;
      return { log: (message: string) => `${context.name}:${message}` };
    },
  });
  const application = new Owner();
  application.provideService(Logger);
  const page = application.createChild();
  const first = page.useService(Logger);
  const second = page.useService(Logger);
  assert.strictEqual(first, second);
  assert.equal(created, 1);
  assert.equal(first.log('hello'), 'logger:hello');
  const other = new Owner();
  other.provideService(Logger);
  assert.notStrictEqual(other.useService(Logger), first);
  assert.equal(created, 2);
});

test('page overrides shadow application services without affecting siblings', () => {
  const Format = defineService({
    name: 'format',
    factory() {
      return { prefix: 'app' };
    },
  });
  const application = new Owner();
  application.provideService(Format);
  const page = application.createChild();
  page.provideService(Format, () => ({ prefix: 'page' }));
  const otherPage = application.createChild();
  assert.equal(page.useService(Format).prefix, 'page');
  assert.equal(otherPage.useService(Format).prefix, 'app');
  assert.equal(application.useService(Format).prefix, 'app');
});

test('nested services resolve from the owning scope and report missing or circular ones', () => {
  let shared = 0;
  const Shared = defineService({
    name: 'shared',
    factory() {
      shared += 1;
      return { value: shared };
    },
  });
  const Dependent = defineService({
    name: 'dependent',
    factory(context) {
      const service = context.useService(Shared);
      return { value: service.value * 10 };
    },
  });
  const application = new Owner();
  application.provideService(Shared);
  application.provideService(Dependent);
  assert.equal(application.useService(Dependent).value, 10);
  assert.equal(application.useService(Shared).value, 1);
  assert.equal(shared, 1);

  assert.throws(
    () => new Owner().useService(Shared),
    (error) => error instanceof ServiceError && /not provided/.test(error.message),
  );

  let A: ReturnType<typeof defineService>;
  let B: ReturnType<typeof defineService>;
  A = defineService({
    name: 'service-a',
    factory(context) {
      context.useService(B);
      return {};
    },
  });
  B = defineService({
    name: 'service-b',
    factory(context) {
      context.useService(A);
      return {};
    },
  });
  const circular = new Owner();
  circular.provideService(A);
  circular.provideService(B);
  assert.throws(
    () => circular.useService(A),
    /Circular service dependency: service-a -> service-b -> service-a/,
  );
});

test('service cleanup follows the owner and disposed owners reject lookups', () => {
  let cleanups = 0;
  const Resource = defineService({
    name: 'resource',
    factory(context) {
      context.own(() => {
        cleanups += 1;
      });
      return { ready: true };
    },
  });
  const application = new Owner();
  application.provideService(Resource);
  application.useService(Resource);
  application.dispose();
  assert.equal(cleanups, 1);
  assert.throws(() => application.useService(Resource), OwnerError);
});

test('components resolve services from their page owner', () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const Log = defineService({
    name: 'log',
    factory() {
      return { entries: [] as string[] };
    },
  });
  const application = new Owner();
  application.provideService(Log);
  const page = application.createChild();
  const environment: ComponentEnvironment = {
    owner: page,
    onError(error) {
      throw error;
    },
  };
  const resolved: Array<{ entries: string[] }> = [];
  const View = defineComponent({
    selector: 'service-view',
    setup(context) {
      resolved.push(context.useService(Log));
      return {};
    },
    $template: '<span></span>',
  });
  const firstHost = document.createElement('div');
  const secondHost = document.createElement('div');
  document.body.append(firstHost, secondHost);
  const first = mountComponent(firstHost, View, environment);
  const second = mountComponent(secondHost, View, environment);
  assert.strictEqual(resolved[0], resolved[1]);
  first.dispose();
  second.dispose();
});
