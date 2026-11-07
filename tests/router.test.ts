import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  bindRouteLink,
  createBrowserHistoryDriver,
  createMatcher,
  createRouter,
  createRouterOutlet,
  defineComponent,
  defineRoutes,
  input,
  Owner,
  parsePath,
  RouteError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  HistoryDriver,
  HistoryEventKind,
  HistoryLocation,
  RouteLocation,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('matcher resolves params, query, hash, nested chains and static priority', () => {
  const table = defineRoutes([
    { name: 'home', path: '/' },
    { name: 'play', path: '/play/:levelId' },
    { name: 'play-new', path: '/play/new' },
    { name: 'files', path: '/files/*path' },
    {
      name: 'settings',
      path: '/settings',
      children: [{ name: 'settings-profile', path: 'profile' }],
    },
  ]);
  const matcher = createMatcher(table);
  const play = matcher.match('/play/one?mode=hard#top')!;
  assert.equal(play.record.name, 'play');
  assert.deepEqual(play.location.params, { levelId: 'one' });
  assert.deepEqual(play.location.query, { mode: 'hard' });
  assert.equal(play.location.hash, 'top');
  assert.equal(matcher.match('/play/new')!.record.name, 'play-new');
  assert.equal(matcher.match('/files/a/b/c')!.location.params.path, 'a/b/c');
  assert.equal(matcher.match('/')!.record.name, 'home');
  assert.equal(matcher.match('/missing'), undefined);
  const nested = matcher.match('/settings/profile')!;
  assert.deepEqual(
    nested.chain.map((record) => record.name),
    ['settings', 'settings-profile'],
  );
  assert.equal(nested.location.name, 'settings-profile');
});

test('matcher decodes parameters safely and rejects malformed input', () => {
  const matcher = createMatcher(
    defineRoutes([
      { name: 'play', path: '/play/:levelId' },
      { name: 'search', path: '/search/:term' },
    ]),
  );
  assert.equal(matcher.match('/play/a%20b')!.location.params.levelId, 'a b');
  assert.equal(matcher.match('/search/%E0%A4%A'), undefined);
  assert.throws(() => matcher.match('https://example.com/play'), RouteError);
});

