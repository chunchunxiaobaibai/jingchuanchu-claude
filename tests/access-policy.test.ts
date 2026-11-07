import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccessService,
  createAuthService,
  createRouter,
  defineAccess,
  defineAuthProvider,
  defineComponent,
  defineRoutes,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  AuthSession,
  HistoryDriver,
  HistoryEventKind,
  HistoryLocation,
  RouteGuardContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

interface User {
  id: string;
  roles: readonly string[];
}

function decode(value: unknown): AuthSession<User> {
  if (value === 'anonymous') return { status: 'anonymous', user: undefined };
  const raw = value as { status?: string; user?: { id?: string; roles?: string[] } };
  if (raw?.status === 'authenticated' && raw.user && typeof raw.user.id === 'string')
    return {
      status: 'authenticated',
      user: { id: raw.user.id, roles: raw.user.roles ?? [] },
    };
  throw new Error('invalid session');
}

const policy = defineAccess({
  admin: ['play', 'settings'],
  player: ['play'],
});

const admin: User = { id: 'admin', roles: ['admin'] };
const player: User = { id: 'player', roles: ['player'] };

function authWith(initial: unknown = 'anonymous') {
  return createAuthService({
    provider: defineAuthProvider<{ id: string; roles: readonly string[] }, User>({
      async restore() {
        return initial;
      },
      async login(input) {
        return { status: 'authenticated', user: input };
      },
      async logout() {},
      decode,
    }),
  });
}

