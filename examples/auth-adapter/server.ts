import type { AuthRequest, AuthResponse, RequestDriver, SessionUser } from './protocol.js';

interface ServerUser extends SessionUser {
  readonly password: string;
}

export interface AuthServerOptions {
  readonly users: readonly ServerUser[];
  readonly now?: () => number;
  readonly sessionTtlMs?: number;
  readonly failLogout?: boolean;
}

interface Session {
  readonly userId: string;
  readonly expiresAt: number;
}

const TOKEN_COOKIE = 'jcc_session';

export function createAuthServer(options: AuthServerOptions) {
  const now = options.now ?? (() => Date.now());
  const ttl = options.sessionTtlMs ?? 60_000;
  const sessions = new Map<string, Session>();
  let counter = 0;

  const cookieToken = (request: AuthRequest): string | undefined => {
    const header = request.headers?.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [name, value] = part.trim().split('=');
      if (name === TOKEN_COOKIE && value) return value;
    }
    return undefined;
  };
  const currentUser = (request: AuthRequest): ServerUser | undefined => {
    const token = cookieToken(request);
    if (!token) return undefined;
    const session = sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return undefined;
    }
    return options.users.find((user) => user.id === session.userId);
  };
  const view = (user: ServerUser): SessionUser => ({
    id: user.id,
    displayName: user.displayName,
    roles: [...user.roles],
  });
  const json = (status: number, body: unknown, headers?: Record<string, string>): AuthResponse => ({
    status,
    body,
    ...(headers ? { headers } : {}),
  });

  return {
    get sessions() {
      return sessions.size;
    },
    async handle(request: AuthRequest): Promise<AuthResponse> {
      const path = request.path.split('?')[0];
      if (request.method === 'POST' && path === '/auth/login') {
        const body = request.body as { username?: unknown; password?: unknown };
        const user = options.users.find(
          (item) => item.id === body?.username && item.password === body?.password,
        );
        if (!user) return json(401, { error: 'invalid-credentials' });
        const token = `session-${++counter}-${now()}`;
        sessions.set(token, { userId: user.id, expiresAt: now() + ttl });
        return json(
          200,
          { user: view(user) },
          {
            'set-cookie': `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
          },
        );
      }
      if (request.method === 'GET' && path === '/auth/session') {
        const user = currentUser(request);
        return user ? json(200, { user: view(user) }) : json(401, { error: 'unauthenticated' });
      }
      if (request.method === 'POST' && path === '/auth/logout') {
        if (options.failLogout) return json(500, { error: 'revocation-failed' });
        const token = cookieToken(request);
        if (token) sessions.delete(token);
        return json(204, undefined, {
          'set-cookie': `${TOKEN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
        });
      }
      if (request.method === 'GET' && path === '/api/profile') {
        const user = currentUser(request);
        return user ? json(200, { user: view(user) }) : json(401, { error: 'unauthenticated' });
      }
      if (request.method === 'GET' && path === '/api/admin') {
        const user = currentUser(request);
        if (!user) return json(401, { error: 'unauthenticated' });
        if (!user.roles.includes('admin')) return json(403, { error: 'forbidden' });
        return json(200, { ok: true });
      }
      if (request.method === 'POST' && path === '/api/scores') {
        const user = currentUser(request);
        if (!user) return json(401, { error: 'unauthenticated' });
        if (!user.roles.some((role) => role === 'player' || role === 'admin'))
          return json(403, { error: 'forbidden' });
        return json(200, { saved: true });
      }
      return json(404, { error: 'not-found' });
    },
  };
}

export function createCookieJarDriver(
  server: { handle(request: AuthRequest): Promise<AuthResponse> },
  initialCookie?: string,
): { driver: RequestDriver; readonly cookie: string | undefined } {
  let cookie = initialCookie;
  return {
    get cookie() {
      return cookie;
    },
    async driver(request) {
      const headers = { ...(request.headers ?? {}), ...(cookie ? { cookie } : {}) };
      const response = await server.handle({ ...request, headers });
      const setCookie = response.headers?.['set-cookie'];
      if (setCookie) {
        if (/Max-Age=0/i.test(setCookie)) cookie = undefined;
        else cookie = setCookie.split(';')[0];
      }
      return response;
    },
  };
}