test('named targets resolve and validate required parameters', () => {
  const table = defineRoutes([
    { name: 'home', path: '/' },
    { name: 'play', path: '/play/:levelId' },
  ]);
  const matcher = createMatcher(table);
  assert.equal(
    matcher.resolve({
      name: 'play',
      params: { levelId: 'a b' },
      query: { mode: 'hard', skip: undefined },
      hash: 'top',
    }),
    '/play/a%20b?mode=hard#top',
  );
  assert.equal(matcher.resolve('/home'), '/home');
  assert.throws(() => matcher.resolve({ name: 'play' }), /Missing route parameter/);
  assert.throws(() => matcher.resolve({ name: 'missing' }), /Unknown route name/);
  assert.throws(() => matcher.resolve('https://example.com'), /External route target/);
  assert.throws(() => matcher.resolve('relative'), /must start with \//);
  assert.equal(matcher.byName('play')!.fullPath, '/play/:levelId');
  assert.equal(
    matcher.matchTarget({ name: 'play', params: { levelId: 'one' } })!.record.name,
    'play',
  );
});

test('route tables reject duplicate names, patterns and unsupported syntax', () => {
  assert.throws(
    () =>
      defineRoutes([
        { name: 'one', path: '/' },
        { name: 'one', path: '/other' },
      ]),
    /Duplicate route name/,
  );
  assert.throws(
    () =>
      defineRoutes([
        { name: 'one', path: '/same' },
        { name: 'two', path: '/same' },
      ]),
    /Route pattern conflicts/,
  );
  assert.throws(
    () => defineRoutes([{ name: 'bad', path: '/files/*rest/more' }]),
    /Catch-all segment must be last/,
  );
  assert.throws(
    () =>
      defineRoutes([
        { name: 'parent', path: '/parent', children: [{ name: 'child', path: 'child' }] },
        { name: 'other', path: '/parent/child' },
      ]),
    /Route pattern conflicts/,
  );
});

function fakeWindow(mode: 'hash' | 'history', initial = '/') {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const location = {
    hash: mode === 'hash' ? `#${initial}` : '',
    pathname: mode === 'history' ? initial : '/',
    search: '',
  };
  const history = {
    pushState(_data: unknown, _unused: string, url?: string) {
      if (!url) return;
      if (mode === 'hash') location.hash = url;
      else {
        const url_value = new URL(url, 'http://local');
        location.pathname = url_value.pathname;
        location.search = url_value.search;
      }
    },
    replaceState(_data: unknown, _unused: string, url?: string) {
      history.pushState(null, '', url);
    },
    back() {
      emit('popstate');
    },
  };
  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener({});
  };
  return {
    location,
    history,
    addEventListener(type: string, listener: (event: unknown) => void) {
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    emitHash(value: string) {
      location.hash = `#${value}`;
      emit('hashchange');
    },
    emitPop(path: string) {
      location.pathname = path;
      emit('popstate');
    },
  };
}

test('browser history drivers emit external navigation but not their own commits', () => {
  const hashWindow = fakeWindow('hash');
  const hashDriver = createBrowserHistoryDriver(hashWindow, 'hash');
  const events: Array<[HistoryLocation, HistoryEventKind]> = [];
  const stop = hashDriver.subscribe((location, kind) => events.push([location, kind]));
  hashDriver.push('/play?mode=hard');
  assert.equal(hashWindow.location.hash, '/play?mode=hard');
  assert.equal(events.length, 0);
  hashWindow.emitHash('/settings');
  assert.equal(events.length, 1);
  assert.equal(events[0]![0].path, '/settings');
  assert.equal(events[0]![1], 'pop');
  hashWindow.emitHash('/play?mode=hard');
  assert.equal(events.length, 2);
  assert.equal(events[1]![0].path, '/play');
  stop();
  hashWindow.emitHash('/ignored');
  assert.equal(events.length, 2);

  const historyWindow = fakeWindow('history');
  const historyDriver = createBrowserHistoryDriver(historyWindow, 'history');
  const popped: string[] = [];
  historyDriver.subscribe((location) => popped.push(location.path));
  historyDriver.push('/play');
  assert.equal(historyWindow.location.pathname, '/play');
  assert.deepEqual(popped, []);
  historyWindow.emitPop('/back');
  assert.deepEqual(popped, ['/back']);
});

void (null as unknown as HistoryDriver);

function memoryDriver(initial = '/'): HistoryDriver & {
  readonly pushes: string[];
  readonly replaces: string[];
  pop(path: string): void;
} {
  let location = parsePath(initial);
  const listeners = new Set<(value: HistoryLocation, kind: HistoryEventKind) => void>();
  const pushes: string[] = [];
  const replaces: string[] = [];
  return {
    pushes,
    replaces,
    get location() {
      return location;
    },
    push(path: string) {
      pushes.push(path);
      location = parsePath(path);
    },
    replace(path: string) {
      replaces.push(path);
      location = parsePath(path);
    },
    back() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pop(path: string) {
      location = parsePath(path);
      for (const listener of [...listeners]) listener(location, 'pop');
    },
  };
}

const HomePage = defineComponent({
  selector: 'route-home',
  setup() {
    return {};
  },
  $template: '<span>home</span>',
});
const PlayPage = defineComponent({
  selector: 'route-play',
  setup() {
    return {};
  },
  $template: '<span>play</span>',
});

function recorder() {
  const commits: Array<{ name: string; inputs: Record<string, unknown>; mode: string }> = [];
  return {
    commits,
    commit(context: {
      match: { record: { name: string } };
      inputs: Readonly<Record<string, unknown>>;
      mode: string;
    }) {
      commits.push({
        name: context.match.record.name,
        inputs: { ...context.inputs },
        mode: context.mode,
      });
    },
  };
}

test('router commits push and replace with prepared inputs', async () => {
  const history = memoryDriver();
  const record = recorder();
  const routes = defineRoutes([
    { name: 'home', path: '/', page: HomePage },
    {
      name: 'play',
      path: '/play/:levelId',
      page: PlayPage,
      prepare: ({ params }) => ({ levelId: params.levelId }),
    },
  ]);
  const router = createRouter({ routes, history, commit: record.commit });
  const pushed = await router.push({ name: 'play', params: { levelId: 'one' } });
  assert.equal(pushed.status, 'committed');
  assert.equal(router.current!.record.name, 'play');
  assert.equal(router.pending, undefined);
  assert.deepEqual(record.commits, [{ name: 'play', inputs: { levelId: 'one' }, mode: 'push' }]);
  assert.deepEqual(history.pushes, ['/play/one']);
  const replaced = await router.replace('/');
  assert.equal(replaced.status, 'committed');
  assert.equal(router.current!.record.name, 'home');
  assert.equal(history.replaces.at(-1), '/');
  router.dispose();
});

test('guards deny, redirect and run beforeLeave before entering the target', async () => {
  const history = memoryDriver();
  const record = recorder();
  const routes = defineRoutes([
    {
      name: 'home',
      path: '/',
      page: HomePage,
      beforeLeave: [
        ({ to }) => (to.name === 'blocked' ? { type: 'deny', reason: 'stay' } : { type: 'allow' }),
      ],
    },
    { name: 'blocked', path: '/blocked', page: PlayPage },
    {
      name: 'play',
      path: '/play',
      page: PlayPage,
      guards: [() => ({ type: 'redirect', target: { name: 'home' } })],
    },
    {
      name: 'denied',
      path: '/denied',
      page: PlayPage,
      guards: [() => ({ type: 'deny', reason: 'no access' })],
    },
  ]);
  const router = createRouter({ routes, history, commit: record.commit });
  const denied = await router.push({ name: 'denied' });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.reason as string, 'no access');
  assert.equal(record.commits.length, 0);
  const redirected = await router.push({ name: 'play' });
  assert.equal(redirected.status, 'redirected');
  assert.equal(router.current!.record.name, 'home');
  assert.deepEqual(
    record.commits.map((item) => item.name),
    ['home'],
  );
  const leaveDenied = await router.push({ name: 'blocked' });
  assert.equal(leaveDenied.status, 'denied');
  assert.equal(router.current!.record.name, 'home');
  router.dispose();
});