function memoryHistory(): HistoryDriver & { readonly pushes: string[] } {
  let location: HistoryLocation = { path: '/', query: {}, hash: '' };
  const listeners = new Set<(value: HistoryLocation, kind: HistoryEventKind) => void>();
  const pushes: string[] = [];
  return {
    pushes,
    get location() {
      return location;
    },
    push(path: string) {
      pushes.push(path);
      location = { path, query: {}, hash: '' };
    },
    replace(path: string) {
      location = { path, query: {}, hash: '' };
    },
    back() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

test('access checks wait for session restoration and separate anonymous from failures', async () => {
  const auth = authWith('anonymous');
  const access = createAccessService({
    auth,
    policy,
    loginTarget: '/login',
  });
  assert.equal(access.can('play'), false);
  const anonymous = await access.check({ session: 'required', all: ['play'] });
  assert.deepEqual(anonymous, { type: 'redirect', target: '/login' });
  const noRedirect = createAccessService({ auth, policy });
  await auth.ensureSession();
  const denied = await noRedirect.check({ session: 'required', any: ['play'] });
  assert.deepEqual(denied, { type: 'deny', reason: 'anonymous' });

  const failed = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore() {
        throw new Error('401 expired');
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  const failedAccess = createAccessService({
    auth: failed,
    policy,
    loginTarget: '/login',
  });
  const failedResult = await failedAccess.check({ session: 'required', all: ['play'] });
  assert.deepEqual(failedResult, { type: 'deny', reason: 'session-failed' });
  failed.dispose();
  auth.dispose();
});

test('authenticated permissions support all/any, forbidden targets and unknown keys', async () => {
  const auth = authWith('anonymous');
  const access = createAccessService({ auth, policy, forbiddenTarget: '/forbidden' });
  await auth.ensureSession();
  await auth.login(admin);
  assert.equal(access.can('play'), true);
  assert.equal(access.can('settings'), true);
  assert.equal(access.canAll(['play', 'settings']), true);
  assert.equal(access.canAny([]), true);
  assert.deepEqual(await access.check({ session: 'required', all: ['play'], any: ['settings'] }), {
    type: 'allow',
  });
  await auth.logout();
  await auth.login(player);
  assert.equal(access.can('settings'), false);
  assert.deepEqual(await access.check({ session: 'required', all: ['settings'] }), {
    type: 'redirect',
    target: '/forbidden',
  });
  const noRedirect = createAccessService({ auth, policy });
  assert.deepEqual(await noRedirect.check({ session: 'required', all: ['settings'] }), {
    type: 'deny',
    reason: 'forbidden',
  });
  assert.deepEqual(await noRedirect.check({ session: 'required', any: ['unknown'] }), {
    type: 'deny',
    reason: 'unknown-permission:unknown',
  });
  noRedirect.dispose();
  access.dispose();
  auth.dispose();
});

test('route guards accumulate parent access declarations while public children do not reset them', async () => {
  const auth = authWith('anonymous');
  const access = createAccessService({ auth, policy, loginTarget: '/login' });
  const guard = access.guard();
  const context = (metas: Array<Record<string, unknown>>): RouteGuardContext => ({
    from: undefined,
    to: {
      name: 'target',
      path: '/target',
      params: {},
      query: {},
      hash: '',
    },
    params: {},
    query: {},
    metas,
    signal: { aborted: false, throwIfAborted() {} },
  });
  assert.deepEqual(
    await guard(
      context([{ access: { session: 'required', all: ['play'] } }, { access: 'public' }]),
    ),
    { type: 'redirect', target: '/login' },
  );
  await auth.ensureSession();
  await auth.login(player);
  assert.deepEqual(
    await guard(
      context([{ access: { session: 'required', all: ['play'] } }, { access: 'public' }]),
    ),
    { type: 'allow' },
  );
  assert.deepEqual(
    await guard(
      context([
        { access: { session: 'required', all: ['play'] } },
        { access: { session: 'required', all: ['settings'] } },
      ]),
    ),
    { type: 'deny', reason: 'forbidden' },
  );
  assert.deepEqual(
    await guard(
      context([{ access: 'public' }, { access: { session: 'required', all: ['play'] } }]),
    ),
    { type: 'allow' },
  );
  access.dispose();
  auth.dispose();
});

test('router integration redirects anonymous users before preparation and allows admins', async () => {
  const auth = authWith('anonymous');
  const access = createAccessService({
    auth,
    policy,
    loginTarget: '/login',
    forbiddenTarget: '/forbidden',
  });
  let adminPrepares = 0;
  let adminCommits = 0;
  const page = (selector: string) =>
    defineComponent({
      selector,
      setup() {
        return {};
      },
      $template: '<span></span>',
    });
  const Login = page('access-login');
  const Forbidden = page('access-forbidden');
  const Admin = page('access-admin');
  const routes = defineRoutes([
    { name: 'login', path: '/login', page: Login },
    { name: 'forbidden', path: '/forbidden', page: Forbidden },
    {
      name: 'admin',
      path: '/admin',
      page: Admin,
      meta: { access: { session: 'required', all: ['settings'] } },
      guards: [access.guard()],
      prepare() {
        adminPrepares += 1;
        return {};
      },
    },
  ]);
  const router = createRouter({
    routes,
    history: memoryHistory(),
    commit(context) {
      if (context.match.record.name === 'admin') adminCommits += 1;
    },
  });
  const anonymous = await router.push('/admin');
  assert.equal(anonymous.status, 'redirected');
  assert.equal(router.current!.record.name, 'login');
  assert.equal(adminPrepares, 0);
  assert.equal(adminCommits, 0);

  await auth.login(player);
  const forbidden = await router.push('/admin');
  assert.equal(forbidden.status, 'redirected');
  assert.equal(router.current!.record.name, 'forbidden');

  await auth.login(admin);
  const allowed = await router.push('/admin');
  assert.equal(allowed.status, 'committed');
  assert.equal(router.current!.record.name, 'admin');
  assert.equal(adminPrepares, 1);
  assert.equal(adminCommits, 1);
  router.dispose();
  access.dispose();
  auth.dispose();
});

test('unknown sessions wait for restoration and failed restores deny without a login redirect', async () => {
  let release!: (value: unknown) => void;
  const gate = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const auth = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore() {
        return gate;
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  const access = createAccessService({ auth, policy, loginTarget: '/login' });
  const Admin = defineComponent({
    selector: 'wait-admin',
    setup() {
      return {};
    },
    $template: '<span></span>',
  });
  const router = createRouter({
    routes: defineRoutes([
      { name: 'login', path: '/login', page: Admin },
      {
        name: 'admin',
        path: '/admin',
        page: Admin,
        guards: [access.guard()],
        meta: { access: { session: 'required', all: ['settings'] } },
      },
    ]),
    history: memoryHistory(),
  });
  const pending = router.push('/admin');
  await Promise.resolve();
  assert.equal(router.current, undefined);
  release({ status: 'authenticated', user: admin });
  const result = await pending;
  assert.equal(result.status, 'committed');
  assert.equal(router.current!.record.name, 'admin');
  router.dispose();
  access.dispose();
  auth.dispose();

  const failedAuth = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore() {
        throw new Error('expired token');
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  const failedAccess = createAccessService({
    auth: failedAuth,
    policy,
    loginTarget: '/login',
  });
  const failedRouter = createRouter({
    routes: defineRoutes([
      { name: 'login', path: '/login', page: Admin },
      {
        name: 'admin',
        path: '/admin',
        page: Admin,
        guards: [failedAccess.guard()],
        meta: { access: { session: 'required', all: ['settings'] } },
      },
    ]),
    history: memoryHistory(),
  });
  const denied = await failedRouter.push('/admin');
  assert.equal(denied.status, 'denied');
  assert.equal(denied.reason, 'session-failed');
  assert.equal(failedRouter.current, undefined);
  failedRouter.dispose();
  failedAccess.dispose();
  failedAuth.dispose();
});

test('identity changes notify access consumers and applications stay isolated', async () => {
  const firstAuth = authWith('anonymous');
  const secondAuth = authWith('anonymous');
  const first = createAccessService({ auth: firstAuth, policy });
  const second = createAccessService({ auth: secondAuth, policy });
  let changes = 0;
  first.subscribe(() => {
    changes += 1;
  });
  await firstAuth.ensureSession();
  await firstAuth.login(player);
  assert.equal(changes, 1);
  assert.equal(first.can('play'), true);
  assert.equal(second.can('play'), false);
  await firstAuth.logout();
  assert.equal(changes, 2);
  assert.equal(first.can('play'), false);
  first.dispose();
  second.dispose();
  firstAuth.dispose();
  secondAuth.dispose();
});
