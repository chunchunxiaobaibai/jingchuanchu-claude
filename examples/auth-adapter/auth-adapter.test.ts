import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createAuthServer, createCookieJarDriver, createHttpAuthProvider } from './index.js';

const users = [
  { id: 'alice', password: 'player-pass', displayName: 'Alice', roles: ['player'] },
  { id: 'admin', password: 'admin-pass', displayName: 'Admin', roles: ['admin'] },
];

test('cookie-backed provider restores, logs in and distinguishes expired sessions', async () => {
  let now = 1_000;
  const server = createAuthServer({ users, now: () => now, sessionTtlMs: 100 });
  const jar = createCookieJarDriver(server);
  const provider = createHttpAuthProvider(jar.driver);
  const service = createAuthService({ provider });
  const anonymous = await service.ensureSession();
  assert.equal(anonymous.status, 'anonymous');
  const invalid = await service.login({ username: 'alice', password: 'wrong' });
  assert.equal(invalid.status, 'failed');
  const valid = await service.login({ username: 'alice', password: 'player-pass' });
  assert.equal(valid.status, 'authenticated');
  assert.equal(service.session!.user!.displayName, 'Alice');
  assert.ok(jar.cookie?.startsWith('jcc_session='));
  assert.equal(JSON.stringify(service.session).includes('player-pass'), false);

  const secondService = createAuthService({
    provider: createHttpAuthProvider(jar.driver),
  });
  const restored = await secondService.ensureSession();
  assert.equal(restored.status, 'authenticated');
  assert.equal(restored.user!.id, 'alice');
  secondService.dispose();

  now += 1_000;
  const expiredService = createAuthService({
    provider: createHttpAuthProvider(jar.driver),
  });
  const expired = await expiredService.ensureSession();
  assert.equal(expired.status, 'anonymous');
  expiredService.dispose();
  service.dispose();
});

test('server rejects bypassed requests and distinguishes 401 from 403', async () => {
  const server = createAuthServer({ users });
  const anonymous = createCookieJarDriver(server);
  assert.equal((await anonymous.driver({ method: 'GET', path: '/api/admin' })).status, 401);
  assert.equal((await anonymous.driver({ method: 'POST', path: '/api/scores' })).status, 401);

  const playerJar = createCookieJarDriver(server);
  const playerService = createAuthService({
    provider: createHttpAuthProvider(playerJar.driver),
  });
  assert.equal(
    (await playerService.login({ username: 'alice', password: 'player-pass' })).status,
    'authenticated',
  );
  const playerCookie = playerJar.cookie!;
  assert.equal(
    (await server.handle({ method: 'GET', path: '/api/admin', headers: { cookie: playerCookie } }))
      .status,
    403,
  );
  assert.equal(
    (
      await server.handle({
        method: 'POST',
        path: '/api/scores',
        headers: { cookie: playerCookie },
      })
    ).status,
    200,
  );

  const adminJar = createCookieJarDriver(server);
  const adminService = createAuthService({
    provider: createHttpAuthProvider(adminJar.driver),
  });
  await adminService.login({ username: 'admin', password: 'admin-pass' });
  assert.equal(
    (
      await server.handle({
        method: 'GET',
        path: '/api/admin',
        headers: { cookie: adminJar.cookie! },
      })
    ).status,
    200,
  );
  assert.equal((await server.handle({ method: 'GET', path: '/api/admin' })).status, 401);
  playerService.dispose();
  adminService.dispose();
});

test('logout revokes the server session but a failed revocation is reported honestly', async () => {
  const server = createAuthServer({ users });
  const jar = createCookieJarDriver(server);
  const service = createAuthService({ provider: createHttpAuthProvider(jar.driver) });
  await service.login({ username: 'alice', password: 'player-pass' });
  const previousCookie = jar.cookie!;
  assert.equal((await service.logout()).status, 'logged-out');
  assert.equal(service.status, 'anonymous');
  assert.equal(jar.cookie, undefined);
  assert.equal(
    (
      await server.handle({
        method: 'GET',
        path: '/api/profile',
        headers: { cookie: previousCookie },
      })
    ).status,
    401,
  );
  service.dispose();

  const failingServer = createAuthServer({ users, failLogout: true });
  const failingJar = createCookieJarDriver(failingServer);
  const failingService = createAuthService({
    provider: createHttpAuthProvider(failingJar.driver),
  });
  await failingService.login({ username: 'alice', password: 'player-pass' });
  const result = await failingService.logout();
  assert.equal(result.status, 'failed');
  assert.equal(failingService.status, 'anonymous');
  assert.equal(failingService.session, undefined);
  assert.equal(failingServer.sessions, 1);
  assert.equal(
    (
      await failingServer.handle({
        method: 'GET',
        path: '/api/profile',
        headers: { cookie: failingJar.cookie! },
      })
    ).status,
    200,
  );
  failingService.dispose();
});