test('prepare inputs are validated and failures keep the committed page', async () => {
  const history = memoryDriver();
  const record = recorder();
  const RequiredPage = defineComponent({
    selector: 'route-required',
    inputs: { levelId: input<string>({ required: true }) },
    setup() {
      return {};
    },
    $template: '<span>required</span>',
  });
  const routes = defineRoutes([
    { name: 'home', path: '/', page: HomePage },
    { name: 'required', path: '/required', page: RequiredPage },
    {
      name: 'broken',
      path: '/broken',
      page: RequiredPage,
      prepare: () => ({}),
    },
    {
      name: 'throws',
      path: '/throws',
      page: RequiredPage,
      prepare: () => {
        throw new Error('prepare failure');
      },
    },
  ]);
  const router = createRouter({ routes, history, commit: record.commit });
  await router.replace('/');
  const failed = await router.push({ name: 'broken' });
  assert.equal(failed.status, 'failed');
  assert.match(String((failed.reason as Error).message), /Missing required page input/);
  assert.equal(router.current!.record.name, 'home');
  assert.equal((router.error as Error).message.includes('Missing required page input'), true);
  const thrown = await router.push({ name: 'throws' });
  assert.equal(thrown.status, 'failed');
  assert.equal(router.current!.record.name, 'home');
  assert.deepEqual(
    record.commits.map((item) => item.name),
    ['home'],
  );
  router.dispose();
});

test('rapid navigation cancels preparation and commits only the latest target', async () => {
  const history = memoryDriver();
  const record = recorder();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const routes = defineRoutes([
    { name: 'home', path: '/', page: HomePage },
    {
      name: 'slow',
      path: '/slow',
      page: PlayPage,
      prepare: async () => {
        await gate;
        return {};
      },
    },
  ]);
  const router = createRouter({ routes, history, commit: record.commit });
  const slow = router.push('/slow');
  await Promise.resolve();
  assert.equal(router.pending, '/slow');
  const home = await router.push('/');
  assert.equal(home.status, 'committed');
  release();
  const cancelled = await slow;
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(
    record.commits.map((item) => item.name),
    ['home'],
  );
  assert.deepEqual(history.pushes, ['/']);
  router.dispose();
});

test('denied history navigation restores the committed URL', async () => {
  const history = memoryDriver();
  const record = recorder();
  const routes = defineRoutes([
    { name: 'home', path: '/', page: HomePage },
    {
      name: 'blocked',
      path: '/blocked',
      page: PlayPage,
      guards: [() => ({ type: 'deny', reason: 'no' })],
    },
  ]);
  const router = createRouter({ routes, history, commit: record.commit });
  await router.replace('/');
  const back = router.back();
  history.pop('/blocked');
  const result = await back;
  assert.equal(result.status, 'denied');
  assert.equal(router.current!.record.name, 'home');
  assert.equal(history.replaces.at(-1), '/');
  router.dispose();
});

test('redirect loops and disposed routers fail explicitly', async () => {
  const history = memoryDriver();
  const routes = defineRoutes([
    { name: 'a', path: '/a', redirect: '/b' },
    { name: 'b', path: '/b', redirect: '/a' },
  ]);
  const router = createRouter({ routes, history });
  const result = await router.push('/a');
  assert.equal(result.status, 'failed');
  assert.match(String((result.reason as Error).message), /Redirect loop/);
  router.dispose();
  const after = await router.push('/a');
  assert.equal(after.status, 'failed');
});

