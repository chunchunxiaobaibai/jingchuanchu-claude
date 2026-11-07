import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthError,
  createAuthService,
  defineAuthProvider,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { AuthSession } from '@xiaobaibaifqy/jingchuanchu-app/application';

interface User {
  id: string;
  roles: readonly string[];
}

function decode(value: unknown): AuthSession<User> {
  if (value === 'anonymous') return { status: 'anonymous', user: undefined };
  const raw = value as { status?: string; user?: { id?: unknown; roles?: unknown } };
  if (
    raw?.status === 'authenticated' &&
    raw.user &&
    typeof raw.user.id === 'string' &&
    Array.isArray(raw.user.roles)
  )
    return {
      status: 'authenticated',
      user: { id: raw.user.id, roles: raw.user.roles as string[] },
    };
  throw new Error('invalid session payload');
}

const authenticated: User = { id: 'alice', roles: ['player'] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('restore is shared, validates provider output and distinguishes failure from anonymous', async () => {
  const gate = deferred<unknown>();
  let restores = 0;
  const provider = defineAuthProvider<undefined, User>({
    async restore() {
      restores += 1;
      return gate.promise;
    },
    async login() {
      return { status: 'authenticated', user: authenticated };
    },
    async logout() {},
    decode,
  });
  const service = createAuthService({ provider });
  assert.equal(service.status, 'unknown');
  const first = service.ensureSession();
  assert.equal(service.status, 'restoring');
  const second = service.ensureSession();
  assert.strictEqual(first, second);
  gate.resolve({ status: 'authenticated', user: authenticated });
  const session = await first;
  assert.deepEqual(session.user, authenticated);
  assert.equal(service.status, 'authenticated');
  assert.equal(restores, 1);
  service.dispose();

  const failed = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore() {
        throw new Error('network down');
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  await assert.rejects(failed.ensureSession(), AuthError);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.session, undefined);
  failed.dispose();

  const anonymous = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore() {
        return 'anonymous';
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  const anonymousSession = await anonymous.ensureSession();
  assert.equal(anonymousSession.status, 'anonymous');
  assert.equal(anonymous.session!.status, 'anonymous');
  assert.equal(anonymous.session!.user, undefined);
  anonymous.dispose();

  const invalid = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore() {
        return { status: 'bogus' };
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  await assert.rejects(invalid.ensureSession(), /invalid session payload/);
  assert.equal(invalid.status, 'failed');
  invalid.dispose();
});

test('login authenticates and identity switches notify user-scoped cleanup', async () => {
  let changes = 0;
  let lastGeneration = 0;
  const provider = defineAuthProvider<{ name: string }, User>({
    async restore() {
      return 'anonymous';
    },
    async login(input) {
      return {
        status: 'authenticated',
        user: { id: input.name, roles: ['player'] },
      };
    },
    async logout() {},
    decode,
  });
  const service = createAuthService({ provider });
  service.onIdentityChange((_session, generation) => {
    changes += 1;
    lastGeneration = generation;
  });
  const anonymous = await service.ensureSession();
  assert.equal(anonymous.status, 'anonymous');
  const result = await service.login({ name: 'bob' });
  assert.equal(result.status, 'authenticated');
  assert.equal(service.status, 'authenticated');
  assert.equal(service.session!.user!.id, 'bob');
  assert.equal(changes, 1);
  assert.equal(lastGeneration, service.generation);

  const failingProvider = defineAuthProvider<{ name: string }, User>({
    async restore() {
      return 'anonymous';
    },
    async login() {
      throw new Error('bad credentials');
    },
    async logout() {},
    decode,
  });
  const failing = createAuthService({ provider: failingProvider });
  await failing.ensureSession();
  const before = failing.generation;
  const failed = await failing.login({ name: 'x' });
  assert.equal(failed.status, 'failed');
  assert.equal(failing.status, 'anonymous');
  assert.equal(failing.generation, before + 1);
  failing.dispose();
});

test('logout cleans local identity before the provider result and reports revocation failure', async () => {
  const gate = deferred<void>();
  const provider = defineAuthProvider<undefined, User>({
    async restore() {
      return { status: 'authenticated', user: authenticated };
    },
    async login() {
      return 'anonymous';
    },
    async logout() {
      await gate.promise;
      throw new Error('revocation failed');
    },
    decode,
  });
  const service = createAuthService({ provider });
  await service.ensureSession();
  let cleaned: AuthSession<User> | undefined | 'unset' = 'unset';
  service.onIdentityChange((session) => {
    cleaned = session;
  });
  const logout = service.logout();
  assert.equal(service.status, 'anonymous');
  assert.equal(service.session, undefined);
  assert.equal(cleaned, undefined);
  gate.reject(new Error('revocation failed'));
  const result = await logout;
  assert.equal(result.status, 'failed');
  assert.ok(result.status === 'failed' && result.error instanceof AuthError);
  assert.equal(service.status, 'anonymous');
  service.dispose();
});

test('superseded login results cannot restore an old identity', async () => {
  const loginGate = deferred<unknown>();
  const provider = defineAuthProvider<{ name: string }, User>({
    async restore() {
      return 'anonymous';
    },
    async login(input) {
      if (input.name === 'slow') return loginGate.promise;
      return { status: 'authenticated', user: authenticated };
    },
    async logout() {},
    decode,
  });
  const service = createAuthService({ provider });
  await service.ensureSession();
  const slow = service.login({ name: 'slow' });
  const logout = await service.logout();
  assert.equal(logout.status, 'logged-out');
  loginGate.resolve({ status: 'authenticated', user: authenticated });
  const result = await slow;
  assert.equal(result.status, 'cancelled');
  assert.equal(service.status, 'anonymous');
  assert.equal(service.session, undefined);
  service.dispose();

  const second = createAuthService({ provider });
  await second.ensureSession();
  assert.equal(second.status, 'anonymous');
  second.dispose();
});

test('disposing while restoring cancels the pending restore', async () => {
  const gate = deferred<unknown>();
  const service = createAuthService({
    provider: defineAuthProvider<undefined, User>({
      async restore(signal) {
        await gate.promise;
        signal.throwIfAborted();
        return 'anonymous';
      },
      async login() {
        return 'anonymous';
      },
      async logout() {},
      decode,
    }),
  });
  const pending = service.ensureSession();
  service.dispose();
  gate.resolve('anonymous');
  await assert.rejects(pending, AuthError);
});