test('router outlet swaps page owners atomically and exposes the route context', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const container = document.createElement('div');
  const outletHost = document.createElement('router-outlet');
  container.append(outletHost);
  document.body.append(container);
  const owner = new Owner();
  const contexts: RouteLocation[] = [];
  let cleanups = 0;
  const Home = defineComponent({
    selector: 'outlet-home',
    setup(context) {
      contexts.push(context.route!);
      context.own(() => {
        cleanups += 1;
      });
      return { text: 'home' };
    },
    $template: '<span data-jcc-text-0></span>',
    $bindings: [{ kind: 'text', id: 0, textIndex: 0, read: (scope) => String(scope.text) }],
  });
  const Play = defineComponent({
    selector: 'outlet-play',
    inputs: { levelId: input<string>({ default: '' }) },
    setup(context) {
      contexts.push(context.route!);
      return { levelId: context.inputs.levelId };
    },
    $template: '<span data-jcc-text-0></span>',
    $bindings: [
      {
        kind: 'text',
        id: 0,
        textIndex: 0,
        read: (scope) => String((scope.levelId as () => string)()),
      },
    ],
  });
  const errors: unknown[] = [];
  const outlet = createRouterOutlet(outletHost, owner, { onError: (error) => errors.push(error) });
  const router = createRouter({
    routes: defineRoutes([
      { name: 'home', path: '/', page: Home },
      {
        name: 'play',
        path: '/play/:levelId',
        page: Play,
        prepare: ({ params }) => ({ levelId: params.levelId }),
      },
    ]),
    history: memoryDriver(),
    commit: outlet.commit,
  });
  assert.equal((await router.push('/play/one')).status, 'committed');
  assert.equal(container.textContent, 'one');
  assert.equal(contexts.at(-1)!.params.levelId, 'one');
  const firstPageOwner = outlet.pageOwner!;
  assert.equal((await router.push('/')).status, 'committed');
  assert.equal(container.textContent, 'home');
  assert.equal(firstPageOwner.disposed, true);
  assert.equal(cleanups, 0);
  const homePageOwner = outlet.pageOwner!;
  assert.equal((await router.push('/play/two')).status, 'committed');
  assert.equal(container.textContent, 'two');
  assert.equal(homePageOwner.disposed, true);
  assert.equal(cleanups, 1);
  outlet.dispose();
  router.dispose();
  owner.dispose();
  assert.deepEqual(errors, []);
});

test('outlet keeps the committed page when old page cleanup fails', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const host = document.createElement('router-outlet');
  document.body.append(host);
  const owner = new Owner();
  const errors: unknown[] = [];
  const Old = defineComponent({
    selector: 'outlet-old',
    setup() {
      return {};
    },
    onDestroy() {
      throw new Error('old cleanup');
    },
    $template: '<span>old</span>',
  });
  const Next = defineComponent({
    selector: 'outlet-next',
    setup() {
      return {};
    },
    $template: '<span>next</span>',
  });
  const outlet = createRouterOutlet(host, owner, { onError: (error) => errors.push(error) });
  const router = createRouter({
    routes: defineRoutes([
      { name: 'old', path: '/old', page: Old },
      { name: 'next', path: '/next', page: Next },
    ]),
    history: memoryDriver(),
    commit: outlet.commit,
  });
  await router.push('/old');
  const result = await router.push('/next');
  assert.equal(result.status, 'committed');
  assert.equal(host.textContent, 'next');
  assert.equal(errors.length, 1);
  outlet.dispose();
  router.dispose();
});

test('route links resolve hrefs and navigate without reloading', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const anchor = document.createElement('a');
  document.body.append(anchor);
  const router = createRouter({
    routes: defineRoutes([
      { name: 'home', path: '/', page: HomePage },
      { name: 'play', path: '/play/:levelId', page: PlayPage },
    ]),
    history: memoryDriver(),
  });
  const stop = bindRouteLink(anchor, router, { name: 'play', params: { levelId: 'two' } });
  assert.equal(anchor.getAttribute('href'), '#/play/two');
  const allowed = anchor.dispatchEvent(
    new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }) as unknown as Event,
  );
  assert.equal(allowed, false);
  await settle();
  assert.equal(router.current!.record.name, 'play');
  assert.equal(router.current!.location.params.levelId, 'two');
  anchor.dispatchEvent(
    new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    }) as unknown as Event,
  );
  stop();
  router.dispose();
});
